import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Crown,
  Eraser,
  Eye,
  Filter,
  HelpCircle,
  MessageSquareText,
  Sparkles,
  Star,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type {
  AvailabilitySlot,
  AvailabilityStatus,
  DaySummary,
  HolidayCountry,
  Participant,
  PlanGranularity,
  SpecificSlot,
} from '../../shared/types';
import {
  addMonthsISO,
  buildMonthGrid,
  formatDateISO,
  getMonthLabel,
  getMonthShortLabel,
  getPlanTimeSlots,
  getWeekdaysShort,
  isFriSatSun,
  isSaturdayOrSunday,
  isSlotGranularity,
} from '../../shared/dates';
import { getHolidayInfo } from '../../shared/holidays';
import { useI18n } from '../lib/i18n';
import { Avatar } from './Avatar';

export type BrushMode = AvailabilityStatus | 'clear' | 'inspect';

interface InteractiveCalendarProps {
  currentMonth: string;
  onChangeMonth: (ym: string) => void;
  participants: Participant[];
  me: Participant | null;
  granularity: PlanGranularity;
  enabledSlots?: SpecificSlot[];
  activeSlot?: AvailabilitySlot;
  onChangeActiveSlot?: (slot: AvailabilitySlot) => void;
  holidayCountry: HolidayCountry;
  requiredParticipantIds: string[];
  onlineParticipantIds: Set<string>;
  myAvailabilityMap: Map<string, AvailabilityStatus>;
  mySlotAvailabilityMap: Map<string, AvailabilityStatus>; // key: `${date}:${slot}`
  summaries: Map<string, DaySummary>;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  confirmedDate: string | null;
  confirmedEndDate: string | null;
  highlightedRangeDates?: Set<string>;
  filterParticipantIds: string[];
  onToggleFilterParticipant: (id: string) => void;
  onClearFilters: () => void;
  onCommitAvailability: (
    changes: Array<{ date: string; slot?: AvailabilitySlot; status: AvailabilityStatus | null }>
  ) => void;
  canUndo: boolean;
  onUndo: () => void;
  onRequireIdentity: () => void;
  /** Mobile layout: no brush toolbar, tap opens the day, painting only while `paintMode` is on. */
  mobile?: boolean;
  paintMode?: boolean;
  mobileBrush?: AvailabilityStatus;
  onOpenDay?: (date: string) => void;
}

function getHeatmapClasses(
  ratio: number,
  hasAnyYesOrMaybe: boolean,
  isOnlyMineMode: boolean,
  myStatus: AvailabilityStatus | undefined,
  isDimmedByFilter: boolean
): string {
  if (isDimmedByFilter) {
    return 'bg-stone-100/50 dark:bg-slate-800/30 text-stone-400 dark:text-slate-600 opacity-45';
  }

  if (isOnlyMineMode) {
    if (myStatus === 'yes') {
      return 'bg-emerald-500/90 dark:bg-emerald-600/90 text-white border-emerald-600/40 shadow-xs';
    }
    if (myStatus === 'maybe') {
      return 'bg-amber-400/85 dark:bg-amber-500/80 text-amber-950 dark:text-slate-950 border-amber-500/40';
    }
    if (myStatus === 'no') {
      return 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/70';
    }
    return 'bg-white dark:bg-slate-900/70 text-stone-700 dark:text-slate-200 hover:bg-stone-50 dark:hover:bg-slate-800/80';
  }

  if (!hasAnyYesOrMaybe || ratio <= 0) {
    return 'bg-white dark:bg-slate-900/70 text-stone-700 dark:text-slate-200 hover:bg-stone-50 dark:hover:bg-slate-800/80';
  }
  if (ratio < 0.34) {
    return 'bg-teal-50 dark:bg-teal-950/55 text-teal-950 dark:text-teal-100 hover:bg-teal-100/80 dark:hover:bg-teal-950/80';
  }
  if (ratio < 0.62) {
    return 'bg-teal-100/95 dark:bg-teal-900/65 text-teal-950 dark:text-teal-50 hover:bg-teal-200/80 dark:hover:bg-teal-900/85';
  }
  if (ratio < 0.88) {
    return 'bg-teal-300/85 dark:bg-teal-700/80 text-teal-950 dark:text-white hover:bg-teal-300 dark:hover:bg-teal-700';
  }
  return 'bg-gradient-to-br from-teal-500 to-emerald-500 dark:from-teal-500 dark:to-emerald-600 text-white shadow-sm shadow-teal-600/20';
}

export function InteractiveCalendar({
  currentMonth,
  onChangeMonth,
  participants,
  me,
  granularity,
  enabledSlots,
  activeSlot: controlledActiveSlot,
  onChangeActiveSlot,
  holidayCountry,
  requiredParticipantIds,
  onlineParticipantIds,
  myAvailabilityMap,
  mySlotAvailabilityMap,
  summaries,
  selectedDate,
  onSelectDate,
  confirmedDate,
  confirmedEndDate,
  highlightedRangeDates,
  filterParticipantIds,
  onToggleFilterParticipant,
  onClearFilters,
  onCommitAvailability,
  canUndo,
  onUndo,
  onRequireIdentity,
  mobile = false,
  paintMode = false,
  mobileBrush = 'yes',
  onOpenDay,
}: InteractiveCalendarProps) {
  const { language, t } = useI18n();
  const [desktopBrush, setBrush] = useState<BrushMode>('yes');
  const [uncontrolledActiveSlot, setUncontrolledActiveSlot] = useState<AvailabilitySlot>('all');
  const [onlyMineMode, setOnlyMineMode] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  // On mobile, browsing never paints: the brush is only active inside "Mark my days" mode.
  const brush: BrushMode = mobile ? (paintMode ? mobileBrush : 'inspect') : desktopBrush;
  const mobileBrowsing = mobile && !paintMode;

  const useSlots = isSlotGranularity(granularity);
  const planSlots = useMemo(
    () => getPlanTimeSlots(granularity, enabledSlots, language),
    [granularity, enabledSlots, language]
  );
  const singleSlot = useSlots && planSlots.length === 1 ? planSlots[0] : null;
  const rawActiveSlot = controlledActiveSlot ?? uncontrolledActiveSlot;
  const activeSlot: AvailabilitySlot = !useSlots
    ? 'all'
    : singleSlot
      ? singleSlot.id
      : rawActiveSlot !== 'all' && planSlots.some((s) => s.id === rawActiveSlot)
        ? rawActiveSlot
        : 'all';
  const setActiveSlot = (next: AvailabilitySlot) => {
    if (onChangeActiveSlot) onChangeActiveSlot(next);
    else setUncontrolledActiveSlot(next);
  };

  const weekdaysShort = useMemo(() => getWeekdaysShort(language), [language]);

  // Drag-painting state (mouse + mobile touch)
  const isDraggingRef = useRef(false);
  const dragTargetStatusRef = useRef<AvailabilityStatus | null>(null);
  const [dragPreview, setDragPreview] = useState<Map<string, AvailabilityStatus | null>>(new Map());
  const dragPreviewRef = useRef<Map<string, AvailabilityStatus | null>>(new Map());
  const gridRef = useRef<HTMLDivElement | null>(null);

  const todayISO = useMemo(() => formatDateISO(new Date()), []);
  const cells = useMemo(() => buildMonthGrid(currentMonth, todayISO), [currentMonth, todayISO]);
  const requiredSet = useMemo(() => new Set(requiredParticipantIds), [requiredParticipantIds]);

  const effectiveSlot: AvailabilitySlot = useSlots ? activeSlot : 'all';

  function expandSlotChanges(
    dates: Array<{ date: string; status: AvailabilityStatus | null }>
  ): Array<{ date: string; slot: AvailabilitySlot; status: AvailabilityStatus | null }> {
    if (useSlots && activeSlot === 'all') {
      const out: Array<{ date: string; slot: AvailabilitySlot; status: AvailabilityStatus | null }> = [];
      for (const item of dates) {
        for (const s of planSlots) {
          out.push({ date: item.date, slot: s.id, status: item.status });
        }
        out.push({ date: item.date, slot: 'all', status: null });
      }
      return out;
    }
    return dates.map((item) => ({
      date: item.date,
      slot: effectiveSlot,
      status: item.status,
    }));
  }

  // Global pointerup finishes any active drag-paint
  useEffect(() => {
    function handlePointerUp() {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      const pending = dragPreviewRef.current;
      if (pending.size > 0) {
        const rawChanges = Array.from(pending.entries()).map(([date, status]) => ({
          date,
          status,
        }));
        onCommitAvailability(expandSlotChanges(rawChanges));
      }
      dragPreviewRef.current = new Map();
      setDragPreview(new Map());
    }

    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  });

  function getMyStatusForCurrentSlot(date: string): AvailabilityStatus | undefined {
    if (useSlots && activeSlot !== 'all') {
      return mySlotAvailabilityMap.get(`${date}:${activeSlot}`) ?? mySlotAvailabilityMap.get(`${date}:all`);
    }
    return myAvailabilityMap.get(date);
  }

  function startCellInteraction(date: string) {
    onSelectDate(date);
    if (brush === 'inspect') return;
    if (!me) {
      onRequireIdentity();
      return;
    }

    const currentStatus = getMyStatusForCurrentSlot(date);
    let nextStatus: AvailabilityStatus | null;
    if (brush === 'clear') {
      nextStatus = null;
    } else if (currentStatus === brush) {
      nextStatus = null;
    } else {
      nextStatus = brush;
    }

    isDraggingRef.current = true;
    dragTargetStatusRef.current = nextStatus;
    const nextMap = new Map<string, AvailabilityStatus | null>([[date, nextStatus]]);
    dragPreviewRef.current = nextMap;
    setDragPreview(nextMap);
  }

  function enterCellDuringDrag(date: string) {
    if (!isDraggingRef.current) return;
    if (dragPreviewRef.current.has(date)) return;
    onSelectDate(date);
    const nextMap = new Map(dragPreviewRef.current);
    nextMap.set(date, dragTargetStatusRef.current);
    dragPreviewRef.current = nextMap;
    setDragPreview(nextMap);
  }

  // Mobile touch drag support via elementFromPoint
  function handleGridPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cellEl = el?.closest<HTMLElement>('[data-calendar-date]');
    const date = cellEl?.dataset.calendarDate;
    if (date) {
      enterCellDuringDrag(date);
    }
  }

  function handlePaintWeekdayColumn(weekdayIdxMon: number) {
    if (!me) {
      onRequireIdentity();
      return;
    }
    const targets = cells.filter(
      (c) => c.inCurrentMonth && !c.isPast && c.weekdayIndexMon === weekdayIdxMon
    );
    if (targets.length === 0) return;

    const statusToApply: AvailabilityStatus | null =
      brush === 'inspect' ? 'yes' : brush === 'clear' ? null : brush;

    const allAlreadyMatch =
      statusToApply !== null &&
      targets.every((c) => getMyStatusForCurrentSlot(c.date) === statusToApply);
    const finalStatus = allAlreadyMatch ? null : statusToApply;

    onCommitAvailability(
      expandSlotChanges(targets.map((c) => ({ date: c.date, status: finalStatus })))
    );
  }

  function handlePaintWeekends() {
    if (!me) {
      onRequireIdentity();
      return;
    }
    const statusToApply: AvailabilityStatus | null =
      brush === 'clear' || brush === 'inspect' ? 'yes' : brush;
    const targets = cells.filter((c) => c.inCurrentMonth && !c.isPast && isFriSatSun(c.date));
    if (targets.length > 0) {
      onCommitAvailability(
        expandSlotChanges(targets.map((c) => ({ date: c.date, status: statusToApply })))
      );
    }
  }

  function handleClearCurrentMonth() {
    if (!me) {
      onRequireIdentity();
      return;
    }
    const targetDates = cells
      .filter(
        (c) =>
          c.inCurrentMonth &&
          (myAvailabilityMap.has(c.date) ||
            planSlots.some((s) => mySlotAvailabilityMap.has(`${c.date}:${s.id}`)))
      )
      .map((c) => c.date);
    if (targetDates.length === 0) return;

    const changes: Array<{ date: string; slot: AvailabilitySlot; status: AvailabilityStatus | null }> = [];
    for (const date of targetDates) {
      changes.push({ date, slot: 'all', status: null });
      if (useSlots) {
        for (const s of planSlots) {
          changes.push({ date, slot: s.id, status: null });
        }
      }
    }
    onCommitAvailability(changes);
  }

  const activeParticipantCount =
    filterParticipantIds.length > 0 ? filterParticipantIds.length : participants.length;

  const quickMonths = useMemo(() => {
    return [
      addMonthsISO(currentMonth, -1),
      currentMonth,
      addMonthsISO(currentMonth, 1),
      addMonthsISO(currentMonth, 2),
    ];
  }, [currentMonth]);

  return (
    <div className="space-y-4">
      {/* Brush & Mode Toolbar */}
      {!mobile && (
      <div className="rounded-2xl border border-stone-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3 sm:p-4 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-stone-500 dark:text-slate-400 mr-1 hidden sm:inline">
              {t.calendar.brushLabel}
            </span>
            {(
              [
                {
                  id: 'yes',
                  label: t.calendar.brushYes,
                  icon: Check,
                  active:
                    'bg-emerald-600 text-white border-emerald-600 shadow-xs shadow-emerald-600/20',
                  idle: 'bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border-emerald-200/80 dark:border-emerald-800/60 hover:bg-emerald-100 dark:hover:bg-emerald-950/70',
                },
                {
                  id: 'maybe',
                  label: t.calendar.brushMaybe,
                  icon: HelpCircle,
                  active: 'bg-amber-500 text-white border-amber-500 shadow-xs shadow-amber-500/20',
                  idle: 'bg-amber-50/80 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border-amber-200/80 dark:border-amber-800/60 hover:bg-amber-100 dark:hover:bg-amber-950/70',
                },
                {
                  id: 'no',
                  label: t.calendar.brushNo,
                  icon: X,
                  active: 'bg-rose-500 text-white border-rose-500 shadow-xs shadow-rose-500/20',
                  idle: 'bg-rose-50/80 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border-rose-200/80 dark:border-rose-800/60 hover:bg-rose-100 dark:hover:bg-rose-950/70',
                },
                {
                  id: 'clear',
                  label: t.calendar.brushClear,
                  icon: Eraser,
                  active:
                    'bg-stone-800 dark:bg-slate-200 text-white dark:text-slate-900 border-stone-800 dark:border-slate-200',
                  idle: 'bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-300 border-stone-200 dark:border-slate-700 hover:bg-stone-200/70 dark:hover:bg-slate-700',
                },
                {
                  id: 'inspect',
                  label: t.calendar.brushInspect,
                  icon: Eye,
                  active: 'bg-teal-700 text-white border-teal-700',
                  idle: 'bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-300 border-stone-200 dark:border-slate-700 hover:bg-stone-200/70 dark:hover:bg-slate-700',
                },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const isSelected = brush === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setBrush(item.id)}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    isSelected ? item.active : item.idle
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5">
            {canUndo && (
              <button
                type="button"
                onClick={onUndo}
                title={t.calendar.undoTitle}
                className="inline-flex items-center gap-1 rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-stone-100 dark:hover:bg-slate-700 px-2.5 py-1.5 text-xs font-semibold text-stone-700 dark:text-slate-200 transition cursor-pointer"
              >
                <Undo2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t.calendar.undoLabel}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setOnlyMineMode((v) => !v)}
              className={`rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                onlyMineMode
                  ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/70 text-teal-800 dark:text-teal-200'
                  : 'border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-stone-600 dark:text-slate-300 hover:bg-stone-50 dark:hover:bg-slate-700'
              }`}
            >
              {onlyMineMode ? t.calendar.viewOnlyMine : t.calendar.viewGroupAndMine}
            </button>
          </div>
        </div>

        {/* Time-Slot / Meal Selector (when granularity is 'slots' or 'meals') */}
        {useSlots && singleSlot && (
          <div className="flex items-center gap-2 border-t border-stone-100 dark:border-slate-800 pt-2.5 text-xs font-semibold text-teal-800 dark:text-teal-200">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 dark:border-teal-800/70 bg-teal-50/80 dark:bg-teal-950/50 px-3 py-1">
              {t.calendar.slotBannerSingle(singleSlot.emoji, singleSlot.label, singleSlot.hint)}
            </span>
          </div>
        )}
        {useSlots && planSlots.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-stone-100 dark:border-slate-800 pt-2.5">
            <span className="text-xs font-semibold text-stone-500 dark:text-slate-400 mr-1">
              {brush === 'inspect' ? t.calendar.slotFilterLabel : t.calendar.slotToPaint}
            </span>
            <button
              type="button"
              onClick={() => setActiveSlot('all')}
              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                activeSlot === 'all'
                  ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/70 text-teal-800 dark:text-teal-200'
                  : 'border-stone-200 dark:border-slate-700 text-stone-600 dark:text-slate-300'
              }`}
            >
              {brush === 'inspect'
                ? `✨ ${t.calendar.allSlotsBest}`
                : t.calendar.allActiveSlots(planSlots.map((s) => s.shortLabel).join('+'))}
            </button>
            {planSlots.map((slot) => (
              <button
                key={slot.id}
                type="button"
                onClick={() => setActiveSlot(slot.id)}
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
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

        {/* Tip + Quick Month Shortcuts */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 dark:border-slate-800 pt-2.5 text-xs text-stone-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-teal-500 shrink-0" />
            <span>
              {brush === 'inspect' ? t.calendar.tipInspect : t.calendar.tipDrag}
            </span>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePaintWeekends}
              className="rounded-lg bg-stone-100 dark:bg-slate-800 hover:bg-teal-50 dark:hover:bg-teal-950/60 hover:text-teal-700 dark:hover:text-teal-300 px-2.5 py-1 font-medium transition cursor-pointer"
            >
              {t.calendar.markWeekends}
            </button>
            <button
              type="button"
              onClick={handleClearCurrentMonth}
              className="inline-flex items-center gap-1 rounded-lg bg-stone-100 dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 hover:text-rose-600 dark:hover:text-rose-300 px-2.5 py-1 font-medium transition cursor-pointer"
            >
              <Trash2 className="h-3 w-3" />
              {t.calendar.clearMonth}
            </button>
          </div>
        </div>
      </div>
      )}

      {/* Main Calendar Card */}
      <div
        className={`rounded-3xl border border-stone-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-sm ${
          mobile ? 'p-3' : 'p-4 sm:p-5'
        }`}
      >
        {/* Compact mobile month header: < Month > · Filter · Only me */}
        {mobile && (
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-0.5">
              <button
                type="button"
                aria-label={t.calendar.prevMonthAria}
                onClick={() => onChangeMonth(addMonthsISO(currentMonth, -1))}
                className="flex h-10 w-9 items-center justify-center rounded-xl text-stone-600 dark:text-slate-300 active:bg-stone-100 dark:active:bg-slate-800 cursor-pointer"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => onChangeMonth(todayISO.slice(0, 7))}
                title={t.calendar.today}
                className="min-w-0 truncate px-1 font-display text-base font-extrabold tracking-tight first-letter:uppercase cursor-pointer"
              >
                {getMonthLabel(currentMonth, language)}
              </button>
              <button
                type="button"
                aria-label={t.calendar.nextMonthAria}
                onClick={() => onChangeMonth(addMonthsISO(currentMonth, 1))}
                className="flex h-10 w-9 items-center justify-center rounded-xl text-stone-600 dark:text-slate-300 active:bg-stone-100 dark:active:bg-slate-800 cursor-pointer"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {participants.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFilterOpen((v) => !v)}
                  aria-pressed={filterOpen || filterParticipantIds.length > 0}
                  aria-label={t.mobile.filter}
                  className={`inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold transition cursor-pointer ${
                    filterOpen || filterParticipantIds.length > 0
                      ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/70 text-teal-800 dark:text-teal-200'
                      : 'border-stone-200 dark:border-slate-700 text-stone-600 dark:text-slate-300'
                  }`}
                >
                  <Filter className="h-3.5 w-3.5" />
                  <span className="hidden min-[430px]:inline">{t.mobile.filter}</span>
                  {filterParticipantIds.length > 0 && (
                    <span className="tabular-nums">· {filterParticipantIds.length}</span>
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={() => setOnlyMineMode((v) => !v)}
                aria-pressed={onlyMineMode}
                className={`inline-flex h-8 items-center rounded-full border px-2.5 text-xs font-semibold transition cursor-pointer ${
                  onlyMineMode
                    ? 'border-teal-500 bg-teal-600 text-white'
                    : 'border-stone-200 dark:border-slate-700 text-stone-600 dark:text-slate-300'
                }`}
              >
                {t.mobile.onlyMe}
              </button>
            </div>
          </div>
        )}

        {/* Mobile friend filter strip (horizontal scroll) */}
        {mobile && participants.length > 0 && (filterOpen || filterParticipantIds.length > 0) && (
          <div className="-mx-3 mb-2.5 flex gap-1.5 overflow-x-auto no-scrollbar px-3 pb-0.5 animate-fade-in">
            {filterParticipantIds.length > 0 && (
              <button
                type="button"
                onClick={onClearFilters}
                className="shrink-0 rounded-full border border-stone-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-teal-700 dark:text-teal-300 cursor-pointer"
              >
                {t.calendar.showAllGroup}
              </button>
            )}
            {participants.map((p) => {
              const active = filterParticipantIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onToggleFilterParticipant(p.id)}
                  aria-pressed={active}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border pl-1 pr-3 py-1 text-xs font-medium transition cursor-pointer ${
                    active
                      ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/70 text-teal-900 dark:text-teal-100'
                      : 'border-stone-200 dark:border-slate-700 bg-stone-50/70 dark:bg-slate-800/60 text-stone-700 dark:text-slate-300'
                  }`}
                >
                  <Avatar
                    participant={p}
                    size="xs"
                    online={onlineParticipantIds.has(p.id)}
                    required={requiredSet.has(p.id)}
                  />
                  <span className="max-w-[90px] truncate">{p.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Mobile slot strip: visible both while browsing (filter heatmap) and painting */}
        {mobile && useSlots && singleSlot && (
          <div className="mb-2.5 flex items-center">
            <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 dark:border-teal-800/70 bg-teal-50/80 dark:bg-teal-950/50 px-2.5 py-1 text-[11px] font-semibold text-teal-800 dark:text-teal-200">
              {t.calendar.slotBannerSingle(singleSlot.emoji, singleSlot.label, singleSlot.hint)}
            </span>
          </div>
        )}
        {mobile && useSlots && planSlots.length > 1 && (
          <div className="-mx-3 mb-2.5 flex gap-1.5 overflow-x-auto no-scrollbar px-3 animate-fade-in">
            <button
              type="button"
              onClick={() => setActiveSlot('all')}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                activeSlot === 'all'
                  ? 'border-teal-500 bg-teal-600 text-white'
                  : 'border-stone-200 dark:border-slate-700 text-stone-600 dark:text-slate-300'
              }`}
            >
              {paintMode
                ? t.calendar.allActiveSlots(planSlots.map((s) => s.shortLabel).join('+'))
                : `✨ ${t.calendar.allSlotsBest}`}
            </button>
            {planSlots.map((slot) => (
              <button
                key={slot.id}
                type="button"
                onClick={() => setActiveSlot(slot.id)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  activeSlot === slot.id
                    ? 'border-teal-500 bg-teal-600 text-white'
                    : 'border-stone-200 dark:border-slate-700 text-stone-600 dark:text-slate-300'
                }`}
              >
                {slot.emoji} {slot.label}
              </button>
            ))}
          </div>
        )}

        {/* Mobile paint-mode extras: quick bulk actions */}
        {mobile && paintMode && (
          <div className="-mx-3 mb-2.5 flex gap-1.5 overflow-x-auto no-scrollbar px-3 animate-fade-in">
            <button
              type="button"
              onClick={handlePaintWeekends}
              className="shrink-0 rounded-full bg-stone-100 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-stone-700 dark:text-slate-200 cursor-pointer"
            >
              {t.calendar.markWeekends}
            </button>
            <button
              type="button"
              onClick={handleClearCurrentMonth}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-stone-100 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-stone-700 dark:text-slate-200 cursor-pointer"
            >
              <Trash2 className="h-3 w-3" />
              {t.calendar.clearMonth}
            </button>
          </div>
        )}

        {/* Month Header */}
        {!mobile && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={t.calendar.prevMonthAria}
              onClick={() => onChangeMonth(addMonthsISO(currentMonth, -1))}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200 dark:border-slate-700 hover:bg-stone-100 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              <ChevronLeft className="h-4.5 w-4.5" />
            </button>
            <h2 className="font-display text-lg sm:text-xl font-extrabold tracking-tight min-w-[165px] text-center">
              {getMonthLabel(currentMonth, language)}
            </h2>
            <button
              type="button"
              aria-label={t.calendar.nextMonthAria}
              onClick={() => onChangeMonth(addMonthsISO(currentMonth, 1))}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200 dark:border-slate-700 hover:bg-stone-100 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              <ChevronRight className="h-4.5 w-4.5" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto">
            <button
              type="button"
              onClick={() => onChangeMonth(todayISO.slice(0, 7))}
              className="rounded-xl border border-stone-200 dark:border-slate-700 px-2.5 py-1 text-xs font-semibold hover:bg-stone-100 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              {t.calendar.today}
            </button>
            <div className="hidden md:flex items-center gap-1">
              {quickMonths.map((ym) => (
                <button
                  key={ym}
                  type="button"
                  onClick={() => onChangeMonth(ym)}
                  className={`rounded-xl px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                    ym === currentMonth
                      ? 'bg-teal-600 text-white'
                      : 'text-stone-500 dark:text-slate-400 hover:bg-stone-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {getMonthShortLabel(ym, language)}
                </button>
              ))}
            </div>
          </div>
        </div>
        )}

        {/* Interactive Weekday Headers (click to paint entire weekday column!) */}
        <div className={`grid grid-cols-7 mb-1.5 ${mobile ? 'gap-1' : 'gap-1.5 sm:gap-2'}`}>
          {weekdaysShort.map((wd, idx) =>
            mobileBrowsing ? (
              <span
                key={`${idx}-${wd}`}
                className={`text-center text-[10px] font-bold uppercase tracking-wider py-1 ${
                  idx >= 5 ? 'text-teal-700 dark:text-teal-400' : 'text-stone-400 dark:text-slate-500'
                }`}
              >
                {wd}
              </span>
            ) : (
            <button
              key={`${idx}-${wd}`}
              type="button"
              onClick={() => handlePaintWeekdayColumn(idx)}
              title={t.calendar.weekdayColumnTitle(wd)}
              className={`rounded-lg text-center text-[11px] font-bold uppercase tracking-wider py-1 transition cursor-pointer hover:bg-teal-50 dark:hover:bg-teal-950/50 ${
                idx >= 5
                  ? 'text-teal-700 dark:text-teal-400'
                  : 'text-stone-400 dark:text-slate-500 hover:text-teal-700 dark:hover:text-teal-300'
              }`}
            >
              {wd}
            </button>
            )
          )}
        </div>

        {/* Day Grid (supports both mouse and mobile finger drag-painting!) */}
        <div
          ref={gridRef}
          onPointerMove={handleGridPointerMove}
          className={`grid grid-cols-7 calendar-no-select ${mobile ? 'gap-1' : 'gap-1.5 sm:gap-2'} ${
            brush !== 'inspect' ? 'touch-none' : 'touch-pan-y'
          }`}
        >
          {cells.map((cell, cellIdx) => {
            const summary = summaries.get(cell.date);
            const focusedSlotSummary =
              useSlots && activeSlot !== 'all' ? summary?.slots?.[activeSlot] : undefined;
            const hasDragOverride = dragPreview.has(cell.date);
            const effectiveMyStatus = hasDragOverride
              ? dragPreview.get(cell.date) ?? undefined
              : getMyStatusForCurrentSlot(cell.date);

            const displayYes = focusedSlotSummary ? focusedSlotSummary.yes : summary?.yes ?? [];
            const displayMaybe = focusedSlotSummary
              ? focusedSlotSummary.maybe
              : summary?.maybe ?? [];
            const yesCount = displayYes.length;
            const maybeCount = displayMaybe.length;
            const voteCount = summary?.votes.length ?? 0;
            const ratio = focusedSlotSummary ? focusedSlotSummary.ratio : summary?.ratio ?? 0;
            const hasAny = yesCount > 0 || maybeCount > 0;
            const isSelected = selectedDate === cell.date;
            const isConfirmed =
              confirmedDate !== null &&
              (confirmedEndDate
                ? cell.date >= confirmedDate && cell.date <= confirmedEndDate
                : cell.date === confirmedDate);
            const isInHighlightedRange = highlightedRangeDates?.has(cell.date) ?? false;
            const isWeekendReal = isSaturdayOrSunday(cell.date);
            const holiday = getHolidayInfo(cell.date, holidayCountry, language);

            const slotMatchesFilter =
              focusedSlotSummary !== undefined
                ? activeParticipantCount > 0 && yesCount === activeParticipantCount
                : summary?.allFilteredAvailable ?? false;
            const isDimmedByFilter = filterParticipantIds.length > 0 && !slotMatchesFilter;
            const isPerfectMatch =
              filterParticipantIds.length > 0
                ? slotMatchesFilter
                : activeParticipantCount >= 2 && yesCount === activeParticipantCount;
            const slotAllRequired =
              focusedSlotSummary !== undefined
                ? focusedSlotSummary.allRequiredAvailable
                : summary?.allRequiredAvailable ?? true;
            const missingRequired = requiredSet.size > 0 && hasAny && !slotAllRequired;

            const heatmapClass = getHeatmapClasses(
              ratio,
              hasAny,
              onlyMineMode,
              effectiveMyStatus,
              isDimmedByFilter
            );

            const isHighContrastBg =
              (!onlyMineMode && ratio >= 0.88 && !isDimmedByFilter) ||
              (onlyMineMode && effectiveMyStatus === 'yes' && !isDimmedByFilter);

            return (
              <div
                key={cell.date}
                data-calendar-date={cell.date}
                role="button"
                tabIndex={0}
                aria-label={t.calendar.cellAriaLabel({
                  date: cell.date,
                  holidayName: holiday?.name,
                  yesCount,
                  maybeCount,
                  voteCount,
                })}
                onPointerDown={(e) => {
                  if (mobileBrowsing) return;
                  if (brush !== 'inspect') e.preventDefault();
                  startCellInteraction(cell.date);
                }}
                onClick={() => {
                  if (!mobileBrowsing) return;
                  onSelectDate(cell.date);
                  onOpenDay?.(cell.date);
                }}
                onPointerEnter={() => enterCellDuringDrag(cell.date)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (mobileBrowsing) {
                      onSelectDate(cell.date);
                      onOpenDay?.(cell.date);
                      return;
                    }
                    startCellInteraction(cell.date);
                    isDraggingRef.current = false;
                    const pending = dragPreviewRef.current;
                    if (pending.size > 0) {
                      onCommitAvailability(
                        expandSlotChanges(
                          Array.from(pending.entries()).map(([d, st]) => ({ date: d, status: st }))
                        )
                      );
                      dragPreviewRef.current = new Map();
                      setDragPreview(new Map());
                    }
                    return;
                  }
                  const offsets: Record<string, number> = {
                    ArrowLeft: -1,
                    ArrowRight: 1,
                    ArrowUp: -7,
                    ArrowDown: 7,
                  };
                  if (e.key in offsets) {
                    e.preventDefault();
                    const nextIdx = cellIdx + offsets[e.key];
                    const target = gridRef.current?.children[nextIdx] as HTMLElement | undefined;
                    if (target) {
                      target.focus();
                      const d = target.dataset.calendarDate;
                      if (d) onSelectDate(d);
                    }
                  }
                }}
                className={`group relative flex flex-col justify-between border transition-all cursor-pointer ${
                  mobile
                    ? 'rounded-xl p-1 min-h-[54px] active:scale-[0.96]'
                    : 'rounded-2xl p-1.5 sm:p-2 min-h-[70px] sm:min-h-[88px]'
                } ${heatmapClass} ${
                  !cell.inCurrentMonth ? 'opacity-40' : ''
                } ${
                  cell.isPast && !hasAny && !effectiveMyStatus ? 'opacity-55' : ''
                } ${
                  isConfirmed
                    ? 'ring-2 ring-amber-400 dark:ring-amber-400 border-amber-400 shadow-md shadow-amber-500/20'
                    : isInHighlightedRange
                      ? 'ring-2 ring-indigo-500 dark:ring-indigo-400 border-indigo-400 z-10'
                      : isSelected
                        ? 'ring-2 ring-teal-600 dark:ring-teal-400 border-teal-500 z-10'
                        : isPerfectMatch && !onlyMineMode
                          ? 'border-emerald-500/70 dark:border-emerald-400/60'
                          : 'border-stone-200/80 dark:border-slate-800'
                }`}
              >
                {/* Top row: Day number + holiday dot + personal status */}
                <div className="flex items-start justify-between gap-1">
                  <div className="flex items-center gap-1 min-w-0">
                    <span
                      className={`tabular-nums text-xs sm:text-sm font-bold leading-none ${
                        cell.isToday
                          ? isHighContrastBg
                            ? 'underline decoration-2 underline-offset-4'
                            : 'text-teal-600 dark:text-teal-300 underline decoration-2 underline-offset-4'
                          : holiday && !isHighContrastBg
                            ? 'text-rose-600 dark:text-rose-400'
                            : isWeekendReal && !isHighContrastBg
                              ? 'text-teal-900 dark:text-teal-200'
                              : ''
                      }`}
                    >
                      {cell.dayNumber}
                    </span>
                    {isConfirmed && (
                      <Crown className="h-3.5 w-3.5 text-amber-400 drop-shadow-xs shrink-0" />
                    )}
                    {holiday && (
                      <span
                        title={t.calendar.holidayPrefix(holiday.name)}
                        className="h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0"
                      />
                    )}
                    {summary?.hasNotes && !mobile && (
                      <span title={t.calendar.hasNotesTitle} className="shrink-0">
                        <MessageSquareText
                          className={`h-3 w-3 ${
                            isHighContrastBg ? 'text-white/85' : 'text-teal-600 dark:text-teal-400'
                          }`}
                        />
                      </span>
                    )}
                  </div>

                  {effectiveMyStatus && (
                    <span
                      title={
                        effectiveMyStatus === 'yes'
                          ? t.calendar.myStatusYes
                          : effectiveMyStatus === 'maybe'
                            ? t.calendar.myStatusMaybe
                            : t.calendar.myStatusNo
                      }
                      className={`flex items-center justify-center rounded-full font-bold shadow-2xs ring-1 ring-white/80 dark:ring-slate-900/80 shrink-0 ${
                        mobile ? 'h-3.5 w-3.5 text-[8px]' : 'h-4.5 w-4.5 sm:h-5 sm:w-5 text-[10px]'
                      } ${
                        effectiveMyStatus === 'yes'
                          ? 'bg-emerald-600 text-white'
                          : effectiveMyStatus === 'maybe'
                            ? 'bg-amber-400 text-amber-950'
                            : 'bg-rose-500 text-white'
                      }`}
                    >
                      {effectiveMyStatus === 'yes' ? (
                        <Check className="h-2.5 w-2.5 stroke-[3]" />
                      ) : effectiveMyStatus === 'maybe' ? (
                        '?'
                      ) : (
                        <X className="h-2.5 w-2.5 stroke-[3]" />
                      )}
                    </span>
                  )}
                </div>

                {/* Middle: Holiday short label OR Dynamic Time-Slot Mini Bars */}
                {useSlots && planSlots.length > 1 ? (
                  <div
                    className="my-1 grid gap-0.5"
                    style={{
                      gridTemplateColumns: `repeat(${planSlots.length}, minmax(0, 1fr))`,
                    }}
                  >
                    {planSlots.map((slot) => {
                      const sSummary = summary?.slots?.[slot.id];
                      const mySlotSt =
                        mySlotAvailabilityMap.get(`${cell.date}:${slot.id}`) ??
                        mySlotAvailabilityMap.get(`${cell.date}:all`);
                      const isFocusedSlot = activeSlot === slot.id;
                      const slotActive = onlyMineMode
                        ? mySlotSt === 'yes'
                          ? 'bg-emerald-400'
                          : mySlotSt === 'maybe'
                            ? 'bg-amber-300'
                            : mySlotSt === 'no'
                              ? 'bg-rose-400'
                              : 'bg-stone-200/70 dark:bg-slate-700/70'
                        : (sSummary?.ratio ?? 0) >= 0.75
                          ? 'bg-emerald-500'
                          : (sSummary?.ratio ?? 0) > 0
                            ? 'bg-teal-400/80'
                            : 'bg-stone-200/60 dark:bg-slate-700/50';
                      return (
                        <span
                          key={slot.id}
                          title={t.calendar.slotAvailableTitle(slot.label, sSummary?.yes.length ?? 0)}
                          className={`h-1.5 rounded-full transition-opacity ${slotActive} ${
                            activeSlot !== 'all' && !isFocusedSlot ? 'opacity-35' : ''
                          } ${isFocusedSlot ? 'ring-1 ring-teal-700/60 dark:ring-white/70' : ''}`}
                        />
                      );
                    })}
                  </div>
                ) : holiday ? (
                  <span
                    title={holiday.name}
                    className={`hidden sm:block text-[9px] font-semibold truncate leading-tight ${
                      isHighContrastBg ? 'text-white/90' : 'text-rose-600/85 dark:text-rose-300/90'
                    }`}
                  >
                    {holiday.name}
                  </span>
                ) : null}

                {/* Bottom row: Friend dots + consensus count + vote star */}
                <div className={`mt-auto pt-0.5 flex items-end justify-between ${mobile ? 'gap-0.5' : 'gap-1'}`}>
                  {!onlyMineMode && (yesCount > 0 || maybeCount > 0) ? (
                    <div className="flex items-center gap-1 min-w-0">
                      <div className="hidden sm:flex items-center -space-x-1">
                        {displayYes.slice(0, 3).map((p) => (
                          <span
                            key={p.id}
                            style={{ backgroundColor: p.avatarColor }}
                            className="h-2.5 w-2.5 rounded-full ring-1 ring-white/90 dark:ring-slate-900/90"
                          />
                        ))}
                        {displayMaybe.slice(0, Math.max(0, 3 - displayYes.length)).map((p) => (
                          <span
                            key={p.id}
                            style={{ backgroundColor: p.avatarColor }}
                            className="h-2.5 w-2.5 rounded-full opacity-55 ring-1 ring-amber-300"
                          />
                        ))}
                      </div>
                      <span
                        className={`tabular-nums text-[10px] sm:text-[11px] font-bold leading-none ${
                          missingRequired
                            ? 'line-through opacity-75'
                            : isHighContrastBg
                              ? 'text-white/95'
                              : 'text-teal-900/80 dark:text-teal-100/90'
                        }`}
                        title={missingRequired ? t.calendar.missingRequiredTitle : undefined}
                      >
                        {yesCount}
                        {maybeCount > 0 ? `+${maybeCount}` : ''}
                      </span>
                    </div>
                  ) : (
                    <span />
                  )}

                  {voteCount > 0 && mobile && (
                    <span
                      title={t.common.votes(voteCount)}
                      className={`inline-flex shrink-0 items-center gap-px text-[10px] font-extrabold leading-none tabular-nums ${
                        isHighContrastBg ? 'text-amber-200' : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      <Star className="h-2 w-2 fill-current" />
                      {voteCount}
                    </span>
                  )}
                  {voteCount > 0 && !mobile && (
                    <span
                      title={t.common.votes(voteCount)}
                      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                        isHighContrastBg
                          ? 'bg-amber-300 text-amber-950'
                          : 'bg-amber-100 dark:bg-amber-900/70 text-amber-800 dark:text-amber-200'
                      }`}
                    >
                      <Star className="h-2.5 w-2.5 fill-current" />
                      {voteCount}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend Row */}
        <div
          className={`flex flex-wrap items-center justify-between border-t border-stone-100 dark:border-slate-800 text-stone-500 dark:text-slate-400 ${
            mobile ? 'mt-3 gap-x-3 gap-y-1.5 pt-2.5 text-[10px]' : 'mt-4 gap-3 pt-3 text-[11px]'
          }`}
        >
          <div className="flex items-center gap-2">
            <span>{t.calendar.legendLess}</span>
            <div className="flex items-center gap-1">
              <span className="h-3.5 w-3.5 rounded-md border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900" />
              <span className="h-3.5 w-3.5 rounded-md bg-teal-50 dark:bg-teal-950/60 border border-teal-200/50" />
              <span className="h-3.5 w-3.5 rounded-md bg-teal-100 dark:bg-teal-900/70" />
              <span className="h-3.5 w-3.5 rounded-md bg-teal-300 dark:bg-teal-700" />
              <span className="h-3.5 w-3.5 rounded-md bg-gradient-to-br from-teal-500 to-emerald-500" />
            </div>
            <span>{t.calendar.legendAll}</span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {holidayCountry !== 'none' && (
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                {t.calendar.legendHoliday}
              </span>
            )}
            {useSlots && planSlots.length > 1 && (
              <span className="inline-flex items-center gap-1">
                <span className="inline-flex gap-0.5">
                  {planSlots.map((s, idx) => (
                    <span
                      key={s.id}
                      className={`h-1.5 w-2 rounded-full ${
                        idx === 0
                          ? 'bg-emerald-500'
                          : idx === 1
                            ? 'bg-teal-400'
                            : 'bg-stone-300 dark:bg-slate-600'
                      }`}
                    />
                  ))}
                </span>
                {planSlots.map((s) => s.shortLabel).join(' · ')}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
              {t.calendar.legendVotes}
            </span>
          </div>
        </div>
      </div>

      {/* Friend Intersection Filter Bar */}
      {participants.length > 0 && !mobile && (
        <div className="rounded-2xl border border-stone-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3.5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-700 dark:text-slate-200">
              <Filter className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
              <span>
                {filterParticipantIds.length > 0
                  ? t.calendar.filterActive(filterParticipantIds.length)
                  : t.calendar.filterPrompt}
              </span>
            </div>
            {filterParticipantIds.length > 0 && (
              <button
                type="button"
                onClick={onClearFilters}
                className="text-xs font-semibold text-teal-700 dark:text-teal-300 hover:underline cursor-pointer"
              >
                {t.calendar.showAllGroup}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {participants.map((p) => {
              const active = filterParticipantIds.includes(p.id);
              const isOnline = onlineParticipantIds.has(p.id);
              const isReq = requiredSet.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onToggleFilterParticipant(p.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border pl-1 pr-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                    active
                      ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/70 text-teal-900 dark:text-teal-100 ring-2 ring-teal-500/20'
                      : 'border-stone-200 dark:border-slate-700 bg-stone-50/70 dark:bg-slate-800/60 text-stone-700 dark:text-slate-300 hover:bg-stone-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Avatar participant={p} size="xs" online={isOnline} required={isReq} />
                  <span>{p.name}</span>
                  {me?.id === p.id && (
                    <span className="text-[10px] text-stone-400 dark:text-slate-400">
                      {t.common.youTag}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
