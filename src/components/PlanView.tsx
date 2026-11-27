import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  CalendarHeart,
  CalendarPlus,
  ClipboardList,
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
  isVotingEffectivelyOpen,
  rankBestDates,
  rankBestRanges,
  type RankingSortMode,
} from '../../shared/dates';
import { api, subscribePlanStream } from '../lib/api';
import {
  forgetPlan,
  getAdminToken,
  getParticipantToken,
  getSavedParticipantId,
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
import { ShareModal } from './ShareModal';
import { PlanSettingsModal } from './PlanSettingsModal';
import { RsvpPanel } from './RsvpPanel';
import { PlanLogisticsPanel } from './PlanLogisticsPanel';

type ViewTab = 'calendar' | 'voting' | 'matrix' | 'logistics';

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
  const [liveConnected, setLiveConnected] = useState(false);
  const [onlineIds, setOnlineIds] = useState<string[]>([]);

  const [myParticipantId, setMyParticipantId] = useState<string | null>(() =>
    getSavedParticipantId(slug)
  );
  const [isAdmin, setIsAdmin] = useState<boolean>(
    () => Boolean(getAdminToken(slug)) || slug === 'cena-reencuentro'
  );
  const [activeTab, setActiveTab] = useState<ViewTab>('calendar');
  const [sortMode, setSortMode] = useState<RankingSortMode>('smart');
  const [currentMonth, setCurrentMonth] = useState<string>(() =>
    formatDateISO(new Date()).slice(0, 7)
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [hoveredRangeDates, setHoveredRangeDates] = useState<string[] | null>(null);
  const [filterParticipantIds, setFilterParticipantIds] = useState<string[]>([]);

  const [identityModalMode, setIdentityModalMode] = useState<'join' | 'edit' | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [generalNote, setGeneralNote] = useState('');
  const [toast, setToast] = useState<{ text: string; tone?: 'ok' | 'err' } | null>(null);

  // Undo stack stores previous availability batch changes to revert last action
  const [undoStack, setUndoStack] = useState<
    Array<Array<{ date: string; slot: AvailabilitySlot; status: AvailabilityStatus | null; note?: string }>>
  >([]);
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
    } else if (notFound) {
      document.title = `${t.plan.notFoundTitle} — Shalendar`;
    }
  }, [snapshot?.plan, notFound, t.plan.notFoundTitle]);

  // Load initial snapshot + handle cross-device magic tokens (?pt=...&at=...) + SSE (skipInitial=1)
  useEffect(() => {
    let cancelled = false;
    let unsubscribeStream: (() => void) | null = null;
    setLoading(true);
    setNotFound(false);

    async function boot() {
      // 1. Check cross-device transfer tokens in URL query params and clean URL immediately
      const url = new URL(window.location.href);
      const pt = url.searchParams.get('pt');
      const at = url.searchParams.get('at');
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
            }
            setIsAdmin(session.isAdmin || slug === 'cena-reencuentro');
          }
        } catch {
          // Ignore invalid token
        }
      } else {
        setIsAdmin(slug === 'cena-reencuentro');
      }

      // 3. Load single initial snapshot
      try {
        const data = await api.getPlan(slug);
        if (cancelled) return;
        setSnapshot(data);
        setOnlineIds(data.onlineParticipantIds ?? []);
        setLoading(false);
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
          setCurrentMonth(data.plan.startMonth);
        }

        const savedId = getSavedParticipantId(slug);
        if (savedId && data.participants.some((p) => p.id === savedId)) {
          setMyParticipantId(savedId);
        } else if (savedId) {
          saveParticipantId(slug, null);
          setMyParticipantId(null);
        }

        // 4. Connect SSE with skipInitial=1 to avoid duplicate initial snapshot payload!
        unsubscribeStream = subscribePlanStream(
          slug,
          {
            onSnapshot: (next) => {
              if (!cancelled) {
                setSnapshot(next);
                if (next.onlineParticipantIds) setOnlineIds(next.onlineParticipantIds);
              }
            },
            onPresence: (online) => {
              if (!cancelled) setOnlineIds(online);
            },
            onConnectionChange: (connected) => {
              if (!cancelled) setLiveConnected(connected);
            },
          },
          { participantId: savedId, skipInitial: true }
        );
      } catch {
        if (cancelled) return;
        setNotFound(true);
        setLoading(false);
      }
    }

    boot();

    return () => {
      cancelled = true;
      unsubscribeStream?.();
    };
  }, [slug, showToast]);

  const me = useMemo(() => {
    if (!snapshot || !myParticipantId) return null;
    return snapshot.participants.find((p) => p.id === myParticipantId) ?? null;
  }, [snapshot, myParticipantId]);

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
    for (const a of snapshot.availabilities) {
      if (a.participantId !== me.id) continue;
      const slot = a.slot || 'all';
      slotMap.set(`${a.date}:${slot}`, a.status);
      if (a.note) notesMap.set(a.date, a.note);

      const prev = dayMap.get(a.date);
      if (!prev || statusPriority[a.status] > statusPriority[prev]) {
        dayMap.set(a.date, a.status);
      }
    }
    return { myAvailabilityMap: dayMap, mySlotAvailabilityMap: slotMap, myNotesByDate: notesMap };
  }, [snapshot, me]);

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
    showToast(t.plan.toasts.welcomeNew(res.participant.name));
  }

  async function handleClaimExisting(name: string, pin: string) {
    const res = await api.claimParticipant(slug, { name, pin });
    setSnapshot(res.snapshot);
    setMyParticipantId(res.participant.id);
    saveParticipantId(slug, res.participant.id);
    saveParticipantToken(slug, res.participantToken);
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
      const prevSnap = snapshotRef.current;

      // Build inverse changes for Undo stack
      if (recordUndo && prevSnap) {
        const inverse = changes.map((ch) => {
          const slot: AvailabilitySlot = ch.slot ?? 'all';
          const existing = prevSnap.availabilities.find(
            (a) => a.participantId === me.id && a.date === ch.date && (a.slot || 'all') === slot
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
          if (a.participantId === me.id && keyedChanges.has(k)) {
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
              participantId: me.id,
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

      try {
        const res = await api.setAvailability(slug, {
          participantId: me.id,
          changes,
        });
        setSnapshot(res.snapshot);
      } catch (err) {
        if (prevSnap) setSnapshot(prevSnap);
        showToast(err instanceof Error ? err.message : tRef.current.plan.toasts.saveAvailabilityErr, 'err');
      }
    },
    [me, slug, showToast]
  );

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      handleCommitAvailability(last, false);
      showToast(tRef.current.plan.toasts.undone);
      return prev.slice(0, -1);
    });
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

  async function handleAddComment(date: string | null, body: string) {
    if (!me) {
      setIdentityModalMode('join');
      return;
    }
    try {
      const res = await api.addComment(slug, {
        participantId: me.id,
        date,
        body,
      });
      setSnapshot(res.snapshot);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t.plan.toasts.commentErr, 'err');
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
        {plan.description && (
          <p className="text-sm text-stone-600 dark:text-slate-300 max-w-3xl leading-relaxed">
            {plan.description}
          </p>
        )}

        {/* Confirmed Winning Date Banner + RSVP Panel */}
        {plan.confirmedDate && (
          <div className="space-y-4">
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

            <RsvpPanel
              participants={participants}
              rsvps={rsvps}
              me={me}
              onSaveRsvp={handleSaveRsvp}
              onRequireIdentity={() => setIdentityModalMode('join')}
            />
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
              onClick={() => setIdentityModalMode('join')}
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
                {
                  id: 'voting',
                  label: t.plan.tabs.voting,
                  icon: Vote,
                  badge: blindVoteStats?.hidden
                    ? blindVoteStats.votersCount || undefined
                    : votes.length > 0
                      ? votes.length
                      : undefined,
                },
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
            {activeTab === 'calendar' && (
              <InteractiveCalendar
                currentMonth={currentMonth}
                onChangeMonth={setCurrentMonth}
                participants={participants}
                me={me}
                granularity={plan.granularity}
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
                onRequireIdentity={() => setIdentityModalMode('join')}
              />
            )}

            {activeTab === 'voting' && (
              <VotingPanel
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
                onSelectDate={(d) => {
                  setSelectedDate(d);
                  setCurrentMonth(d.slice(0, 7));
                }}
                onHoverRange={setHoveredRangeDates}
                onToggleVote={handleToggleVote}
                onNominateDate={handleNominateDate}
                onRemovePollOption={handleRemovePollOption}
                onConfirmDate={handleConfirmDate}
                onToggleVotingOpen={handleToggleVotingOpen}
                onRequireIdentity={() => setIdentityModalMode('join')}
              />
            )}

            {activeTab === 'matrix' && (
              <ComparisonMatrix
                participants={participants}
                me={me}
                onlineParticipantIds={onlineSet}
                requiredParticipantIds={plan.requiredParticipantIds}
                availabilities={availabilities}
                rankedDates={rankedDates}
                confirmedDate={plan.confirmedDate}
                selectedDate={selectedDate}
                blindVotingHidden={Boolean(blindVoteStats?.hidden)}
                onSelectDate={(d) => {
                  setSelectedDate(d);
                  setCurrentMonth(d.slice(0, 7));
                }}
                onToggleVote={handleToggleVote}
                onCycleMyStatus={(date, nextStatus) =>
                  handleCommitAvailability([{ date, slot: 'all', status: nextStatus }])
                }
                myVotedDates={myVotedDates}
              />
            )}

            {activeTab === 'logistics' && (
              <PlanLogisticsPanel
                participants={participants}
                me={me}
                isAdmin={isAdmin}
                subPolls={subPolls}
                checklist={checklist}
                carpools={carpools}
                onCreateSubPoll={async (category: SubPollCategory, question, initialOptions) => {
                  const res = await api.createSubPoll(slug, {
                    participantId: me?.id,
                    category,
                    question,
                    initialOptions,
                  });
                  setSnapshot(res.snapshot);
                  showToast(t.plan.toasts.pollCreated);
                }}
                onAddSubPollOption={async (pollId, title, url, estimatedCost) => {
                  const res = await api.addSubPollOption(slug, pollId, {
                    participantId: me?.id,
                    title,
                    url,
                    estimatedCost,
                  });
                  setSnapshot(res.snapshot);
                  showToast(t.plan.toasts.optionAdded);
                }}
                onToggleSubPollVote={async (pollId, optionId) => {
                  if (!me) return;
                  const res = await api.toggleSubPollVote(slug, pollId, {
                    participantId: me.id,
                    optionId,
                  });
                  setSnapshot(res.snapshot);
                }}
                onSetSubPollWinner={async (pollId, winnerOptionId) => {
                  const res = await api.setSubPollWinner(slug, pollId, winnerOptionId);
                  setSnapshot(res.snapshot);
                  showToast(
                    winnerOptionId ? t.plan.toasts.winnerSet : t.plan.toasts.winnerCleared
                  );
                }}
                onDeleteSubPoll={async (pollId) => {
                  const res = await api.deleteSubPoll(slug, pollId);
                  setSnapshot(res.snapshot);
                  showToast(t.plan.toasts.pollDeleted);
                }}
                onAddChecklistItem={async (title, assignToMe) => {
                  const res = await api.addChecklistItem(slug, {
                    participantId: me?.id,
                    title,
                    assignedTo: assignToMe ? me?.id ?? null : null,
                  });
                  setSnapshot(res.snapshot);
                }}
                onUpdateChecklistItem={async (itemId, updates) => {
                  const res = await api.updateChecklistItem(slug, itemId, updates);
                  setSnapshot(res.snapshot);
                }}
                onDeleteChecklistItem={async (itemId) => {
                  const res = await api.deleteChecklistItem(slug, itemId);
                  setSnapshot(res.snapshot);
                }}
                onAddCarpool={async (origin, seatsTotal, departureTime, notes) => {
                  if (!me) return;
                  const res = await api.addCarpoolRide(slug, {
                    driverId: me.id,
                    origin,
                    seatsTotal,
                    departureTime,
                    notes,
                  });
                  setSnapshot(res.snapshot);
                  showToast(t.plan.toasts.carPublished);
                }}
                onToggleCarpoolSeat={async (rideId) => {
                  if (!me) return;
                  try {
                    const res = await api.toggleCarpoolSeat(slug, rideId, me.id);
                    setSnapshot(res.snapshot);
                    showToast(
                      res.joined ? t.plan.toasts.seatReserved : t.plan.toasts.seatReleased
                    );
                  } catch (err) {
                    showToast(
                      err instanceof Error ? err.message : t.plan.toasts.seatReserveErr,
                      'err'
                    );
                  }
                }}
                onDeleteCarpool={async (rideId) => {
                  const res = await api.deleteCarpoolRide(slug, rideId);
                  setSnapshot(res.snapshot);
                  showToast(t.plan.toasts.carDeleted);
                }}
                onRequireIdentity={() => setIdentityModalMode('join')}
              />
            )}
          </div>

          {/* Right Smart Column */}
          <div className="lg:col-span-5 space-y-5">
            <DayInspector
              date={selectedDate}
              summary={selectedDate ? summaries.get(selectedDate) ?? null : null}
              participants={participants}
              me={me}
              granularity={plan.granularity}
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
              onToggleVote={handleToggleVote}
              onAddComment={(d, body) => handleAddComment(d, body)}
              onRequireIdentity={() => setIdentityModalMode('join')}
            />

            {activeTab !== 'voting' && (
              <VotingPanel
                compact
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
                onSelectDate={(d) => {
                  setSelectedDate(d);
                  setCurrentMonth(d.slice(0, 7));
                }}
                onHoverRange={setHoveredRangeDates}
                onToggleVote={handleToggleVote}
                onNominateDate={handleNominateDate}
                onRemovePollOption={handleRemovePollOption}
                onConfirmDate={handleConfirmDate}
                onToggleVotingOpen={handleToggleVotingOpen}
                onRequireIdentity={() => setIdentityModalMode('join')}
              />
            )}

            {/* Group Quick Notes Card */}
            <div className="rounded-3xl border border-stone-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                <h3 className="font-display text-sm font-extrabold tracking-tight">
                  {t.plan.groupNotesTitle(generalComments.length)}
                </h3>
              </div>

              {generalComments.length === 0 ? (
                <p className="text-xs text-stone-500 dark:text-slate-400">
                  {t.plan.groupNotesEmpty}
                </p>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {generalComments.map((c) => {
                    const author = participantById.get(c.participantId);
                    return (
                      <div
                        key={c.id}
                        className="flex items-start gap-2.5 rounded-2xl bg-stone-50/90 dark:bg-slate-800/55 p-2.5 text-xs"
                      >
                        {author && <Avatar participant={author} size="xs" className="mt-0.5" />}
                        <div className="min-w-0 flex-1">
                          <span className="font-bold text-stone-800 dark:text-slate-100">
                            {author?.name ?? t.common.friendFallback}
                          </span>
                          <p className="text-stone-600 dark:text-slate-300 mt-0.5 break-words">
                            {c.body}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!generalNote.trim()) return;
                  handleAddComment(null, generalNote.trim());
                  setGeneralNote('');
                }}
                className="flex items-center gap-1.5 pt-1"
              >
                <input
                  type="text"
                  maxLength={320}
                  value={generalNote}
                  onChange={(e) => setGeneralNote(e.target.value)}
                  placeholder={t.plan.groupNotePlaceholder}
                  className="flex-1 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50/70 dark:bg-slate-800/70 px-3 py-2 text-xs outline-none focus:border-teal-500 transition"
                />
                <button
                  type="submit"
                  disabled={!generalNote.trim()}
                  aria-label={t.plan.publishNoteAria}
                  className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white transition cursor-pointer"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </form>
            </div>
          </div>
        </div>
      </main>

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

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 animate-pop">
          <div
            className={`rounded-2xl px-4 py-2.5 text-xs sm:text-sm font-semibold shadow-xl border ${
              toast.tone === 'err'
                ? 'bg-rose-600 text-white border-rose-500'
                : 'bg-stone-900 dark:bg-white text-white dark:text-slate-900 border-stone-800 dark:border-stone-200'
            }`}
          >
            {toast.text}
          </div>
        </div>
      )}
    </div>
  );
}
