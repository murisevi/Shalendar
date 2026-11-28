import { useMemo, useState } from 'react';
import { Check, Crown, HelpCircle, Minus, Star, X } from 'lucide-react';
import type {
  AvailabilityEntry,
  AvailabilitySlot,
  AvailabilityStatus,
  DaySummary,
  Participant,
  PlanGranularity,
  SpecificSlot,
} from '../../shared/types';
import {
  formatDateShortParts,
  getPlanTimeSlots,
  getSlotMeta,
  isSlotGranularity,
} from '../../shared/dates';
import { useI18n } from '../lib/i18n';
import { Avatar } from './Avatar';

interface ComparisonMatrixProps {
  participants: Participant[];
  me: Participant | null;
  granularity?: PlanGranularity;
  enabledSlots?: SpecificSlot[];
  onlineParticipantIds: Set<string>;
  requiredParticipantIds: string[];
  availabilities: AvailabilityEntry[];
  rankedDates: DaySummary[];
  confirmedDate: string | null;
  selectedDate: string | null;
  votingOpen?: boolean;
  blindVotingHidden?: boolean;
  onSelectDate: (date: string) => void;
  onToggleVote: (date: string) => void;
  onCycleMyStatus: (date: string, nextStatus: AvailabilityStatus | null) => void;
  onCycleMySlotStatus?: (
    date: string,
    slot: SpecificSlot,
    nextStatus: AvailabilityStatus | null
  ) => void;
  myVotedDates: Set<string>;
}

const CYCLE_ORDER: Array<AvailabilityStatus | null> = ['yes', 'maybe', 'no', null];

export function ComparisonMatrix({
  participants,
  me,
  granularity = 'day',
  enabledSlots,
  onlineParticipantIds,
  requiredParticipantIds,
  availabilities,
  rankedDates,
  confirmedDate,
  selectedDate,
  votingOpen = true,
  blindVotingHidden = false,
  onSelectDate,
  onToggleVote,
  onCycleMyStatus,
  onCycleMySlotStatus,
  myVotedDates,
}: ComparisonMatrixProps) {
  const { language, t } = useI18n();
  const useSlots = isSlotGranularity(granularity);
  const planSlots = useMemo(
    () => getPlanTimeSlots(granularity, enabledSlots, language),
    [granularity, enabledSlots, language]
  );
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot>('all');
  const activeSlot: AvailabilitySlot = !useSlots
    ? 'all'
    : planSlots.length === 1
      ? planSlots[0].id
      : selectedSlot !== 'all' && planSlots.some((s) => s.id === selectedSlot)
        ? selectedSlot
        : 'all';

  const columns = rankedDates.slice(0, 10);
  const requiredSet = new Set(requiredParticipantIds);

  // Lookup per (participant, date, slot) plus day aggregate across active slots
  const statusRank = { yes: 3, maybe: 2, no: 1 } as const;
  const enabledSlotSet = new Set<string>(planSlots.map((s) => s.id));
  const availBySlot = new Map<string, { status: AvailabilityStatus; note: string }>();
  const availAggregate = new Map<string, { status: AvailabilityStatus; note: string }>();
  for (const a of availabilities) {
    const slot = a.slot || 'all';
    availBySlot.set(`${a.participantId}:${a.date}:${slot}`, { status: a.status, note: a.note });

    if (useSlots && slot !== 'all' && !enabledSlotSet.has(slot)) continue;
    const key = `${a.participantId}:${a.date}`;
    const prev = availAggregate.get(key);
    if (!prev || statusRank[a.status] > statusRank[prev.status]) {
      availAggregate.set(key, { status: a.status, note: a.note || prev?.note || '' });
    } else if (a.note && !prev.note) {
      availAggregate.set(key, { ...prev, note: a.note });
    }
  }

  function resolveEntry(
    participantId: string,
    col: DaySummary,
    isMeRow: boolean
  ): { status: AvailabilityStatus; note: string } | undefined {
    if (useSlots && activeSlot !== 'all') {
      return (
        availBySlot.get(`${participantId}:${col.date}:${activeSlot}`) ??
        availBySlot.get(`${participantId}:${col.date}:all`)
      );
    }
    if (useSlots && !isMeRow && col.bestSlot) {
      return (
        availBySlot.get(`${participantId}:${col.date}:${col.bestSlot}`) ??
        availBySlot.get(`${participantId}:${col.date}:all`)
      );
    }
    return availAggregate.get(`${participantId}:${col.date}`);
  }

  if (columns.length === 0 || participants.length === 0) {
    return (
      <div className="rounded-3xl border border-stone-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-8 text-center">
        <p className="font-display text-base font-bold text-stone-700 dark:text-slate-200">
          {t.matrix.emptyTitle}
        </p>
        <p className="mt-1 text-xs text-stone-500 dark:text-slate-400">
          {t.matrix.emptyDesc}
        </p>
      </div>
    );
  }

  function nextStatusAfter(cur: AvailabilityStatus | undefined): AvailabilityStatus | null {
    const idx = CYCLE_ORDER.indexOf(cur ?? null);
    return CYCLE_ORDER[(idx + 1) % CYCLE_ORDER.length];
  }

  return (
    <div className="rounded-3xl border border-stone-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-lg font-extrabold tracking-tight">
            {t.matrix.title}
          </h3>
          <p className="text-xs text-stone-500 dark:text-slate-400">
            {t.matrix.subtitle(columns.length, Boolean(me))}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-medium text-stone-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-emerald-500 inline-block" /> {t.matrix.legendYes}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-amber-400 inline-block" /> {t.matrix.legendMaybe}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-rose-400 inline-block" /> {t.matrix.legendNo}
          </span>
        </div>
      </div>

      {useSlots && planSlots.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedSlot('all')}
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
              activeSlot === 'all'
                ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/70 text-teal-800 dark:text-teal-200'
                : 'border-stone-200 dark:border-slate-700 text-stone-600 dark:text-slate-300'
            }`}
          >
            ✨ {t.matrix.slotFilterBest}
          </button>
          {planSlots.map((slot) => (
            <button
              key={slot.id}
              type="button"
              onClick={() => setSelectedSlot(slot.id)}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                activeSlot === slot.id
                  ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/70 text-teal-800 dark:text-teal-200'
                  : 'border-stone-200 dark:border-slate-700 text-stone-600 dark:text-slate-300'
              }`}
            >
              <span>{slot.emoji}</span>
              <span>{slot.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto -mx-2 px-2">
        <table className="w-full border-separate border-spacing-1.5 text-left">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white dark:bg-slate-900 shadow-[-6px_0_0_0_#fff,6px_0_0_0_#fff] dark:shadow-[-6px_0_0_0_#0f172a,6px_0_0_0_#0f172a] min-w-[112px] sm:min-w-[140px] py-2 pl-2 text-xs font-bold uppercase tracking-wider text-stone-400 dark:text-slate-500">
                {t.matrix.friendHeader}
              </th>
              {columns.map((col) => {
                const parts = formatDateShortParts(col.date, language);
                const isConfirmed = confirmedDate === col.date;
                const isSel = selectedDate === col.date;
                return (
                  <th key={col.date} className="min-w-[60px] sm:min-w-[68px] p-0 text-center">
                    <button
                      type="button"
                      onClick={() => onSelectDate(col.date)}
                      className={`w-full rounded-xl border px-2 py-2 transition cursor-pointer ${
                        isConfirmed
                          ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/60'
                          : isSel
                            ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/60'
                            : 'border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800/70 hover:border-teal-400'
                      }`}
                    >
                      <div className="flex items-center justify-center gap-0.5 text-[10px] font-bold uppercase text-stone-500 dark:text-slate-400">
                        {isConfirmed && <Crown className="h-3 w-3 text-amber-500" />}
                        <span>{parts.weekday}</span>
                      </div>
                      <div className="font-display text-base font-extrabold tabular-nums">
                        {parts.day}
                      </div>
                      <div className="text-[10px] font-semibold uppercase text-stone-500 dark:text-slate-400">
                        {parts.month}
                        {useSlots && activeSlot === 'all' && col.bestSlot && (
                          <span className="ml-0.5" title={getSlotMeta(col.bestSlot, language).label}>
                            {getSlotMeta(col.bestSlot, language).emoji}
                          </span>
                        )}
                      </div>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {participants.map((p) => {
              const isMeRow = me?.id === p.id;
              return (
                <tr key={p.id}>
                  <td className="sticky left-0 z-10 bg-white dark:bg-slate-900 shadow-[-6px_0_0_0_#fff,6px_0_0_0_#fff] dark:shadow-[-6px_0_0_0_#0f172a,6px_0_0_0_#0f172a] p-0">
                    <div
                      className={`flex h-10 items-center gap-2 rounded-xl px-2.5 ${
                        isMeRow
                          ? 'bg-teal-50/80 dark:bg-teal-950/40 ring-1 ring-teal-300/70 dark:ring-teal-800'
                          : 'bg-stone-50/80 dark:bg-slate-800/40'
                      }`}
                    >
                      <Avatar
                        participant={p}
                        size="xs"
                        online={onlineParticipantIds.has(p.id)}
                        required={requiredSet.has(p.id)}
                      />
                      <span className="text-xs font-semibold truncate max-w-[64px] sm:max-w-[100px]">
                        {p.name}
                      </span>
                      {isMeRow && (
                        <span className="text-[10px] font-bold text-teal-600 dark:text-teal-400">
                          {t.common.youTag}
                        </span>
                      )}
                    </div>
                  </td>

                  {columns.map((col) => {
                    const entry = resolveEntry(p.id, col, isMeRow);
                    const st = entry?.status;
                    const note = entry?.note;
                    const cellContent = (
                      <div
                        title={
                          note
                            ? `${p.name}: «${note}»`
                            : isMeRow
                              ? t.matrix.clickToToggleTitle
                              : undefined
                        }
                        className={`relative flex h-10 items-center justify-center rounded-xl transition ${
                          st === 'yes'
                            ? 'bg-emerald-500/90 text-white'
                            : st === 'maybe'
                              ? 'bg-amber-400/85 text-amber-950'
                              : st === 'no'
                                ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300'
                                : 'bg-stone-100/70 dark:bg-slate-800/50 text-stone-400 dark:text-slate-600'
                        } ${isMeRow ? 'hover:ring-2 hover:ring-teal-500 cursor-pointer' : ''}`}
                      >
                        {st === 'yes' ? (
                          <Check className="h-4 w-4 stroke-[2.75]" />
                        ) : st === 'maybe' ? (
                          <HelpCircle className="h-4 w-4" />
                        ) : st === 'no' ? (
                          <X className="h-4 w-4" />
                        ) : (
                          <Minus className="h-3.5 w-3.5" />
                        )}
                        {note && (
                          <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-white/90 ring-1 ring-black/20" />
                        )}
                      </div>
                    );

                    return (
                      <td key={col.date} className="p-0 text-center">
                        {isMeRow ? (
                          <button
                            type="button"
                            onClick={() => {
                              const nextSt = nextStatusAfter(st);
                              if (useSlots && activeSlot !== 'all' && onCycleMySlotStatus) {
                                onCycleMySlotStatus(col.date, activeSlot, nextSt);
                              } else {
                                onCycleMyStatus(col.date, nextSt);
                              }
                            }}
                            className="w-full"
                          >
                            {cellContent}
                          </button>
                        ) : (
                          cellContent
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* Summary Footer Row */}
            <tr>
              <td className="sticky left-0 z-10 bg-white dark:bg-slate-900 shadow-[-6px_0_0_0_#fff,6px_0_0_0_#fff] dark:shadow-[-6px_0_0_0_#0f172a,6px_0_0_0_#0f172a] px-2.5 pt-2 text-xs font-bold text-stone-600 dark:text-slate-300">
                {t.matrix.totalAndVotes}
              </td>
              {columns.map((col) => {
                const voted = myVotedDates.has(col.date);
                const colYesCount =
                  useSlots && activeSlot !== 'all'
                    ? (col.slots?.[activeSlot]?.yes.length ?? 0)
                    : col.yes.length;
                return (
                  <td key={col.date} className="pt-2 text-center">
                    <div className="space-y-1">
                      <div className="text-xs font-extrabold text-teal-700 dark:text-teal-300 tabular-nums">
                        {colYesCount}/{participants.length}
                      </div>
                      <button
                        type="button"
                        disabled={!votingOpen}
                        onClick={() => onToggleVote(col.date)}
                        className={`inline-flex items-center justify-center gap-0.5 rounded-lg border px-2 py-0.5 text-[11px] font-bold transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                          voted
                            ? 'border-amber-400 bg-amber-400 text-amber-950'
                            : 'border-stone-200 dark:border-slate-700 text-stone-500 hover:border-amber-400 hover:text-amber-600'
                        }`}
                      >
                        <Star className={`h-3 w-3 ${voted ? 'fill-current' : ''}`} />
                        {blindVotingHidden ? (voted ? '✓' : '·') : col.votes.length}
                      </button>
                    </div>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
