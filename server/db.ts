import { validatePlanDates, profilePinSchema, ValidationError } from './validation.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
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
} from '../shared/types.js';
import {
  computeExpiresAt,
  DEFAULT_POST_EVENT_GRACE_DAYS,
  isPlanExpired,
  pickLaterExpiration,
  type ExportedPlanBackup,
  type PlanSummaryItem,
} from '../shared/persistence.js';
import { PlanExpiredError, type PurgeSummary } from './persistence/repository.js';
import {
  AVATAR_COLORS,
  AVATAR_EMOJIS,
  addMonthsISO,
  formatDateISO,
  formatMonthISO,
  isVotingEffectivelyOpen,
} from '../shared/dates.js';

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

export interface SqliteRetentionDefaults {
  defaultRetentionPolicy?: RetentionPolicy;
  defaultRetentionDays?: number;
  postEventGraceDays?: number;
}

export class ShalendarDB {
  private db: DatabaseSync;
  private readonly defaultRetentionPolicy: RetentionPolicy;
  private readonly defaultRetentionDays: number;
  private readonly postEventGraceDays: number;

  constructor(dbPath: string, defaults?: SqliteRetentionDefaults) {
    this.defaultRetentionPolicy = defaults?.defaultRetentionPolicy ?? 'ephemeral_after_event';
    this.defaultRetentionDays = defaults?.defaultRetentionDays ?? 30;
    this.postEventGraceDays = defaults?.postEventGraceDays ?? DEFAULT_POST_EVENT_GRACE_DAYS;
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.initSchema();
  }

  private getColumnNames(table: string): Set<string> {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return new Set(rows.map((r) => String(r.name)));
  }

  private ensureColumn(table: string, col: string, definition: string): void {
    const cols = this.getColumnNames(table);
    if (!cols.has(col)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition};`);
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        emoji TEXT NOT NULL DEFAULT '🍕',
        start_month TEXT NOT NULL,
        end_month TEXT NOT NULL,
        max_votes_per_user INTEGER NOT NULL DEFAULT 3,
        voting_open INTEGER NOT NULL DEFAULT 1,
        voting_deadline TEXT,
        blind_voting INTEGER NOT NULL DEFAULT 0,
        granularity TEXT NOT NULL DEFAULT 'day',
        duration_days INTEGER NOT NULL DEFAULT 1,
        holiday_country TEXT NOT NULL DEFAULT 'ES',
        required_participant_ids TEXT NOT NULL DEFAULT '[]',
        confirmed_date TEXT,
        confirmed_end_date TEXT,
        confirmed_time TEXT,
        confirmed_duration_minutes INTEGER NOT NULL DEFAULT 180,
        confirmed_timezone TEXT,
        is_demo INTEGER NOT NULL DEFAULT 0,
        visibility TEXT NOT NULL DEFAULT 'unlisted',
        retention_policy TEXT NOT NULL DEFAULT 'ephemeral_after_event',
        retention_days INTEGER NOT NULL DEFAULT 30,
        last_activity_at TEXT,
        expires_at TEXT,
        admin_token TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS participants (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        avatar_color TEXT NOT NULL,
        avatar_emoji TEXT NOT NULL,
        is_organizer INTEGER NOT NULL DEFAULT 0,
        participant_token TEXT NOT NULL DEFAULT '',
        pin_hash TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(plan_id, name COLLATE NOCASE)
      );

      CREATE TABLE IF NOT EXISTS availabilities (
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        slot TEXT NOT NULL DEFAULT 'all' CHECK(slot IN ('all', 'morning', 'afternoon', 'evening')),
        status TEXT NOT NULL CHECK(status IN ('yes', 'maybe', 'no')),
        note TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (plan_id, participant_id, date, slot)
      );

      CREATE TABLE IF NOT EXISTS poll_options (
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        proposed_by TEXT REFERENCES participants(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (plan_id, date)
      );

      CREATE TABLE IF NOT EXISTS votes (
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (plan_id, participant_id, date)
      );

      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        date TEXT,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rsvps (
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('going', 'maybe', 'not_going')),
        guests_count INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (plan_id, participant_id)
      );

      CREATE TABLE IF NOT EXISTS sub_polls (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        category TEXT NOT NULL DEFAULT 'place' CHECK(category IN ('place', 'activity', 'other')),
        question TEXT NOT NULL,
        winner_option_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sub_poll_options (
        id TEXT PRIMARY KEY,
        poll_id TEXT NOT NULL REFERENCES sub_polls(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        url TEXT NOT NULL DEFAULT '',
        estimated_cost TEXT NOT NULL DEFAULT '',
        proposed_by TEXT REFERENCES participants(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sub_poll_votes (
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        poll_id TEXT NOT NULL REFERENCES sub_polls(id) ON DELETE CASCADE,
        option_id TEXT NOT NULL REFERENCES sub_poll_options(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (poll_id, option_id, participant_id)
      );

      CREATE TABLE IF NOT EXISTS checklist_items (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        assigned_to TEXT REFERENCES participants(id) ON DELETE SET NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        created_by TEXT REFERENCES participants(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS carpool_rides (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        driver_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        origin TEXT NOT NULL,
        seats_total INTEGER NOT NULL DEFAULT 3,
        departure_time TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS carpool_passengers (
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        ride_id TEXT NOT NULL REFERENCES carpool_rides(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (ride_id, participant_id)
      );

      CREATE INDEX IF NOT EXISTS idx_avail_plan ON availabilities(plan_id);
      CREATE INDEX IF NOT EXISTS idx_votes_plan ON votes(plan_id);
      CREATE INDEX IF NOT EXISTS idx_comments_plan ON comments(plan_id);
      CREATE INDEX IF NOT EXISTS idx_rsvps_plan ON rsvps(plan_id);
      CREATE INDEX IF NOT EXISTS idx_sub_polls_plan ON sub_polls(plan_id);
      CREATE INDEX IF NOT EXISTS idx_checklist_plan ON checklist_items(plan_id);
      CREATE INDEX IF NOT EXISTS idx_carpool_plan ON carpool_rides(plan_id);
    `);

    // Safe online migrations for pre-existing databases
    this.ensureColumn('plans', 'voting_deadline', 'TEXT');
    this.ensureColumn('plans', 'blind_voting', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('plans', 'granularity', "TEXT NOT NULL DEFAULT 'day'");
    this.ensureColumn('plans', 'duration_days', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureColumn('plans', 'holiday_country', "TEXT NOT NULL DEFAULT 'ES'");
    this.ensureColumn('plans', 'required_participant_ids', "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn('plans', 'confirmed_end_date', 'TEXT');
    this.ensureColumn('plans', 'confirmed_duration_minutes', 'INTEGER NOT NULL DEFAULT 180');
    this.ensureColumn('plans', 'confirmed_timezone', 'TEXT');
    this.ensureColumn('plans', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('plans', 'visibility', "TEXT NOT NULL DEFAULT 'unlisted'");
    this.ensureColumn('plans', 'retention_policy', "TEXT NOT NULL DEFAULT 'ephemeral_after_event'");
    this.ensureColumn('plans', 'retention_days', 'INTEGER NOT NULL DEFAULT 30');
    this.ensureColumn('plans', 'last_activity_at', 'TEXT');
    this.ensureColumn('plans', 'expires_at', 'TEXT');

    this.ensureColumn('participants', 'participant_token', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('participants', 'pin_hash', 'TEXT');

    // Backfill participant tokens for legacy rows
    const missingTokens = this.db
      .prepare("SELECT id FROM participants WHERE participant_token IS NULL OR participant_token = ''")
      .all() as Array<{ id: string }>;
    for (const row of missingTokens) {
      this.db
        .prepare('UPDATE participants SET participant_token = ? WHERE id = ?')
        .run(crypto.randomBytes(16).toString('hex'), String(row.id));
    }

    // Mark demo slug if already existing from v1
    this.db.prepare("UPDATE plans SET is_demo = 1 WHERE slug = 'cena-reencuentro'").run();

    // Migrate legacy availabilities table lacking 'slot' PK
    const availCols = this.getColumnNames('availabilities');
    if (!availCols.has('slot')) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(`
          CREATE TABLE availabilities_v2 (
            plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
            participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
            date TEXT NOT NULL,
            slot TEXT NOT NULL DEFAULT 'all' CHECK(slot IN ('all', 'morning', 'afternoon', 'evening')),
            status TEXT NOT NULL CHECK(status IN ('yes', 'maybe', 'no')),
            note TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL,
            PRIMARY KEY (plan_id, participant_id, date, slot)
          );
          INSERT INTO availabilities_v2 (plan_id, participant_id, date, slot, status, note, updated_at)
          SELECT plan_id, participant_id, date, 'all', status, note, updated_at FROM availabilities;
          DROP TABLE availabilities;
          ALTER TABLE availabilities_v2 RENAME TO availabilities;
          CREATE INDEX IF NOT EXISTS idx_avail_plan ON availabilities(plan_id);
        `);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    }
  }

  close(): void {
    this.db.close();
  }

  private generateId(): string {
    return crypto.randomUUID();
  }

  private generateToken(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  private generateSlug(title: string): string {
    const base = title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24);
    // 10 base64url chars = 60 bits of entropy against brute-force enumeration
    const rand = crypto.randomBytes(8).toString('base64url').slice(0, 10).toLowerCase();
    return base ? `${base}-${rand}` : `quedada-${rand}`;
  }

  private mapPlan(row: Record<string, unknown>): Plan {
    let requiredIds: string[] = [];
    try {
      const parsed = JSON.parse(String(row.required_participant_ids ?? '[]'));
      if (Array.isArray(parsed)) requiredIds = parsed.map(String);
    } catch {
      requiredIds = [];
    }

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
      votingOpen: Number(row.voting_open) === 1,
      votingDeadline: row.voting_deadline ? String(row.voting_deadline) : null,
      blindVoting: Number(row.blind_voting ?? 0) === 1,
      granularity: (row.granularity === 'slots' ? 'slots' : 'day') as PlanGranularity,
      durationDays: Math.max(1, Math.min(7, Number(row.duration_days ?? 1))),
      holidayCountry: String(row.holiday_country ?? 'ES') as HolidayCountry,
      requiredParticipantIds: requiredIds,
      confirmedDate: row.confirmed_date ? String(row.confirmed_date) : null,
      confirmedEndDate: row.confirmed_end_date ? String(row.confirmed_end_date) : null,
      confirmedTime: row.confirmed_time ? String(row.confirmed_time) : null,
      confirmedDurationMinutes: Number(row.confirmed_duration_minutes ?? 180),
      confirmedTimezone: row.confirmed_timezone ? String(row.confirmed_timezone) : null,
      visibility: (row.visibility === 'public_demo' || Number(row.is_demo ?? 0) === 1
        ? 'public_demo'
        : 'unlisted') as PlanVisibility,
      retentionPolicy: (String(row.retention_policy ?? 'ephemeral_after_event')) as RetentionPolicy,
      retentionDays: Number(row.retention_days ?? 30),
      lastActivityAt: String(row.last_activity_at ?? row.created_at),
      expiresAt: row.expires_at ? String(row.expires_at) : null,
      createdAt: String(row.created_at),
    };
  }

  private mapParticipant(row: Record<string, unknown>): Participant {
    return {
      id: String(row.id),
      planId: String(row.plan_id),
      name: String(row.name),
      avatarColor: String(row.avatar_color),
      avatarEmoji: String(row.avatar_emoji),
      isOrganizer: Number(row.is_organizer) === 1,
      hasPin: Boolean(row.pin_hash),
      createdAt: String(row.created_at),
    };
  }

  getPlanRowBySlug(slug: string): Record<string, unknown> | null {
    const row = this.db
      .prepare('SELECT * FROM plans WHERE slug = ?')
      .get(slug) as Record<string, unknown> | undefined;
    if (!row) return null;
    const isDemo = Number(row.is_demo ?? 0) === 1;
    const expiresAt = row.expires_at ? String(row.expires_at) : null;
    if (!isDemo && isPlanExpired(expiresAt)) {
      this.db.prepare('DELETE FROM plans WHERE id = ?').run(String(row.id));
      throw new PlanExpiredError();
    }
    return row;
  }

  private touchPlanActivity(planId: string): void {
    const row = this.db
      .prepare(
        'SELECT is_demo, retention_policy, retention_days, confirmed_date, confirmed_end_date, expires_at FROM plans WHERE id = ?'
      )
      .get(planId) as Record<string, unknown> | undefined;
    if (!row || Number(row.is_demo ?? 0) === 1) return;

    const now = new Date();
    const policy = String(row.retention_policy ?? this.defaultRetentionPolicy) as RetentionPolicy;
    const retentionDays = Number(row.retention_days ?? this.defaultRetentionDays);
    const confirmedDate = row.confirmed_date ? String(row.confirmed_date) : null;
    const confirmedEndDate = row.confirmed_end_date ? String(row.confirmed_end_date) : null;
    const currentExpiresAt = row.expires_at ? String(row.expires_at) : null;

    if (policy === 'sliding_inactivity' || (policy === 'ephemeral_after_event' && !confirmedDate)) {
      const candidateExpiresAt = computeExpiresAt({
        policy,
        retentionDays,
        now,
        confirmedDate,
        confirmedEndDate,
        postEventGraceDays: this.postEventGraceDays,
      });
      const nextExpiresAt = pickLaterExpiration(currentExpiresAt, candidateExpiresAt);
      this.db
        .prepare('UPDATE plans SET last_activity_at = ?, expires_at = ? WHERE id = ?')
        .run(now.toISOString(), nextExpiresAt, planId);
    } else {
      this.db
        .prepare('UPDATE plans SET last_activity_at = ? WHERE id = ?')
        .run(now.toISOString(), planId);
    }
  }

  verifyAdminToken(planRow: Record<string, unknown>, token: string | null | undefined): boolean {
    if (!token) return false;
    return safeTimingEqual(String(planRow.admin_token), token);
  }

  verifyParticipantToken(
    planId: string,
    participantId: string,
    token: string | null | undefined,
    _allowDemoPlan = false
  ): boolean {
    if (!token) return false;
    const row = this.db
      .prepare('SELECT participant_token FROM participants WHERE id = ? AND plan_id = ?')
      .get(participantId, planId) as Record<string, unknown> | undefined;
    if (!row || !row.participant_token) return false;
    return safeTimingEqual(String(row.participant_token), token);
  }

  getParticipantByToken(planId: string, token: string): Participant | null {
    if (!token) return null;
    const rows = this.db
      .prepare('SELECT * FROM participants WHERE plan_id = ?')
      .all(planId) as Record<string, unknown>[];
    for (const r of rows) {
      if (r.participant_token && safeTimingEqual(String(r.participant_token), token)) {
        return this.mapParticipant(r);
      }
    }
    return null;
  }

  claimParticipantByPin(
    planId: string,
    name: string,
    pin: string
  ): { participant: Participant; participantToken: string } {
    const row = this.db
      .prepare('SELECT * FROM participants WHERE plan_id = ? AND name = ? COLLATE NOCASE')
      .get(planId, name.trim()) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error('No encontramos a nadie con ese nombre en esta quedada.');
    }
    if (!row.pin_hash) {
      throw new Error('Este perfil no tiene PIN configurado. Pide al organizador o usa tu enlace de traspaso.');
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

  getPlanSnapshotBySlug(
    slug: string,
    options?: { viewerParticipantId?: string | null; onlineParticipantIds?: string[]; includeAllVotes?: boolean }
  ): PlanSnapshot | null {
    const planRow = this.getPlanRowBySlug(slug);
    if (!planRow) return null;
    const plan = this.mapPlan(planRow);

    const participants = (
      this.db
        .prepare('SELECT * FROM participants WHERE plan_id = ? ORDER BY is_organizer DESC, created_at ASC')
        .all(plan.id) as Record<string, unknown>[]
    ).map((r) => this.mapParticipant(r));

    const availabilities: AvailabilityEntry[] = (
      this.db
        .prepare('SELECT participant_id, date, slot, status, note, updated_at FROM availabilities WHERE plan_id = ?')
        .all(plan.id) as Record<string, unknown>[]
    ).map((r) => ({
      participantId: String(r.participant_id),
      date: String(r.date),
      slot: String(r.slot ?? 'all') as AvailabilitySlot,
      status: String(r.status) as AvailabilityStatus,
      note: String(r.note ?? ''),
      updatedAt: String(r.updated_at),
    }));

    const pollOptions: PollOption[] = (
      this.db
        .prepare('SELECT date, label, proposed_by, created_at FROM poll_options WHERE plan_id = ? ORDER BY date ASC')
        .all(plan.id) as Record<string, unknown>[]
    ).map((r) => ({
      date: String(r.date),
      label: String(r.label ?? ''),
      proposedBy: r.proposed_by ? String(r.proposed_by) : null,
      createdAt: String(r.created_at),
    }));

    const allVotes: VoteEntry[] = (
      this.db
        .prepare('SELECT participant_id, date, created_at FROM votes WHERE plan_id = ? ORDER BY created_at ASC')
        .all(plan.id) as Record<string, unknown>[]
    ).map((r) => ({
      participantId: String(r.participant_id),
      date: String(r.date),
      createdAt: String(r.created_at),
    }));

    // Blind voting masks other voters while voting is open & date is unconfirmed
    const hideVotes =
      plan.blindVoting && isVotingEffectivelyOpen(plan) && !plan.confirmedDate && !options?.includeAllVotes;
    const viewerId = options?.viewerParticipantId ?? null;
    const votes = hideVotes
      ? allVotes.filter((v) => viewerId !== null && v.participantId === viewerId)
      : allVotes;
    const distinctVoters = new Set(allVotes.map((v) => v.participantId)).size;
    const blindVoteStats = hideVotes
      ? { totalVotes: allVotes.length, votersCount: distinctVoters, hidden: true }
      : undefined;

    const comments: CommentEntry[] = (
      this.db
        .prepare('SELECT id, participant_id, date, body, created_at FROM comments WHERE plan_id = ? ORDER BY created_at DESC LIMIT 80')
        .all(plan.id) as Record<string, unknown>[]
    ).map((r) => ({
      id: String(r.id),
      participantId: String(r.participant_id),
      date: r.date ? String(r.date) : null,
      body: String(r.body),
      createdAt: String(r.created_at),
    }));

    const rsvps: RsvpEntry[] = (
      this.db
        .prepare('SELECT participant_id, status, guests_count, note, updated_at FROM rsvps WHERE plan_id = ?')
        .all(plan.id) as Record<string, unknown>[]
    ).map((r) => ({
      participantId: String(r.participant_id),
      status: String(r.status) as RsvpStatus,
      guestsCount: Number(r.guests_count ?? 0),
      note: String(r.note ?? ''),
      updatedAt: String(r.updated_at),
    }));

    // Sub-polls
    const pollRows = this.db
      .prepare('SELECT id, category, question, winner_option_id, created_at FROM sub_polls WHERE plan_id = ? ORDER BY created_at ASC')
      .all(plan.id) as Record<string, unknown>[];
    const optRows = this.db
      .prepare('SELECT id, poll_id, title, url, estimated_cost, proposed_by, created_at FROM sub_poll_options WHERE plan_id = ? ORDER BY created_at ASC')
      .all(plan.id) as Record<string, unknown>[];
    const subVoteRows = this.db
      .prepare('SELECT option_id, participant_id FROM sub_poll_votes WHERE plan_id = ?')
      .all(plan.id) as Record<string, unknown>[];

    const votersByOption = new Map<string, string[]>();
    for (const v of subVoteRows) {
      const oid = String(v.option_id);
      const arr = votersByOption.get(oid) ?? [];
      arr.push(String(v.participant_id));
      votersByOption.set(oid, arr);
    }

    const optionsByPoll = new Map<string, SubPollOption[]>();
    for (const o of optRows) {
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
        createdAt: String(o.created_at),
      });
      optionsByPoll.set(pid, arr);
    }

    const subPolls: SubPoll[] = pollRows.map((p) => ({
      id: String(p.id),
      category: String(p.category) as SubPollCategory,
      question: String(p.question),
      winnerOptionId: p.winner_option_id ? String(p.winner_option_id) : null,
      options: optionsByPoll.get(String(p.id)) ?? [],
      createdAt: String(p.created_at),
    }));

    // Checklist
    const checklist: ChecklistItem[] = (
      this.db
        .prepare('SELECT id, title, assigned_to, completed, created_by, created_at FROM checklist_items WHERE plan_id = ? ORDER BY completed ASC, created_at ASC')
        .all(plan.id) as Record<string, unknown>[]
    ).map((r) => ({
      id: String(r.id),
      title: String(r.title),
      assignedTo: r.assigned_to ? String(r.assigned_to) : null,
      completed: Number(r.completed) === 1,
      createdBy: r.created_by ? String(r.created_by) : null,
      createdAt: String(r.created_at),
    }));

    // Carpools
    const rideRows = this.db
      .prepare('SELECT id, driver_id, origin, seats_total, departure_time, notes, created_at FROM carpool_rides WHERE plan_id = ? ORDER BY created_at ASC')
      .all(plan.id) as Record<string, unknown>[];
    const passRows = this.db
      .prepare('SELECT ride_id, participant_id FROM carpool_passengers WHERE plan_id = ? ORDER BY created_at ASC')
      .all(plan.id) as Record<string, unknown>[];
    const passByRide = new Map<string, string[]>();
    for (const pr of passRows) {
      const rid = String(pr.ride_id);
      const arr = passByRide.get(rid) ?? [];
      arr.push(String(pr.participant_id));
      passByRide.set(rid, arr);
    }

    const carpools: CarpoolRide[] = rideRows.map((r) => ({
      id: String(r.id),
      driverId: String(r.driver_id),
      origin: String(r.origin),
      seatsTotal: Number(r.seats_total ?? 3),
      departureTime: String(r.departure_time ?? ''),
      notes: String(r.notes ?? ''),
      passengerIds: passByRide.get(String(r.id)) ?? [],
      createdAt: String(r.created_at),
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

  /**
   * Lists only explicitly public/demo plans so private user plans never leak globally.
   */
  listPublicPlans(limit = 6): PlanSummaryItem[] {
    const rows = this.db
      .prepare(`
        SELECT p.slug, p.title, p.emoji, p.location, p.confirmed_date, p.created_at,
               p.retention_policy, p.expires_at,
               COUNT(pa.id) AS participant_count
        FROM plans p
        LEFT JOIN participants pa ON pa.plan_id = p.id
        WHERE p.is_demo = 1
        GROUP BY p.id
        ORDER BY p.created_at DESC
        LIMIT ?
      `)
      .all(limit) as Record<string, unknown>[];

    return rows.map((r) => ({
      slug: String(r.slug),
      title: String(r.title),
      emoji: String(r.emoji),
      location: String(r.location ?? ''),
      participantCount: Number(r.participant_count ?? 0),
      confirmedDate: r.confirmed_date ? String(r.confirmed_date) : null,
      createdAt: String(r.created_at),
      retentionPolicy: String(r.retention_policy ?? 'persistent') as RetentionPolicy,
      expiresAt: r.expires_at ? String(r.expires_at) : null,
    }));
  }

  /**
   * Safely hydrates summaries ONLY for specific slugs the user already knows locally.
   */
  lookupPlansBySlugs(slugs: string[]): PlanSummaryItem[] {
    const clean = Array.from(new Set(slugs.map((s) => s.trim()).filter(Boolean))).slice(0, 15);
    if (clean.length === 0) return [];
    const placeholders = clean.map(() => '?').join(', ');
    const nowIso = new Date().toISOString();
    const rows = this.db
      .prepare(`
        SELECT p.slug, p.title, p.emoji, p.location, p.confirmed_date, p.created_at,
               p.retention_policy, p.expires_at,
               COUNT(pa.id) AS participant_count
        FROM plans p
        LEFT JOIN participants pa ON pa.plan_id = p.id
        WHERE p.slug IN (${placeholders})
          AND (p.is_demo = 1 OR p.expires_at IS NULL OR p.expires_at > ?)
        GROUP BY p.id
      `)
      .all(...clean, nowIso) as Record<string, unknown>[];

    const bySlug = new Map<string, PlanSummaryItem>(
      rows.map((r) => [
        String(r.slug),
        {
          slug: String(r.slug),
          title: String(r.title),
          emoji: String(r.emoji),
          location: String(r.location ?? ''),
          participantCount: Number(r.participant_count ?? 0),
          confirmedDate: r.confirmed_date ? String(r.confirmed_date) : null,
          createdAt: String(r.created_at),
          retentionPolicy: String(r.retention_policy ?? 'ephemeral_after_event') as RetentionPolicy,
          expiresAt: r.expires_at ? String(r.expires_at) : null,
        },
      ])
    );

    return clean.map((s) => bySlug.get(s)).filter((x): x is PlanSummaryItem => Boolean(x));
  }

  createPlan(input: {
    title: string;
    description?: string;
    location?: string;
    emoji?: string;
    organizerName: string;
    organizerColor?: string;
    organizerEmoji?: string;
    organizerPin?: string;
    startMonth?: string;
    endMonth?: string;
    maxVotesPerUser?: number;
    granularity?: PlanGranularity;
    durationDays?: number;
    votingDeadline?: string | null;
    blindVoting?: boolean;
    holidayCountry?: HolidayCountry;
    retentionPolicy?: RetentionPolicy;
    retentionDays?: number;
    customSlug?: string;
    isDemo?: boolean;
  }): { plan: Plan; participant: Participant; adminToken: string; participantToken: string } {
    const now = new Date();
    const defaultStart = formatMonthISO(now.getFullYear(), now.getMonth());
    const startMonth = input.startMonth || defaultStart;
    const endMonth = input.endMonth || addMonthsISO(startMonth, 2);
    validatePlanDates({ startMonth, endMonth, votingDeadline: input.votingDeadline });

    const id = this.generateId();
    const slug = input.customSlug || this.generateSlug(input.title);
    const adminToken = this.generateToken();
    const createdAt = now.toISOString();
    const isDemo = Boolean(input.isDemo);
    const visibility: PlanVisibility = isDemo ? 'public_demo' : 'unlisted';
    const retentionPolicy: RetentionPolicy = isDemo
      ? 'persistent'
      : (input.retentionPolicy ?? this.defaultRetentionPolicy);
    const retentionDays =
      retentionPolicy === 'persistent'
        ? 0
        : Math.max(1, Math.min(365, input.retentionDays ?? this.defaultRetentionDays));
    const expiresAt = isDemo
      ? null
      : computeExpiresAt({
          policy: retentionPolicy,
          retentionDays,
          now,
          createdAt: now,
          postEventGraceDays: this.postEventGraceDays,
        });

    this.db
      .prepare(`
        INSERT INTO plans (
          id, slug, title, description, location, emoji,
          start_month, end_month, max_votes_per_user, voting_open,
          voting_deadline, blind_voting, granularity, duration_days,
          holiday_country, required_participant_ids, is_demo,
          visibility, retention_policy, retention_days, last_activity_at, expires_at,
          admin_token, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
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
        input.blindVoting ? 1 : 0,
        input.granularity ?? 'day',
        Math.max(1, Math.min(7, input.durationDays ?? 1)),
        input.holidayCountry ?? 'ES',
        isDemo ? 1 : 0,
        visibility,
        retentionPolicy,
        retentionDays,
        createdAt,
        expiresAt,
        adminToken,
        createdAt
      );

    const joined = this.addOrGetParticipant(id, {
      name: input.organizerName.trim(),
      avatarColor: input.organizerColor || AVATAR_COLORS[0],
      avatarEmoji: input.organizerEmoji || AVATAR_EMOJIS[0],
      pin: input.organizerPin,
      isOrganizer: true,
    });

    const planRow = this.getPlanRowBySlug(slug)!;
    return {
      plan: this.mapPlan(planRow),
      participant: joined.participant,
      adminToken,
      participantToken: joined.participantToken,
    };
  }

  addOrGetParticipant(
    planId: string,
    input: {
      name: string;
      avatarColor?: string;
      avatarEmoji?: string;
      pin?: string;
      isOrganizer?: boolean;
      rejectDuplicate?: boolean;
    }
  ): { participant: Participant; participantToken: string } {
    const cleanName = input.name.trim();
    const existing = this.db
      .prepare('SELECT * FROM participants WHERE plan_id = ? AND name = ? COLLATE NOCASE')
      .get(planId, cleanName) as Record<string, unknown> | undefined;

    if (existing) {
      if (input.rejectDuplicate) {
        throw new Error(
          `Ya hay alguien apuntado como «${String(existing.name)}». Usa otro nombre o recupera tu perfil con PIN.`
        );
      }
      if (input.avatarColor || input.avatarEmoji) {
        this.db
          .prepare('UPDATE participants SET avatar_color = ?, avatar_emoji = ? WHERE id = ?')
          .run(
            input.avatarColor ?? String(existing.avatar_color),
            input.avatarEmoji ?? String(existing.avatar_emoji),
            String(existing.id)
          );
        const updated = this.db
          .prepare('SELECT * FROM participants WHERE id = ?')
          .get(String(existing.id)) as Record<string, unknown>;
        return {
          participant: this.mapParticipant(updated),
          participantToken: String(updated.participant_token),
        };
      }
      return {
        participant: this.mapParticipant(existing),
        participantToken: String(existing.participant_token),
      };
    }

    const countRow = this.db
      .prepare('SELECT COUNT(*) as c FROM participants WHERE plan_id = ?')
      .get(planId) as Record<string, unknown>;
    const idx = Number(countRow.c ?? 0);

    const id = this.generateId();
    const color = input.avatarColor || AVATAR_COLORS[idx % AVATAR_COLORS.length];
    const emoji = input.avatarEmoji || AVATAR_EMOJIS[idx % AVATAR_EMOJIS.length];
    const participantToken = this.generateToken();
    const pinHash = input.pin && input.pin.trim().length >= 4 ? hashPin(id, input.pin) : null;
    const createdAt = new Date().toISOString();

    this.db
      .prepare(`
        INSERT INTO participants (id, plan_id, name, avatar_color, avatar_emoji, is_organizer, participant_token, pin_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(id, planId, cleanName, color, emoji, input.isOrganizer ? 1 : 0, participantToken, pinHash, createdAt);

    const row = this.db
      .prepare('SELECT * FROM participants WHERE id = ?')
      .get(id) as Record<string, unknown>;
    this.touchPlanActivity(planId);
    return {
      participant: this.mapParticipant(row),
      participantToken,
    };
  }

  updateParticipant(
    planId: string,
    participantId: string,
    updates: { name?: string; avatarColor?: string; avatarEmoji?: string; pin?: string }
  ): Participant {
    const existing = this.db
      .prepare('SELECT * FROM participants WHERE id = ? AND plan_id = ?')
      .get(participantId, planId) as Record<string, unknown> | undefined;
    if (!existing) throw new Error('Participante no encontrado');

    if (updates.pin !== undefined && !profilePinSchema.safeParse(updates.pin).success) {
      throw new ValidationError('El PIN debe tener al menos 4 caracteres');
    }

    const nextName = updates.name !== undefined ? updates.name.trim() : String(existing.name);
    if (nextName.toLowerCase() !== String(existing.name).toLowerCase()) {
      const collision = this.db
        .prepare('SELECT id FROM participants WHERE plan_id = ? AND name = ? COLLATE NOCASE AND id != ?')
        .get(planId, nextName, participantId);
      if (collision) {
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

    this.db
      .prepare('UPDATE participants SET name = ?, avatar_color = ?, avatar_emoji = ?, pin_hash = ? WHERE id = ?')
      .run(nextName, nextColor, nextEmoji, nextPinHash, participantId);

    const updated = this.db
      .prepare('SELECT * FROM participants WHERE id = ?')
      .get(participantId) as Record<string, unknown>;
    this.touchPlanActivity(planId);
    return this.mapParticipant(updated);
  }

  deleteParticipant(planId: string, participantId: string): boolean {
    const info = this.db
      .prepare('DELETE FROM participants WHERE id = ? AND plan_id = ?')
      .run(participantId, planId);
    if (Number(info.changes) > 0) this.touchPlanActivity(planId);
    return Number(info.changes) > 0;
  }

  deletePlan(slug: string): boolean {
    const info = this.db.prepare('DELETE FROM plans WHERE slug = ?').run(slug);
    return Number(info.changes) > 0;
  }

  setAvailabilityBatch(
    planId: string,
    participantId: string,
    changes: Array<{ date: string; slot?: AvailabilitySlot; status: AvailabilityStatus | null; note?: string }>
  ): void {
    const participant = this.db
      .prepare('SELECT id FROM participants WHERE id = ? AND plan_id = ?')
      .get(participantId, planId);
    if (!participant) {
      throw new Error('Participante no encontrado en esta quedada');
    }

    const now = new Date().toISOString();
    const upsertWithNoteStmt = this.db.prepare(`
      INSERT INTO availabilities (plan_id, participant_id, date, slot, status, note, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plan_id, participant_id, date, slot)
      DO UPDATE SET status = excluded.status, note = excluded.note, updated_at = excluded.updated_at
    `);
    const upsertKeepNoteStmt = this.db.prepare(`
      INSERT INTO availabilities (plan_id, participant_id, date, slot, status, note, updated_at)
      VALUES (?, ?, ?, ?, ?, '', ?)
      ON CONFLICT(plan_id, participant_id, date, slot)
      DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
    `);
    const deleteStmt = this.db.prepare(
      'DELETE FROM availabilities WHERE plan_id = ? AND participant_id = ? AND date = ? AND slot = ?'
    );

    this.db.exec('BEGIN');
    try {
      for (const ch of changes) {
        const slot: AvailabilitySlot = ch.slot ?? 'all';
        if (ch.status === null) {
          deleteStmt.run(planId, participantId, ch.date, slot);
        } else if (ch.note !== undefined) {
          upsertWithNoteStmt.run(planId, participantId, ch.date, slot, ch.status, ch.note.trim(), now);
        } else {
          upsertKeepNoteStmt.run(planId, participantId, ch.date, slot, ch.status, now);
        }
      }
      this.db.exec('COMMIT');
      this.touchPlanActivity(planId);
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  nominateDate(planId: string, date: string, label = '', proposedBy: string | null = null): void {
    this.assertParticipantInPlan(planId, proposedBy);
    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO poll_options (plan_id, date, label, proposed_by, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(plan_id, date)
        DO UPDATE SET label = CASE WHEN excluded.label != '' THEN excluded.label ELSE poll_options.label END
      `)
      .run(planId, date, label.trim(), proposedBy, now);
    this.touchPlanActivity(planId);
  }

  removePollOption(planId: string, date: string): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM poll_options WHERE plan_id = ? AND date = ?').run(planId, date);
      this.db.prepare('DELETE FROM votes WHERE plan_id = ? AND date = ?').run(planId, date);
      this.db.exec('COMMIT');
      this.touchPlanActivity(planId);
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  toggleVote(
    planId: string,
    participantId: string,
    date: string
  ): { voted: boolean } {
    const planRow = this.db
      .prepare('SELECT voting_open, voting_deadline, max_votes_per_user FROM plans WHERE id = ?')
      .get(planId) as Record<string, unknown> | undefined;
    if (!planRow) throw new Error('Quedada no encontrada');
    const isOpen = isVotingEffectivelyOpen({
      votingOpen: Number(planRow.voting_open) === 1,
      votingDeadline: planRow.voting_deadline ? String(planRow.voting_deadline) : null,
    });
    if (!isOpen) {
      throw new Error('La votación está cerrada');
    }

    const participant = this.db
      .prepare('SELECT id FROM participants WHERE id = ? AND plan_id = ?')
      .get(participantId, planId);
    if (!participant) {
      throw new Error('Participante no encontrado');
    }

    const existing = this.db
      .prepare('SELECT 1 FROM votes WHERE plan_id = ? AND participant_id = ? AND date = ?')
      .get(planId, participantId, date);

    if (existing) {
      this.db
        .prepare('DELETE FROM votes WHERE plan_id = ? AND participant_id = ? AND date = ?')
        .run(planId, participantId, date);
      this.touchPlanActivity(planId);
      return { voted: false };
    }

    const maxVotes = Number(planRow.max_votes_per_user ?? 3);
    if (maxVotes > 0) {
      const countRow = this.db
        .prepare('SELECT COUNT(*) as c FROM votes WHERE plan_id = ? AND participant_id = ?')
        .get(planId, participantId) as Record<string, unknown>;
      if (Number(countRow.c ?? 0) >= maxVotes) {
        throw new Error(
          `Has alcanzado el máximo de ${maxVotes} ${maxVotes === 1 ? 'voto' : 'votos'}. Quita uno para votar otro día.`
        );
      }
    }

    const now = new Date().toISOString();
    this.nominateDate(planId, date, '', participantId);
    this.db
      .prepare('INSERT INTO votes (plan_id, participant_id, date, created_at) VALUES (?, ?, ?, ?)')
      .run(planId, participantId, date, now);

    this.touchPlanActivity(planId);
    return { voted: true };
  }

  addComment(planId: string, participantId: string, body: string, date: string | null = null): CommentEntry {
    const participant = this.db
      .prepare('SELECT id FROM participants WHERE id = ? AND plan_id = ?')
      .get(participantId, planId);
    if (!participant) throw new Error('Participante no encontrado');

    const id = this.generateId();
    const createdAt = new Date().toISOString();
    this.db
      .prepare('INSERT INTO comments (id, plan_id, participant_id, date, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, planId, participantId, date, body.trim(), createdAt);

    this.touchPlanActivity(planId);
    return {
      id,
      participantId,
      date,
      body: body.trim(),
      createdAt,
    };
  }

  // ---- RSVP ----
  setRsvp(
    planId: string,
    participantId: string,
    status: RsvpStatus,
    guestsCount = 0,
    note = ''
  ): void {
    const participant = this.db
      .prepare('SELECT id FROM participants WHERE id = ? AND plan_id = ?')
      .get(participantId, planId);
    if (!participant) throw new Error('Participante no encontrado');

    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO rsvps (plan_id, participant_id, status, guests_count, note, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(plan_id, participant_id)
        DO UPDATE SET status = excluded.status, guests_count = excluded.guests_count, note = excluded.note, updated_at = excluded.updated_at
      `)
      .run(planId, participantId, status, Math.max(0, Math.min(10, guestsCount)), note.trim(), now);
    this.touchPlanActivity(planId);
  }

  // ---- Sub-Polls (Where / What) ----
  createSubPoll(
    planId: string,
    category: SubPollCategory,
    question: string,
    initialOptions: Array<{ title: string; url?: string; estimatedCost?: string }> = [],
    proposedBy: string | null = null
  ): string {
    this.assertParticipantInPlan(planId, proposedBy);
    const pollId = this.generateId();
    const now = new Date().toISOString();

    this.db.exec('BEGIN');
    try {
      this.db
        .prepare('INSERT INTO sub_polls (id, plan_id, category, question, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(pollId, planId, category, question.trim(), now);

      const optStmt = this.db.prepare(
        'INSERT INTO sub_poll_options (id, poll_id, plan_id, title, url, estimated_cost, proposed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const opt of initialOptions) {
        if (!opt.title.trim()) continue;
        optStmt.run(
          this.generateId(),
          pollId,
          planId,
          opt.title.trim(),
          (opt.url ?? '').trim(),
          (opt.estimatedCost ?? '').trim(),
          proposedBy,
          now
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    this.touchPlanActivity(planId);
    return pollId;
  }

  addSubPollOption(
    planId: string,
    pollId: string,
    title: string,
    url = '',
    estimatedCost = '',
    proposedBy: string | null = null
  ): string {
    this.assertParticipantInPlan(planId, proposedBy);
    const poll = this.db
      .prepare('SELECT id FROM sub_polls WHERE id = ? AND plan_id = ?')
      .get(pollId, planId);
    if (!poll) throw new Error('Encuesta no encontrada');

    const id = this.generateId();
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO sub_poll_options (id, poll_id, plan_id, title, url, estimated_cost, proposed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(id, pollId, planId, title.trim(), url.trim(), estimatedCost.trim(), proposedBy, now);
    this.touchPlanActivity(planId);
    return id;
  }

  toggleSubPollVote(
    planId: string,
    pollId: string,
    optionId: string,
    participantId: string
  ): { voted: boolean } {
    const opt = this.db
      .prepare('SELECT id FROM sub_poll_options WHERE id = ? AND poll_id = ? AND plan_id = ?')
      .get(optionId, pollId, planId);
    if (!opt) throw new Error('Opción no encontrada');

    const existing = this.db
      .prepare('SELECT 1 FROM sub_poll_votes WHERE poll_id = ? AND option_id = ? AND participant_id = ?')
      .get(pollId, optionId, participantId);

    if (existing) {
      this.db
        .prepare('DELETE FROM sub_poll_votes WHERE poll_id = ? AND option_id = ? AND participant_id = ?')
        .run(pollId, optionId, participantId);
      this.touchPlanActivity(planId);
      return { voted: false };
    }

    this.db
      .prepare('INSERT INTO sub_poll_votes (plan_id, poll_id, option_id, participant_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(planId, pollId, optionId, participantId, new Date().toISOString());
    this.touchPlanActivity(planId);
    return { voted: true };
  }

  setSubPollWinner(planId: string, pollId: string, winnerOptionId: string | null): void {
    const poll = this.db.prepare('SELECT id FROM sub_polls WHERE id = ? AND plan_id = ?').get(pollId, planId);
    if (!poll) throw new ValidationError('Encuesta no encontrada');
    if (winnerOptionId !== null) {
      const option = this.db.prepare('SELECT id FROM sub_poll_options WHERE id = ? AND poll_id = ? AND plan_id = ?').get(winnerOptionId, pollId, planId);
      if (!option) throw new ValidationError('Opcion no encontrada en esta encuesta');
    }
    this.db
      .prepare('UPDATE sub_polls SET winner_option_id = ? WHERE id = ? AND plan_id = ?')
      .run(winnerOptionId, pollId, planId);
    this.touchPlanActivity(planId);
  }

  deleteSubPoll(planId: string, pollId: string): void {
    this.db.prepare('DELETE FROM sub_polls WHERE id = ? AND plan_id = ?').run(pollId, planId);
    this.touchPlanActivity(planId);
  }

  // ---- Checklist ("¿Quién lleva qué?") ----
  private assertParticipantInPlan(planId: string, participantId: string | null): void {
    if (participantId === null) return;
    const row = this.db.prepare('SELECT id FROM participants WHERE id = ? AND plan_id = ?').get(participantId, planId);
    if (!row) throw new ValidationError('Participante no encontrado en esta quedada');
  }

  addChecklistItem(
    planId: string,
    title: string,
    assignedTo: string | null = null,
    createdBy: string | null = null
  ): string {
    this.assertParticipantInPlan(planId, assignedTo);
    this.assertParticipantInPlan(planId, createdBy);
    const id = this.generateId();
    this.db
      .prepare('INSERT INTO checklist_items (id, plan_id, title, assigned_to, completed, created_by, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
      .run(id, planId, title.trim(), assignedTo, createdBy, new Date().toISOString());
    this.touchPlanActivity(planId);
    return id;
  }

  updateChecklistItem(
    planId: string,
    itemId: string,
    updates: { title?: string; assignedTo?: string | null; completed?: boolean }
  ): void {
    const existing = this.db
      .prepare('SELECT * FROM checklist_items WHERE id = ? AND plan_id = ?')
      .get(itemId, planId) as Record<string, unknown> | undefined;
    if (!existing) throw new Error('Elemento no encontrado');

    const nextTitle = updates.title !== undefined ? updates.title.trim() : String(existing.title);
    const nextAssigned =
      updates.assignedTo !== undefined
        ? updates.assignedTo
        : existing.assigned_to
          ? String(existing.assigned_to)
          : null;
    this.assertParticipantInPlan(planId, nextAssigned);
    const nextCompleted =
      updates.completed !== undefined ? (updates.completed ? 1 : 0) : Number(existing.completed);

    this.db
      .prepare('UPDATE checklist_items SET title = ?, assigned_to = ?, completed = ? WHERE id = ? AND plan_id = ?')
      .run(nextTitle, nextAssigned, nextCompleted, itemId, planId);
    this.touchPlanActivity(planId);
  }

  deleteChecklistItem(planId: string, itemId: string): void {
    this.db.prepare('DELETE FROM checklist_items WHERE id = ? AND plan_id = ?').run(itemId, planId);
    this.touchPlanActivity(planId);
  }

  // ---- Carpooling ----
  addCarpoolRide(
    planId: string,
    driverId: string,
    origin: string,
    seatsTotal: number,
    departureTime = '',
    notes = ''
  ): string {
    const driver = this.db
      .prepare('SELECT id FROM participants WHERE id = ? AND plan_id = ?')
      .get(driverId, planId);
    if (!driver) throw new Error('Conductor no encontrado');

    const id = this.generateId();
    this.db
      .prepare(
        'INSERT INTO carpool_rides (id, plan_id, driver_id, origin, seats_total, departure_time, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        id,
        planId,
        driverId,
        origin.trim(),
        Math.max(1, Math.min(9, seatsTotal)),
        departureTime.trim(),
        notes.trim(),
        new Date().toISOString()
      );
    this.touchPlanActivity(planId);
    return id;
  }

  toggleCarpoolSeat(planId: string, rideId: string, participantId: string): { joined: boolean } {
    const ride = this.db
      .prepare('SELECT driver_id, seats_total FROM carpool_rides WHERE id = ? AND plan_id = ?')
      .get(rideId, planId) as Record<string, unknown> | undefined;
    if (!ride) throw new Error('Coche no encontrado');
    if (String(ride.driver_id) === participantId) {
      throw new Error('Ya eres el conductor de este coche.');
    }

    const existing = this.db
      .prepare('SELECT 1 FROM carpool_passengers WHERE ride_id = ? AND participant_id = ?')
      .get(rideId, participantId);
    if (existing) {
      this.db
        .prepare('DELETE FROM carpool_passengers WHERE ride_id = ? AND participant_id = ?')
        .run(rideId, participantId);
      this.touchPlanActivity(planId);
      return { joined: false };
    }

    const countRow = this.db
      .prepare('SELECT COUNT(*) as c FROM carpool_passengers WHERE ride_id = ?')
      .get(rideId) as Record<string, unknown>;
    if (Number(countRow.c ?? 0) >= Number(ride.seats_total ?? 1)) {
      throw new Error('Este coche ya está completo.');
    }

    this.db
      .prepare('INSERT INTO carpool_passengers (plan_id, ride_id, participant_id, created_at) VALUES (?, ?, ?, ?)')
      .run(planId, rideId, participantId, new Date().toISOString());
    this.touchPlanActivity(planId);
    return { joined: true };
  }

  deleteCarpoolRide(planId: string, rideId: string): void {
    this.db.prepare('DELETE FROM carpool_rides WHERE id = ? AND plan_id = ?').run(rideId, planId);
    this.touchPlanActivity(planId);
  }

  // ---- Plan Settings ----
  updatePlanSettings(
    slug: string,
    updates: {
      title?: string;
      description?: string;
      location?: string;
      emoji?: string;
      startMonth?: string;
      endMonth?: string;
      maxVotesPerUser?: number;
      votingOpen?: boolean;
      votingDeadline?: string | null;
      blindVoting?: boolean;
      granularity?: PlanGranularity;
      durationDays?: number;
      holidayCountry?: HolidayCountry;
      requiredParticipantIds?: string[];
      confirmedDate?: string | null;
      confirmedEndDate?: string | null;
      confirmedTime?: string | null;
      confirmedDurationMinutes?: number;
      confirmedTimezone?: string | null;
      retentionPolicy?: RetentionPolicy;
      retentionDays?: number;
    }
  ): Plan | null {
    const row = this.getPlanRowBySlug(slug);
    if (!row) return null;
    const now = new Date();
    const isDemo = Number(row.is_demo ?? 0) === 1;

    const nextTitle = updates.title !== undefined ? updates.title.trim() : String(row.title);
    const nextDesc = updates.description !== undefined ? updates.description.trim() : String(row.description);
    const nextLoc = updates.location !== undefined ? updates.location.trim() : String(row.location);
    const nextEmoji = updates.emoji !== undefined ? updates.emoji : String(row.emoji);
    const nextStartMonth = updates.startMonth !== undefined ? updates.startMonth : String(row.start_month);
    const nextEndMonth = updates.endMonth !== undefined ? updates.endMonth : String(row.end_month);
    const nextMaxVotes =
      updates.maxVotesPerUser !== undefined ? updates.maxVotesPerUser : Number(row.max_votes_per_user);
    const nextVotingOpen =
      updates.votingOpen !== undefined ? (updates.votingOpen ? 1 : 0) : Number(row.voting_open);
    const nextDeadline =
      updates.votingDeadline !== undefined
        ? updates.votingDeadline
        : row.voting_deadline
          ? String(row.voting_deadline)
          : null;
    const nextBlind =
      updates.blindVoting !== undefined ? (updates.blindVoting ? 1 : 0) : Number(row.blind_voting ?? 0);
    const nextGranularity =
      updates.granularity !== undefined ? updates.granularity : String(row.granularity ?? 'day');
    const nextDurationDays =
      updates.durationDays !== undefined
        ? Math.max(1, Math.min(7, updates.durationDays))
        : Number(row.duration_days ?? 1);
    const nextHolidayCountry =
      updates.holidayCountry !== undefined ? updates.holidayCountry : String(row.holiday_country ?? 'ES');
    const nextRequiredIds =
      updates.requiredParticipantIds !== undefined
        ? JSON.stringify(updates.requiredParticipantIds)
        : String(row.required_participant_ids ?? '[]');
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
      : (updates.retentionPolicy ??
        (String(row.retention_policy ?? 'ephemeral_after_event') as RetentionPolicy));
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
    const existingExpiresAt = row.expires_at ? String(row.expires_at) : null;

    let nextExpiresAt: string | null;
    if (isDemo) {
      nextExpiresAt = null;
    } else if (retentionChanged) {
      nextExpiresAt = computeExpiresAt({
        policy: nextRetentionPolicy,
        retentionDays: nextRetentionDays,
        now,
        // Anchor newly chosen fixed_ttl from now so switching an older plan never deletes it immediately
        createdAt: switchedToFixedTtl ? now : new Date(String(row.created_at)),
        confirmedDate: nextConfirmedDate,
        confirmedEndDate: nextConfirmedEndDate,
        postEventGraceDays: this.postEventGraceDays,
      });
    } else if (nextRetentionPolicy === 'sliding_inactivity') {
      const candidate = computeExpiresAt({
        policy: nextRetentionPolicy,
        retentionDays: nextRetentionDays,
        now,
        createdAt: new Date(String(row.created_at)),
        confirmedDate: nextConfirmedDate,
        confirmedEndDate: nextConfirmedEndDate,
        postEventGraceDays: this.postEventGraceDays,
      });
      nextExpiresAt = pickLaterExpiration(existingExpiresAt, candidate);
    } else {
      nextExpiresAt = existingExpiresAt;
    }

    this.db
      .prepare(`
        UPDATE plans
        SET title = ?, description = ?, location = ?, emoji = ?,
            start_month = ?, end_month = ?, max_votes_per_user = ?, voting_open = ?,
            voting_deadline = ?, blind_voting = ?, granularity = ?, duration_days = ?,
            holiday_country = ?, required_participant_ids = ?,
            confirmed_date = ?, confirmed_end_date = ?, confirmed_time = ?,
            confirmed_duration_minutes = ?, confirmed_timezone = ?,
            retention_policy = ?, retention_days = ?, last_activity_at = ?, expires_at = ?
        WHERE id = ?
      `)
      .run(
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
        nextRequiredIds,
        nextConfirmedDate,
        nextConfirmedEndDate,
        nextConfirmedTime,
        nextConfirmedDuration,
        nextConfirmedTimezone,
        nextRetentionPolicy,
        nextRetentionDays,
        now.toISOString(),
        nextExpiresAt,
        String(row.id)
      );

    const updated = this.getPlanRowBySlug(slug)!;
    return this.mapPlan(updated);
  }

  extendPlanExpiration(slug: string, extraDays = 30): Plan | null {
    const row = this.getPlanRowBySlug(slug);
    if (!row) return null;
    if (Number(row.is_demo ?? 0) === 1 || String(row.retention_policy) === 'persistent') {
      return this.mapPlan(row);
    }
    const days = Math.max(1, Math.min(365, Math.round(extraDays)));
    const nowMs = Date.now();
    const currentExp = row.expires_at ? String(row.expires_at) : null;
    const baseMs = currentExp ? Math.max(nowMs, Date.parse(currentExp) || nowMs) : nowMs;
    const nextExpiresAt = new Date(baseMs + days * 24 * 60 * 60 * 1000).toISOString();
    this.db
      .prepare('UPDATE plans SET expires_at = ?, last_activity_at = ? WHERE id = ?')
      .run(nextExpiresAt, new Date().toISOString(), String(row.id));
    return this.mapPlan(this.getPlanRowBySlug(slug)!);
  }

  exportPlanBackup(slug: string): ExportedPlanBackup<PlanSnapshot> | null {
    const snapshot = this.getPlanSnapshotBySlug(slug, { includeAllVotes: true });
    if (!snapshot) return null;
    return {
      format: 'shalendar-backup-v1',
      exportedAt: new Date().toISOString(),
      snapshot,
    };
  }

  purgeExpiredPlans(now = new Date()): PurgeSummary {
    const executedAt = now.toISOString();
    const info = this.db
      .prepare(
        'DELETE FROM plans WHERE is_demo = 0 AND expires_at IS NOT NULL AND expires_at <= ?'
      )
      .run(executedAt);
    return {
      deletedCount: Number(info.changes ?? 0),
      executedAt,
    };
  }

  checkHealth(): { ok: boolean; driver: 'sqlite'; latencyMs: number; error?: string } {
    const startedAt = Date.now();
    try {
      this.db.prepare('SELECT 1').get();
      return { ok: true, driver: 'sqlite', latencyMs: Date.now() - startedAt };
    } catch (err) {
      return {
        ok: false,
        driver: 'sqlite',
        latencyMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : 'SQLite error',
      };
    }
  }

  /**
   * Seeds a vibrant demo quedada anchored around the current date if not already present.
   */
  seedDemoPlanIfEmpty(): void {
    const existing = this.getPlanRowBySlug('cena-reencuentro');
    if (existing) return;

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

    const { plan, participant: lucia } = this.createPlan({
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

    const carlos = this.addOrGetParticipant(plan.id, {
      name: 'Carlos',
      avatarColor: '#2563EB',
      avatarEmoji: '😎',
    }).participant;
    const marta = this.addOrGetParticipant(plan.id, {
      name: 'Marta',
      avatarColor: '#E11D48',
      avatarEmoji: '🌟',
    }).participant;
    const diego = this.addOrGetParticipant(plan.id, {
      name: 'Diego',
      avatarColor: '#D97706',
      avatarEmoji: '🐻',
    }).participant;
    const sofia = this.addOrGetParticipant(plan.id, {
      name: 'Sofía',
      avatarColor: '#7C3AED',
      avatarEmoji: '🦄',
    }).participant;

    const [d0, d1, d2, d3, d4, d5, d6, d7, d8] = upcomingDates;
    if (d0 && d1 && d2 && d3 && d4 && d5 && d6 && d7 && d8) {
      this.setAvailabilityBatch(plan.id, lucia.id, [
        { date: d0, status: 'maybe', note: 'Solo a partir de las 21:00' },
        { date: d1, status: 'yes' },
        { date: d2, status: 'no' },
        { date: d3, status: 'yes' },
        { date: d4, status: 'yes', note: '¡Puedo reservar la mesa grande!' },
        { date: d5, status: 'maybe' },
        { date: d7, status: 'yes' },
        { date: d8, status: 'yes' },
      ]);
      this.setAvailabilityBatch(plan.id, carlos.id, [
        { date: d0, status: 'yes' },
        { date: d1, status: 'yes', note: 'Salgo a las 19:30, a las 20:30 perfecto' },
        { date: d3, status: 'maybe' },
        { date: d4, status: 'yes' },
        { date: d6, status: 'no' },
        { date: d7, status: 'yes' },
        { date: d8, status: 'maybe' },
      ]);
      this.setAvailabilityBatch(plan.id, marta.id, [
        { date: d0, status: 'no' },
        { date: d1, status: 'yes' },
        { date: d3, status: 'yes' },
        { date: d4, status: 'yes' },
        { date: d5, status: 'yes' },
        { date: d7, status: 'maybe', note: 'Depende del turno de mañana' },
      ]);
      this.setAvailabilityBatch(plan.id, diego.id, [
        { date: d1, status: 'maybe' },
        { date: d2, status: 'yes' },
        { date: d3, status: 'yes' },
        { date: d4, status: 'yes' },
        { date: d7, status: 'yes' },
        { date: d8, status: 'yes' },
      ]);
      this.setAvailabilityBatch(plan.id, sofia.id, [
        { date: d1, status: 'yes' },
        { date: d3, status: 'no' },
        { date: d4, status: 'yes' },
        { date: d5, status: 'yes' },
        { date: d7, status: 'yes' },
      ]);

      this.nominateDate(plan.id, d4, 'Noche perfecta · todos libres', lucia.id);
      this.nominateDate(plan.id, d1, 'Plan rápido esta semana', carlos.id);
      this.nominateDate(plan.id, d7, 'Alternativa con más margen', diego.id);

      this.toggleVote(plan.id, lucia.id, d4);
      this.toggleVote(plan.id, lucia.id, d1);
      this.toggleVote(plan.id, carlos.id, d4);
      this.toggleVote(plan.id, carlos.id, d7);
      this.toggleVote(plan.id, marta.id, d4);
      this.toggleVote(plan.id, marta.id, d1);
      this.toggleVote(plan.id, diego.id, d4);
      this.toggleVote(plan.id, sofia.id, d7);

      this.addComment(
        plan.id,
        lucia.id,
        '¡Si elegimos el día que podemos los 5, me encargo yo de reservar la mesa grande! 🍷',
        d4
      );
      this.addComment(
        plan.id,
        carlos.id,
        'Yo salgo de trabajar a las 19:30, así que a partir de las 20:30 perfecto.',
        null
      );
      this.addComment(
        plan.id,
        marta.id,
        '¡Qué ganas! Por mí cena + juegos de mesa después 🎲',
        null
      );

      // Seed a lively sub-poll, checklist, and carpool so demo showcases Wave 2 too!
      const pollId = this.createSubPoll(
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
      const snap = this.getPlanSnapshotBySlug('cena-reencuentro');
      const opts = snap?.subPolls.find((p) => p.id === pollId)?.options ?? [];
      if (opts[0] && opts[1]) {
        this.toggleSubPollVote(plan.id, pollId, opts[0].id, lucia.id);
        this.toggleSubPollVote(plan.id, pollId, opts[0].id, carlos.id);
        this.toggleSubPollVote(plan.id, pollId, opts[1].id, marta.id);
      }

      this.addChecklistItem(plan.id, 'Reservar mesa para 5', lucia.id, lucia.id);
      this.addChecklistItem(plan.id, 'Llevar Catan / Código Secreto para la sobremesa', marta.id, marta.id);
      this.addChecklistItem(plan.id, 'Confirmar si alguien tiene alergias', null, carlos.id);

      const rideId = this.addCarpoolRide(
        plan.id,
        diego.id,
        'Zona Norte · Plaza Castilla',
        3,
        '20:00',
        'Paso a recoger por el camino si hace falta'
      );
      this.toggleCarpoolSeat(plan.id, rideId, sofia.id);
    }
  }
}
