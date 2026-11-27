import { useEffect, useState } from 'react';
import {
  CalendarRange,
  CheckCircle2,
  Clock,
  Crown,
  EyeOff,
  Lock,
  Plus,
  Sparkles,
  Star,
  Timer,
  Trash2,
  Unlock,
} from 'lucide-react';
import type {
  BlindVoteStats,
  DateRangeSummary,
  DaySummary,
  Participant,
  Plan,
  VoteEntry,
} from '../../shared/types';
import {
  formatDateLong,
  formatDateRange,
  formatDateShortParts,
  getTimeSlots,
  isVotingEffectivelyOpen,
  type RankingSortMode,
} from '../../shared/dates';
import { useI18n, type Translations } from '../lib/i18n';
import { AvatarStack } from './Avatar';

interface VotingPanelProps {
  plan: Plan;
  participants: Participant[];
  me: Participant | null;
  isAdmin: boolean;
  rankedDates: DaySummary[];
  rankedRanges?: DateRangeSummary[];
  sortMode: RankingSortMode;
  onChangeSortMode: (mode: RankingSortMode) => void;
  votes: VoteEntry[];
  blindVoteStats?: BlindVoteStats;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  onHoverRange?: (dates: string[] | null) => void;
  onToggleVote: (date: string) => void;
  onNominateDate: (date: string, label: string) => void;
  onRemovePollOption: (date: string) => void;
  onConfirmDate: (
    date: string,
    time: string | null,
    options?: { endDate?: string | null; durationMinutes?: number; timezone?: string | null }
  ) => void;
  onToggleVotingOpen: () => void;
  onRequireIdentity: () => void;
  compact?: boolean;
}

function formatCountdown(
  deadlineIso: string,
  t: Translations
): { text: string; expired: boolean } {
  const diff = Date.parse(deadlineIso) - Date.now();
  if (Number.isNaN(diff) || diff <= 0) {
    return { text: t.voting.deadlineExpired, expired: true };
  }
  const mins = Math.floor(diff / 60_000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const remMins = mins % 60;
  if (days > 0) return { text: t.voting.closesInDays(days, hours), expired: false };
  if (hours > 0) return { text: t.voting.closesInHours(hours, remMins), expired: false };
  return { text: t.voting.closesInMins(Math.max(1, remMins)), expired: false };
}

export function VotingPanel({
  plan,
  participants,
  me,
  isAdmin,
  rankedDates,
  rankedRanges = [],
  sortMode,
  onChangeSortMode,
  votes,
  blindVoteStats,
  selectedDate,
  onSelectDate,
  onHoverRange,
  onToggleVote,
  onNominateDate,
  onRemovePollOption,
  onConfirmDate,
  onToggleVotingOpen,
  onRequireIdentity,
  compact = false,
}: VotingPanelProps) {
  const { language, t } = useI18n();
  const [showNominateForm, setShowNominateForm] = useState(false);
  const [nominateDate, setNominateDate] = useState(selectedDate || '');
  const [nominateLabel, setNominateLabel] = useState('');
  const [confirmingDate, setConfirmingDate] = useState<string | null>(null);
  const [confirmTime, setConfirmTime] = useState('20:30');
  const [confirmDuration, setConfirmDuration] = useState<number>(plan.confirmedDurationMinutes || 180);
  const [, setTick] = useState(0);

  // Refresh countdown every 30s if deadline exists
  useEffect(() => {
    if (!plan.votingDeadline) return;
    const id = setInterval(() => setTick((tk) => tk + 1), 30_000);
    return () => clearInterval(id);
  }, [plan.votingDeadline]);

  const timeSlots = getTimeSlots(language);
  const effectivelyOpen = isVotingEffectivelyOpen(plan);
  const deadlineInfo = plan.votingDeadline ? formatCountdown(plan.votingDeadline, t) : null;

  const myVotes = me ? votes.filter((v) => v.participantId === me.id) : [];
  const myVotedDateSet = new Set(myVotes.map((v) => v.date));
  const totalParticipants = Math.max(participants.length, 1);
  const maxVoteCount = Math.max(...rankedDates.map((d) => d.votes.length), 0);
  const remainingVotes =
    plan.maxVotesPerUser > 0 ? Math.max(0, plan.maxVotesPerUser - myVotes.length) : null;

  const visibleItems = compact ? rankedDates.slice(0, 5) : rankedDates;
  const detectedTz =
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;

  function handleAddOption(e: React.FormEvent) {
    e.preventDefault();
    if (!nominateDate) return;
    onNominateDate(nominateDate, nominateLabel.trim());
    setNominateLabel('');
    setShowNominateForm(false);
    onSelectDate(nominateDate);
  }

  return (
    <div className="rounded-3xl border border-stone-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="font-display text-base sm:text-lg font-extrabold tracking-tight">
              {t.voting.title}
            </h3>
            {effectivelyOpen ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100/90 dark:bg-amber-950/70 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:text-amber-300">
                <Star className="h-3 w-3 fill-current" />
                {t.voting.statusOpen}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-stone-200 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-stone-600 dark:text-slate-300">
                <Lock className="h-3 w-3" />
                {t.voting.statusClosed}
              </span>
            )}
            {deadlineInfo && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  deadlineInfo.expired
                    ? 'bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300'
                    : 'bg-teal-50 dark:bg-teal-950/70 text-teal-700 dark:text-teal-300'
                }`}
              >
                <Timer className="h-3 w-3" />
                {deadlineInfo.text}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-stone-500 dark:text-slate-400">
            {effectivelyOpen
              ? remainingVotes !== null
                ? t.voting.subtitleRemaining(remainingVotes, plan.maxVotesPerUser)
                : t.voting.subtitleUnlimited
              : t.voting.subtitleClosed}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setNominateDate(selectedDate || rankedDates[0]?.date || '');
              setShowNominateForm((v) => !v);
            }}
            className="inline-flex items-center gap-1 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 hover:bg-stone-100 dark:hover:bg-slate-700 px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            {t.voting.proposeDay}
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={onToggleVotingOpen}
              title={plan.votingOpen ? t.voting.closeVotingTitle : t.voting.reopenVotingTitle}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-stone-200 dark:border-slate-700 text-stone-500 hover:bg-stone-100 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              {plan.votingOpen ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Blind Voting Info Banner */}
      {blindVoteStats?.hidden && (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-indigo-200/80 dark:border-indigo-800/60 bg-indigo-50/70 dark:bg-indigo-950/35 px-3.5 py-2.5 text-xs text-indigo-900 dark:text-indigo-200">
          <div className="flex items-center gap-2">
            <EyeOff className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
            <span>
              <strong>{t.voting.blindBannerStrong}</strong>{' '}
              {t.voting.blindBannerText(blindVoteStats.votersCount)}
            </span>
          </div>
        </div>
      )}

      {/* Multi-Day Getaway Range Finder (durationDays >= 2) */}
      {plan.durationDays >= 2 && rankedRanges.length > 0 && (
        <div className="rounded-2xl border border-indigo-200/80 dark:border-indigo-800/60 bg-gradient-to-br from-indigo-50/70 to-teal-50/50 dark:from-indigo-950/35 dark:to-teal-950/25 p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-extrabold text-indigo-950 dark:text-indigo-200">
              <CalendarRange className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <span>{t.voting.bestRangesTitle(plan.durationDays)}</span>
            </div>
            <span className="text-[10px] font-semibold text-indigo-700/80 dark:text-indigo-300">
              {t.voting.multiDayTag}
            </span>
          </div>
          <div className="space-y-1.5">
            {rankedRanges.slice(0, compact ? 3 : 6).map((range) => {
              const isConfirmedRange =
                plan.confirmedDate === range.startDate && plan.confirmedEndDate === range.endDate;
              return (
                <div
                  key={`${range.startDate}:${range.endDate}`}
                  onMouseEnter={() => onHoverRange?.(range.dates)}
                  onMouseLeave={() => onHoverRange?.(null)}
                  onClick={() => onSelectDate(range.startDate)}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs transition cursor-pointer ${
                    isConfirmedRange
                      ? 'border-amber-400 bg-amber-50/80 dark:bg-amber-950/40'
                      : 'border-white/90 dark:border-slate-800 bg-white/85 dark:bg-slate-900/75 hover:border-indigo-400'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-display font-bold text-stone-900 dark:text-white">
                        {formatDateRange(range.startDate, range.endDate, language)}
                      </span>
                      {range.includesHoliday && (
                        <span className="rounded-full bg-rose-100 dark:bg-rose-950/70 px-1.5 py-0.2 text-[10px] font-bold text-rose-700 dark:text-rose-300">
                          {t.voting.holidayBadge}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
                      {t.voting.rangeAvailSummary(
                        range.fullYes.length,
                        participants.length,
                        Math.max(0, range.fullYesOrMaybe.length - range.fullYes.length)
                      )}
                    </p>
                  </div>
                  {isAdmin && !isConfirmedRange && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onConfirmDate(range.startDate, null, {
                          endDate: range.endDate,
                          timezone: detectedTz,
                        });
                      }}
                      className="shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-2.5 py-1 text-[11px] font-bold text-white cursor-pointer"
                    >
                      {t.voting.lockBlockBtn}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Ranking Sort Mode Pills */}
      {visibleItems.length > 1 && (
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-stone-400 dark:text-slate-500 font-semibold">
            {t.voting.sortLabel}
          </span>
          {(
            [
              { id: 'smart', label: t.voting.sortSmart },
              { id: 'votes', label: t.voting.sortVotes },
              { id: 'availability', label: t.voting.sortAvailability },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChangeSortMode(opt.id)}
              className={`rounded-lg px-2 py-1 font-semibold transition cursor-pointer ${
                sortMode === opt.id
                  ? 'bg-teal-100 dark:bg-teal-950/70 text-teal-800 dark:text-teal-200'
                  : 'text-stone-500 dark:text-slate-400 hover:bg-stone-100 dark:hover:bg-slate-800'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Propose new date form */}
      {showNominateForm && (
        <form
          onSubmit={handleAddOption}
          className="rounded-2xl border border-teal-200 dark:border-teal-800/60 bg-teal-50/50 dark:bg-teal-950/30 p-3.5 space-y-2.5 animate-pop"
        >
          <p className="text-xs font-bold text-teal-900 dark:text-teal-200">
            {t.voting.addCandidateTitle}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="date"
              required
              value={nominateDate}
              onChange={(e) => setNominateDate(e.target.value)}
              className="rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs outline-none focus:border-teal-500"
            />
            <input
              type="text"
              maxLength={80}
              value={nominateLabel}
              onChange={(e) => setNominateLabel(e.target.value)}
              placeholder={t.voting.addCandidateNotePlaceholder}
              className="rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs outline-none focus:border-teal-500"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowNominateForm(false)}
              className="rounded-lg px-2.5 py-1 text-xs font-medium text-stone-500 hover:text-stone-700 cursor-pointer"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              className="rounded-lg bg-teal-600 hover:bg-teal-700 px-3 py-1 text-xs font-semibold text-white transition cursor-pointer"
            >
              {t.voting.addOptionBtn}
            </button>
          </div>
        </form>
      )}

      {/* Candidate List */}
      {visibleItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-200 dark:border-slate-800 py-8 px-4 text-center space-y-2">
          <Sparkles className="mx-auto h-7 w-7 text-teal-500/70" />
          <p className="font-display text-sm font-bold text-stone-700 dark:text-slate-200">
            {t.voting.emptyTitle}
          </p>
          <p className="text-xs text-stone-500 dark:text-slate-400 max-w-xs mx-auto">
            {t.voting.emptyDesc}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visibleItems.map((item, index) => {
            const parts = formatDateShortParts(item.date, language);
            const hasVoted = myVotedDateSet.has(item.date);
            const isLeader = !blindVoteStats?.hidden && maxVoteCount > 0 && item.votes.length === maxVoteCount;
            const isConfirmed = plan.confirmedDate === item.date && !plan.confirmedEndDate;
            const isAllAvailable =
              participants.length >= 2 && item.yes.length === participants.length;
            const availPct = Math.round((item.yes.length / totalParticipants) * 100);
            const votePct =
              maxVoteCount > 0 ? Math.round((item.votes.length / totalParticipants) * 100) : 0;
            const bestSlotObj = item.bestSlot
              ? timeSlots.find((s) => s.id === item.bestSlot)
              : null;

            return (
              <div
                key={item.date}
                onClick={() => onSelectDate(item.date)}
                className={`group rounded-2xl border p-3 transition cursor-pointer ${
                  isConfirmed
                    ? 'border-amber-400 bg-amber-50/70 dark:bg-amber-950/30 ring-1 ring-amber-400/50'
                    : selectedDate === item.date
                      ? 'border-teal-400 dark:border-teal-600 bg-teal-50/40 dark:bg-teal-950/25'
                      : 'border-stone-200/80 dark:border-slate-800 bg-stone-50/40 dark:bg-slate-800/35 hover:border-stone-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Date Badge */}
                  <div
                    className={`flex w-12 shrink-0 flex-col items-center justify-center rounded-xl py-1.5 text-center border ${
                      isConfirmed || isLeader
                        ? 'border-amber-300 dark:border-amber-700 bg-amber-100/80 dark:bg-amber-950/70 text-amber-950 dark:text-amber-200'
                        : 'border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-stone-800 dark:text-slate-100'
                    }`}
                  >
                    <span className="text-[9px] font-bold uppercase tracking-wider opacity-70">
                      {parts.weekday}
                    </span>
                    <span className="font-display text-lg font-extrabold leading-tight tabular-nums">
                      {parts.day}
                    </span>
                    <span className="text-[9px] font-bold uppercase opacity-70">{parts.month}</span>
                  </div>

                  {/* Middle Info & Visual Bars */}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-display text-sm font-bold text-stone-900 dark:text-white truncate">
                        {formatDateLong(item.date, language)}
                      </span>
                      {isConfirmed && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-extrabold text-amber-950">
                          <Crown className="h-2.5 w-2.5" />
                          {t.voting.badgeChosen}
                        </span>
                      )}
                      {!isConfirmed && isLeader && index === 0 && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 dark:bg-amber-900/70 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-200">
                          <Crown className="h-2.5 w-2.5" />
                          {t.voting.badgeLeader}
                        </span>
                      )}
                      {isAllAvailable && (
                        <span className="rounded-full bg-emerald-100 dark:bg-emerald-950/80 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                          {t.voting.badgeAllFree}
                        </span>
                      )}
                      {bestSlotObj && (
                        <span className="rounded-full bg-sky-100 dark:bg-sky-950/70 px-1.5 py-0.5 text-[10px] font-bold text-sky-800 dark:text-sky-200">
                          {bestSlotObj.emoji} {bestSlotObj.label}
                        </span>
                      )}
                    </div>

                    {item.pollOption?.label && (
                      <p className="text-xs text-stone-600 dark:text-slate-300">
                        {item.pollOption.label}
                      </p>
                    )}

                    {/* Availability bar */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-medium text-emerald-700 dark:text-emerald-300">
                          {t.voting.availRatio(item.yes.length, participants.length, item.maybe.length)}
                        </span>
                        {!blindVoteStats?.hidden && (
                          <span className="font-semibold text-amber-700 dark:text-amber-300 tabular-nums">
                            {t.common.votes(item.votes.length)}
                          </span>
                        )}
                      </div>

                      <div className="h-2 w-full overflow-hidden rounded-full bg-stone-200/80 dark:bg-slate-800 flex">
                        <div
                          style={{ width: `${availPct}%` }}
                          className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 transition-all duration-300"
                        />
                        {item.maybe.length > 0 && (
                          <div
                            style={{
                              width: `${Math.round((item.maybe.length / totalParticipants) * 100)}%`,
                            }}
                            className="h-full bg-amber-400/80 transition-all duration-300"
                          />
                        )}
                      </div>

                      {!blindVoteStats?.hidden && item.votes.length > 0 && (
                        <div className="flex items-center justify-between gap-2 pt-0.5">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-amber-100 dark:bg-amber-950/60">
                            <div
                              style={{ width: `${Math.min(100, Math.max(12, votePct))}%` }}
                              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-400 transition-all duration-300"
                            />
                          </div>
                          <AvatarStack participants={item.votes} max={4} size="xs" />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Vote & Admin Buttons */}
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={!effectivelyOpen}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!me) {
                          onRequireIdentity();
                          return;
                        }
                        onToggleVote(item.date);
                      }}
                      className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-bold transition cursor-pointer disabled:opacity-50 ${
                        hasVoted
                          ? 'border-amber-400 bg-amber-400 text-amber-950 shadow-xs shadow-amber-400/30'
                          : 'border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-stone-700 dark:text-slate-200 hover:border-amber-400 hover:text-amber-700 dark:hover:text-amber-300'
                      }`}
                    >
                      <Star className={`h-3.5 w-3.5 ${hasVoted ? 'fill-current' : ''}`} />
                      <span>{hasVoted ? t.voting.voted : t.voting.vote}</span>
                    </button>

                    <div className="flex items-center gap-1.5">
                      {isAdmin && !isConfirmed && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmingDate(confirmingDate === item.date ? null : item.date);
                          }}
                          className="text-[11px] font-semibold text-stone-400 hover:text-teal-600 dark:hover:text-teal-300 transition cursor-pointer"
                        >
                          {t.voting.confirm}
                        </button>
                      )}
                      {isAdmin && item.pollOption && (
                        <button
                          type="button"
                          title={t.voting.removeCandidateTitle}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemovePollOption(item.date);
                          }}
                          className="text-stone-300 hover:text-rose-500 transition cursor-pointer"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Inline Confirm Date Picker with Duration */}
                {confirmingDate === item.date && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/40 p-2.5 animate-pop"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Clock className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" />
                      <input
                        type="time"
                        value={confirmTime}
                        onChange={(e) => setConfirmTime(e.target.value)}
                        className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                      />
                      <select
                        value={confirmDuration}
                        onChange={(e) => setConfirmDuration(Number(e.target.value))}
                        className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-900 px-2 py-1 text-xs font-medium"
                      >
                        <option value={60}>{t.common.hours(1)}</option>
                        <option value={120}>{t.common.hours(2)}</option>
                        <option value={180}>{t.common.hours(3)}</option>
                        <option value={240}>{t.common.hours(4)}</option>
                        <option value={360}>{t.common.hours(6)}</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setConfirmingDate(null)}
                        className="rounded-lg px-2 py-1 text-xs text-stone-500 hover:text-stone-700 cursor-pointer"
                      >
                        {t.common.cancel}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onConfirmDate(item.date, confirmTime || null, {
                            endDate: null,
                            durationMinutes: confirmDuration,
                            timezone: detectedTz,
                          });
                          setConfirmingDate(null);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-1 text-xs font-bold text-white transition cursor-pointer"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {t.voting.confirmDateBtn}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
