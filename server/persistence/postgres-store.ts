import { validatePlanDates, profilePinSchema, ValidationError } from '../validation.js';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import type {
  AvailabilityEntry,
  AvailabilitySlot,
  AvailabilityStatus,
  CarpoolRide,
  ChecklistItem,
  CommentEntry,
  HolidayCountry,
  Participant,
  Plan,
  PlanGranularity,
  PlanSnapshot,
  PlanVisibility,
  PollOption,
  RetentionPolicy,
  RsvpEntry,
  RsvpStatus,
  SubPoll,
  SubPollCategory,
  SubPollOption,
  VoteEntry,
} from '../../shared/types.js';
import {
  AVATAR_COLORS,
  AVATAR_EMOJIS,
  addMonthsISO,
  formatDateISO,
  formatMonthISO,
  isVotingEffectivelyOpen,
  normalizeEnabledSlots,
} from '../../shared/dates.js';
import {
  computeExpiresAt,
  isPlanExpired,
  pickLaterExpiration,
  type ExportedPlanBackup,
  type PlanSummaryItem,
} from '../../shared/persistence.js';
import type {
  CreatePlanInput,
  PlanAuthRow,
  ShalendarStore,
  StoreHealthStatus,
  UpdatePlanSettingsInput,
} from '../store.js';
import type { PersistenceConfig } from './config.js';
import { runMigrations } from './migrator.js';
import {
  buildPgPoolOptions,
  checkDatabaseHealth,
  withTransaction,
  type PgPoolLike,
  type PgQueryClient,
} from './pool.js';
import { purgeExpiredPlansSql } from './purge-worker.js';
import { PlanExpiredError, type PurgeSummary } from './repository.js';
import {
  generateSecretToken,
  generateSecureSlug,
  hashToken,
  verifyTokenHash,
} from './security.js';

function safeTimingEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function hashPin(participantId: string, pin: string): string {
  return crypto
    .createHash('sha256')
    .update(`${participantId}:${pin.trim()}`)
    .digest('hex');
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function parseRequiredIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asGranularity(value: unknown): PlanGranularity {
  if (value === 'meals') return 'meals';
  if (value === 'slots') return 'slots';
  return 'day';
}

function asPolicy(value: unknown): RetentionPolicy {
  const str = String(value ?? 'ephemeral_after_event');
  if (
    str === 'ephemeral_after_event' ||
    str === 'fixed_ttl' ||
    str === 'sliding_inactivity' ||
    str === 'persistent'
  ) {
    return str;
  }
  return 'ephemeral_after_event';
}

export class PostgresShalendarStore implements ShalendarStore {
  readonly driver = 'postgres' as const;

  constructor(
    private readonly pool: PgPoolLike,
    private readonly config: PersistenceConfig
  ) {}

  static async connect(
    config: PersistenceConfig,
    migrationsDir?: string
  ): Promise<PostgresShalendarStore> {
    const pool = new Pool(buildPgPoolOptions(config));
    // Prevent unhandled 'error' events on idle clients (e.g. Postgres restart / Neon scale-to-zero)
    // from crashing the entire Node.js process.
    pool.on('error', (err) => {
      console.error('[shalendar:pg-pool] Error inesperado en cliente inactivo de PostgreSQL:', err);
    });
    await runMigrations(pool, migrationsDir);
    return new PostgresShalendarStore(pool, config);
  }

  getPool(): PgPoolLike {
    return this.pool;
  }

  private mapPlan(row: Record<string, unknown>): Plan {
    const granularity = asGranularity(row.granularity);
    const enabledSlots = normalizeEnabledSlots(granularity, parseRequiredIds(row.enabled_slots));
    return {
      id: String(row.id),
      slug: String(row.slug),
      title: String(row.title),
      description: String(row.description ?? ''),
      location: String(row.location ?? ''),
      emoji: String(row.emoji ?? '🍕'),
      startMonth: String(row.start_month),
      endMonth: String(row.end_month),
      maxVotesPerUser: Number(row.max_votes_per_user ?? 3),
      votingOpen: Boolean(row.voting_open),
      votingDeadline: toIsoOrNull(row.voting_deadline),
      blindVoting: Boolean(row.blind_voting),
      granularity,
      enabledSlots,
      durationDays: Math.max(1, Math.min(7, Number(row.duration_days ?? 1))),
      holidayCountry: String(row.holiday_country ?? 'ES') as HolidayCountry,
      requiredParticipantIds: parseRequiredIds(row.required_participant_ids),
      confirmedDate: row.confirmed_date ? String(row.confirmed_date) : null,
      confirmedEndDate: row.confirmed_end_date ? String(row.confirmed_end_date) : null,
      confirmedTime: row.confirmed_time ? String(row.confirmed_time) : null,
      confirmedDurationMinutes: Number(row.confirmed_duration_minutes ?? 180),
      confirmedTimezone: row.confirmed_timezone ? String(row.confirmed_timezone) : null,
      visibility: (row.visibility === 'public_demo' ? 'public_demo' : 'unlisted') as PlanVisibility,
      retentionPolicy: asPolicy(row.retention_policy),
      retentionDays: Number(row.retention_days ?? 30),
      lastActivityAt: toIso(row.last_activity_at ?? row.created_at),
      expiresAt: toIsoOrNull(row.expires_at),
      createdAt: toIso(row.created_at),
    };
  }

  private mapParticipant(row: Record<string, unknown>): Participant {
    return {
      id: String(row.id),
      planId: String(row.plan_id),
      name: String(row.name),
      avatarColor: String(row.avatar_color),
      avatarEmoji: String(row.avatar_emoji),
      isOrganizer: Boolean(row.is_organizer),
      hasPin: Boolean(row.pin_hash),
      createdAt: toIso(row.created_at),
    };
  }

  private async fetchPlanRowBySlug(slug: string): Promise<Record<string, unknown> | null> {
    const res = await this.pool.query('SELECT * FROM plans WHERE slug = $1', [slug]);
    const row = res.rows[0];
    if (!row) return null;

    const isDemo = Boolean(row.is_demo);
    const expiresAt = toIsoOrNull(row.expires_at);
    if (!isDemo && isPlanExpired(expiresAt)) {
      await this.pool.query('DELETE FROM plans WHERE id = $1', [String(row.id)]);
      throw new PlanExpiredError();
    }

    return row;
  }

  /**
   * Updates last_activity_at and rolls expires_at forward when using sliding_inactivity
   * or pre-confirmation ephemeral_after_event.
   */
  private async touchPlanActivity(planId: string, client?: PgQueryClient): Promise<void> {
    const runner = client ?? this.pool;
    const res = await runner.query(
      'SELECT is_demo, retention_policy, retention_days, confirmed_date, confirmed_end_date, expires_at FROM plans WHERE id = $1',
      [planId]
    );
    const row = res.rows[0];
    if (!row || Boolean(row.is_demo)) return;

    const now = new Date();
    const policy = asPolicy(row.retention_policy);
    const retentionDays = Number(row.retention_days ?? this.config.defaultRetentionDays);
    const confirmedDate = row.confirmed_date ? String(row.confirmed_date) : null;
    const confirmedEndDate = row.confirmed_end_date ? String(row.confirmed_end_date) : null;
    const currentExpiresAt = toIsoOrNull(row.expires_at);

    if (policy === 'sliding_inactivity' || (policy === 'ephemeral_after_event' && !confirmedDate)) {
      const candidateExpiresAt = computeExpiresAt({
        policy,
        retentionDays,
        now,
        confirmedDate,
        confirmedEndDate,
        postEventGraceDays: this.config.postEventGraceDays,
      });
      const nextExpiresAt = pickLaterExpiration(currentExpiresAt, candidateExpiresAt);
      await runner.query(
        'UPDATE plans SET last_activity_at = $1::timestamptz, expires_at = $2::timestamptz WHERE id = $3',
        [now.toISOString(), nextExpiresAt, planId]
      );
    } else {
      await runner.query('UPDATE plans SET last_activity_at = $1::timestamptz WHERE id = $2', [
        now.toISOString(),
        planId,
      ]);
    }
  }

  async getPlanAuthRowBySlug(slug: string): Promise<PlanAuthRow | null> {
    const row = await this.fetchPlanRowBySlug(slug);
    if (!row) return null;
    return {
      id: String(row.id),
      slug: String(row.slug),
      isDemo: Boolean(row.is_demo),
      adminTokenOrHash: String(row.admin_token_hash),
      adminTokenIsHashed: true,
      retentionPolicy: asPolicy(row.retention_policy),
      retentionDays: Number(row.retention_days ?? 30),
      expiresAt: toIsoOrNull(row.expires_at),
    };
  }

  verifyAdminToken(planRow: PlanAuthRow, token: string | null | undefined): boolean {
    return verifyTokenHash(token, planRow.adminTokenOrHash);
  }

  async verifyParticipantToken(
    planId: string,
    participantId: string,
    token: string | null | undefined,
    _allowDemoPlan = false
  ): Promise<boolean> {
    if (!token) return false;
    const res = await this.pool.query(
      'SELECT participant_token FROM participants WHERE id = $1 AND plan_id = $2',
      [participantId, planId]
    );
    const row = res.rows[0];
    if (!row || !row.participant_token) return false;
    return safeTimingEqual(String(row.participant_token), token);
  }

  async getParticipantByToken(planId: string, token: string): Promise<Participant | null> {
    if (!token) return null;
    const res = await this.pool.query('SELECT * FROM participants WHERE plan_id = $1', [planId]);
    for (const r of res.rows) {
      if (r.participant_token && safeTimingEqual(String(r.participant_token), token)) {
        return this.mapParticipant(r);
      }
    }
    return null;
  }

  async claimParticipantByPin(
    planId: string,
    name: string,
    pin: string
  ): Promise<{ participant: Participant; participantToken: string }> {
    const res = await this.pool.query(
      'SELECT * FROM participants WHERE plan_id = $1 AND LOWER(name) = LOWER($2)',
      [planId, name.trim()]
    );
    const row = res.rows[0];
    if (!row) {
      throw new Error('No encontramos a nadie con ese nombre en esta quedada.');
    }
    if (!row.pin_hash) {
      throw new Error(
        'Este perfil no tiene PIN configurado. Pide al organizador o usa tu enlace de traspaso.'
      );
    }
    const expected = hashPin(String(row.id), pin);
    if (!safeTimingEqual(String(row.pin_hash), expected)) {
      throw new Error('El PIN no coincide. Inténtalo de nuevo.');
    }
    return {
      participant: this.mapParticipant(row),
      participantToken: String(row.participant_token),
    };
  }

  async getPlanSnapshotBySlug(
    slug: string,
    options?: { viewerParticipantId?: string | null; onlineParticipantIds?: string[]; includeAllVotes?: boolean }
  ): Promise<PlanSnapshot | null> {
    const planRow = await this.fetchPlanRowBySlug(slug);
    if (!planRow) return null;
    const plan = this.mapPlan(planRow);

    const [
      partRes,
      availRes,
      pollOptRes,
      voteRes,
      commentRes,
      rsvpRes,
      subPollRes,
      subOptRes,
      subVoteRes,
      checkRes,
      rideRes,
      passRes,
    ] = await Promise.all([
      this.pool.query(
        'SELECT * FROM participants WHERE plan_id = $1 ORDER BY is_organizer DESC, created_at ASC',
        [plan.id]
      ),
      this.pool.query(
        'SELECT participant_id, date, slot, status, note, updated_at FROM availabilities WHERE plan_id = $1',
        [plan.id]
      ),
      this.pool.query(
        'SELECT date, label, proposed_by, created_at FROM poll_options WHERE plan_id = $1 ORDER BY date ASC',
        [plan.id]
      ),
      this.pool.query(
        'SELECT participant_id, date, created_at FROM votes WHERE plan_id = $1 ORDER BY created_at ASC',
        [plan.id]
      ),
      this.pool.query(
        'SELECT id, participant_id, date, body, created_at FROM comments WHERE plan_id = $1 ORDER BY created_at DESC LIMIT 80',
        [plan.id]
      ),
      this.pool.query(
        'SELECT participant_id, status, guests_count, note, updated_at FROM rsvps WHERE plan_id = $1',
        [plan.id]
      ),
      this.pool.query(
        'SELECT id, category, question, winner_option_id, created_at FROM sub_polls WHERE plan_id = $1 ORDER BY created_at ASC',
        [plan.id]
      ),
      this.pool.query(
        'SELECT id, poll_id, title, url, estimated_cost, proposed_by, created_at FROM sub_poll_options WHERE plan_id = $1 ORDER BY created_at ASC',
        [plan.id]
      ),
      this.pool.query(
        'SELECT option_id, participant_id FROM sub_poll_votes WHERE plan_id = $1',
        [plan.id]
      ),
      this.pool.query(
        'SELECT id, title, assigned_to, completed, created_by, created_at FROM checklist_items WHERE plan_id = $1 ORDER BY completed ASC, created_at ASC',
        [plan.id]
      ),
      this.pool.query(
        'SELECT id, driver_id, origin, seats_total, departure_time, notes, created_at FROM carpool_rides WHERE plan_id = $1 ORDER BY created_at ASC',
        [plan.id]
      ),
      this.pool.query(
        'SELECT ride_id, participant_id FROM carpool_passengers WHERE plan_id = $1 ORDER BY created_at ASC',
        [plan.id]
      ),
    ]);

    const participants = partRes.rows.map((r) => this.mapParticipant(r));

    const availabilities: AvailabilityEntry[] = availRes.rows.map((r) => ({
      participantId: String(r.participant_id),
      date: String(r.date),
      slot: String(r.slot ?? 'all') as AvailabilitySlot,
      status: String(r.status) as AvailabilityStatus,
      note: String(r.note ?? ''),
      updatedAt: toIso(r.updated_at),
    }));

    const pollOptions: PollOption[] = pollOptRes.rows.map((r) => ({
      date: String(r.date),
      label: String(r.label ?? ''),
      proposedBy: r.proposed_by ? String(r.proposed_by) : null,
      createdAt: toIso(r.created_at),
    }));

    const allVotes: VoteEntry[] = voteRes.rows.map((r) => ({
      participantId: String(r.participant_id),
      date: String(r.date),
      createdAt: toIso(r.created_at),
    }));

    const hideVotes = plan.blindVoting && isVotingEffectivelyOpen(plan) && !plan.confirmedDate && !options?.includeAllVotes;
    const viewerId = options?.viewerParticipantId ?? null;
    const votes = hideVotes
      ? allVotes.filter((v) => viewerId !== null && v.participantId === viewerId)
      : allVotes;
    const distinctVoters = new Set(allVotes.map((v) => v.participantId)).size;
    const blindVoteStats = hideVotes
      ? { totalVotes: allVotes.length, votersCount: distinctVoters, hidden: true }
      : undefined;

    const comments: CommentEntry[] = commentRes.rows.map((r) => ({
      id: String(r.id),
      participantId: String(r.participant_id),
      date: r.date ? String(r.date) : null,
      body: String(r.body),
      createdAt: toIso(r.created_at),
    }));

    const rsvps: RsvpEntry[] = rsvpRes.rows.map((r) => ({
      participantId: String(r.participant_id),
      status: String(r.status) as RsvpStatus,
      guestsCount: Number(r.guests_count ?? 0),
      note: String(r.note ?? ''),
      updatedAt: toIso(r.updated_at),
    }));

    const votersByOption = new Map<string, string[]>();
    for (const v of subVoteRes.rows) {
      const oid = String(v.option_id);
      const arr = votersByOption.get(oid) ?? [];
      arr.push(String(v.participant_id));
      votersByOption.set(oid, arr);
    }

    const optionsByPoll = new Map<string, SubPollOption[]>();
    for (const o of subOptRes.rows) {
      const pid = String(o.poll_id);
      const arr = optionsByPoll.get(pid) ?? [];
      arr.push({
        id: String(o.id),
        pollId: pid,
        title: String(o.title),
        url: String(o.url ?? ''),
        estimatedCost: String(o.estimated_cost ?? ''),
        proposedBy: o.proposed_by ? String(o.proposed_by) : null,
        voterIds: votersByOption.get(String(o.id)) ?? [],
        createdAt: toIso(o.created_at),
      });
      optionsByPoll.set(pid, arr);
    }

    const subPolls: SubPoll[] = subPollRes.rows.map((p) => ({
      id: String(p.id),
      category: String(p.category) as SubPollCategory,
      question: String(p.question),
      winnerOptionId: p.winner_option_id ? String(p.winner_option_id) : null,
      options: optionsByPoll.get(String(p.id)) ?? [],
      createdAt: toIso(p.created_at),
    }));

    const checklist: ChecklistItem[] = checkRes.rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      assignedTo: r.assigned_to ? String(r.assigned_to) : null,
      completed: Boolean(r.completed),
      createdBy: r.created_by ? String(r.created_by) : null,
      createdAt: toIso(r.created_at),
    }));

    const passByRide = new Map<string, string[]>();
    for (const pr of passRes.rows) {
      const rid = String(pr.ride_id);
      const arr = passByRide.get(rid) ?? [];
      arr.push(String(pr.participant_id));
      passByRide.set(rid, arr);
    }

    const carpools: CarpoolRide[] = rideRes.rows.map((r) => ({
      id: String(r.id),
      driverId: String(r.driver_id),
      origin: String(r.origin),
      seatsTotal: Number(r.seats_total ?? 3),
      departureTime: String(r.departure_time ?? ''),
      notes: String(r.notes ?? ''),
      passengerIds: passByRide.get(String(r.id)) ?? [],
      createdAt: toIso(r.created_at),
    }));

    return {
      plan,
      participants,
      availabilities,
      pollOptions,
      votes,
      comments,
      rsvps,
      subPolls,
      checklist,
      carpools,
      ...(options?.onlineParticipantIds ? { onlineParticipantIds: options.onlineParticipantIds } : {}),
      ...(blindVoteStats ? { blindVoteStats } : {}),
    };
  }

  async listPublicPlans(limit = 6): Promise<PlanSummaryItem[]> {
    const res = await this.pool.query(
      `
        SELECT p.slug, p.title, p.emoji, p.location, p.confirmed_date, p.created_at,
               p.retention_policy, p.expires_at,
               COUNT(pa.id) AS participant_count
        FROM plans p
        LEFT JOIN participants pa ON pa.plan_id = p.id
        WHERE p.is_demo = TRUE
        GROUP BY p.id
        ORDER BY p.created_at DESC
        LIMIT $1
      `,
      [limit]
    );

    return res.rows.map((r) => ({
      slug: String(r.slug),
      title: String(r.title),
      emoji: String(r.emoji),
      location: String(r.location ?? ''),
      participantCount: Number(r.participant_count ?? 0),
      confirmedDate: r.confirmed_date ? String(r.confirmed_date) : null,
      createdAt: toIso(r.created_at),
      retentionPolicy: asPolicy(r.retention_policy),
      expiresAt: toIsoOrNull(r.expires_at),
    }));
  }

  async lookupPlansBySlugs(slugs: string[]): Promise<PlanSummaryItem[]> {
    const clean = Array.from(new Set(slugs.map((s) => s.trim()).filter(Boolean))).slice(0, 15);
    if (clean.length === 0) return [];

    const res = await this.pool.query(
      `
        SELECT p.slug, p.title, p.emoji, p.location, p.confirmed_date, p.created_at,
               p.retention_policy, p.expires_at,
               COUNT(pa.id) AS participant_count
        FROM plans p
        LEFT JOIN participants pa ON pa.plan_id = p.id
        WHERE p.slug = ANY($1::text[])
          AND (p.is_demo = TRUE OR p.expires_at IS NULL OR p.expires_at > NOW())
        GROUP BY p.id
      `,
      [clean]
    );

    const bySlug = new Map<string, PlanSummaryItem>(
      res.rows.map((r) => [
        String(r.slug),
        {
          slug: String(r.slug),
          title: String(r.title),
          emoji: String(r.emoji),
          location: String(r.location ?? ''),
          participantCount: Number(r.participant_count ?? 0),
          confirmedDate: r.confirmed_date ? String(r.confirmed_date) : null,
          createdAt: toIso(r.created_at),
          retentionPolicy: asPolicy(r.retention_policy),
          expiresAt: toIsoOrNull(r.expires_at),
        },
      ])
    );

    return clean.map((s) => bySlug.get(s)).filter((x): x is PlanSummaryItem => Boolean(x));
  }

  async createPlan(input: CreatePlanInput): Promise<{
    plan: Plan;
    participant: Participant;
    adminToken: string;
    participantToken: string;
  }> {
    const now = new Date();
    const defaultStart = formatMonthISO(now.getFullYear(), now.getMonth());
    const startMonth = input.startMonth || defaultStart;
    const endMonth = input.endMonth || addMonthsISO(startMonth, 2);
    validatePlanDates({ startMonth, endMonth, votingDeadline: input.votingDeadline });

    const id = crypto.randomUUID();
    const slug = input.customSlug || generateSecureSlug(input.title);
    const adminToken = generateSecretToken();
    const adminTokenHash = hashToken(adminToken);
    const isDemo = Boolean(input.isDemo);
    const visibility: PlanVisibility = isDemo ? 'public_demo' : 'unlisted';

    const retentionPolicy: RetentionPolicy = isDemo
      ? 'persistent'
      : (input.retentionPolicy ?? this.config.defaultRetentionPolicy);
    const retentionDays =
      retentionPolicy === 'persistent'
        ? 0
        : Math.max(1, Math.min(365, input.retentionDays ?? this.config.defaultRetentionDays));
    const expiresAt = isDemo
      ? null
      : computeExpiresAt({
          policy: retentionPolicy,
          retentionDays,
          now,
          createdAt: now,
          postEventGraceDays: this.config.postEventGraceDays,
        });

    const participantId = crypto.randomUUID();
    const participantToken = generateSecretToken();
    const pinHash =
      input.organizerPin && input.organizerPin.trim().length >= 4
        ? hashPin(participantId, input.organizerPin)
        : null;
    const createdAt = now.toISOString();

    const granularity: PlanGranularity = input.granularity ?? 'day';
    const enabledSlots = normalizeEnabledSlots(granularity, input.enabledSlots);

    const { planRow, participantRow } = await withTransaction(this.pool, async (client) => {
      const pRes = await client.query(
        `
          INSERT INTO plans (
            id, slug, title, description, location, emoji,
            start_month, end_month, max_votes_per_user, voting_open,
            voting_deadline, blind_voting, granularity, duration_days,
            holiday_country, required_participant_ids, is_demo,
            admin_token_hash, visibility, retention_policy, retention_days,
            created_at, last_activity_at, expires_at, enabled_slots
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, TRUE,
            $10, $11, $12, $13,
            $14, '[]'::jsonb, $15,
            $16, $17, $18, $19,
            $20::timestamptz, $20::timestamptz, $21::timestamptz, $22::jsonb
          )
          RETURNING *
        `,
        [
          id,
          slug,
          input.title.trim(),
          (input.description ?? '').trim(),
          (input.location ?? '').trim(),
          input.emoji || '🍕',
          startMonth,
          endMonth,
          input.maxVotesPerUser ?? 3,
          input.votingDeadline ?? null,
          Boolean(input.blindVoting),
          granularity,
          Math.max(1, Math.min(7, input.durationDays ?? 1)),
          input.holidayCountry ?? 'ES',
          isDemo,
          adminTokenHash,
          visibility,
          retentionPolicy,
          retentionDays,
          createdAt,
          expiresAt,
          JSON.stringify(enabledSlots),
        ]
      );

      const uRes = await client.query(
        `
          INSERT INTO participants (
            id, plan_id, name, avatar_color, avatar_emoji, is_organizer,
            participant_token, pin_hash, created_at
          ) VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8::timestamptz)
          RETURNING *
        `,
        [
          participantId,
          id,
          input.organizerName.trim(),
          input.organizerColor || AVATAR_COLORS[0],
          input.organizerEmoji || AVATAR_EMOJIS[0],
          participantToken,
          pinHash,
          createdAt,
        ]
      );

      return { planRow: pRes.rows[0], participantRow: uRes.rows[0] };
    });

    return {
      plan: this.mapPlan(planRow),
      participant: this.mapParticipant(participantRow),
      adminToken,
      participantToken,
    };
  }

  async addOrGetParticipant(
    planId: string,
    input: {
      name: string;
      avatarColor?: string;
      avatarEmoji?: string;
      pin?: string;
      isOrganizer?: boolean;
      rejectDuplicate?: boolean;
    }
  ): Promise<{ participant: Participant; participantToken: string }> {
    const cleanName = input.name.trim();
    const existingRes = await this.pool.query(
      'SELECT * FROM participants WHERE plan_id = $1 AND LOWER(name) = LOWER($2)',
      [planId, cleanName]
    );
    const existing = existingRes.rows[0];

    if (existing) {
      if (input.rejectDuplicate) {
        throw new Error(
          `Ya hay alguien apuntado como «${String(existing.name)}». Usa otro nombre o recupera tu perfil con PIN.`
        );
      }
      if (input.avatarColor || input.avatarEmoji) {
        const updatedRes = await this.pool.query(
          'UPDATE participants SET avatar_color = $1, avatar_emoji = $2 WHERE id = $3 RETURNING *',
          [
            input.avatarColor ?? String(existing.avatar_color),
            input.avatarEmoji ?? String(existing.avatar_emoji),
            String(existing.id),
          ]
        );
        return {
          participant: this.mapParticipant(updatedRes.rows[0]),
          participantToken: String(updatedRes.rows[0].participant_token),
        };
      }
      return {
        participant: this.mapParticipant(existing),
        participantToken: String(existing.participant_token),
      };
    }

    const countRes = await this.pool.query(
      'SELECT COUNT(*) AS c FROM participants WHERE plan_id = $1',
      [planId]
    );
    const idx = Number(countRes.rows[0]?.c ?? 0);

    const id = crypto.randomUUID();
    const color = input.avatarColor || AVATAR_COLORS[idx % AVATAR_COLORS.length];
    const emoji = input.avatarEmoji || AVATAR_EMOJIS[idx % AVATAR_EMOJIS.length];
    const participantToken = generateSecretToken();
    const pinHash = input.pin && input.pin.trim().length >= 4 ? hashPin(id, input.pin) : null;
    const createdAt = new Date().toISOString();

    let inserted;
    try {
      inserted = await this.pool.query(
        `
          INSERT INTO participants (
            id, plan_id, name, avatar_color, avatar_emoji, is_organizer,
            participant_token, pin_hash, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
          RETURNING *
        `,
        [id, planId, cleanName, color, emoji, Boolean(input.isOrganizer), participantToken, pinHash, createdAt]
      );
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') {
        throw new Error(
          `Ya hay alguien apuntado como «${cleanName}». Usa otro nombre o recupera tu perfil con PIN.`
        );
      }
      throw err;
    }
    await this.touchPlanActivity(planId);

    return {
      participant: this.mapParticipant(inserted.rows[0]),
      participantToken,
    };
  }

  async updateParticipant(
    planId: string,
    participantId: string,
    updates: { name?: string; avatarColor?: string; avatarEmoji?: string; pin?: string }
  ): Promise<Participant> {
    const existingRes = await this.pool.query(
      'SELECT * FROM participants WHERE id = $1 AND plan_id = $2',
      [participantId, planId]
    );
    const existing = existingRes.rows[0];
    if (!existing) throw new Error('Participante no encontrado');

    if (updates.pin !== undefined && !profilePinSchema.safeParse(updates.pin).success) {
      throw new ValidationError('El PIN debe tener al menos 4 caracteres');
    }

    const nextName = updates.name !== undefined ? updates.name.trim() : String(existing.name);
    if (nextName.toLowerCase() !== String(existing.name).toLowerCase()) {
      const collision = await this.pool.query(
        'SELECT id FROM participants WHERE plan_id = $1 AND LOWER(name) = LOWER($2) AND id != $3',
        [planId, nextName, participantId]
      );
      if (collision.rows.length > 0) {
        throw new Error(`Ya existe un participante llamado «${nextName}».`);
      }
    }

    const nextColor = updates.avatarColor ?? String(existing.avatar_color);
    const nextEmoji = updates.avatarEmoji ?? String(existing.avatar_emoji);
    const nextPinHash =
      updates.pin !== undefined
        ? updates.pin.trim().length >= 4
          ? hashPin(participantId, updates.pin)
          : null
        : existing.pin_hash
          ? String(existing.pin_hash)
          : null;

    const updated = await this.pool.query(
      'UPDATE participants SET name = $1, avatar_color = $2, avatar_emoji = $3, pin_hash = $4 WHERE id = $5 RETURNING *',
      [nextName, nextColor, nextEmoji, nextPinHash, participantId]
    );
    await this.touchPlanActivity(planId);
    return this.mapParticipant(updated.rows[0]);
  }

  async deleteParticipant(planId: string, participantId: string): Promise<boolean> {
    const res = await this.pool.query(
      'DELETE FROM participants WHERE id = $1 AND plan_id = $2',
      [participantId, planId]
    );
    if ((res.rowCount ?? 0) > 0) {
      await this.touchPlanActivity(planId);
      return true;
    }
    return false;
  }

  async deletePlan(slug: string): Promise<boolean> {
    const res = await this.pool.query('DELETE FROM plans WHERE slug = $1', [slug]);
    return (res.rowCount ?? 0) > 0;
  }

  async setAvailabilityBatch(
    planId: string,
    participantId: string,
    changes: Array<{
      date: string;
      slot?: AvailabilitySlot;
      status: AvailabilityStatus | null;
      note?: string;
    }>
  ): Promise<void> {
    const partRes = await this.pool.query(
      'SELECT id FROM participants WHERE id = $1 AND plan_id = $2',
      [participantId, planId]
    );
    if (partRes.rows.length === 0) {
      throw new Error('Participante no encontrado en esta quedada');
    }

    const now = new Date().toISOString();
    await withTransaction(this.pool, async (client) => {
      for (const ch of changes) {
        const slot: AvailabilitySlot = ch.slot ?? 'all';
        if (ch.status === null) {
          await client.query(
            'DELETE FROM availabilities WHERE plan_id = $1 AND participant_id = $2 AND date = $3 AND slot = $4',
            [planId, participantId, ch.date, slot]
          );
        } else if (ch.note !== undefined) {
          await client.query(
            `
              INSERT INTO availabilities (plan_id, participant_id, date, slot, status, note, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
              ON CONFLICT (plan_id, participant_id, date, slot)
              DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = EXCLUDED.updated_at
            `,
            [planId, participantId, ch.date, slot, ch.status, ch.note.trim(), now]
          );
        } else {
          await client.query(
            `
              INSERT INTO availabilities (plan_id, participant_id, date, slot, status, note, updated_at)
              VALUES ($1, $2, $3, $4, $5, '', $6::timestamptz)
              ON CONFLICT (plan_id, participant_id, date, slot)
              DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at
            `,
            [planId, participantId, ch.date, slot, ch.status, now]
          );
        }
      }
      await this.touchPlanActivity(planId, client);
    });
  }

  async nominateDate(
    planId: string,
    date: string,
    label = '',
    proposedBy: string | null = null
  ): Promise<void> {
    await this.assertParticipantInPlan(planId, proposedBy);
    const now = new Date().toISOString();
    await this.pool.query(
      `
        INSERT INTO poll_options (plan_id, date, label, proposed_by, created_at)
        VALUES ($1, $2, $3, $4, $5::timestamptz)
        ON CONFLICT (plan_id, date)
        DO UPDATE SET label = CASE WHEN EXCLUDED.label <> '' THEN EXCLUDED.label ELSE poll_options.label END
      `,
      [planId, date, label.trim(), proposedBy, now]
    );
    await this.touchPlanActivity(planId);
  }

  async removePollOption(planId: string, date: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await client.query('DELETE FROM poll_options WHERE plan_id = $1 AND date = $2', [
        planId,
        date,
      ]);
      await client.query('DELETE FROM votes WHERE plan_id = $1 AND date = $2', [planId, date]);
      await this.touchPlanActivity(planId, client);
    });
  }

  async toggleVote(planId: string, participantId: string, date: string): Promise<{ voted: boolean }> {
    return withTransaction(this.pool, async (client) => {
      const planRes = await client.query(
        'SELECT voting_open, voting_deadline, max_votes_per_user FROM plans WHERE id = $1',
        [planId]
      );
      const planRow = planRes.rows[0];
      if (!planRow) throw new Error('Quedada no encontrada');

      const isOpen = isVotingEffectivelyOpen({
        votingOpen: Boolean(planRow.voting_open),
        votingDeadline: toIsoOrNull(planRow.voting_deadline),
      });
      if (!isOpen) throw new Error('La votación está cerrada');

      const partRes = await client.query(
        'SELECT id FROM participants WHERE id = $1 AND plan_id = $2 FOR UPDATE',
        [participantId, planId]
      );
      if (partRes.rows.length === 0) throw new Error('Participante no encontrado');

      const existing = await client.query(
        'SELECT 1 FROM votes WHERE plan_id = $1 AND participant_id = $2 AND date = $3',
        [planId, participantId, date]
      );
      if (existing.rows.length > 0) {
        await client.query(
          'DELETE FROM votes WHERE plan_id = $1 AND participant_id = $2 AND date = $3',
          [planId, participantId, date]
        );
        await this.touchPlanActivity(planId, client);
        return { voted: false };
      }

      const maxVotes = Number(planRow.max_votes_per_user ?? 3);
      if (maxVotes > 0) {
        const countRes = await client.query(
          'SELECT COUNT(*) AS c FROM votes WHERE plan_id = $1 AND participant_id = $2',
          [planId, participantId]
        );
        if (Number(countRes.rows[0]?.c ?? 0) >= maxVotes) {
          throw new Error(
            `Has alcanzado el máximo de ${maxVotes} ${maxVotes === 1 ? 'voto' : 'votos'}. Quita uno para votar otro día.`
          );
        }
      }

      const now = new Date().toISOString();
      await client.query(
        `
          INSERT INTO poll_options (plan_id, date, label, proposed_by, created_at)
          VALUES ($1, $2, '', $3, $4::timestamptz)
          ON CONFLICT (plan_id, date) DO NOTHING
        `,
        [planId, date, participantId, now]
      );
      await client.query(
        `
          INSERT INTO votes (plan_id, participant_id, date, created_at)
          VALUES ($1, $2, $3, $4::timestamptz)
          ON CONFLICT (plan_id, participant_id, date) DO NOTHING
        `,
        [planId, participantId, date, now]
      );
      await this.touchPlanActivity(planId, client);
      return { voted: true };
    });
  }

  async addComment(
    planId: string,
    participantId: string,
    body: string,
    date: string | null = null
  ): Promise<CommentEntry> {
    const partRes = await this.pool.query(
      'SELECT id FROM participants WHERE id = $1 AND plan_id = $2',
      [participantId, planId]
    );
    if (partRes.rows.length === 0) throw new Error('Participante no encontrado');

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await this.pool.query(
      'INSERT INTO comments (id, plan_id, participant_id, date, body, created_at) VALUES ($1, $2, $3, $4, $5, $6::timestamptz)',
      [id, planId, participantId, date, body.trim(), createdAt]
    );
    await this.touchPlanActivity(planId);

    return { id, participantId, date, body: body.trim(), createdAt };
  }

  async setRsvp(
    planId: string,
    participantId: string,
    status: RsvpStatus,
    guestsCount = 0,
    note = ''
  ): Promise<void> {
    const partRes = await this.pool.query(
      'SELECT id FROM participants WHERE id = $1 AND plan_id = $2',
      [participantId, planId]
    );
    if (partRes.rows.length === 0) throw new Error('Participante no encontrado');

    const now = new Date().toISOString();
    await this.pool.query(
      `
        INSERT INTO rsvps (plan_id, participant_id, status, guests_count, note, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
        ON CONFLICT (plan_id, participant_id)
        DO UPDATE SET status = EXCLUDED.status, guests_count = EXCLUDED.guests_count, note = EXCLUDED.note, updated_at = EXCLUDED.updated_at
      `,
      [planId, participantId, status, Math.max(0, Math.min(10, guestsCount)), note.trim(), now]
    );
    await this.touchPlanActivity(planId);
  }

  async createSubPoll(
    planId: string,
    category: SubPollCategory,
    question: string,
    initialOptions: Array<{ title: string; url?: string; estimatedCost?: string }> = [],
    proposedBy: string | null = null
  ): Promise<string> {
    await this.assertParticipantInPlan(planId, proposedBy);
    const pollId = crypto.randomUUID();
    const now = new Date().toISOString();

    await withTransaction(this.pool, async (client) => {
      await client.query(
        'INSERT INTO sub_polls (id, plan_id, category, question, created_at) VALUES ($1, $2, $3, $4, $5::timestamptz)',
        [pollId, planId, category, question.trim(), now]
      );
      for (const opt of initialOptions) {
        if (!opt.title.trim()) continue;
        await client.query(
          'INSERT INTO sub_poll_options (id, poll_id, plan_id, title, url, estimated_cost, proposed_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)',
          [
            crypto.randomUUID(),
            pollId,
            planId,
            opt.title.trim(),
            (opt.url ?? '').trim(),
            (opt.estimatedCost ?? '').trim(),
            proposedBy,
            now,
          ]
        );
      }
      await this.touchPlanActivity(planId, client);
    });

    return pollId;
  }

  async addSubPollOption(
    planId: string,
    pollId: string,
    title: string,
    url = '',
    estimatedCost = '',
    proposedBy: string | null = null
  ): Promise<string> {
    await this.assertParticipantInPlan(planId, proposedBy);
    const poll = await this.pool.query(
      'SELECT id FROM sub_polls WHERE id = $1 AND plan_id = $2',
      [pollId, planId]
    );
    if (poll.rows.length === 0) throw new Error('Encuesta no encontrada');

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await this.pool.query(
      'INSERT INTO sub_poll_options (id, poll_id, plan_id, title, url, estimated_cost, proposed_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)',
      [id, pollId, planId, title.trim(), url.trim(), estimatedCost.trim(), proposedBy, now]
    );
    await this.touchPlanActivity(planId);
    return id;
  }

  async toggleSubPollVote(
    planId: string,
    pollId: string,
    optionId: string,
    participantId: string
  ): Promise<{ voted: boolean }> {
    return withTransaction(this.pool, async (client) => {
      const opt = await client.query(
        'SELECT id FROM sub_poll_options WHERE id = $1 AND poll_id = $2 AND plan_id = $3',
        [optionId, pollId, planId]
      );
      if (opt.rows.length === 0) throw new Error('Opción no encontrada');

      const part = await client.query(
        'SELECT id FROM participants WHERE id = $1 AND plan_id = $2 FOR UPDATE',
        [participantId, planId]
      );
      if (part.rows.length === 0) throw new Error('Participante no encontrado');

      const existing = await client.query(
        'SELECT 1 FROM sub_poll_votes WHERE poll_id = $1 AND option_id = $2 AND participant_id = $3',
        [pollId, optionId, participantId]
      );
      if (existing.rows.length > 0) {
        await client.query(
          'DELETE FROM sub_poll_votes WHERE poll_id = $1 AND option_id = $2 AND participant_id = $3',
          [pollId, optionId, participantId]
        );
        await this.touchPlanActivity(planId, client);
        return { voted: false };
      }

      await client.query(
        `
          INSERT INTO sub_poll_votes (plan_id, poll_id, option_id, participant_id, created_at)
          VALUES ($1, $2, $3, $4, $5::timestamptz)
          ON CONFLICT (poll_id, option_id, participant_id) DO NOTHING
        `,
        [planId, pollId, optionId, participantId, new Date().toISOString()]
      );
      await this.touchPlanActivity(planId, client);
      return { voted: true };
    });
  }

  async setSubPollWinner(
    planId: string,
    pollId: string,
    winnerOptionId: string | null
  ): Promise<void> {
    const poll = await this.pool.query('SELECT id FROM sub_polls WHERE id = $1 AND plan_id = $2', [pollId, planId]);
    if (!poll.rows[0]) throw new ValidationError('Encuesta no encontrada');
    if (winnerOptionId !== null) {
      const option = await this.pool.query('SELECT id FROM sub_poll_options WHERE id = $1 AND poll_id = $2 AND plan_id = $3', [winnerOptionId, pollId, planId]);
      if (!option.rows[0]) throw new ValidationError('Opcion no encontrada en esta encuesta');
    }
    await this.pool.query(
      'UPDATE sub_polls SET winner_option_id = $1 WHERE id = $2 AND plan_id = $3',
      [winnerOptionId, pollId, planId]
    );
    await this.touchPlanActivity(planId);
  }

  async deleteSubPoll(planId: string, pollId: string): Promise<void> {
    await this.pool.query('DELETE FROM sub_polls WHERE id = $1 AND plan_id = $2', [pollId, planId]);
    await this.touchPlanActivity(planId);
  }

  private async assertParticipantInPlan(planId: string, participantId: string | null): Promise<void> {
    if (participantId === null) return;
    const result = await this.pool.query('SELECT id FROM participants WHERE id = $1 AND plan_id = $2', [participantId, planId]);
    if (!result.rows[0]) throw new ValidationError('Participante no encontrado en esta quedada');
  }

  async addChecklistItem(
    planId: string,
    title: string,
    assignedTo: string | null = null,
    createdBy: string | null = null
  ): Promise<string> {
    await this.assertParticipantInPlan(planId, assignedTo);
    await this.assertParticipantInPlan(planId, createdBy);
    const id = crypto.randomUUID();
    await this.pool.query(
      'INSERT INTO checklist_items (id, plan_id, title, assigned_to, completed, created_by, created_at) VALUES ($1, $2, $3, $4, FALSE, $5, $6::timestamptz)',
      [id, planId, title.trim(), assignedTo, createdBy, new Date().toISOString()]
    );
    await this.touchPlanActivity(planId);
    return id;
  }

  async updateChecklistItem(
    planId: string,
    itemId: string,
    updates: { title?: string; assignedTo?: string | null; completed?: boolean }
  ): Promise<void> {
    const existingRes = await this.pool.query(
      'SELECT * FROM checklist_items WHERE id = $1 AND plan_id = $2',
      [itemId, planId]
    );
    const existing = existingRes.rows[0];
    if (!existing) throw new Error('Elemento no encontrado');

    const nextTitle = updates.title !== undefined ? updates.title.trim() : String(existing.title);
    const nextAssigned =
      updates.assignedTo !== undefined
        ? updates.assignedTo
        : existing.assigned_to
          ? String(existing.assigned_to)
          : null;
    await this.assertParticipantInPlan(planId, nextAssigned);
    const nextCompleted =
      updates.completed !== undefined ? updates.completed : Boolean(existing.completed);

    await this.pool.query(
      'UPDATE checklist_items SET title = $1, assigned_to = $2, completed = $3 WHERE id = $4 AND plan_id = $5',
      [nextTitle, nextAssigned, nextCompleted, itemId, planId]
    );
    await this.touchPlanActivity(planId);
  }

  async deleteChecklistItem(planId: string, itemId: string): Promise<void> {
    await this.pool.query('DELETE FROM checklist_items WHERE id = $1 AND plan_id = $2', [
      itemId,
      planId,
    ]);
    await this.touchPlanActivity(planId);
  }

  async addCarpoolRide(
    planId: string,
    driverId: string,
    origin: string,
    seatsTotal: number,
    departureTime = '',
    notes = ''
  ): Promise<string> {
    const driver = await this.pool.query(
      'SELECT id FROM participants WHERE id = $1 AND plan_id = $2',
      [driverId, planId]
    );
    if (driver.rows.length === 0) throw new Error('Conductor no encontrado');

    const id = crypto.randomUUID();
    await this.pool.query(
      'INSERT INTO carpool_rides (id, plan_id, driver_id, origin, seats_total, departure_time, notes, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)',
      [
        id,
        planId,
        driverId,
        origin.trim(),
        Math.max(1, Math.min(9, seatsTotal)),
        departureTime.trim(),
        notes.trim(),
        new Date().toISOString(),
      ]
    );
    await this.touchPlanActivity(planId);
    return id;
  }

  async toggleCarpoolSeat(
    planId: string,
    rideId: string,
    participantId: string
  ): Promise<{ joined: boolean }> {
    return withTransaction(this.pool, async (client) => {
      const rideRes = await client.query(
        'SELECT driver_id, seats_total FROM carpool_rides WHERE id = $1 AND plan_id = $2 FOR UPDATE',
        [rideId, planId]
      );
      const ride = rideRes.rows[0];
      if (!ride) throw new Error('Coche no encontrado');
      if (String(ride.driver_id) === participantId) {
        throw new Error('Ya eres el conductor de este coche.');
      }

      const existing = await client.query(
        'SELECT 1 FROM carpool_passengers WHERE ride_id = $1 AND participant_id = $2',
        [rideId, participantId]
      );
      if (existing.rows.length > 0) {
        await client.query(
          'DELETE FROM carpool_passengers WHERE ride_id = $1 AND participant_id = $2',
          [rideId, participantId]
        );
        await this.touchPlanActivity(planId, client);
        return { joined: false };
      }

      const countRes = await client.query(
        'SELECT COUNT(*) AS c FROM carpool_passengers WHERE ride_id = $1',
        [rideId]
      );
      if (Number(countRes.rows[0]?.c ?? 0) >= Number(ride.seats_total ?? 1)) {
        throw new Error('Este coche ya está completo.');
      }

      await client.query(
        `
          INSERT INTO carpool_passengers (plan_id, ride_id, participant_id, created_at)
          VALUES ($1, $2, $3, $4::timestamptz)
          ON CONFLICT (ride_id, participant_id) DO NOTHING
        `,
        [planId, rideId, participantId, new Date().toISOString()]
      );
      await this.touchPlanActivity(planId, client);
      return { joined: true };
    });
  }

  async deleteCarpoolRide(planId: string, rideId: string): Promise<void> {
    await this.pool.query('DELETE FROM carpool_rides WHERE id = $1 AND plan_id = $2', [
      rideId,
      planId,
    ]);
    await this.touchPlanActivity(planId);
  }

  async updatePlanSettings(slug: string, updates: UpdatePlanSettingsInput): Promise<Plan | null> {
    const row = await this.fetchPlanRowBySlug(slug);
    if (!row) return null;

    const now = new Date();
    const isDemo = Boolean(row.is_demo);

    const nextTitle = updates.title !== undefined ? updates.title.trim() : String(row.title);
    const nextDesc =
      updates.description !== undefined ? updates.description.trim() : String(row.description);
    const nextLoc = updates.location !== undefined ? updates.location.trim() : String(row.location);
    const nextEmoji = updates.emoji !== undefined ? updates.emoji : String(row.emoji);
    const nextStartMonth =
      updates.startMonth !== undefined ? updates.startMonth : String(row.start_month);
    const nextEndMonth = updates.endMonth !== undefined ? updates.endMonth : String(row.end_month);
    const nextMaxVotes =
      updates.maxVotesPerUser !== undefined
        ? updates.maxVotesPerUser
        : Number(row.max_votes_per_user);
    const nextVotingOpen =
      updates.votingOpen !== undefined ? updates.votingOpen : Boolean(row.voting_open);
    const nextDeadline =
      updates.votingDeadline !== undefined
        ? updates.votingDeadline
        : toIsoOrNull(row.voting_deadline);
    const nextBlind =
      updates.blindVoting !== undefined ? updates.blindVoting : Boolean(row.blind_voting);
    const prevGranularity = asGranularity(row.granularity);
    const nextGranularity: PlanGranularity =
      updates.granularity !== undefined ? updates.granularity : prevGranularity;
    const nextEnabledSlots = normalizeEnabledSlots(
      nextGranularity,
      updates.enabledSlots !== undefined
        ? updates.enabledSlots
        : updates.granularity !== undefined && updates.granularity !== prevGranularity
          ? undefined
          : parseRequiredIds(row.enabled_slots)
    );
    const nextDurationDays =
      updates.durationDays !== undefined
        ? Math.max(1, Math.min(7, updates.durationDays))
        : Number(row.duration_days ?? 1);
    const nextHolidayCountry =
      updates.holidayCountry !== undefined
        ? updates.holidayCountry
        : String(row.holiday_country ?? 'ES');
    const nextRequiredIds =
      updates.requiredParticipantIds !== undefined
        ? updates.requiredParticipantIds
        : parseRequiredIds(row.required_participant_ids);
    const nextConfirmedDate =
      updates.confirmedDate !== undefined
        ? updates.confirmedDate
        : row.confirmed_date
          ? String(row.confirmed_date)
          : null;
    const nextConfirmedEndDate =
      updates.confirmedEndDate !== undefined
        ? updates.confirmedEndDate
        : nextConfirmedDate === null
          ? null
          : row.confirmed_end_date
            ? String(row.confirmed_end_date)
            : null;
    const nextConfirmedTime =
      updates.confirmedTime !== undefined
        ? updates.confirmedTime
        : row.confirmed_time
          ? String(row.confirmed_time)
          : null;
    const nextConfirmedDuration =
      updates.confirmedDurationMinutes !== undefined
        ? Math.max(30, Math.min(1440, updates.confirmedDurationMinutes))
        : Number(row.confirmed_duration_minutes ?? 180);
    const nextConfirmedTimezone =
      updates.confirmedTimezone !== undefined
        ? updates.confirmedTimezone
        : row.confirmed_timezone
          ? String(row.confirmed_timezone)
          : null;

    validatePlanDates({
      startMonth: nextStartMonth, endMonth: nextEndMonth, votingDeadline: nextDeadline,
      confirmedDate: nextConfirmedDate, confirmedEndDate: nextConfirmedEndDate,
      confirmedTime: nextConfirmedTime, confirmedTimezone: nextConfirmedTimezone,
    });
    const nextRetentionPolicy: RetentionPolicy = isDemo
      ? 'persistent'
      : (updates.retentionPolicy ?? asPolicy(row.retention_policy));
    const nextRetentionDays =
      nextRetentionPolicy === 'persistent'
        ? 0
        : Math.max(1, Math.min(365, updates.retentionDays ?? Number(row.retention_days ?? 30)));

    const retentionChanged =
      updates.retentionPolicy !== undefined ||
      updates.retentionDays !== undefined ||
      updates.confirmedDate !== undefined ||
      updates.confirmedEndDate !== undefined;
    const switchedToFixedTtl =
      nextRetentionPolicy === 'fixed_ttl' &&
      (updates.retentionPolicy !== undefined || updates.retentionDays !== undefined);
    const existingExpiresAt = toIsoOrNull(row.expires_at);

    let nextExpiresAt: string | null;
    if (isDemo) {
      nextExpiresAt = null;
    } else if (retentionChanged) {
      nextExpiresAt = computeExpiresAt({
        policy: nextRetentionPolicy,
        retentionDays: nextRetentionDays,
        now,
        // Anchor newly chosen fixed_ttl from now so switching an older plan never deletes it immediately
        createdAt: switchedToFixedTtl ? now : new Date(toIso(row.created_at)),
        confirmedDate: nextConfirmedDate,
        confirmedEndDate: nextConfirmedEndDate,
        postEventGraceDays: this.config.postEventGraceDays,
      });
    } else if (nextRetentionPolicy === 'sliding_inactivity') {
      const candidate = computeExpiresAt({
        policy: nextRetentionPolicy,
        retentionDays: nextRetentionDays,
        now,
        createdAt: new Date(toIso(row.created_at)),
        confirmedDate: nextConfirmedDate,
        confirmedEndDate: nextConfirmedEndDate,
        postEventGraceDays: this.config.postEventGraceDays,
      });
      nextExpiresAt = pickLaterExpiration(existingExpiresAt, candidate);
    } else {
      nextExpiresAt = existingExpiresAt;
    }

    const updatedRes = await this.pool.query(
      `
        UPDATE plans
        SET title = $1, description = $2, location = $3, emoji = $4,
            start_month = $5, end_month = $6, max_votes_per_user = $7, voting_open = $8,
            voting_deadline = $9::timestamptz, blind_voting = $10, granularity = $11, duration_days = $12,
            holiday_country = $13, required_participant_ids = $14::jsonb,
            confirmed_date = $15, confirmed_end_date = $16, confirmed_time = $17,
            confirmed_duration_minutes = $18, confirmed_timezone = $19,
            retention_policy = $20, retention_days = $21,
            last_activity_at = $22::timestamptz, expires_at = $23::timestamptz,
            enabled_slots = $24::jsonb
        WHERE id = $25
        RETURNING *
      `,
      [
        nextTitle,
        nextDesc,
        nextLoc,
        nextEmoji,
        nextStartMonth,
        nextEndMonth,
        nextMaxVotes,
        nextVotingOpen,
        nextDeadline,
        nextBlind,
        nextGranularity,
        nextDurationDays,
        nextHolidayCountry,
        JSON.stringify(nextRequiredIds),
        nextConfirmedDate,
        nextConfirmedEndDate,
        nextConfirmedTime,
        nextConfirmedDuration,
        nextConfirmedTimezone,
        nextRetentionPolicy,
        nextRetentionDays,
        now.toISOString(),
        nextExpiresAt,
        JSON.stringify(nextEnabledSlots),
        String(row.id),
      ]
    );

    return this.mapPlan(updatedRes.rows[0]);
  }

  async extendPlanExpiration(slug: string, extraDays = 30): Promise<Plan | null> {
    const row = await this.fetchPlanRowBySlug(slug);
    if (!row) return null;
    if (Boolean(row.is_demo) || asPolicy(row.retention_policy) === 'persistent') {
      return this.mapPlan(row);
    }

    const days = Math.max(1, Math.min(365, Math.round(extraDays)));
    const nowMs = Date.now();
    const currentExp = toIsoOrNull(row.expires_at);
    const baseMs = currentExp ? Math.max(nowMs, Date.parse(currentExp) || nowMs) : nowMs;
    const nextExpiresAt = new Date(baseMs + days * 24 * 60 * 60 * 1000).toISOString();

    const updated = await this.pool.query(
      'UPDATE plans SET expires_at = $1::timestamptz, last_activity_at = NOW() WHERE id = $2 RETURNING *',
      [nextExpiresAt, String(row.id)]
    );
    return this.mapPlan(updated.rows[0]);
  }

  async exportPlanBackup(slug: string): Promise<ExportedPlanBackup<PlanSnapshot> | null> {
    const snapshot = await this.getPlanSnapshotBySlug(slug, { includeAllVotes: true });
    if (!snapshot) return null;
    return {
      format: 'shalendar-backup-v1',
      exportedAt: new Date().toISOString(),
      snapshot,
    };
  }

  async purgeExpiredPlans(now = new Date()): Promise<PurgeSummary> {
    return purgeExpiredPlansSql(this.pool, now);
  }

  async checkHealth(): Promise<StoreHealthStatus> {
    const health = await checkDatabaseHealth(this.pool);
    return { ...health, driver: 'postgres' };
  }

  async seedDemoPlanIfEmpty(): Promise<void> {
    const existing = await this.pool.query('SELECT id FROM plans WHERE slug = $1', [
      'cena-reencuentro',
    ]);
    if (existing.rows.length > 0) return;

    const now = new Date();
    const upcomingDates: string[] = [];
    for (let i = 1; i <= 35; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const dow = d.getDay();
      if (dow === 5 || dow === 6 || dow === 0) {
        upcomingDates.push(formatDateISO(d));
      }
    }

    const startMonth = formatMonthISO(now.getFullYear(), now.getMonth());
    const endMonth = addMonthsISO(startMonth, 2);

    let createdDemo: { plan: Plan; participant: Participant };
    try {
      createdDemo = await this.createPlan({
        title: 'Cena y sobremesa del grupo',
        description:
          '¡Hace mil que no nos juntamos todos! Apuntad qué días os vienen bien, votad vuestro favorito y decidimos restaurante.',
        location: 'La Taberna del Parque · Centro',
        emoji: '🍕',
        organizerName: 'Lucía',
        organizerColor: '#0D9488',
        organizerEmoji: '🦊',
        startMonth,
        endMonth,
        maxVotesPerUser: 3,
        customSlug: 'cena-reencuentro',
        isDemo: true,
      });
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') return;
      throw err;
    }
    const { plan, participant: lucia } = createdDemo;

    const carlos = (
      await this.addOrGetParticipant(plan.id, {
        name: 'Carlos',
        avatarColor: '#2563EB',
        avatarEmoji: '😎',
      })
    ).participant;
    const marta = (
      await this.addOrGetParticipant(plan.id, {
        name: 'Marta',
        avatarColor: '#E11D48',
        avatarEmoji: '🌟',
      })
    ).participant;
    const diego = (
      await this.addOrGetParticipant(plan.id, {
        name: 'Diego',
        avatarColor: '#D97706',
        avatarEmoji: '🐻',
      })
    ).participant;
    const sofia = (
      await this.addOrGetParticipant(plan.id, {
        name: 'Sofía',
        avatarColor: '#7C3AED',
        avatarEmoji: '🦄',
      })
    ).participant;

    const [d0, d1, d2, d3, d4, d5, d6, d7, d8] = upcomingDates;
    if (d0 && d1 && d2 && d3 && d4 && d5 && d6 && d7 && d8) {
      await this.setAvailabilityBatch(plan.id, lucia.id, [
        { date: d0, status: 'maybe', note: 'Solo a partir de las 21:00' },
        { date: d1, status: 'yes' },
        { date: d2, status: 'no' },
        { date: d3, status: 'yes' },
        { date: d4, status: 'yes', note: '¡Puedo reservar la mesa grande!' },
        { date: d5, status: 'maybe' },
        { date: d7, status: 'yes' },
        { date: d8, status: 'yes' },
      ]);
      await this.setAvailabilityBatch(plan.id, carlos.id, [
        { date: d0, status: 'yes' },
        { date: d1, status: 'yes', note: 'Salgo a las 19:30, a las 20:30 perfecto' },
        { date: d3, status: 'maybe' },
        { date: d4, status: 'yes' },
        { date: d6, status: 'no' },
        { date: d7, status: 'yes' },
        { date: d8, status: 'maybe' },
      ]);
      await this.setAvailabilityBatch(plan.id, marta.id, [
        { date: d0, status: 'no' },
        { date: d1, status: 'yes' },
        { date: d3, status: 'yes' },
        { date: d4, status: 'yes' },
        { date: d5, status: 'yes' },
        { date: d7, status: 'maybe', note: 'Depende del turno de mañana' },
      ]);
      await this.setAvailabilityBatch(plan.id, diego.id, [
        { date: d1, status: 'maybe' },
        { date: d2, status: 'yes' },
        { date: d3, status: 'yes' },
        { date: d4, status: 'yes' },
        { date: d7, status: 'yes' },
        { date: d8, status: 'yes' },
      ]);
      await this.setAvailabilityBatch(plan.id, sofia.id, [
        { date: d1, status: 'yes' },
        { date: d3, status: 'no' },
        { date: d4, status: 'yes' },
        { date: d5, status: 'yes' },
        { date: d7, status: 'yes' },
      ]);

      await this.nominateDate(plan.id, d4, 'Noche perfecta · todos libres', lucia.id);
      await this.nominateDate(plan.id, d1, 'Plan rápido esta semana', carlos.id);
      await this.nominateDate(plan.id, d7, 'Alternativa con más margen', diego.id);

      await this.toggleVote(plan.id, lucia.id, d4);
      await this.toggleVote(plan.id, lucia.id, d1);
      await this.toggleVote(plan.id, carlos.id, d4);
      await this.toggleVote(plan.id, carlos.id, d7);
      await this.toggleVote(plan.id, marta.id, d4);
      await this.toggleVote(plan.id, marta.id, d1);
      await this.toggleVote(plan.id, diego.id, d4);
      await this.toggleVote(plan.id, sofia.id, d7);

      await this.addComment(
        plan.id,
        lucia.id,
        '¡Si elegimos el día que podemos los 5, me encargo yo de reservar la mesa grande! 🍷',
        d4
      );
      await this.addComment(
        plan.id,
        carlos.id,
        'Yo salgo de trabajar a las 19:30, así que a partir de las 20:30 perfecto.',
        null
      );
      await this.addComment(
        plan.id,
        marta.id,
        '¡Qué ganas! Por mí cena + juegos de mesa después 🎲',
        null
      );

      const pollId = await this.createSubPoll(
        plan.id,
        'place',
        '¿Dónde cenamos?',
        [
          { title: 'La Taberna del Parque (tapas)', estimatedCost: '~22€' },
          { title: 'Pizzería Napoli Verace', estimatedCost: '~18€' },
          { title: 'Ramen & Gyoza Centro', estimatedCost: '~20€' },
        ],
        lucia.id
      );
      const snap = await this.getPlanSnapshotBySlug('cena-reencuentro');
      const opts = snap?.subPolls.find((p) => p.id === pollId)?.options ?? [];
      if (opts[0] && opts[1]) {
        await this.toggleSubPollVote(plan.id, pollId, opts[0].id, lucia.id);
        await this.toggleSubPollVote(plan.id, pollId, opts[0].id, carlos.id);
        await this.toggleSubPollVote(plan.id, pollId, opts[1].id, marta.id);
      }

      await this.addChecklistItem(plan.id, 'Reservar mesa para 5', lucia.id, lucia.id);
      await this.addChecklistItem(
        plan.id,
        'Llevar Catan / Código Secreto para la sobremesa',
        marta.id,
        marta.id
      );
      await this.addChecklistItem(plan.id, 'Confirmar si alguien tiene alergias', null, carlos.id);

      const rideId = await this.addCarpoolRide(
        plan.id,
        diego.id,
        'Zona Norte · Plaza Castilla',
        3,
        '20:00',
        'Paso a recoger por el camino si hace falta'
      );
      await this.toggleCarpoolSeat(plan.id, rideId, sofia.id);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
