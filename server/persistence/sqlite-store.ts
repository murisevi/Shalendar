import type {
  AvailabilitySlot,
  AvailabilityStatus,
  CommentEntry,
  Participant,
  Plan,
  PlanSnapshot,
  RetentionPolicy,
  RsvpStatus,
  SubPollCategory,
} from '../../shared/types.js';
import type { ExportedPlanBackup, PlanSummaryItem } from '../../shared/persistence.js';
import type { ShalendarDB } from '../db.js';
import type {
  CreatePlanInput,
  PlanAuthRow,
  ShalendarStore,
  StoreHealthStatus,
  UpdatePlanSettingsInput,
} from '../store.js';
import type { PurgeSummary } from './repository.js';

export class SqliteShalendarStore implements ShalendarStore {
  readonly driver = 'sqlite' as const;

  constructor(private readonly db: ShalendarDB) {}

  async getPlanAuthRowBySlug(slug: string): Promise<PlanAuthRow | null> {
    const row = this.db.getPlanRowBySlug(slug);
    if (!row) return null;
    return {
      id: String(row.id),
      slug: String(row.slug),
      isDemo: Number(row.is_demo ?? 0) === 1,
      adminTokenOrHash: String(row.admin_token),
      adminTokenIsHashed: false,
      retentionPolicy: String(row.retention_policy ?? 'ephemeral_after_event') as RetentionPolicy,
      retentionDays: Number(row.retention_days ?? 30),
      expiresAt: row.expires_at ? String(row.expires_at) : null,
    };
  }

  verifyAdminToken(planRow: PlanAuthRow, token: string | null | undefined): boolean {
    return this.db.verifyAdminToken(
      { is_demo: planRow.isDemo ? 1 : 0, admin_token: planRow.adminTokenOrHash },
      token
    );
  }

  async verifyParticipantToken(
    planId: string,
    participantId: string,
    token: string | null | undefined,
    allowDemoPlan = false
  ): Promise<boolean> {
    return this.db.verifyParticipantToken(planId, participantId, token, allowDemoPlan);
  }

  async getParticipantByToken(planId: string, token: string): Promise<Participant | null> {
    return this.db.getParticipantByToken(planId, token);
  }

  async claimParticipantByPin(
    planId: string,
    name: string,
    pin: string
  ): Promise<{ participant: Participant; participantToken: string }> {
    return this.db.claimParticipantByPin(planId, name, pin);
  }

  async getPlanSnapshotBySlug(
    slug: string,
    options?: {
      viewerParticipantId?: string | null;
      onlineParticipantIds?: string[];
      includeAllVotes?: boolean;
    }
  ): Promise<PlanSnapshot | null> {
    return this.db.getPlanSnapshotBySlug(slug, options);
  }

  async listPublicPlans(limit = 6): Promise<PlanSummaryItem[]> {
    return this.db.listPublicPlans(limit);
  }

  async lookupPlansBySlugs(slugs: string[]): Promise<PlanSummaryItem[]> {
    return this.db.lookupPlansBySlugs(slugs);
  }

  async createPlan(input: CreatePlanInput): Promise<{
    plan: Plan;
    participant: Participant;
    adminToken: string;
    participantToken: string;
  }> {
    return this.db.createPlan(input);
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
    return this.db.addOrGetParticipant(planId, input);
  }

  async updateParticipant(
    planId: string,
    participantId: string,
    updates: { name?: string; avatarColor?: string; avatarEmoji?: string; pin?: string }
  ): Promise<Participant> {
    return this.db.updateParticipant(planId, participantId, updates);
  }

  async deleteParticipant(planId: string, participantId: string): Promise<boolean> {
    return this.db.deleteParticipant(planId, participantId);
  }

  async deletePlan(slug: string): Promise<boolean> {
    return this.db.deletePlan(slug);
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
    this.db.setAvailabilityBatch(planId, participantId, changes);
  }

  async nominateDate(
    planId: string,
    date: string,
    label = '',
    proposedBy: string | null = null
  ): Promise<void> {
    this.db.nominateDate(planId, date, label, proposedBy);
  }

  async removePollOption(planId: string, date: string): Promise<void> {
    this.db.removePollOption(planId, date);
  }

  async toggleVote(planId: string, participantId: string, date: string): Promise<{ voted: boolean }> {
    return this.db.toggleVote(planId, participantId, date);
  }

  async addComment(
    planId: string,
    participantId: string,
    body: string,
    date: string | null = null
  ): Promise<CommentEntry> {
    return this.db.addComment(planId, participantId, body, date);
  }

  async setRsvp(
    planId: string,
    participantId: string,
    status: RsvpStatus,
    guestsCount = 0,
    note = ''
  ): Promise<void> {
    this.db.setRsvp(planId, participantId, status, guestsCount, note);
  }

  async createSubPoll(
    planId: string,
    category: SubPollCategory,
    question: string,
    initialOptions: Array<{ title: string; url?: string; estimatedCost?: string }> = [],
    proposedBy: string | null = null
  ): Promise<string> {
    return this.db.createSubPoll(planId, category, question, initialOptions, proposedBy);
  }

  async addSubPollOption(
    planId: string,
    pollId: string,
    title: string,
    url = '',
    estimatedCost = '',
    proposedBy: string | null = null
  ): Promise<string> {
    return this.db.addSubPollOption(planId, pollId, title, url, estimatedCost, proposedBy);
  }

  async toggleSubPollVote(
    planId: string,
    pollId: string,
    optionId: string,
    participantId: string
  ): Promise<{ voted: boolean }> {
    return this.db.toggleSubPollVote(planId, pollId, optionId, participantId);
  }

  async setSubPollWinner(
    planId: string,
    pollId: string,
    winnerOptionId: string | null
  ): Promise<void> {
    this.db.setSubPollWinner(planId, pollId, winnerOptionId);
  }

  async deleteSubPoll(planId: string, pollId: string): Promise<void> {
    this.db.deleteSubPoll(planId, pollId);
  }

  async addChecklistItem(
    planId: string,
    title: string,
    assignedTo: string | null = null,
    createdBy: string | null = null
  ): Promise<string> {
    return this.db.addChecklistItem(planId, title, assignedTo, createdBy);
  }

  async updateChecklistItem(
    planId: string,
    itemId: string,
    updates: { title?: string; assignedTo?: string | null; completed?: boolean }
  ): Promise<void> {
    this.db.updateChecklistItem(planId, itemId, updates);
  }

  async deleteChecklistItem(planId: string, itemId: string): Promise<void> {
    this.db.deleteChecklistItem(planId, itemId);
  }

  async addCarpoolRide(
    planId: string,
    driverId: string,
    origin: string,
    seatsTotal: number,
    departureTime = '',
    notes = ''
  ): Promise<string> {
    return this.db.addCarpoolRide(planId, driverId, origin, seatsTotal, departureTime, notes);
  }

  async toggleCarpoolSeat(
    planId: string,
    rideId: string,
    participantId: string
  ): Promise<{ joined: boolean }> {
    return this.db.toggleCarpoolSeat(planId, rideId, participantId);
  }

  async deleteCarpoolRide(planId: string, rideId: string): Promise<void> {
    this.db.deleteCarpoolRide(planId, rideId);
  }

  async updatePlanSettings(slug: string, updates: UpdatePlanSettingsInput): Promise<Plan | null> {
    return this.db.updatePlanSettings(slug, updates);
  }

  async extendPlanExpiration(slug: string, extraDays = 30): Promise<Plan | null> {
    return this.db.extendPlanExpiration(slug, extraDays);
  }

  async exportPlanBackup(slug: string): Promise<ExportedPlanBackup<PlanSnapshot> | null> {
    return this.db.exportPlanBackup(slug);
  }

  async purgeExpiredPlans(now = new Date()): Promise<PurgeSummary> {
    return this.db.purgeExpiredPlans(now);
  }

  async checkHealth(): Promise<StoreHealthStatus> {
    return this.db.checkHealth();
  }

  async seedDemoPlanIfEmpty(): Promise<void> {
    this.db.seedDemoPlanIfEmpty();
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

export function asShalendarStore(dbOrStore: ShalendarStore | ShalendarDB): ShalendarStore {
  if ('driver' in dbOrStore) {
    return dbOrStore;
  }
  return new SqliteShalendarStore(dbOrStore);
}
