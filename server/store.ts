import type {
  AvailabilitySlot,
  AvailabilityStatus,
  CommentEntry,
  HolidayCountry,
  Participant,
  Plan,
  PlanGranularity,
  PlanSnapshot,
  RetentionPolicy,
  RsvpStatus,
  SubPollCategory,
} from '../shared/types.js';
import type { ExportedPlanBackup, PlanSummaryItem } from '../shared/persistence.js';
import type { PurgeSummary } from './persistence/repository.js';

export interface PlanAuthRow {
  id: string;
  slug: string;
  isDemo: boolean;
  adminTokenOrHash: string;
  adminTokenIsHashed: boolean;
  retentionPolicy: RetentionPolicy;
  retentionDays: number;
  expiresAt: string | null;
}

export interface CreatePlanInput {
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
}

export interface UpdatePlanSettingsInput {
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

export interface StoreHealthStatus {
  ok: boolean;
  driver: 'postgres' | 'sqlite';
  latencyMs: number;
  error?: string;
}

/**
 * Unified async storage contract implemented by both:
 *  - PostgresShalendarStore (production / Northflank / Neon / Docker Postgres)
 *  - ShalendarDB (SQLite fallback for zero-setup local dev & fast unit tests)
 */
export interface ShalendarStore {
  readonly driver: 'postgres' | 'sqlite';

  getPlanAuthRowBySlug(slug: string): Promise<PlanAuthRow | null>;
  verifyAdminToken(planRow: PlanAuthRow, token: string | null | undefined): boolean;
  verifyParticipantToken(
    planId: string,
    participantId: string,
    token: string | null | undefined,
    allowDemoPlan?: boolean
  ): Promise<boolean>;
  getParticipantByToken(planId: string, token: string): Promise<Participant | null>;
  claimParticipantByPin(
    planId: string,
    name: string,
    pin: string
  ): Promise<{ participant: Participant; participantToken: string }>;

  getPlanSnapshotBySlug(
    slug: string,
    options?: { viewerParticipantId?: string | null; onlineParticipantIds?: string[] }
  ): Promise<PlanSnapshot | null>;
  listPublicPlans(limit?: number): Promise<PlanSummaryItem[]>;
  lookupPlansBySlugs(slugs: string[]): Promise<PlanSummaryItem[]>;

  createPlan(input: CreatePlanInput): Promise<{
    plan: Plan;
    participant: Participant;
    adminToken: string;
    participantToken: string;
  }>;
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
  ): Promise<{ participant: Participant; participantToken: string }>;
  updateParticipant(
    planId: string,
    participantId: string,
    updates: { name?: string; avatarColor?: string; avatarEmoji?: string; pin?: string }
  ): Promise<Participant>;
  deleteParticipant(planId: string, participantId: string): Promise<boolean>;
  deletePlan(slug: string): Promise<boolean>;

  setAvailabilityBatch(
    planId: string,
    participantId: string,
    changes: Array<{
      date: string;
      slot?: AvailabilitySlot;
      status: AvailabilityStatus | null;
      note?: string;
    }>
  ): Promise<void>;
  nominateDate(
    planId: string,
    date: string,
    label?: string,
    proposedBy?: string | null
  ): Promise<void>;
  removePollOption(planId: string, date: string): Promise<void>;
  toggleVote(planId: string, participantId: string, date: string): Promise<{ voted: boolean }>;
  addComment(
    planId: string,
    participantId: string,
    body: string,
    date?: string | null
  ): Promise<CommentEntry>;

  setRsvp(
    planId: string,
    participantId: string,
    status: RsvpStatus,
    guestsCount?: number,
    note?: string
  ): Promise<void>;
  createSubPoll(
    planId: string,
    category: SubPollCategory,
    question: string,
    initialOptions?: Array<{ title: string; url?: string; estimatedCost?: string }>,
    proposedBy?: string | null
  ): Promise<string>;
  addSubPollOption(
    planId: string,
    pollId: string,
    title: string,
    url?: string,
    estimatedCost?: string,
    proposedBy?: string | null
  ): Promise<string>;
  toggleSubPollVote(
    planId: string,
    pollId: string,
    optionId: string,
    participantId: string
  ): Promise<{ voted: boolean }>;
  setSubPollWinner(
    planId: string,
    pollId: string,
    winnerOptionId: string | null
  ): Promise<void>;
  deleteSubPoll(planId: string, pollId: string): Promise<void>;

  addChecklistItem(
    planId: string,
    title: string,
    assignedTo?: string | null,
    createdBy?: string | null
  ): Promise<string>;
  updateChecklistItem(
    planId: string,
    itemId: string,
    updates: { title?: string; assignedTo?: string | null; completed?: boolean }
  ): Promise<void>;
  deleteChecklistItem(planId: string, itemId: string): Promise<void>;

  addCarpoolRide(
    planId: string,
    driverId: string,
    origin: string,
    seatsTotal: number,
    departureTime?: string,
    notes?: string
  ): Promise<string>;
  toggleCarpoolSeat(
    planId: string,
    rideId: string,
    participantId: string
  ): Promise<{ joined: boolean }>;
  deleteCarpoolRide(planId: string, rideId: string): Promise<void>;

  updatePlanSettings(slug: string, updates: UpdatePlanSettingsInput): Promise<Plan | null>;
  extendPlanExpiration(slug: string, extraDays?: number): Promise<Plan | null>;
  exportPlanBackup(slug: string): Promise<ExportedPlanBackup<PlanSnapshot> | null>;
  purgeExpiredPlans(now?: Date): Promise<PurgeSummary>;

  checkHealth(): Promise<StoreHealthStatus>;
  seedDemoPlanIfEmpty(): Promise<void>;
  close(): Promise<void>;
}
