import { dayAvailabilityChanges, personalNoteChanges } from '../lib/availabilityChanges';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  Check,
  HelpCircle,
  House,
  MoreHorizontal,
  Star,
  Undo2,
  Users,
  X,
  CalendarHeart,
  CalendarPlus,
  ClipboardList,
  Clock,
  Crown,
  Download,
  Grid3X3,
  ImageDown,
  MapPin,
  MessageSquare,
  Moon,
  Pencil,
  RefreshCw,
  Send,
  Settings,
  Share2,
  Sun,
  UserPlus,
  Vote,
} from 'lucide-react';
import type {
  AvailabilityEntry,
  AvailabilitySlot,
  AvailabilityStatus,
  PlanSnapshot,
  RsvpStatus,
  SubPollCategory,
  UpdatePlanSettingsRequest,
} from '../../shared/types';
import {
  buildGoogleCalendarUrl,
  buildIcsContent,
  computeDaySummaries,
  formatDateISO,
  formatDateRange,
  formatDateShortParts,
  isSlotGranularity,
  isVotingEffectivelyOpen,
  normalizeEnabledSlots,
  rankBestDates,
  rankBestRanges,
  type RankingSortMode,
} from '../../shared/dates';
import { getRemainingDays } from '../../shared/persistence';
import { api, ApiError, subscribePlanStream } from '../lib/api';
import {
  forgetPlan,
  getAdminToken,
  getParticipantToken,
  getSavedParticipantId,
  hasSeenPlanIntro,
  markPlanIntroSeen,
  rememberPlan,
  saveAdminToken,
  saveParticipantId,
  saveParticipantToken,
  type ThemeMode,
} from '../lib/storage';
import { downloadOrShareInviteCard } from '../lib/inviteCard';
import { useI18n } from '../lib/i18n';
import { Avatar, AvatarStack } from './Avatar';
import { LanguageSelector } from './LanguageSelector';
import { InteractiveCalendar } from './InteractiveCalendar';
import { VotingPanel } from './VotingPanel';
import { ComparisonMatrix } from './ComparisonMatrix';
import { DayInspector } from './DayInspector';
import { IdentityModal } from './IdentityModal';
import { PlanIntroModal } from './PlanIntroModal';
import { ShareModal } from './ShareModal';
import { PlanSettingsModal } from './PlanSettingsModal';
import { RsvpPanel } from './RsvpPanel';
import { PlanLogisticsPanel, type LogisticsSection } from './PlanLogisticsPanel';
import { BottomSheet } from './BottomSheet';
import { useIsMobile } from '../lib/useMediaQuery';

type ViewTab = 'calendar' | 'voting' | 'matrix' | 'logistics';
type MobileTab = 'calendar' | 'voting' | 'logistics' | 'group';

interface PlanViewProps {
  slug: string;
  onGoHome: () => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
}

export function PlanView({ slug, onGoHome, theme, onToggleTheme }: PlanViewProps) {
  const { language, t } = useI18n();
  const [snapshot, setSnapshot] = useState<PlanSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [expired, setExpired] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [liveConnected, setLiveConnected] = useState(false);
  const [onlineIds, setOnlineIds] = useState<string[]>([]);

  const [sessionVersion, setSessionVersion] = useState(0);
  const [myParticipantId, setMyParticipantId] = useState<string | null>(() =>
    getSavedParticipantId(slug)
  );
  const [isAdmin, setIsAdmin] = useState<boolean>(
    () => Boolean(getAdminToken(slug))
  );
  const [activeTab, setActiveTab] = useState<ViewTab>('calendar');
  const [sortMode, setSortMode] = useState<RankingSortMode>('smart');
  const [currentMonth, setCurrentMonth] = useState<string>(() =>
    formatDateISO(new Date()).slice(0, 7)
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<AvailabilitySlot>('all');
  const [hoveredRangeDates, setHoveredRangeDates] = useState<string[] | null>(null);
  const [filterParticipantIds, setFilterParticipantIds] = useState<string[]>([]);

  const [identityModalMode, setIdentityModalMode] = useState<'join' | 'edit' | null>(null);
  const [introOpen, setIntroOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [generalNote, setGeneralNote] = useState('');
  const [toast, setToast] = useState<{ text: string; tone?: 'ok' | 'err' } | null>(null);

  // Mobile shell state (< lg): bottom tabs, sheets and explicit "mark my days" mode
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<MobileTab>('calendar');
  const [voteMode, setVoteMode] = useState<'ranking' | 'matrix'>('ranking');
  const [logSection, setLogSection] = useState<Exclude<LogisticsSection, 'all'>>('polls');
  const [paintMode, setPaintMode] = useState(false);
  const [paintBrush, setPaintBrush] = useState<AvailabilityStatus>('yes');
  const [pendingPaint, setPendingPaint] = useState(false);
  const [daySheetOpen, setDaySheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [planInfoOpen, setPlanInfoOpen] = useState(false);

  // Undo stack stores previous availability batch changes to revert last action
  const [undoStack, setUndoStack] = useState<
    Array<Array<{ date: string; slot: AvailabilitySlot; status: AvailabilityStatus | null; note?: string }>>
  >([]);
  const undoStackRef = useRef(undoStack);
  undoStackRef.current = undoStack;
  const pendingAvailabilityWritesRef = useRef(0);
  const availabilityQueueRef = useRef<Promise<void>>(Promise.resolve());
  const snapshotRef = useRef<PlanSnapshot | null>(null);
  snapshotRef.current = snapshot;
  const tRef = useRef(t);
  tRef.current = t;

  const showToast = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 3200);
  }, []);

  useEffect(() => {
    if (snapshot?.plan) {
      document.title = `${snapshot.plan.emoji} ${snapshot.plan.title} — Shalendar`;
    } else if (expired) {
      document.title = `${t.plan.expiredTitle} — Shalendar`;
    } else if (notFound) {
      document.title = `${t.plan.notFoundTitle} — Shalendar`;
    }
  }, [snapshot?.plan, expired, notFound, t.plan.expiredTitle, t.plan.notFoundTitle]);

  // Load initial snapshot and handle cross-device magic tokens (#pt=...&at=... or legacy ?pt=...&at=...).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setExpired(false);
    setLoadError(false);
    setUndoStack([]);
    setFilterParticipantIds([]);
    setPaintMode(false);
    pendingAvailabilityWritesRef.current = 0;

    async function boot() {
      // 1. Check cross-device transfer tokens in URL hash fragment or legacy query params and clean URL immediately
      const url = new URL(window.location.href);
      const rawHash = url.hash.startsWith('#') ? url.hash.slice(1) : '';
      const hashParams = new URLSearchParams(rawHash);
      const pt = hashParams.get('pt') ?? url.searchParams.get('pt');
      const at =
        hashParams.get('at') ??
        hashParams.get('admin') ??
        url.searchParams.get('at');
      if (pt || at) {
        if (pt) saveParticipantToken(slug, pt);
        if (at) saveAdminToken(slug, at);
        url.searchParams.delete('pt');
        url.searchParams.delete('at');
        window.history.replaceState({}, '', url.pathname + url.search);
      }

      // 2. Verify saved/transferred tokens against server
      const storedPt = getParticipantToken(slug);
      const storedAt = getAdminToken(slug);
      if (storedPt || storedAt) {
        try {
          const session = await api.resolveSession(slug, {
            participantToken: storedPt,
            adminToken: storedAt,
          });
          if (!cancelled) {
            if (session.participant) {
              saveParticipantId(slug, session.participant.id);
              setMyParticipantId(session.participant.id);
              if (pt) showToast(tRef.current.plan.toasts.sessionRestored(session.participant.name));
            } else {
              saveParticipantId(slug, null);
              saveParticipantToken(slug, null);
              setMyParticipantId(null);
            }
            if (!session.isAdmin) saveAdminToken(slug, null);
            setIsAdmin(session.isAdmin);
          }
        } catch {
          // Ignore transient network errors or invalid token without wiping stored tokens
        }
      } else {
        saveParticipantId(slug, null);
        setMyParticipantId(null);
        setIsAdmin(false);
      }

      // 3. Load single initial snapshot
      try {
        const data = await api.getPlan(slug);
        if (cancelled) return;
        setSnapshot(data);
        setOnlineIds(data.onlineParticipantIds ?? []);
        setLoading(false);
        if (!hasSeenPlanIntro()) setIntroOpen(true);
        rememberPlan({
          slug: data.plan.slug,
          title: data.plan.title,
          emoji: data.plan.emoji,
        });

        const initialSummaries = computeDaySummaries({
          participants: data.participants,
          availabilities: data.availabilities,
          votes: data.votes,
          pollOptions: data.pollOptions,
          granularity: data.plan.granularity,
          enabledSlots: data.plan.enabledSlots,
          requiredParticipantIds: data.plan.requiredParticipantIds,
        });
        const top = rankBestDates(
          initialSummaries,
          1,
          'smart',
          data.plan.requiredParticipantIds.length > 0
        )[0];
        const focusDate = data.plan.confirmedDate || top?.date || null;
        if (focusDate) {
          setSelectedDate(focusDate);
          setCurrentMonth(focusDate.slice(0, 7));
        } else {
          setSelectedDate(null);
          setCurrentMonth(data.plan.startMonth);
        }

        const savedId = getSavedParticipantId(slug);
        if (savedId && data.participants.some((p) => p.id === savedId)) {
          setMyParticipantId(savedId);
        } else if (savedId) {
          saveParticipantId(slug, null);
          setMyParticipantId(null);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.expired) {
          forgetPlan(slug);
          setExpired(true);
        } else if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setLoadError(true);
        }
        setLoading(false);
      }
    }

    boot();

    return () => {
      cancelled = true;
    };
  }, [slug, reloadNonce, showToast]);

  // Reconnect after join, recovery (including the same profile), leave, or slug change.
  // Old stream callbacks also reject snapshots once local session credentials change.
  useEffect(() => {
    if (loading || notFound || expired || loadError || snapshot?.plan.slug !== slug) return;
    return subscribePlanStream(slug, {
      onSnapshot: (next) => {
        if (pendingAvailabilityWritesRef.current > 0) return;
        setSnapshot(next);
        if (next.onlineParticipantIds) setOnlineIds(next.onlineParticipantIds);
      },
      onPresence: setOnlineIds,
      onConnectionChange: setLiveConnected,
    });
  }, [slug, loading, notFound, expired, loadError, myParticipantId, sessionVersion, snapshot?.plan.slug]);

  // Re-sync immediately when returning from WhatsApp / background tab or regaining network
  useEffect(() => {
    if (loading || notFound || expired || loadError || snapshot?.plan.slug !== slug) return;
    let disposed = false;
    const refreshLatest = () => {
      if (document.visibilityState === 'hidden') return;
      if (pendingAvailabilityWritesRef.current > 0) return;
      api
        .getPlan(slug)
        .then((fresh) => {
          if (disposed || pendingAvailabilityWritesRef.current > 0) return;
          setSnapshot(fresh);
          if (fresh.onlineParticipantIds) setOnlineIds(fresh.onlineParticipantIds);
        })
        .catch(() => {
          // Keep current view if still offline
        });
    };
    document.addEventListener('visibilitychange', refreshLatest);
    window.addEventListener('online', refreshLatest);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', refreshLatest);
      window.removeEventListener('online', refreshLatest);
    };
  }, [slug, loading, notFound, expired, loadError, snapshot?.plan.slug]);

  const me = useMemo(() => {
    if (!snapshot || !myParticipantId) return null;
    return snapshot.participants.find((p) => p.id === myParticipantId) ?? null;
  }, [snapshot, myParticipantId]);

  // "Mark my days" asked before joining: enter paint mode as soon as the user has an identity
  useEffect(() => {
    if (!pendingPaint) return;
    if (me) {
      setPendingPaint(false);
      setMobileTab('calendar');
      setPaintMode(true);
    } else if (identityModalMode === null) {
      setPendingPaint(false);
    }
  }, [pendingPaint, me, identityModalMode]);

  const onlineSet = useMemo(() => {
    const s = new Set(onlineIds);
    if (me && liveConnected) s.add(me.id);
    return s;
  }, [onlineIds, me, liveConnected]);

  const { myAvailabilityMap, mySlotAvailabilityMap, myNotesByDate } = useMemo(() => {
    const dayMap = new Map<string, AvailabilityStatus>();
    const slotMap = new Map<string, AvailabilityStatus>();
    const notesMap = new Map<string, string>();
    const statusPriority = { yes: 3, maybe: 2, no: 1 } as const;

    if (!snapshot || !me) {
      return { myAvailabilityMap: dayMap, mySlotAvailabilityMap: slotMap, myNotesByDate: notesMap };
    }
    const useSlots = isSlotGranularity(snapshot.plan.granularity);
    const activeSlotsSet = new Set<string>(
      normalizeEnabledSlots(snapshot.plan.granularity, snapshot.plan.enabledSlots)
    );
    for (const a of snapshot.availabilities) {
      if (a.participantId !== me.id) continue;
      const slot = a.slot || 'all';
      slotMap.set(`${a.date}:${slot}`, a.status);
      if (a.note) notesMap.set(a.date, a.note);

      if (useSlots && slot !== 'all' && !activeSlotsSet.has(slot)) continue;
      const prev = dayMap.get(a.date);
      if (!prev || statusPriority[a.status] > statusPriority[prev]) {
        dayMap.set(a.date, a.status);
      }
    }
    return { myAvailabilityMap: dayMap, mySlotAvailabilityMap: slotMap, myNotesByDate: notesMap };
  }, [snapshot, me]);

  const effectiveActiveSlot = useMemo<AvailabilitySlot>(() => {
    if (!snapshot || !isSlotGranularity(snapshot.plan.granularity)) return 'all';
    const slots = normalizeEnabledSlots(snapshot.plan.granularity, snapshot.plan.enabledSlots);
    if (slots.length === 1) return slots[0];
    if (activeSlot !== 'all' && slots.includes(activeSlot)) return activeSlot;
    return 'all';
  }, [snapshot, activeSlot]);

  const myVotedDates = useMemo(() => {
    const set = new Set<string>();
    if (!snapshot || !me) return set;
    for (const v of snapshot.votes) {
      if (v.participantId === me.id) set.add(v.date);
    }
    return set;
  }, [snapshot, me]);

  const summaries = useMemo(() => {
    if (!snapshot) return new Map();
    return computeDaySummaries({
      participants: snapshot.participants,
      availabilities: snapshot.availabilities,
      votes: snapshot.votes,
      pollOptions: snapshot.pollOptions,
      filterParticipantIds,
      requiredParticipantIds: snapshot.plan.requiredParticipantIds,
      granularity: snapshot.plan.granularity,
      enabledSlots: snapshot.plan.enabledSlots,
      extraDates: selectedDate ? [selectedDate] : [],
    });
  }, [snapshot, filterParticipantIds, selectedDate]);

  const rankedDates = useMemo(
    () =>
      rankBestDates(
        summaries,
        12,
        sortMode,
        (snapshot?.plan.requiredParticipantIds.length ?? 0) > 0
      ),
    [summaries, sortMode, snapshot?.plan.requiredParticipantIds.length]
  );

  const rankedRanges = useMemo(() => {
    if (!snapshot || snapshot.plan.durationDays < 2) return [];
    return rankBestRanges({
      summaries,
      participants: snapshot.participants,
      durationDays: snapshot.plan.durationDays,
      requiredParticipantIds: snapshot.plan.requiredParticipantIds,
      holidayCountry: snapshot.plan.holidayCountry,
      limit: 6,
    });
  }, [summaries, snapshot]);

  const highlightedRangeSet = useMemo(
    () => (hoveredRangeDates ? new Set(hoveredRangeDates) : undefined),
    [hoveredRangeDates]
  );

  const myStats = useMemo(() => {
    let yes = 0;
    let maybe = 0;
    for (const st of myAvailabilityMap.values()) {
      if (st === 'yes') yes++;
      else if (st === 'maybe') maybe++;
    }
    return { yes, maybe };
  }, [myAvailabilityMap]);

  async function handleJoinNew(name: string, color: string, emoji: string, pin?: string) {
    const res = await api.joinPlan(slug, {
      name,
      avatarColor: color,
      avatarEmoji: emoji,
      pin,
    });
    setSnapshot(res.snapshot);
    setMyParticipantId(res.participant.id);
    saveParticipantId(slug, res.participant.id);
    saveParticipantToken(slug, res.participantToken);
    setSessionVersion((version) => version + 1);
    showToast(t.plan.toasts.welcomeNew(res.participant.name));
  }

  async function handleClaimExisting(name: string, pin: string) {
    const res = await api.claimParticipant(slug, { name, pin });
    setSnapshot(res.snapshot);
    setMyParticipantId(res.participant.id);
    saveParticipantId(slug, res.participant.id);
    saveParticipantToken(slug, res.participantToken);
    setSessionVersion((version) => version + 1);
    showToast(t.plan.toasts.welcomeBack(res.participant.name));
  }

  async function handleUpdateProfile(updates: {
    name?: string;
    avatarColor?: string;
    avatarEmoji?: string;
    pin?: string;
  }) {
    if (!me) return;
    const res = await api.updateParticipant(slug, me.id, updates);
    setSnapshot(res.snapshot);
    showToast(t.plan.toasts.profileUpdated);
  }

  async function handleLeavePlan() {
    if (!me) return;
    const res = await api.removeParticipant(slug, me.id);
    setSnapshot(res.snapshot);
    saveParticipantId(slug, null);
    saveParticipantToken(slug, null);
    setSessionVersion((version) => version + 1);
    setMyParticipantId(null);
    showToast(t.plan.toasts.leftPlan);
  }

  const handleCommitAvailability = useCallback(
    async (
      changes: Array<{
        date: string;
        slot?: AvailabilitySlot;
        status: AvailabilityStatus | null;
        note?: string;
      }>,
      recordUndo = true
    ) => {
      if (!me || changes.length === 0) return;
      const participantId = me.id;
      const prevSnap = snapshotRef.current;

      // Build inverse changes for Undo stack
      if (recordUndo && prevSnap) {
        const inverse = changes.map((ch) => {
          const slot: AvailabilitySlot = ch.slot ?? 'all';
          const existing = prevSnap.availabilities.find(
            (a) => a.participantId === participantId && a.date === ch.date && (a.slot || 'all') === slot
          );
          return {
            date: ch.date,
            slot,
            status: existing ? existing.status : null,
            note: existing?.note ?? '',
          };
        });
        setUndoStack((stack) => [...stack.slice(-9), inverse]);
      }

      // Optimistic UI update (preserves note when not provided)
      setSnapshot((prev) => {
        if (!prev) return prev;
        const keyedChanges = new Map(
          changes.map((c) => [`${c.date}:${c.slot ?? 'all'}`, c])
        );
        const existingNotes = new Map<string, string>();
        const filtered: AvailabilityEntry[] = [];
        for (const a of prev.availabilities) {
          const k = `${a.date}:${a.slot || 'all'}`;
          if (a.participantId === participantId && keyedChanges.has(k)) {
            existingNotes.set(k, a.note);
            continue;
          }
          filtered.push(a);
        }
        const now = new Date().toISOString();
        for (const ch of changes) {
          const slot: AvailabilitySlot = ch.slot ?? 'all';
          if (ch.status !== null) {
            filtered.push({
              participantId,
              date: ch.date,
              slot,
              status: ch.status,
              note: ch.note !== undefined ? ch.note : existingNotes.get(`${ch.date}:${slot}`) ?? '',
              updatedAt: now,
            });
          }
        }
        return { ...prev, availabilities: filtered };
      });

      // Serialize availability PUTs so rapid taps never race out of order or clobber optimistic state
      pendingAvailabilityWritesRef.current += 1;
      const queuedWrite = availabilityQueueRef.current.then(async () => {
        try {
          const res = await api.setAvailability(slug, {
            participantId,
            changes,
          });
          pendingAvailabilityWritesRef.current = Math.max(
            0,
            pendingAvailabilityWritesRef.current - 1
          );
          if (pendingAvailabilityWritesRef.current === 0) {
            setSnapshot(res.snapshot);
          }
        } catch (err) {
          pendingAvailabilityWritesRef.current = Math.max(
            0,
            pendingAvailabilityWritesRef.current - 1
          );
          showToast(
            err instanceof Error ? err.message : tRef.current.plan.toasts.saveAvailabilityErr,
            'err'
          );
          if (pendingAvailabilityWritesRef.current === 0) {
            try {
              const authoritative = await api.getPlan(slug);
              setSnapshot(authoritative);
            } catch {
              if (prevSnap) setSnapshot(prevSnap);
            }
          }
        }
      });
      availabilityQueueRef.current = queuedWrite;
      await queuedWrite;
    },
    [me, slug, showToast]
  );

  const handleUndo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const last = stack[stack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    void handleCommitAvailability(last, false);
    showToast(tRef.current.plan.toasts.undone);
  }, [handleCommitAvailability, showToast]);

  async function handleToggleVote(date: string) {
    if (!me) {
      setIdentityModalMode('join');
      return;
    }
    try {
      const res = await api.toggleVote(slug, {
        participantId: me.id,
        date,
      });
      setSnapshot(res.snapshot);
      showToast(res.voted ? t.plan.toasts.voteAdded : t.plan.toasts.voteRemoved);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t.plan.toasts.voteErr, 'err');
    }
  }

  async function handleNominateDate(date: string, label: string) {
    try {
      const res = await api.nominateDate(slug, {
        participantId: me?.id,
        date,
        label,
      });
      setSnapshot(res.snapshot);
      showToast(t.plan.toasts.dayAddedToPoll);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t.plan.toasts.proposeDayErr, 'err');
    }
  }

  async function handleRemovePollOption(date: string) {
    try {
      const res = await api.removePollOption(slug, date);
      setSnapshot(res.snapshot);
      showToast(t.plan.toasts.pollOptionRemoved);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t.plan.toasts.deleteErr, 'err');
    }
  }

  async function handleConfirmDate(
    date: string | null,
    time: string | null,
    opts?: { endDate?: string | null; durationMinutes?: number; timezone?: string | null }
  ) {
    try {
      const res = await api.updatePlan(slug, {
        confirmedDate: date,
        confirmedEndDate: opts?.endDate ?? null,
        confirmedTime: time,
        ...(opts?.durationMinutes ? { confirmedDurationMinutes: opts.durationMinutes } : {}),
        ...(opts?.timezone !== undefined ? { confirmedTimezone: opts.timezone } : {}),
      });
      setSnapshot(res.snapshot);
      showToast(
        date
          ? t.plan.toasts.dateConfirmed(formatDateRange(date, opts?.endDate, language))
          : t.plan.toasts.dateReopened
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : t.plan.toasts.confirmErr, 'err');
    }
  }

  async function handleToggleVotingOpen() {
    if (!snapshot) return;
    try {
      const res = await api.updatePlan(slug, {
        votingOpen: !snapshot.plan.votingOpen,
      });
      setSnapshot(res.snapshot);
      showToast(
        res.snapshot.plan.votingOpen ? t.plan.toasts.votingReopened : t.plan.toasts.votingClosed
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : t.plan.toasts.votingUpdateErr, 'err');
    }
  }

  async function handleSaveSettings(updates: UpdatePlanSettingsRequest) {
    try {
      const res = await api.updatePlan(slug, updates);
      setSnapshot(res.snapshot);
      rememberPlan({
        slug: res.snapshot.plan.slug,
        title: res.snapshot.plan.title,
        emoji: res.snapshot.plan.emoji,
      });
      showToast(t.plan.toasts.settingsSaved);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t.plan.toasts.saveErr, 'err');
      throw err;
    }
  }

  async function handleRemoveParticipant(participantId: string) {
    try {
      const res = await api.removeParticipant(slug, participantId);
      setSnapshot(res.snapshot);
      showToast(t.plan.toasts.participantRemoved);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t.plan.toasts.deleteErr, 'err');
    }
  }

  async function handleDeletePlan() {
    try {
      await api.deletePlan(slug);
      forgetPlan(slug);
      onGoHome();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t.plan.toasts.deletePlanErr, 'err');
    }
  }

  async function handleExtendExpiration(extraDays = 30) {
    try {
      const res = await api.extendPlanExpiration(slug, extraDays);
      setSnapshot(res.snapshot);
      showToast(t.plan.toasts.extendedExpiration(extraDays));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t.plan.toasts.extendErr, 'err');
    }
  }

  async function handleExportBackup() {
    try {
      await api.downloadBackup(slug);
      showToast(t.plan.toasts.backupDownloaded);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t.plan.toasts.backupErr, 'err');
    }
  }

  async function handleAddComment(date: string | null, body: string): Promise<boolean> {
    if (!me) {
      setIdentityModalMode('join');
      return false;
    }
    try {
      const res = await api.addComment(slug, {
        participantId: me.id,
        date,
        body,
      });
      setSnapshot(res.snapshot);
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : t.plan.toasts.commentErr, 'err');
      return false;
    }
  }

  async function handleSaveRsvp(status: RsvpStatus, guestsCount: number, note: string) {
    if (!me) return;
    try {
      const res = await api.setRsvp(slug, {
        participantId: me.id,
        status,
        guestsCount,
        note,
      });
      setSnapshot(res.snapshot);
      showToast(t.plan.toasts.rsvpUpdated);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t.plan.toasts.rsvpErr, 'err');
    }
  }

  function handleDownloadIcs() {
    if (!snapshot?.plan.confirmedDate) return;
    const ics = buildIcsContent({
      title: `${snapshot.plan.emoji} ${snapshot.plan.title}`,
      description: snapshot.plan.description,
      location: snapshot.plan.location,
      date: snapshot.plan.confirmedDate,
      endDate: snapshot.plan.confirmedEndDate,
      time: snapshot.plan.confirmedTime,
      durationMinutes: snapshot.plan.confirmedDurationMinutes,
      timezone: snapshot.plan.confirmedTimezone,
      url: window.location.href,
      lang: language,
    });
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${snapshot.plan.slug}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(t.plan.toasts.icsDownloaded);
  }

  function handleToggleFilter(id: string) {
    setFilterParticipantIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF9F6] dark:bg-[#0E1318]">
        <div className="flex flex-col items-center gap-3 text-stone-500 dark:text-slate-400">
          <RefreshCw className="h-7 w-7 animate-spin text-teal-600" />
          <p className="text-sm font-medium">{t.plan.loading}</p>
        </div>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#FAF9F6] dark:bg-[#0E1318] p-4 gap-4">
        <div className="flex items-center gap-2">
          <LanguageSelector variant="rounded" />
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={t.common.changeTheme}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 text-stone-600 dark:text-slate-300 hover:bg-stone-100 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
        <div className="max-w-md rounded-3xl border border-amber-200/80 dark:border-amber-900/60 bg-white dark:bg-slate-900 p-8 text-center space-y-4 shadow-lg">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-950/70 text-3xl">
            ⏳
          </div>
          <h1 className="font-display text-2xl font-extrabold">{t.plan.expiredTitle}</h1>
          <p className="text-sm text-stone-500 dark:text-slate-400">
            {t.plan.expiredDesc}
          </p>
          <button
            type="button"
            onClick={onGoHome}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-700 px-5 py-2.5 text-sm font-bold text-white transition cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            {t.plan.createNewPlanBtn}
          </button>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#FAF9F6] dark:bg-[#0E1318] p-4 gap-4">
        <div className="flex items-center gap-2">
          <LanguageSelector variant="rounded" />
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={t.common.changeTheme}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 text-stone-600 dark:text-slate-300 hover:bg-stone-100 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
        <div className="max-w-md rounded-3xl border border-stone-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center space-y-4 shadow-lg">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-950/70 text-3xl">
            📡
          </div>
          <h1 className="font-display text-2xl font-extrabold">{t.plan.loadErrorTitle}</h1>
          <p className="text-sm text-stone-500 dark:text-slate-400">
            {t.plan.loadErrorDesc}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="inline-flex items-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-700 px-5 py-2.5 text-sm font-bold text-white transition cursor-pointer"
            >
              <RefreshCw className="h-4 w-4" />
              {t.plan.retryBtn}
            </button>
            <button
              type="button"
              onClick={onGoHome}
              className="inline-flex items-center gap-2 rounded-xl border border-stone-200 dark:border-slate-700 px-4 py-2.5 text-sm font-semibold text-stone-600 dark:text-slate-300 hover:bg-stone-50 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
              {t.plan.backHome}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (notFound || !snapshot) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#FAF9F6] dark:bg-[#0E1318] p-4 gap-4">
        <div className="flex items-center gap-2">
          <LanguageSelector variant="rounded" />
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={t.common.changeTheme}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 text-stone-600 dark:text-slate-300 hover:bg-stone-100 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
        <div className="max-w-md rounded-3xl border border-stone-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center space-y-4 shadow-lg">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-100 dark:bg-slate-800 text-3xl">
            🗺️
          </div>
          <h1 className="font-display text-2xl font-extrabold">{t.plan.notFoundTitle}</h1>
          <p className="text-sm text-stone-500 dark:text-slate-400">
            {t.plan.notFoundDesc}
          </p>
          <button
            type="button"
            onClick={onGoHome}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-700 px-5 py-2.5 text-sm font-bold text-white transition cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            {t.plan.backHome}
          </button>
        </div>
      </div>
    );
  }

  const {
    plan,
    participants,
    availabilities,
    votes,
    comments,
    rsvps,
    subPolls,
    checklist,
    carpools,
    blindVoteStats,
  } = snapshot;
  const participantById = new Map(participants.map((p) => [p.id, p]));
  const generalComments = comments.filter((c) => !c.date);
  const logisticsCount =
    subPolls.length + checklist.filter((i) => !i.completed).length + carpools.length;
  const votingOpenEffective = isVotingEffectivelyOpen(plan);
  const votingBadge = blindVoteStats?.hidden
    ? blindVoteStats.votersCount || undefined
    : votes.length > 0
      ? votes.length
      : undefined;

  const requireIdentity = () => setIdentityModalMode('join');
  const focusDate = (d: string) => {
    setSelectedDate(d);
    setCurrentMonth(d.slice(0, 7));
  };

  // ---------- Shared building blocks (used by both desktop and mobile layouts) ----------

  const expiryBanner = (() => {
    const remainingDays = getRemainingDays(plan.expiresAt);
    if (remainingDays === null || remainingDays > 7) return null;
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200/80 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/35 px-4 py-2.5 text-xs text-amber-900 dark:text-amber-200">
        <span className="inline-flex items-center gap-2 font-medium">
          <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>
            {t.plan.expiryBannerBefore}
            <strong>
              {remainingDays === 0
                ? t.plan.expiryBannerLessThan24h
                : t.plan.expiryBannerDays(remainingDays)}
            </strong>
            {t.plan.expiryBannerAfter}
          </span>
        </span>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              type="button"
              onClick={() => handleExtendExpiration(30)}
              className="rounded-lg bg-amber-600 hover:bg-amber-700 px-2.5 py-1 text-[11px] font-bold text-white transition cursor-pointer"
            >
              {t.plan.extend30Btn}
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={handleExportBackup}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-300 dark:border-amber-800 bg-white/80 dark:bg-slate-900/70 px-2.5 py-1 text-[11px] font-semibold hover:bg-white transition cursor-pointer"
            >
              <Download className="h-3 w-3" />
              {t.plan.exportJsonBtn}
            </button>
          )}
        </div>
      </div>
    );
  })();

  const confirmedBanner = plan.confirmedDate ? (
    <div className="rounded-3xl border border-amber-300 dark:border-amber-700/70 bg-gradient-to-r from-amber-50 via-emerald-50/70 to-teal-50 dark:from-amber-950/50 dark:via-emerald-950/35 dark:to-teal-950/40 p-4 sm:p-5 shadow-sm flex flex-wrap items-center justify-between gap-4 animate-fade-up">
      <div className="flex items-center gap-3.5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-400 text-amber-950 shadow-sm">
          <Crown className="h-6 w-6" />
        </div>
        <div>
          <p className="text-xs font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-300">
            {t.plan.confirmedBadge}
          </p>
          <p className="font-display text-lg sm:text-xl font-extrabold text-stone-900 dark:text-white">
            {formatDateRange(plan.confirmedDate, plan.confirmedEndDate, language)}
            {plan.confirmedTime ? ` · ${plan.confirmedTime}` : ''}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={buildGoogleCalendarUrl({
            title: `${plan.emoji} ${plan.title}`,
            description: plan.description,
            location: plan.location,
            date: plan.confirmedDate,
            endDate: plan.confirmedEndDate,
            time: plan.confirmedTime,
            durationMinutes: plan.confirmedDurationMinutes,
            timezone: plan.confirmedTimezone,
          })}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-xl bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 hover:border-teal-400 px-3 py-2 text-xs font-bold shadow-2xs transition"
        >
          <CalendarPlus className="h-3.5 w-3.5 text-teal-600" />
          {t.plan.googleCalendar}
        </a>
        <button
          type="button"
          onClick={handleDownloadIcs}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 hover:border-teal-400 px-3 py-2 text-xs font-bold shadow-2xs transition cursor-pointer"
        >
          <Download className="h-3.5 w-3.5 text-teal-600" />
          {t.plan.icsBtn}
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              await downloadOrShareInviteCard({
                plan,
                participants,
                rsvps,
                shareUrl: window.location.href,
                lang: language,
              });
              showToast(t.plan.toasts.pngReady);
            } catch {
              showToast(t.plan.toasts.pngErr, 'err');
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 hover:border-teal-400 px-3 py-2 text-xs font-bold shadow-2xs transition cursor-pointer"
        >
          <ImageDown className="h-3.5 w-3.5 text-teal-600" />
          {t.plan.pngCardBtn}
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={() => handleConfirmDate(null, null)}
            className="rounded-xl px-2.5 py-2 text-xs font-semibold text-stone-500 hover:text-stone-800 dark:hover:text-slate-200 transition cursor-pointer"
          >
            {t.plan.changeDateBtn}
          </button>
        )}
      </div>
    </div>
  ) : null;

  const rsvpPanel = plan.confirmedDate ? (
    <RsvpPanel
      participants={participants}
      rsvps={rsvps}
      me={me}
      onSaveRsvp={handleSaveRsvp}
      onRequireIdentity={requireIdentity}
    />
  ) : null;

  const renderCalendar = (mobile: boolean) => (
    <InteractiveCalendar
      currentMonth={currentMonth}
      onChangeMonth={setCurrentMonth}
      participants={participants}
      me={me}
      granularity={plan.granularity}
      enabledSlots={plan.enabledSlots}
      activeSlot={effectiveActiveSlot}
      onChangeActiveSlot={setActiveSlot}
      holidayCountry={plan.holidayCountry}
      requiredParticipantIds={plan.requiredParticipantIds}
      onlineParticipantIds={onlineSet}
      myAvailabilityMap={myAvailabilityMap}
      mySlotAvailabilityMap={mySlotAvailabilityMap}
      summaries={summaries}
      selectedDate={selectedDate}
      onSelectDate={setSelectedDate}
      confirmedDate={plan.confirmedDate}
      confirmedEndDate={plan.confirmedEndDate}
      highlightedRangeDates={highlightedRangeSet}
      filterParticipantIds={filterParticipantIds}
      onToggleFilterParticipant={handleToggleFilter}
      onClearFilters={() => setFilterParticipantIds([])}
      onCommitAvailability={handleCommitAvailability}
      canUndo={undoStack.length > 0}
      onUndo={handleUndo}
      onRequireIdentity={requireIdentity}
      mobile={mobile}
      paintMode={paintMode}
      mobileBrush={paintBrush}
      onOpenDay={() => setDaySheetOpen(true)}
    />
  );

  const renderVoting = (compact: boolean, onSelect: (d: string) => void = focusDate) => (
    <VotingPanel
      compact={compact}
      plan={plan}
      participants={participants}
      me={me}
      isAdmin={isAdmin}
      rankedDates={rankedDates}
      rankedRanges={rankedRanges}
      sortMode={sortMode}
      onChangeSortMode={setSortMode}
      votes={votes}
      blindVoteStats={blindVoteStats}
      selectedDate={selectedDate}
      onSelectDate={onSelect}
      onHoverRange={setHoveredRangeDates}
      onToggleVote={handleToggleVote}
      onNominateDate={handleNominateDate}
      onRemovePollOption={handleRemovePollOption}
      onConfirmDate={handleConfirmDate}
      onToggleVotingOpen={handleToggleVotingOpen}
      onRequireIdentity={requireIdentity}
    />
  );

  const renderMatrix = (onSelect: (d: string) => void = focusDate) => (
    <ComparisonMatrix
      participants={participants}
      me={me}
      granularity={plan.granularity}
      enabledSlots={plan.enabledSlots}
      onlineParticipantIds={onlineSet}
      requiredParticipantIds={plan.requiredParticipantIds}
      availabilities={availabilities}
      rankedDates={rankedDates}
      confirmedDate={plan.confirmedDate}
      selectedDate={selectedDate}
      votingOpen={votingOpenEffective}
      blindVotingHidden={Boolean(blindVoteStats?.hidden)}
      onSelectDate={onSelect}
      onToggleVote={handleToggleVote}
      onCycleMyStatus={(date, nextStatus) =>
        handleCommitAvailability(
          dayAvailabilityChanges(date, nextStatus, plan.granularity, undefined, plan.enabledSlots)
        )
      }
      onCycleMySlotStatus={(date, slot, nextStatus) =>
        handleCommitAvailability([{ date, slot, status: nextStatus }])
      }
      myVotedDates={myVotedDates}
    />
  );

  const renderLogistics = (section: LogisticsSection) => (
    <PlanLogisticsPanel
      section={section}
      participants={participants}
      me={me}
      isAdmin={isAdmin}
      subPolls={subPolls}
      checklist={checklist}
      carpools={carpools}
      onCreateSubPoll={async (category: SubPollCategory, question, initialOptions) => {
        try {
          const res = await api.createSubPoll(slug, {
            participantId: me?.id,
            category,
            question,
            initialOptions,
          });
          setSnapshot(res.snapshot);
          showToast(t.plan.toasts.pollCreated);
        } catch (err) {
          showToast(err instanceof Error ? err.message : t.plan.toasts.saveErr, 'err');
          throw err;
        }
      }}
      onAddSubPollOption={async (pollId, title, url, estimatedCost) => {
        try {
          const res = await api.addSubPollOption(slug, pollId, {
            participantId: me?.id,
            title,
            url,
            estimatedCost,
          });
          setSnapshot(res.snapshot);
          showToast(t.plan.toasts.optionAdded);
        } catch (err) {
          showToast(err instanceof Error ? err.message : t.plan.toasts.saveErr, 'err');
          throw err;
        }
      }}
      onToggleSubPollVote={async (pollId, optionId) => {
        if (!me) return;
        try {
          const res = await api.toggleSubPollVote(slug, pollId, {
            participantId: me.id,
            optionId,
          });
          setSnapshot(res.snapshot);
        } catch (err) {
          showToast(err instanceof Error ? err.message : t.plan.toasts.voteErr, 'err');
        }
      }}
      onSetSubPollWinner={async (pollId, winnerOptionId) => {
        try {
          const res = await api.setSubPollWinner(slug, pollId, winnerOptionId);
          setSnapshot(res.snapshot);
          showToast(winnerOptionId ? t.plan.toasts.winnerSet : t.plan.toasts.winnerCleared);
        } catch (err) {
          showToast(err instanceof Error ? err.message : t.plan.toasts.saveErr, 'err');
        }
      }}
      onDeleteSubPoll={async (pollId) => {
        try {
          const res = await api.deleteSubPoll(slug, pollId);
          setSnapshot(res.snapshot);
          showToast(t.plan.toasts.pollDeleted);
        } catch (err) {
          showToast(err instanceof Error ? err.message : t.plan.toasts.deleteErr, 'err');
        }
      }}
      onAddChecklistItem={async (title, assignToMe) => {
        try {
          const res = await api.addChecklistItem(slug, {
            participantId: me?.id,
            title,
            assignedTo: assignToMe ? me?.id ?? null : null,
          });
          setSnapshot(res.snapshot);
        } catch (err) {
          showToast(err instanceof Error ? err.message : t.plan.toasts.saveErr, 'err');
          throw err;
        }
      }}
      onUpdateChecklistItem={async (itemId, updates) => {
        try {
          const res = await api.updateChecklistItem(slug, itemId, updates);
          setSnapshot(res.snapshot);
        } catch (err) {
          showToast(err instanceof Error ? err.message : t.plan.toasts.saveErr, 'err');
        }
      }}
      onDeleteChecklistItem={async (itemId) => {
        try {
          const res = await api.deleteChecklistItem(slug, itemId);
          setSnapshot(res.snapshot);
        } catch (err) {
          showToast(err instanceof Error ? err.message : t.plan.toasts.deleteErr, 'err');
        }
      }}
      onAddCarpool={async (origin, seatsTotal, departureTime, notes) => {
        if (!me) return;
        try {
          const res = await api.addCarpoolRide(slug, {
            driverId: me.id,
            origin,
            seatsTotal,
            departureTime,
            notes,
          });
          setSnapshot(res.snapshot);
          showToast(t.plan.toasts.carPublished);
        } catch (err) {
          showToast(err instanceof Error ? err.message : t.plan.toasts.saveErr, 'err');
          throw err;
        }
      }}
      onToggleCarpoolSeat={async (rideId) => {
        if (!me) return;
        try {
          const res = await api.toggleCarpoolSeat(slug, rideId, me.id);
          setSnapshot(res.snapshot);
          showToast(res.joined ? t.plan.toasts.seatReserved : t.plan.toasts.seatReleased);
        } catch (err) {
          showToast(err instanceof Error ? err.message : t.plan.toasts.seatReserveErr, 'err');
        }
      }}
      onDeleteCarpool={async (rideId) => {
        try {
          const res = await api.deleteCarpoolRide(slug, rideId);
          setSnapshot(res.snapshot);
          showToast(t.plan.toasts.carDeleted);
        } catch (err) {
          showToast(err instanceof Error ? err.message : t.plan.toasts.deleteErr, 'err');
        }
      }}
      onRequireIdentity={requireIdentity}
    />
  );

  const renderDayInspector = (variant: 'card' | 'sheet') => (
    <DayInspector
      variant={variant}
      date={selectedDate}
      summary={selectedDate ? summaries.get(selectedDate) ?? null : null}
      participants={participants}
      me={me}
      granularity={plan.granularity}
      enabledSlots={plan.enabledSlots}
      preferredSlot={effectiveActiveSlot !== 'all' ? effectiveActiveSlot : null}
      holidayCountry={plan.holidayCountry}
      requiredParticipantIds={plan.requiredParticipantIds}
      myStatus={selectedDate ? myAvailabilityMap.get(selectedDate) : undefined}
      myNote={selectedDate ? myNotesByDate.get(selectedDate) ?? '' : ''}
      mySlotAvailabilityMap={mySlotAvailabilityMap}
      hasVoted={selectedDate ? myVotedDates.has(selectedDate) : false}
      votingOpen={votingOpenEffective}
      comments={comments}
      onSetMyStatus={(d, st, slot = 'all', note) =>
        handleCommitAvailability([{ date: d, slot, status: st, note }])
      }
      onSetMyDayStatus={(d, st, note) =>
        handleCommitAvailability(
          dayAvailabilityChanges(d, st, plan.granularity, note, plan.enabledSlots)
        )
      }
      onSaveMyNote={(d, note) => {
        if (me) handleCommitAvailability(personalNoteChanges(snapshotRef.current?.availabilities ?? [], me.id, d, note));
      }}
      onToggleVote={handleToggleVote}
      onAddComment={(d, body) => handleAddComment(d, body)}
      onRequireIdentity={requireIdentity}
    />
  );

  const renderGroupNotes = (mobile: boolean) => (
    <div className="rounded-3xl border border-stone-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-teal-600 dark:text-teal-400" />
        <h3 className="font-display text-sm font-extrabold tracking-tight">
          {t.plan.groupNotesTitle(generalComments.length)}
        </h3>
      </div>

      {generalComments.length === 0 ? (
        <p className="text-xs text-stone-500 dark:text-slate-400">{t.plan.groupNotesEmpty}</p>
      ) : (
        <div className={`space-y-2 ${mobile ? '' : 'max-h-56 overflow-y-auto pr-1'}`}>
          {generalComments.map((c) => {
            const author = participantById.get(c.participantId);
            const mine = me?.id === c.participantId;
            return (
              <div
                key={c.id}
                className={`flex items-start gap-2.5 rounded-2xl p-2.5 ${mobile ? 'text-sm' : 'text-xs'} ${
                  mine && mobile
                    ? 'bg-teal-50/90 dark:bg-teal-950/40'
                    : 'bg-stone-50/90 dark:bg-slate-800/55'
                }`}
              >
                {author && <Avatar participant={author} size="xs" className="mt-0.5" />}
                <div className="min-w-0 flex-1">
                  <span className="font-bold text-stone-800 dark:text-slate-100">
                    {author?.name ?? t.common.friendFallback}
                  </span>
                  <p className="text-stone-600 dark:text-slate-300 mt-0.5 break-words">{c.body}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const text = generalNote.trim();
          if (!text) return;
          if (!me) {
            requireIdentity();
            return;
          }
          const ok = await handleAddComment(null, text);
          if (ok) setGeneralNote('');
        }}
        className="flex items-center gap-1.5 pt-1"
      >
        <input
          type="text"
          maxLength={320}
          value={generalNote}
          onChange={(e) => setGeneralNote(e.target.value)}
          placeholder={t.plan.groupNotePlaceholder}
          className={`min-w-0 flex-1 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50/70 dark:bg-slate-800/70 px-3 outline-none focus:border-teal-500 transition ${
            mobile ? 'py-2.5 text-sm' : 'py-2 text-xs'
          }`}
        />
        <button
          type="submit"
          disabled={!generalNote.trim()}
          aria-label={t.plan.publishNoteAria}
          className={`flex shrink-0 items-center justify-center rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white transition cursor-pointer ${
            mobile ? 'h-10 w-10' : 'h-8.5 w-8.5'
          }`}
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );

  const modals = (
    <>
      {/* First-visit mini tutorial: mark your days, then vote */}
      <PlanIntroModal
        open={introOpen}
        planEmoji={plan.emoji}
        onClose={() => {
          markPlanIntroSeen();
          setIntroOpen(false);
        }}
      />

      {/* Join / Recover / Edit Profile Modal */}
      <IdentityModal
        open={identityModalMode !== null}
        mode={identityModalMode ?? 'join'}
        plan={plan}
        participantCount={participants.length}
        currentParticipant={me}
        onClose={() => setIdentityModalMode(null)}
        onJoinNew={handleJoinNew}
        onClaimExisting={handleClaimExisting}
        onUpdateProfile={handleUpdateProfile}
        onLeavePlan={handleLeavePlan}
      />

      {/* Organizer Settings Modal */}
      <PlanSettingsModal
        open={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        plan={plan}
        participants={participants}
        onSave={handleSaveSettings}
        onExtendExpiration={handleExtendExpiration}
        onExportBackup={handleExportBackup}
        onRemoveParticipant={handleRemoveParticipant}
        onDeletePlan={handleDeletePlan}
      />

      {/* Share + QR + PNG + Smart Nudge + Multi-device Modal */}
      <ShareModal
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        plan={plan}
        participants={participants}
        availabilities={availabilities}
        votes={votes}
        rsvps={rsvps}
        topDates={rankedDates}
        hasSession={Boolean(me)}
        onToast={(msg) => showToast(msg)}
      />
    </>
  );

  const renderToast = (bottomClass: string) =>
    toast && (
      <div className={`fixed left-1/2 z-[60] -translate-x-1/2 animate-pop ${bottomClass}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-xs sm:text-sm font-semibold shadow-xl border whitespace-nowrap ${
            toast.tone === 'err'
              ? 'bg-rose-600 text-white border-rose-500'
              : 'bg-stone-900 dark:bg-white text-white dark:text-slate-900 border-stone-800 dark:border-stone-200'
          }`}
        >
          {toast.text}
        </div>
      </div>
    );

  // ---------- Mobile layout (< lg) ----------

  if (isMobile) {
    const topDate = rankedDates[0] ?? null;
    const activeCount =
      filterParticipantIds.length > 0 ? filterParticipantIds.length : participants.length;
    const onCalendarTab = mobileTab === 'calendar';

    const switchTab = (tab: MobileTab) => {
      setMobileTab(tab);
      setPaintMode(false);
      setDaySheetOpen(false);
      window.scrollTo({ top: 0, behavior: 'instant' });
    };

    // Selecting a date from Voting/Comparison opens its detail sheet on top of the current tab
    const openDateFromList = (d: string) => {
      focusDate(d);
      setDaySheetOpen(true);
    };

    const startPaint = () => {
      setDaySheetOpen(false);
      if (!me) {
        setPendingPaint(true);
        setIdentityModalMode('join');
        return;
      }
      setPaintMode(true);
    };

    const navItems: Array<{
      id: MobileTab;
      label: string;
      icon: typeof Calendar;
      badge?: number;
    }> = [
      { id: 'calendar', label: t.mobile.navDates, icon: Calendar },
      { id: 'voting', label: t.mobile.navVote, icon: Vote, badge: votingBadge },
      {
        id: 'logistics',
        label: t.mobile.navLogistics,
        icon: ClipboardList,
        badge: logisticsCount > 0 ? logisticsCount : undefined,
      },
      { id: 'group', label: t.mobile.navGroup, icon: MessageSquare },
    ];

    const segmented = <T extends string>(
      value: T,
      onChange: (v: T) => void,
      options: Array<{ id: T; label: string; count?: number }>
    ) => (
      <div
        role="tablist"
        className="grid rounded-2xl bg-stone-200/60 dark:bg-slate-800/80 p-1"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((opt) => {
          const active = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(opt.id)}
              className={`inline-flex min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[13px] font-bold transition cursor-pointer ${
                active
                  ? 'bg-white dark:bg-slate-950 text-stone-900 dark:text-white shadow-xs'
                  : 'text-stone-500 dark:text-slate-400'
              }`}
            >
              <span className="truncate">{opt.label}</span>
              {opt.count !== undefined && opt.count > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[10px] font-extrabold tabular-nums ${
                    active
                      ? 'bg-teal-600 text-white'
                      : 'bg-stone-300/70 dark:bg-slate-700 text-stone-600 dark:text-slate-300'
                  }`}
                >
                  {opt.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );

    const menuRow =
      'flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-semibold active:bg-stone-100 dark:active:bg-slate-800 transition cursor-pointer';
    const menuIcon =
      'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-100 dark:bg-slate-800 text-stone-600 dark:text-slate-300';

    return (
      <div className="min-h-dvh bg-[#FAF9F6] dark:bg-[#0E1318] text-stone-900 dark:text-slate-100">
        {/* Header: identity + 2 actions (share, overflow) */}
        <header className="sticky top-0 z-30 border-b border-stone-200/80 dark:border-slate-800/80 bg-[#FAF9F6]/90 dark:bg-[#0E1318]/90 backdrop-blur-md pt-safe">
          <div className="mx-auto flex h-14 max-w-2xl items-center gap-1.5 px-2">
            <button
              type="button"
              onClick={onGoHome}
              aria-label={t.plan.homeTitleTooltip}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-stone-600 dark:text-slate-300 active:bg-stone-200/70 dark:active:bg-slate-800 cursor-pointer"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={() => setPlanInfoOpen(true)}
              aria-label={t.mobile.planInfoTitle}
              className="min-w-0 flex-1 rounded-xl px-1 py-1 text-left active:bg-stone-200/50 dark:active:bg-slate-800/70 cursor-pointer"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="text-base leading-none">{plan.emoji}</span>
                <h1 className="truncate font-display text-[15px] font-extrabold tracking-tight">
                  {plan.title}
                </h1>
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-stone-500 dark:text-slate-400">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    liveConnected ? 'bg-emerald-500 animate-pulse' : 'bg-stone-400'
                  }`}
                />
                <span className="shrink-0">{t.common.people(participants.length)}</span>
                {plan.location && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="truncate">{plan.location}</span>
                  </>
                )}
              </div>
            </button>

            <button
              type="button"
              onClick={() => setShareModalOpen(true)}
              aria-label={t.mobile.shareAria}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white shadow-xs shadow-teal-600/25 active:bg-teal-700 cursor-pointer"
            >
              <Share2 className="h-4.5 w-4.5" />
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label={t.mobile.menuAria}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-stone-600 dark:text-slate-300 active:bg-stone-200/70 dark:active:bg-slate-800 cursor-pointer"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main
          className={`mx-auto max-w-2xl space-y-3 px-3 pt-3 ${
            onCalendarTab
              ? paintMode
                ? 'pb-[calc(11.5rem+env(safe-area-inset-bottom))]'
                : 'pb-[calc(9.5rem+env(safe-area-inset-bottom))]'
              : 'pb-[calc(5.5rem+env(safe-area-inset-bottom))]'
          }`}
        >
          {expiryBanner}

          {/* ---- Dates ---- */}
          {mobileTab === 'calendar' && (
            <>
              {plan.confirmedDate ? (
                <button
                  type="button"
                  onClick={() => switchTab('group')}
                  className="flex w-full items-center gap-2.5 rounded-2xl border border-amber-300/80 dark:border-amber-700/60 bg-gradient-to-r from-amber-50 to-emerald-50/70 dark:from-amber-950/50 dark:to-emerald-950/30 px-3 py-2.5 text-left cursor-pointer animate-fade-up"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-amber-950">
                    <Crown className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                      {t.plan.confirmedBadge}
                    </span>
                    <span className="block truncate font-display text-sm font-extrabold">
                      {formatDateRange(plan.confirmedDate, plan.confirmedEndDate, language)}
                      {plan.confirmedTime ? ` · ${plan.confirmedTime}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-bold text-amber-800 dark:text-amber-300">
                    {t.mobile.confirmedPillCta} →
                  </span>
                </button>
              ) : (
                topDate && (
                  <button
                    type="button"
                    onClick={() => {
                      focusDate(topDate.date);
                      setDaySheetOpen(true);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-2xl border border-teal-200/80 dark:border-teal-800/60 bg-white dark:bg-slate-900/90 px-3 py-2.5 text-left shadow-2xs cursor-pointer animate-fade-up"
                  >
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-400 px-2 py-1 text-[10px] font-extrabold text-amber-950">
                      <Star className="h-3 w-3 fill-current" />
                      {t.mobile.topPillLabel}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      <span className="font-bold">
                        {(() => {
                          const parts = formatDateShortParts(topDate.date, language);
                          return `${parts.weekday.charAt(0)}${parts.weekday.slice(1).toLowerCase()} ${parts.day} ${parts.month.charAt(0)}${parts.month.slice(1).toLowerCase()}`;
                        })()}
                      </span>
                      <span className="text-stone-500 dark:text-slate-400">
                        {' · '}
                        {t.mobile.topPillFree(topDate.yes.length, activeCount)}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-bold text-teal-700 dark:text-teal-300">
                      {t.mobile.topPillView} →
                    </span>
                  </button>
                )
              )}

              {renderCalendar(true)}
            </>
          )}

          {/* ---- Vote: Ranking | Comparison ---- */}
          {mobileTab === 'voting' && (
            <>
              {segmented(voteMode, setVoteMode, [
                { id: 'ranking', label: t.mobile.voteModeRanking, count: rankedDates.length },
                { id: 'matrix', label: t.mobile.voteModeMatrix },
              ])}
              {voteMode === 'ranking' ? (
                renderVoting(false, openDateFromList)
              ) : (
                <>
                  {renderMatrix(openDateFromList)}
                  {rankedDates.length > 3 && (
                    <p className="text-center text-[11px] text-stone-400 dark:text-slate-500">
                      {t.mobile.matrixScrollHint}
                    </p>
                  )}
                </>
              )}
            </>
          )}

          {/* ---- Logistics: one module at a time ---- */}
          {mobileTab === 'logistics' && (
            <>
              {segmented(logSection, setLogSection, [
                { id: 'polls', label: `📍 ${t.mobile.logPolls}`, count: subPolls.length },
                {
                  id: 'checklist',
                  label: `✓ ${t.mobile.logChecklist}`,
                  count: checklist.filter((i) => !i.completed).length,
                },
                { id: 'carpool', label: `🚗 ${t.mobile.logCarpool}`, count: carpools.length },
              ])}
              {renderLogistics(logSection)}
            </>
          )}

          {/* ---- Group: RSVP, me, members, notes ---- */}
          {mobileTab === 'group' && (
            <>
              {confirmedBanner}
              {rsvpPanel}

              {me ? (
                <div className="flex items-center gap-3 rounded-3xl border border-stone-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-2xs">
                  <Avatar participant={me} size="md" online={liveConnected} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-sm font-bold">
                      {t.plan.participatingAs(me.name)}
                    </p>
                    <p className="text-xs text-stone-500 dark:text-slate-400">
                      {t.plan.myStatsYes(myStats.yes, myStats.maybe)} · {t.mobile.myCardHint}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIdentityModalMode('edit')}
                    className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-stone-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-stone-600 dark:text-slate-300 cursor-pointer"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {t.mobile.editProfileBtn}
                  </button>
                </div>
              ) : (
                <div className="rounded-3xl border border-teal-200/90 dark:border-teal-800/60 bg-gradient-to-br from-teal-50/90 to-emerald-50/70 dark:from-teal-950/40 dark:to-emerald-950/30 p-4 space-y-3">
                  <div>
                    <p className="font-display text-base font-extrabold text-teal-950 dark:text-teal-50">
                      {t.mobile.joinCardTitle}
                    </p>
                    <p className="text-xs text-teal-900/80 dark:text-teal-100/80">
                      {t.mobile.joinCardDesc}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={requireIdentity}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-2xl bg-teal-600 py-3 text-sm font-bold text-white shadow-xs active:bg-teal-700 cursor-pointer"
                  >
                    <UserPlus className="h-4 w-4" />
                    {t.plan.joinWithName}
                  </button>
                </div>
              )}

              <div className="rounded-3xl border border-stone-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-sm space-y-2.5">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                  <h3 className="font-display text-sm font-extrabold tracking-tight">
                    {t.mobile.participantsTitle(participants.length)}
                  </h3>
                </div>
                <ul className="divide-y divide-stone-100 dark:divide-slate-800">
                  {participants.map((p) => {
                    const isOnline = onlineSet.has(p.id);
                    return (
                      <li key={p.id} className="flex items-center gap-2.5 py-2">
                        <Avatar
                          participant={p}
                          size="sm"
                          online={isOnline}
                          required={plan.requiredParticipantIds.includes(p.id)}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                          {p.name}
                          {me?.id === p.id && (
                            <span className="ml-1 text-xs font-medium text-stone-400 dark:text-slate-500">
                              {t.common.youTag}
                            </span>
                          )}
                        </span>
                        {isOnline && (
                          <span className="shrink-0 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                            ● {t.mobile.onlineTag}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>

              {renderGroupNotes(true)}
            </>
          )}
        </main>

        {/* Thumb zone: dock (dates tab) + bottom navigation */}
        <div className="fixed inset-x-0 bottom-0 z-40">
          {onCalendarTab && (
            <div className="mx-auto max-w-2xl px-3 pb-2">
              {paintMode ? (
                <div className="rounded-3xl border border-stone-200/90 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 p-2 shadow-xl shadow-stone-900/10 dark:shadow-black/40 backdrop-blur-md space-y-2 animate-fade-up">
                  <p className="px-2 pt-0.5 text-center text-[11px] font-medium text-stone-500 dark:text-slate-400">
                    {t.mobile.paintHint}
                  </p>
                  <div className="flex items-center gap-1.5">
                    {(
                      [
                        {
                          id: 'yes',
                          label: t.mobile.paintYes,
                          icon: Check,
                          on: 'bg-emerald-600 text-white border-emerald-600',
                          off: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border-emerald-200/80 dark:border-emerald-800/60',
                        },
                        {
                          id: 'maybe',
                          label: t.mobile.paintMaybe,
                          icon: HelpCircle,
                          on: 'bg-amber-500 text-white border-amber-500',
                          off: 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border-amber-200/80 dark:border-amber-800/60',
                        },
                        {
                          id: 'no',
                          label: t.mobile.paintNo,
                          icon: X,
                          on: 'bg-rose-500 text-white border-rose-500',
                          off: 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border-rose-200/80 dark:border-rose-800/60',
                        },
                      ] as const
                    ).map((b) => {
                      const Icon = b.icon;
                      const active = paintBrush === b.id;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setPaintBrush(b.id)}
                          className={`inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-2xl border text-sm font-bold transition cursor-pointer ${
                            active ? `${b.on} shadow-xs` : b.off
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{b.label}</span>
                        </button>
                      );
                    })}
                    {undoStack.length > 0 && (
                      <button
                        type="button"
                        onClick={handleUndo}
                        aria-label={t.calendar.undoTitle}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-stone-200 dark:border-slate-700 text-stone-600 dark:text-slate-300 cursor-pointer"
                      >
                        <Undo2 className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPaintMode(false)}
                      className="h-11 shrink-0 rounded-2xl bg-stone-900 dark:bg-white px-4 text-sm font-bold text-white dark:text-slate-900 cursor-pointer"
                    >
                      {t.mobile.paintDone}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={startPaint}
                  className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-teal-600 to-emerald-600 px-4 text-[15px] font-bold text-white shadow-lg shadow-teal-700/25 active:brightness-95 cursor-pointer"
                >
                  <Pencil className="h-4.5 w-4.5" />
                  {t.mobile.paintCta}
                  {me && (myStats.yes > 0 || myStats.maybe > 0) && (
                    <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold">
                      {t.plan.myStatsYes(myStats.yes, myStats.maybe)}
                    </span>
                  )}
                </button>
              )}
            </div>
          )}

          <nav
            aria-label={t.mobile.navDates}
            className="border-t border-stone-200/80 dark:border-slate-800 bg-[#FAF9F6]/95 dark:bg-[#0E1318]/95 backdrop-blur-md pb-safe"
          >
            <div className="mx-auto grid max-w-2xl grid-cols-4">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = mobileTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => switchTab(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`relative flex h-15 flex-col items-center justify-center gap-0.5 text-[11px] font-bold transition cursor-pointer ${
                      active ? 'text-teal-700 dark:text-teal-300' : 'text-stone-500 dark:text-slate-400'
                    }`}
                  >
                    <span
                      className={`relative flex h-7 w-12 items-center justify-center rounded-full transition ${
                        active ? 'bg-teal-100 dark:bg-teal-950/80' : ''
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      {item.badge !== undefined && (
                        <span className="absolute -right-0.5 -top-1 min-w-4 rounded-full bg-amber-400 px-1 text-center text-[9px] font-extrabold leading-4 text-amber-950 tabular-nums">
                          {item.badge}
                        </span>
                      )}
                    </span>
                    {item.label}
                  </button>
                );
              })}
            </div>
          </nav>
        </div>

        {/* Day detail sheet */}
        <BottomSheet
          open={daySheetOpen && selectedDate !== null}
          onClose={() => setDaySheetOpen(false)}
          ariaLabel={t.inspector.dayDetailEyebrow}
        >
          {renderDayInspector('sheet')}
        </BottomSheet>

        {/* Overflow menu sheet */}
        <BottomSheet
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          title={
            <h2 className="font-display text-lg font-extrabold tracking-tight">
              {t.mobile.menuTitle}
            </h2>
          }
        >
          <div className="space-y-1 pb-2">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setIdentityModalMode(me ? 'edit' : 'join');
              }}
              className={menuRow}
            >
              {me ? (
                <Avatar participant={me} size="sm" />
              ) : (
                <span className={menuIcon}>
                  <UserPlus className="h-4 w-4" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{me ? t.mobile.menuProfile : t.mobile.menuJoin}</span>
                {me && (
                  <span className="block truncate text-xs font-medium text-stone-500 dark:text-slate-400">
                    {me.name}
                  </span>
                )}
              </span>
              <span className="text-stone-400">›</span>
            </button>

            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setSettingsModalOpen(true);
                }}
                className={menuRow}
              >
                <span className={menuIcon}>
                  <Settings className="h-4 w-4" />
                </span>
                <span className="flex-1">{t.mobile.menuSettings}</span>
                <span className="text-stone-400">›</span>
              </button>
            )}

            <div className={`${menuRow} cursor-default active:bg-transparent`}>
              <span className={menuIcon}>🌐</span>
              <span className="flex-1">{t.mobile.menuLanguage}</span>
              <LanguageSelector variant="pill" />
            </div>

            <button type="button" onClick={onToggleTheme} className={menuRow}>
              <span className={menuIcon}>
                {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </span>
              <span className="flex-1">{t.mobile.menuTheme}</span>
              <span className="rounded-full bg-stone-100 dark:bg-slate-800 px-3 py-1 text-xs font-bold text-stone-600 dark:text-slate-300">
                {theme === 'dark' ? t.mobile.themeDark : t.mobile.themeLight}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onGoHome();
              }}
              className={menuRow}
            >
              <span className={menuIcon}>
                <House className="h-4 w-4" />
              </span>
              <span className="flex-1">{t.mobile.menuHome}</span>
            </button>
          </div>
        </BottomSheet>

        {/* Plan details sheet (tap on header title) */}
        <BottomSheet
          open={planInfoOpen}
          onClose={() => setPlanInfoOpen(false)}
          title={
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-stone-100 dark:bg-slate-800 text-2xl">
                {plan.emoji}
              </span>
              <h2 className="min-w-0 font-display text-lg font-extrabold leading-tight tracking-tight">
                {plan.title}
              </h2>
            </div>
          }
        >
          <div className="space-y-4 pb-2 pt-1">
            {plan.description && (
              <p className="text-sm leading-relaxed text-stone-600 dark:text-slate-300">
                {plan.description}
              </p>
            )}
            <div className="space-y-2.5 rounded-2xl bg-stone-50 dark:bg-slate-800/60 p-3.5 text-sm">
              {plan.location && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 shrink-0 text-teal-600" />
                  <span className="min-w-0 break-words">{plan.location}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span
                  className={`ml-1 mr-1 h-2 w-2 shrink-0 rounded-full ${
                    liveConnected ? 'bg-emerald-500 animate-pulse' : 'bg-stone-400'
                  }`}
                />
                <span>
                  {liveConnected
                    ? onlineSet.size > 1
                      ? t.plan.liveOnline(onlineSet.size)
                      : t.plan.live
                    : t.plan.syncing}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <AvatarStack participants={participants} onlineIds={onlineSet} max={6} size="sm" />
                <span className="text-stone-500 dark:text-slate-400">
                  {t.common.people(participants.length)}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setPlanInfoOpen(false);
                setShareModalOpen(true);
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-teal-600 py-3 text-sm font-bold text-white active:bg-teal-700 cursor-pointer"
            >
              <Share2 className="h-4 w-4" />
              {t.plan.shareBtn}
            </button>
          </div>
        </BottomSheet>

        {modals}

        {renderToast(
          onCalendarTab
            ? paintMode
              ? 'bottom-[calc(11.5rem+env(safe-area-inset-bottom))]'
              : 'bottom-[calc(9rem+env(safe-area-inset-bottom))]'
            : 'bottom-[calc(5.25rem+env(safe-area-inset-bottom))]'
        )}
      </div>
    );
  }

  // ---------- Desktop layout (lg+) — unchanged ----------

  return (
    <div className="min-h-screen bg-[#FAF9F6] dark:bg-[#0E1318] text-stone-900 dark:text-slate-100 pb-20">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 border-b border-stone-200/80 dark:border-slate-800/80 bg-[#FAF9F6]/90 dark:bg-[#0E1318]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onGoHome}
              title={t.plan.homeTitleTooltip}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 text-white shadow-xs hover:brightness-110 transition cursor-pointer"
            >
              <CalendarHeart className="h-5 w-5" />
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-lg leading-none">{plan.emoji}</span>
                <h1 className="font-display text-base sm:text-lg font-extrabold tracking-tight truncate">
                  {plan.title}
                </h1>
              </div>
              <div className="flex items-center gap-2.5 text-[11px] text-stone-500 dark:text-slate-400">
                {plan.location && (
                  <span className="inline-flex items-center gap-1 truncate">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate">{plan.location}</span>
                  </span>
                )}
                <span className="inline-flex items-center gap-1 shrink-0">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      liveConnected ? 'bg-emerald-500 animate-pulse' : 'bg-stone-400'
                    }`}
                  />
                  {liveConnected
                    ? onlineSet.size > 1
                      ? t.plan.liveOnline(onlineSet.size)
                      : t.plan.live
                    : t.plan.syncing}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden md:flex items-center gap-2 mr-1">
              <AvatarStack participants={participants} onlineIds={onlineSet} max={5} size="sm" />
              <span className="text-xs font-semibold text-stone-500 dark:text-slate-400">
                {participants.length}
              </span>
            </div>

            {isAdmin && (
              <button
                type="button"
                onClick={() => setSettingsModalOpen(true)}
                title={t.plan.organizerSettingsTitle}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 text-stone-600 dark:text-slate-300 hover:bg-stone-100 dark:hover:bg-slate-700 transition cursor-pointer"
              >
                <Settings className="h-4 w-4" />
              </button>
            )}

            <button
              type="button"
              onClick={() => setShareModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 px-3.5 py-2 text-xs sm:text-sm font-bold text-white shadow-xs shadow-teal-600/20 transition cursor-pointer"
            >
              <Share2 className="h-4 w-4" />
              <span className="hidden sm:inline">{t.plan.shareBtn}</span>
            </button>

            <LanguageSelector variant="rounded" />

            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={t.common.changeTheme}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 text-stone-600 dark:text-slate-300 hover:bg-stone-100 dark:hover:bg-slate-700 transition cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pt-5 sm:px-6 space-y-5">
        {expiryBanner}
        {plan.description && (
          <p className="text-sm text-stone-600 dark:text-slate-300 max-w-3xl leading-relaxed">
            {plan.description}
          </p>
        )}

        {/* Confirmed Winning Date Banner + RSVP Panel */}
        {plan.confirmedDate && (
          <div className="space-y-4">
            {confirmedBanner}
            {rsvpPanel}
          </div>
        )}

        {/* Active Identity Bar OR Non-blocking Read-Only CTA */}
        {me ? (
          <div className="rounded-2xl border border-stone-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/85 px-4 py-3 shadow-2xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Avatar participant={me} size="md" online={liveConnected} />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-sm font-bold">
                    {t.plan.participatingAs(me.name)}
                  </span>
                  <span className="rounded-full bg-emerald-100 dark:bg-emerald-950/70 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                    {t.plan.myStatsYes(myStats.yes, myStats.maybe)}
                  </span>
                </div>
                <p className="text-xs text-stone-500 dark:text-slate-400">
                  {t.plan.liveChangesHint}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIdentityModalMode('edit')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 dark:border-slate-700 hover:bg-stone-50 dark:hover:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-stone-600 dark:text-slate-300 transition cursor-pointer"
            >
              <Pencil className="h-3.5 w-3.5" />
              {t.plan.myProfilePin}
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-teal-200/90 dark:border-teal-800/60 bg-gradient-to-r from-teal-50/90 to-emerald-50/70 dark:from-teal-950/40 dark:to-emerald-950/30 px-4 py-3 shadow-2xs flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs sm:text-sm text-teal-950 dark:text-teal-100">
              <strong>{t.plan.previewModeStrong}</strong> {t.plan.previewModeText}
            </div>
            <button
              type="button"
              onClick={requireIdentity}
              className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 px-4 py-2 text-xs font-bold text-white shadow-xs transition cursor-pointer shrink-0"
            >
              <UserPlus className="h-3.5 w-3.5" />
              {t.plan.joinWithName}
            </button>
          </div>
        )}

        {/* View Switcher Tabs */}
        <div className="flex items-center justify-between gap-3 overflow-x-auto pb-1">
          <div className="inline-flex rounded-2xl border border-stone-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 shadow-2xs">
            {(
              [
                { id: 'calendar', label: t.plan.tabs.calendar, icon: Calendar },
                { id: 'voting', label: t.plan.tabs.voting, icon: Vote, badge: votingBadge },
                { id: 'matrix', label: t.plan.tabs.matrix, icon: Grid3X3 },
                {
                  id: 'logistics',
                  label: t.plan.tabs.logistics,
                  icon: ClipboardList,
                  badge: logisticsCount > 0 ? logisticsCount : undefined,
                },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 sm:px-3.5 py-2 text-xs sm:text-sm font-bold transition cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-teal-600 text-white shadow-xs'
                      : 'text-stone-600 dark:text-slate-300 hover:bg-stone-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                  {'badge' in tab && tab.badge !== undefined && (
                    <span
                      className={`rounded-full px-1.5 py-0.2 text-[10px] font-extrabold tabular-nums ${
                        active
                          ? 'bg-white/25 text-white'
                          : 'bg-amber-100 dark:bg-amber-900/70 text-amber-800 dark:text-amber-200'
                      }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Main Responsive Workspace */}
        <div className="grid gap-6 lg:grid-cols-12 items-start">
          {/* Primary Column */}
          <div className="lg:col-span-7 space-y-5">
            {activeTab === 'calendar' && renderCalendar(false)}
            {activeTab === 'voting' && renderVoting(false)}
            {activeTab === 'matrix' && renderMatrix()}
            {activeTab === 'logistics' && renderLogistics('all')}
          </div>

          {/* Right Smart Column */}
          <div className="lg:col-span-5 space-y-5">
            {renderDayInspector('card')}
            {activeTab !== 'voting' && renderVoting(true)}
            {/* Group Quick Notes Card */}
            {renderGroupNotes(false)}
          </div>
        </div>
      </main>

      {modals}

      {/* Toast Notification */}
      {renderToast('bottom-5')}
    </div>
  );
}
