export type AvailabilityStatus = 'yes' | 'maybe' | 'no';
export type AvailabilitySlot = 'all' | 'morning' | 'afternoon' | 'evening';
export type PlanGranularity = 'day' | 'slots';
export type RsvpStatus = 'going' | 'maybe' | 'not_going';
export type SubPollCategory = 'place' | 'activity' | 'other';
export type HolidayCountry = 'ES' | 'MX' | 'AR' | 'CO' | 'US' | 'none';

export interface Plan {
  id: string;
  slug: string;
  title: string;
  description: string;
  location: string;
  emoji: string;
  startMonth: string; // YYYY-MM
  endMonth: string; // YYYY-MM
  maxVotesPerUser: number; // 0 = unlimited
  votingOpen: boolean;
  votingDeadline: string | null; // ISO datetime
  blindVoting: boolean;
  granularity: PlanGranularity;
  durationDays: number; // 1 = single day, 2..7 = multi-day range
  holidayCountry: HolidayCountry;
  requiredParticipantIds: string[];
  confirmedDate: string | null; // YYYY-MM-DD
  confirmedEndDate: string | null; // YYYY-MM-DD (optional for multi-day)
  confirmedTime: string | null; // e.g. "20:30"
  confirmedDurationMinutes: number; // default 180
  confirmedTimezone: string | null; // e.g. "Europe/Madrid"
  createdAt: string;
}

export interface Participant {
  id: string;
  planId: string;
  name: string;
  avatarColor: string;
  avatarEmoji: string;
  isOrganizer: boolean;
  hasPin?: boolean;
  createdAt: string;
}

export interface AvailabilityEntry {
  participantId: string;
  date: string; // YYYY-MM-DD
  slot: AvailabilitySlot;
  status: AvailabilityStatus;
  note: string;
  updatedAt: string;
}

export interface PollOption {
  date: string; // YYYY-MM-DD
  label: string;
  proposedBy: string | null;
  createdAt: string;
}

export interface VoteEntry {
  participantId: string;
  date: string; // YYYY-MM-DD
  createdAt: string;
}

export interface CommentEntry {
  id: string;
  participantId: string;
  date: string | null;
  body: string;
  createdAt: string;
}

export interface RsvpEntry {
  participantId: string;
  status: RsvpStatus;
  guestsCount: number; // extra guests (+1, +2...)
  note: string;
  updatedAt: string;
}

export interface SubPollOption {
  id: string;
  pollId: string;
  title: string;
  url: string;
  estimatedCost: string;
  proposedBy: string | null;
  voterIds: string[];
  createdAt: string;
}

export interface SubPoll {
  id: string;
  category: SubPollCategory;
  question: string;
  winnerOptionId: string | null;
  options: SubPollOption[];
  createdAt: string;
}

export interface ChecklistItem {
  id: string;
  title: string;
  assignedTo: string | null;
  completed: boolean;
  createdBy: string | null;
  createdAt: string;
}

export interface CarpoolRide {
  id: string;
  driverId: string;
  origin: string;
  seatsTotal: number;
  departureTime: string;
  notes: string;
  passengerIds: string[];
  createdAt: string;
}

export interface BlindVoteStats {
  totalVotes: number;
  votersCount: number;
  hidden: boolean;
}

export interface PlanSnapshot {
  plan: Plan;
  participants: Participant[];
  availabilities: AvailabilityEntry[];
  pollOptions: PollOption[];
  votes: VoteEntry[];
  comments: CommentEntry[];
  rsvps: RsvpEntry[];
  subPolls: SubPoll[];
  checklist: ChecklistItem[];
  carpools: CarpoolRide[];
  onlineParticipantIds?: string[];
  blindVoteStats?: BlindVoteStats;
}

export interface CreatePlanRequest {
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
}

export interface CreatePlanResponse {
  plan: Plan;
  participant: Participant;
  adminToken: string;
  participantToken: string;
}

export interface JoinPlanRequest {
  name: string;
  avatarColor?: string;
  avatarEmoji?: string;
  pin?: string;
}

export interface ClaimParticipantRequest {
  name: string;
  pin: string;
}

export interface UpdateParticipantRequest {
  name?: string;
  avatarColor?: string;
  avatarEmoji?: string;
  pin?: string;
}

export interface SetAvailabilityBatchRequest {
  participantId: string;
  changes: Array<{
    date: string;
    slot?: AvailabilitySlot;
    status: AvailabilityStatus | null; // null removes entry
    note?: string;
  }>;
}

export interface ToggleVoteRequest {
  participantId: string;
  date: string;
}

export interface NominateDateRequest {
  participantId?: string;
  date: string;
  label?: string;
}

export interface AddCommentRequest {
  participantId: string;
  date?: string | null;
  body: string;
}

export interface UpdatePlanSettingsRequest {
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
}

export interface SetRsvpRequest {
  participantId: string;
  status: RsvpStatus;
  guestsCount?: number;
  note?: string;
}

export interface CreateSubPollRequest {
  participantId?: string;
  category: SubPollCategory;
  question: string;
  initialOptions?: Array<{ title: string; url?: string; estimatedCost?: string }>;
}

export interface AddSubPollOptionRequest {
  participantId?: string;
  title: string;
  url?: string;
  estimatedCost?: string;
}

export interface ToggleSubPollVoteRequest {
  participantId: string;
  optionId: string;
}

export interface AddChecklistItemRequest {
  participantId?: string;
  title: string;
  assignedTo?: string | null;
}

export interface UpdateChecklistItemRequest {
  title?: string;
  assignedTo?: string | null;
  completed?: boolean;
}

export interface AddCarpoolRequest {
  driverId: string;
  origin: string;
  seatsTotal: number;
  departureTime?: string;
  notes?: string;
}

export interface SlotDaySummary {
  slot: AvailabilitySlot;
  yes: Participant[];
  maybe: Participant[];
  no: Participant[];
  score: number;
  ratio: number;
}

export interface DaySummary {
  date: string;
  yes: Participant[];
  maybe: Participant[];
  no: Participant[];
  pending: Participant[];
  votes: Participant[];
  pollOption: PollOption | null;
  score: number; // yes + 0.45 * maybe
  ratio: number; // 0..1 relative to active participant count
  allFilteredAvailable: boolean;
  allRequiredAvailable: boolean;
  notesByParticipant: Record<string, string>;
  hasNotes: boolean;
  slots?: Record<'morning' | 'afternoon' | 'evening', SlotDaySummary>;
  bestSlot?: 'morning' | 'afternoon' | 'evening' | null;
}

export interface DateRangeSummary {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  dates: string[];
  durationDays: number;
  fullYes: Participant[]; // available ('yes') on EVERY day of the block
  fullYesOrMaybe: Participant[]; // 'yes' or 'maybe' on EVERY day
  allRequiredAvailable: boolean;
  includesWeekend: boolean;
  includesHoliday: boolean;
  score: number;
  ratio: number;
}
