import type {
  ExportedPlanBackup,
  PlanLifecycleMeta,
  PlanSummaryItem,
  RetentionPolicy,
} from '../../shared/persistence.js';

export class PlanNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message = 'No encontramos esa quedada') {
    super(message);
    this.name = 'PlanNotFoundError';
  }
}

export class PlanExpiredError extends Error {
  readonly statusCode = 410;
  constructor(message = 'Esta quedada caducó y sus datos se eliminaron automáticamente.') {
    super(message);
    this.name = 'PlanExpiredError';
  }
}

export class UnauthorizedTokenError extends Error {
  readonly statusCode = 403;
  constructor(message = 'No tienes permiso para realizar esta acción en esta quedada.') {
    super(message);
    this.name = 'UnauthorizedTokenError';
  }
}

export class DuplicateParticipantError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateParticipantError';
  }
}

export interface PurgeSummary {
  deletedCount: number;
  executedAt: string;
}

/**
 * Async persistence contract for Shalendar.
 *
 * Generic parameters allow this skeleton to stay conflict-free while
 * `feat/future-improvements` finalizes `shared/types.ts`. Once both branches
 * are merged, bind these type parameters directly to the domain types from
 * `../../shared/types.js`.
 */
export interface PlanRepository<
  TPlan = Record<string, unknown>,
  TParticipant = Record<string, unknown>,
  TPlanSnapshot = Record<string, unknown>,
  TComment = Record<string, unknown>,
  TCreatePlanInput = Record<string, unknown>,
  TCreatePlanResult = {
    plan: TPlan;
    participant: TParticipant;
    adminToken: string;
    participantToken: string;
  },
  TJoinPlanInput = Record<string, unknown>,
  TAvailabilityChange = Record<string, unknown>,
  TUpdatePlanSettingsInput = Record<string, unknown>,
> {
  // --- Plan lifecycle & privacy (100% accountless) ---
  getPlanSnapshotBySlug(slug: string): Promise<TPlanSnapshot | null>;
  getPlanSummariesBySlugs(slugs: string[]): Promise<PlanSummaryItem[]>;
  getPublicDemoSummary(): Promise<PlanSummaryItem | null>;
  createPlan(
    input: TCreatePlanInput & {
      retentionPolicy?: RetentionPolicy;
      retentionDays?: number;
    }
  ): Promise<TCreatePlanResult>;
  updatePlanSettings(
    slug: string,
    adminToken: string,
    updates: TUpdatePlanSettingsInput
  ): Promise<TPlan>;
  updatePlanRetention(
    slug: string,
    adminToken: string,
    retentionPolicy: RetentionPolicy,
    retentionDays?: number
  ): Promise<PlanLifecycleMeta>;
  extendPlanExpiration(
    slug: string,
    adminToken: string,
    extraDays: number
  ): Promise<PlanLifecycleMeta>;
  deletePlan(slug: string, adminToken: string): Promise<boolean>;
  exportPlanBackup(slug: string): Promise<ExportedPlanBackup<TPlanSnapshot> | null>;
  purgeExpiredPlans(now?: Date): Promise<PurgeSummary>;

  // --- Participants & lightweight token/PIN identity ---
  addParticipant(
    slug: string,
    input: TJoinPlanInput
  ): Promise<{ participant: TParticipant; participantToken: string }>;
  claimParticipantByPin(
    slug: string,
    name: string,
    pin: string
  ): Promise<{ participant: TParticipant; participantToken: string }>;
  deleteParticipant(
    slug: string,
    participantId: string,
    auth: { adminToken?: string; participantToken?: string }
  ): Promise<boolean>;

  // --- Core collaborative scheduling ---
  setAvailabilityBatch(
    slug: string,
    participantId: string,
    changes: TAvailabilityChange[],
    auth: { adminToken?: string; participantToken?: string }
  ): Promise<void>;
  nominateDate(
    slug: string,
    date: string,
    label: string,
    proposedBy: string | null
  ): Promise<void>;
  removePollOption(slug: string, date: string, adminToken: string): Promise<void>;
  toggleVote(
    slug: string,
    participantId: string,
    date: string,
    auth: { adminToken?: string; participantToken?: string }
  ): Promise<{ voted: boolean }>;
  addComment(
    slug: string,
    participantId: string,
    body: string,
    date: string | null,
    auth: { adminToken?: string; participantToken?: string }
  ): Promise<TComment>;

  // --- Extended modules from feat/future-improvements ---
  setRsvp(
    slug: string,
    participantId: string,
    input: { status: 'going' | 'maybe' | 'not_going'; guestsCount?: number; note?: string }
  ): Promise<void>;
  createSubPoll(
    slug: string,
    input: {
      category: 'place' | 'activity' | 'other';
      question: string;
      initialOptions?: Array<{ title: string; url?: string; estimatedCost?: string }>;
      proposedBy?: string | null;
    }
  ): Promise<string>;
  toggleSubPollVote(slug: string, participantId: string, optionId: string): Promise<void>;
  addChecklistItem(
    slug: string,
    input: { title: string; assignedTo?: string | null; createdBy?: string | null }
  ): Promise<string>;
  updateChecklistItem(
    slug: string,
    itemId: string,
    updates: { title?: string; assignedTo?: string | null; completed?: boolean }
  ): Promise<void>;
  addCarpoolRide(
    slug: string,
    input: {
      driverId: string;
      origin: string;
      seatsTotal: number;
      departureTime?: string;
      notes?: string;
    }
  ): Promise<string>;
  toggleCarpoolPassenger(slug: string, rideId: string, participantId: string): Promise<void>;

  // --- Lifecycle ---
  seedDemoPlanIfMissing(): Promise<void>;
  close(): Promise<void>;
}
