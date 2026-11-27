import type {
  AddCarpoolRequest,
  AddChecklistItemRequest,
  AddCommentRequest,
  AddSubPollOptionRequest,
  ClaimParticipantRequest,
  CreatePlanRequest,
  CreatePlanResponse,
  CreateSubPollRequest,
  JoinPlanRequest,
  NominateDateRequest,
  Participant,
  PlanSnapshot,
  RetentionPolicy,
  SetAvailabilityBatchRequest,
  SetRsvpRequest,
  ToggleSubPollVoteRequest,
  ToggleVoteRequest,
  UpdateChecklistItemRequest,
  UpdateParticipantRequest,
  UpdatePlanSettingsRequest,
} from '../../shared/types';
import { getAdminToken, getParticipantToken, getSavedLanguage } from './storage';

export class ApiError extends Error {
  readonly status: number;
  readonly expired: boolean;

  constructor(message: string, status: number, expired = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.expired = expired;
  }
}

export interface PublicPlanSummary {
  slug: string;
  title: string;
  emoji: string;
  location: string;
  participantCount: number;
  confirmedDate: string | null;
  createdAt: string;
  retentionPolicy?: RetentionPolicy;
  expiresAt?: string | null;
}

function authHeaders(slug?: string): Record<string, string> {
  if (!slug) return {};
  const headers: Record<string, string> = {};
  const adminToken = getAdminToken(slug);
  const participantToken = getParticipantToken(slug);
  if (adminToken) headers['X-Admin-Token'] = adminToken;
  if (participantToken) headers['X-Participant-Token'] = participantToken;
  return headers;
}

async function requestJson<T>(url: string, init?: RequestInit, slug?: string): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Language': getSavedLanguage(),
      ...authHeaders(slug),
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; expired?: boolean };
  if (!res.ok) {
    throw new ApiError(
      data.error || `Error ${res.status}`,
      res.status,
      Boolean(data.expired) || res.status === 410
    );
  }
  return data as T;
}

export const api = {
  listPublicPlans(): Promise<{ plans: PublicPlanSummary[] }> {
    return requestJson('/api/plans');
  },

  lookupPlans(slugs: string[]): Promise<{ plans: PublicPlanSummary[] }> {
    return requestJson('/api/plans/lookup', {
      method: 'POST',
      body: JSON.stringify({ slugs }),
    });
  },

  createPlan(payload: CreatePlanRequest): Promise<CreatePlanResponse> {
    return requestJson('/api/plans', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getPlan(slug: string): Promise<PlanSnapshot> {
    return requestJson(`/api/plans/${encodeURIComponent(slug)}`, undefined, slug);
  },

  resolveSession(
    slug: string,
    tokens: { participantToken?: string | null; adminToken?: string | null }
  ): Promise<{ participant: Participant | null; isAdmin: boolean }> {
    const headers: Record<string, string> = {};
    if (tokens.participantToken) headers['X-Participant-Token'] = tokens.participantToken;
    if (tokens.adminToken) headers['X-Admin-Token'] = tokens.adminToken;
    return requestJson(`/api/plans/${encodeURIComponent(slug)}/session`, { headers });
  },

  joinPlan(
    slug: string,
    payload: JoinPlanRequest
  ): Promise<{ participant: Participant; participantToken: string; snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/participants`,
      { method: 'POST', body: JSON.stringify(payload) },
      slug
    );
  },

  claimParticipant(
    slug: string,
    payload: ClaimParticipantRequest
  ): Promise<{ participant: Participant; participantToken: string; snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/participants/claim`,
      { method: 'POST', body: JSON.stringify(payload) },
      slug
    );
  },

  updateParticipant(
    slug: string,
    participantId: string,
    payload: UpdateParticipantRequest
  ): Promise<{ participant: Participant; snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/participants/${encodeURIComponent(participantId)}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      slug
    );
  },

  removeParticipant(
    slug: string,
    participantId: string
  ): Promise<{ snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/participants/${encodeURIComponent(participantId)}`,
      { method: 'DELETE' },
      slug
    );
  },

  setAvailability(
    slug: string,
    payload: SetAvailabilityBatchRequest
  ): Promise<{ snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/availability`,
      { method: 'PUT', body: JSON.stringify(payload) },
      slug
    );
  },

  nominateDate(
    slug: string,
    payload: NominateDateRequest
  ): Promise<{ snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/poll-options`,
      { method: 'POST', body: JSON.stringify(payload) },
      slug
    );
  },

  removePollOption(
    slug: string,
    date: string
  ): Promise<{ snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/poll-options/${encodeURIComponent(date)}`,
      { method: 'DELETE' },
      slug
    );
  },

  toggleVote(
    slug: string,
    payload: ToggleVoteRequest
  ): Promise<{ voted: boolean; snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/votes/toggle`,
      { method: 'POST', body: JSON.stringify(payload) },
      slug
    );
  },

  addComment(
    slug: string,
    payload: AddCommentRequest
  ): Promise<{ snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/comments`,
      { method: 'POST', body: JSON.stringify(payload) },
      slug
    );
  },

  updatePlan(
    slug: string,
    payload: UpdatePlanSettingsRequest
  ): Promise<{ snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      slug
    );
  },

  deletePlan(slug: string): Promise<{ deleted: boolean }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}`,
      { method: 'DELETE' },
      slug
    );
  },

  extendPlanExpiration(slug: string, extraDays = 30): Promise<{ snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/extend`,
      { method: 'POST', body: JSON.stringify({ extraDays }) },
      slug
    );
  },

  async downloadBackup(slug: string): Promise<void> {
    const backup = await requestJson(`/api/plans/${encodeURIComponent(slug)}/export`, undefined, slug);
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${slug}-backup.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  // ---- Wave 2: RSVP, Sub-Polls, Checklist, Carpooling ----
  setRsvp(slug: string, payload: SetRsvpRequest): Promise<{ snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/rsvp`,
      { method: 'PUT', body: JSON.stringify(payload) },
      slug
    );
  },

  createSubPoll(
    slug: string,
    payload: CreateSubPollRequest
  ): Promise<{ pollId: string; snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/sub-polls`,
      { method: 'POST', body: JSON.stringify(payload) },
      slug
    );
  },

  addSubPollOption(
    slug: string,
    pollId: string,
    payload: AddSubPollOptionRequest
  ): Promise<{ optionId: string; snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/sub-polls/${encodeURIComponent(pollId)}/options`,
      { method: 'POST', body: JSON.stringify(payload) },
      slug
    );
  },

  toggleSubPollVote(
    slug: string,
    pollId: string,
    payload: ToggleSubPollVoteRequest
  ): Promise<{ voted: boolean; snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/sub-polls/${encodeURIComponent(pollId)}/vote`,
      { method: 'POST', body: JSON.stringify(payload) },
      slug
    );
  },

  setSubPollWinner(
    slug: string,
    pollId: string,
    winnerOptionId: string | null
  ): Promise<{ snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/sub-polls/${encodeURIComponent(pollId)}`,
      { method: 'PATCH', body: JSON.stringify({ winnerOptionId }) },
      slug
    );
  },

  deleteSubPoll(slug: string, pollId: string): Promise<{ snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/sub-polls/${encodeURIComponent(pollId)}`,
      { method: 'DELETE' },
      slug
    );
  },

  addChecklistItem(
    slug: string,
    payload: AddChecklistItemRequest
  ): Promise<{ itemId: string; snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/checklist`,
      { method: 'POST', body: JSON.stringify(payload) },
      slug
    );
  },

  updateChecklistItem(
    slug: string,
    itemId: string,
    payload: UpdateChecklistItemRequest
  ): Promise<{ snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/checklist/${encodeURIComponent(itemId)}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      slug
    );
  },

  deleteChecklistItem(slug: string, itemId: string): Promise<{ snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/checklist/${encodeURIComponent(itemId)}`,
      { method: 'DELETE' },
      slug
    );
  },

  addCarpoolRide(
    slug: string,
    payload: AddCarpoolRequest
  ): Promise<{ rideId: string; snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/carpools`,
      { method: 'POST', body: JSON.stringify(payload) },
      slug
    );
  },

  toggleCarpoolSeat(
    slug: string,
    rideId: string,
    participantId: string
  ): Promise<{ joined: boolean; snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/carpools/${encodeURIComponent(rideId)}/toggle`,
      { method: 'POST', body: JSON.stringify({ participantId }) },
      slug
    );
  },

  deleteCarpoolRide(slug: string, rideId: string): Promise<{ snapshot: PlanSnapshot }> {
    return requestJson(
      `/api/plans/${encodeURIComponent(slug)}/carpools/${encodeURIComponent(rideId)}`,
      { method: 'DELETE' },
      slug
    );
  },
};

export function subscribePlanStream(
  slug: string,
  callbacks: {
    onSnapshot: (snapshot: PlanSnapshot) => void;
    onPresence?: (onlineParticipantIds: string[]) => void;
    onConnectionChange?: (connected: boolean) => void;
  },
  options?: { skipInitial?: boolean }
): () => void {
  const params = new URLSearchParams();
  if (options?.skipInitial) params.set('skipInitial', '1');
  const pToken = getParticipantToken(slug);
  if (pToken) params.set('participantToken', pToken);

  const qs = params.toString();
  const es = new EventSource(`/api/plans/${encodeURIComponent(slug)}/stream${qs ? `?${qs}` : ''}`);

  let active = true;
  const isCurrentSession = () => active && pToken === getParticipantToken(slug);

  es.onopen = () => {
    if (!isCurrentSession()) return;
    callbacks.onConnectionChange?.(true);
  };

  es.addEventListener('snapshot', (ev) => {
    if (!isCurrentSession()) return;
    try {
      const parsed = JSON.parse((ev as MessageEvent).data) as PlanSnapshot;
      callbacks.onSnapshot(parsed);
      callbacks.onConnectionChange?.(true);
    } catch {
      // Ignore malformed chunk
    }
  });

  es.addEventListener('presence', (ev) => {
    if (!isCurrentSession()) return;
    try {
      const parsed = JSON.parse((ev as MessageEvent).data) as { onlineParticipantIds: string[] };
      callbacks.onPresence?.(parsed.onlineParticipantIds ?? []);
      callbacks.onConnectionChange?.(true);
    } catch {
      // Ignore
    }
  });

  es.onerror = () => {
    if (!isCurrentSession()) return;
    callbacks.onConnectionChange?.(false);
  };

  return () => {
    active = false;
    es.close();
  };
}
