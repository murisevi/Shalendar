import type {
  AvailabilityEntry,
  AvailabilityStatus,
  DateRangeSummary,
  DaySummary,
  HolidayCountry,
  Participant,
  PlanGranularity,
  PollOption,
  SlotDaySummary,
  VoteEntry,
} from './types.js';
import { getHolidayInfo } from './holidays.js';

export const AVATAR_COLORS = [
  '#0D9488', // teal
  '#2563EB', // blue
  '#D97706', // amber
  '#E11D48', // rose
  '#7C3AED', // violet
  '#059669', // emerald
  '#EA580C', // orange
  '#0284C7', // sky
  '#DB2777', // pink
  '#4F46E5', // indigo
];

export const AVATAR_EMOJIS = [
  '😎', '🦊', '🐱', '🐻', '🦁', '🐼', '🐸', '🐙', '🦄', '🌟', '🔥', '🌿',
];

export const PLAN_EMOJIS = [
  '🍕', '🏔️', '🍻', '🏖️', '🎲', '🎬', '☕', '✈️', '🎸', '🍝', '🎉', '🏕️',
];

export const TIME_SLOTS: Array<{
  id: 'morning' | 'afternoon' | 'evening';
  label: string;
  shortLabel: string;
  emoji: string;
  hint: string;
}> = [
  { id: 'morning', label: 'Mañana', shortLabel: 'M', emoji: '☀️', hint: '09:00–14:00' },
  { id: 'afternoon', label: 'Tarde', shortLabel: 'T', emoji: '🌤️', hint: '14:00–20:00' },
  { id: 'evening', label: 'Noche', shortLabel: 'N', emoji: '🌙', hint: '20:00+' },
];

export const WEEKDAYS_SHORT_ES = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
export const WEEKDAYS_LONG_ES = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
];
export const MONTHS_LONG_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
export const MONTHS_SHORT_ES = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatDateISO(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function formatMonthISO(year: number, monthIndex0: number): string {
  return `${year}-${pad2(monthIndex0 + 1)}`;
}

export function parseDateISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDaysISO(iso: string, delta: number): string {
  const d = parseDateISO(iso);
  d.setDate(d.getDate() + delta);
  return formatDateISO(d);
}

export function parseMonthISO(ym: string): { year: number; month: number } {
  const [y, m] = ym.split('-').map(Number);
  return { year: y, month: (m || 1) - 1 };
}

export function addMonthsISO(ym: string, delta: number): string {
  const { year, month } = parseMonthISO(ym);
  const d = new Date(year, month + delta, 1);
  return formatMonthISO(d.getFullYear(), d.getMonth());
}

export function getMonthLabelEs(ym: string): string {
  const { year, month } = parseMonthISO(ym);
  const name = MONTHS_LONG_ES[month] ?? '';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}

export function formatDateLongEs(iso: string): string {
  const d = parseDateISO(iso);
  const wd = WEEKDAYS_LONG_ES[d.getDay()];
  const day = d.getDate();
  const month = MONTHS_LONG_ES[d.getMonth()];
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${day} de ${month}`;
}

export function formatDateRangeEs(startIso: string, endIso: string | null | undefined): string {
  if (!endIso || endIso <= startIso) return formatDateLongEs(startIso);
  const s = parseDateISO(startIso);
  const e = parseDateISO(endIso);
  const sWd = WEEKDAYS_LONG_ES[s.getDay()].slice(0, 3);
  const eWd = WEEKDAYS_LONG_ES[e.getDay()].slice(0, 3);
  const cap = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${cap(sWd)} ${s.getDate()} – ${cap(eWd)} ${e.getDate()} de ${MONTHS_LONG_ES[s.getMonth()]}`;
  }
  return `${cap(sWd)} ${s.getDate()} ${MONTHS_SHORT_ES[s.getMonth()]} – ${cap(eWd)} ${e.getDate()} ${MONTHS_SHORT_ES[e.getMonth()]}`;
}

export function formatDateShortPartsEs(iso: string): {
  weekday: string;
  day: number;
  month: string;
  year: number;
} {
  const d = parseDateISO(iso);
  const wd = WEEKDAYS_LONG_ES[d.getDay()].slice(0, 3).toUpperCase();
  return {
    weekday: wd,
    day: d.getDate(),
    month: MONTHS_SHORT_ES[d.getMonth()].toUpperCase(),
    year: d.getFullYear(),
  };
}

export interface CalendarCell {
  date: string; // YYYY-MM-DD
  dayNumber: number;
  weekdayIndexMon: number; // 0 = Mon .. 6 = Sun
  inCurrentMonth: boolean;
  isWeekend: boolean;
  isToday: boolean;
  isPast: boolean;
}

/**
 * Generates a Monday-first 6-row (or 5-row) calendar grid for the given YYYY-MM.
 */
export function buildMonthGrid(ym: string, todayISO = formatDateISO(new Date())): CalendarCell[] {
  const { year, month } = parseMonthISO(ym);
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const startOffset = (firstDay.getDay() + 6) % 7;
  const totalDays = lastDay.getDate();
  const totalCells = Math.ceil((startOffset + totalDays) / 7) * 7;

  const cells: CalendarCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(year, month, 1 - startOffset + i);
    const iso = formatDateISO(d);
    const dow = d.getDay();
    cells.push({
      date: iso,
      dayNumber: d.getDate(),
      weekdayIndexMon: (dow + 6) % 7,
      inCurrentMonth: d.getMonth() === month,
      isWeekend: dow === 0 || dow === 6,
      isToday: iso === todayISO,
      isPast: iso < todayISO,
    });
  }
  return cells;
}

export function isSaturdayOrSunday(iso: string): boolean {
  const dow = parseDateISO(iso).getDay();
  return dow === 0 || dow === 6;
}

export function isFriSatSun(iso: string): boolean {
  const dow = parseDateISO(iso).getDay();
  return dow === 5 || dow === 6 || dow === 0;
}

export function isVotingEffectivelyOpen(plan: {
  votingOpen: boolean;
  votingDeadline?: string | null;
}): boolean {
  if (!plan.votingOpen) return false;
  if (plan.votingDeadline) {
    const deadlineMs = Date.parse(plan.votingDeadline);
    if (!Number.isNaN(deadlineMs) && Date.now() >= deadlineMs) {
      return false;
    }
  }
  return true;
}

/**
 * Resolves a participant's effective day-level status when granularity is 'slots' or 'day'.
 */
function resolveDayStatus(
  entries: AvailabilityEntry[] | undefined,
  granularity: PlanGranularity
): AvailabilityStatus | null {
  if (!entries || entries.length === 0) return null;
  if (granularity === 'day') {
    const allEntry = entries.find((e) => e.slot === 'all') ?? entries[0];
    return allEntry?.status ?? null;
  }
  // In slots mode: if any slot is 'yes' -> 'yes'; else if any 'maybe' -> 'maybe'; else if any 'no' -> 'no'
  if (entries.some((e) => e.status === 'yes')) return 'yes';
  if (entries.some((e) => e.status === 'maybe')) return 'maybe';
  if (entries.some((e) => e.status === 'no')) return 'no';
  return null;
}

/**
 * Computes rich per-day availability, slot summaries, notes, required-attendee checks, and votes.
 */
export function computeDaySummaries(params: {
  participants: Participant[];
  availabilities: AvailabilityEntry[];
  votes: VoteEntry[];
  pollOptions: PollOption[];
  filterParticipantIds?: string[];
  requiredParticipantIds?: string[];
  granularity?: PlanGranularity;
  extraDates?: string[];
}): Map<string, DaySummary> {
  const {
    participants,
    availabilities,
    votes,
    pollOptions,
    filterParticipantIds = [],
    requiredParticipantIds = [],
    granularity = 'day',
    extraDates = [],
  } = params;

  const filterSet = new Set(filterParticipantIds);
  const activeParticipants =
    filterSet.size > 0
      ? participants.filter((p) => filterSet.has(p.id))
      : participants;
  const activeIds = new Set(activeParticipants.map((p) => p.id));
  const participantById = new Map(participants.map((p) => [p.id, p]));
  const pollOptionByDate = new Map(pollOptions.map((o) => [o.date, o]));

  const validRequiredIds = requiredParticipantIds.filter((id) => participantById.has(id));

  const allDates = new Set<string>(extraDates);
  for (const a of availabilities) allDates.add(a.date);
  for (const v of votes) allDates.add(v.date);
  for (const o of pollOptions) allDates.add(o.date);

  const availByDate = new Map<string, Map<string, AvailabilityEntry[]>>();
  for (const a of availabilities) {
    let byPart = availByDate.get(a.date);
    if (!byPart) {
      byPart = new Map();
      availByDate.set(a.date, byPart);
    }
    const list = byPart.get(a.participantId) ?? [];
    list.push({ ...a, slot: a.slot || 'all' });
    byPart.set(a.participantId, list);
  }

  const votesByDate = new Map<string, Participant[]>();
  for (const v of votes) {
    const p = participantById.get(v.participantId);
    if (!p) continue;
    const arr = votesByDate.get(v.date) ?? [];
    arr.push(p);
    votesByDate.set(v.date, arr);
  }

  const result = new Map<string, DaySummary>();
  const denom = Math.max(activeParticipants.length, 1);

  for (const date of allDates) {
    const byPart = availByDate.get(date);
    const yes: Participant[] = [];
    const maybe: Participant[] = [];
    const no: Participant[] = [];
    const pending: Participant[] = [];
    const notesByParticipant: Record<string, string> = {};

    // Collect notes across all participants on this day
    if (byPart) {
      for (const [pid, entries] of byPart.entries()) {
        const note = entries.map((e) => e.note?.trim()).find(Boolean);
        if (note) notesByParticipant[pid] = note;
      }
    }

    for (const p of activeParticipants) {
      const entries = byPart?.get(p.id);
      const effective = resolveDayStatus(entries, granularity);
      if (!effective) {
        pending.push(p);
      } else if (effective === 'yes') {
        yes.push(p);
      } else if (effective === 'maybe') {
        maybe.push(p);
      } else {
        no.push(p);
      }
    }

    // Check required attendees against full participant pool (not just filtered)
    let allRequiredAvailable = true;
    if (validRequiredIds.length > 0) {
      for (const reqId of validRequiredIds) {
        const st = resolveDayStatus(byPart?.get(reqId), granularity);
        if (st !== 'yes') {
          allRequiredAvailable = false;
          break;
        }
      }
    }

    // Optional slot-level breakdown
    let slots: Record<'morning' | 'afternoon' | 'evening', SlotDaySummary> | undefined;
    let bestSlot: 'morning' | 'afternoon' | 'evening' | null = null;
    if (granularity === 'slots') {
      const slotKeys: Array<'morning' | 'afternoon' | 'evening'> = ['morning', 'afternoon', 'evening'];
      const slotMap = {} as Record<'morning' | 'afternoon' | 'evening', SlotDaySummary>;
      let topSlotScore = 0;

      for (const slotKey of slotKeys) {
        const sYes: Participant[] = [];
        const sMaybe: Participant[] = [];
        const sNo: Participant[] = [];
        for (const p of activeParticipants) {
          const entries = byPart?.get(p.id) ?? [];
          const match = entries.find((e) => e.slot === slotKey) ?? entries.find((e) => e.slot === 'all');
          if (match?.status === 'yes') sYes.push(p);
          else if (match?.status === 'maybe') sMaybe.push(p);
          else if (match?.status === 'no') sNo.push(p);
        }
        const sScore = sYes.length + sMaybe.length * 0.45;
        const sRatio = activeParticipants.length > 0 ? Math.min(1, sScore / denom) : 0;
        slotMap[slotKey] = { slot: slotKey, yes: sYes, maybe: sMaybe, no: sNo, score: sScore, ratio: sRatio };
        if (sScore > topSlotScore) {
          topSlotScore = sScore;
          bestSlot = slotKey;
        }
      }
      slots = slotMap;
    }

    const score = yes.length + maybe.length * 0.45;
    const ratio = activeParticipants.length > 0 ? Math.min(1, score / denom) : 0;
    const allFilteredAvailable =
      activeIds.size > 0 && yes.length === activeParticipants.length;

    result.set(date, {
      date,
      yes,
      maybe,
      no,
      pending,
      votes: votesByDate.get(date) ?? [],
      pollOption: pollOptionByDate.get(date) ?? null,
      score,
      ratio,
      allFilteredAvailable,
      allRequiredAvailable,
      notesByParticipant,
      hasNotes: Object.keys(notesByParticipant).length > 0,
      ...(slots ? { slots, bestSlot } : {}),
    });
  }

  return result;
}

export type RankingSortMode = 'smart' | 'votes' | 'availability';

/**
 * Ranks the best candidate days for voting and top suggestions.
 * - 'smart': balances availability + votes + required attendees so 1 lone vote never beats a 5/5 consensus day.
 * - 'votes': strictly sorts by vote count first.
 * - 'availability': strictly sorts by attendance score first.
 */
export function rankBestDates(
  summaries: Map<string, DaySummary>,
  limit = 10,
  mode: RankingSortMode = 'votes',
  hasRequiredAttendees = false
): DaySummary[] {
  const list = Array.from(summaries.values()).filter(
    (s) => s.yes.length > 0 || s.maybe.length > 0 || s.votes.length > 0 || s.pollOption !== null
  );

  list.sort((a, b) => {
    if (mode === 'smart') {
      if (hasRequiredAttendees && a.allRequiredAvailable !== b.allRequiredAvailable) {
        return a.allRequiredAvailable ? -1 : 1;
      }
      const smartA = a.score * 1.15 + a.votes.length * 0.85 - a.no.length * 0.25;
      const smartB = b.score * 1.15 + b.votes.length * 0.85 - b.no.length * 0.25;
      if (Math.abs(smartB - smartA) > 0.001) return smartB - smartA;
      if (b.votes.length !== a.votes.length) return b.votes.length - a.votes.length;
      if (b.yes.length !== a.yes.length) return b.yes.length - a.yes.length;
      return a.date.localeCompare(b.date);
    }

    if (mode === 'availability') {
      if (hasRequiredAttendees && a.allRequiredAvailable !== b.allRequiredAvailable) {
        return a.allRequiredAvailable ? -1 : 1;
      }
      if (b.yes.length !== a.yes.length) return b.yes.length - a.yes.length;
      if (b.score !== a.score) return b.score - a.score;
      if (a.no.length !== b.no.length) return a.no.length - b.no.length;
      if (b.votes.length !== a.votes.length) return b.votes.length - a.votes.length;
      return a.date.localeCompare(b.date);
    }

    // Default 'votes' (preserves existing behavior)
    if (b.votes.length !== a.votes.length) return b.votes.length - a.votes.length;
    if (b.yes.length !== a.yes.length) return b.yes.length - a.yes.length;
    if (b.score !== a.score) return b.score - a.score;
    if (a.no.length !== b.no.length) return a.no.length - b.no.length;
    return a.date.localeCompare(b.date);
  });

  return list.slice(0, limit);
}

/**
 * Finds the best consecutive multi-day blocks (e.g., 2–7 day getaways/trips).
 */
export function rankBestRanges(params: {
  summaries: Map<string, DaySummary>;
  participants: Participant[];
  durationDays: number;
  requiredParticipantIds?: string[];
  holidayCountry?: HolidayCountry;
  limit?: number;
}): DateRangeSummary[] {
  const {
    summaries,
    participants,
    durationDays,
    requiredParticipantIds = [],
    holidayCountry = 'ES',
    limit = 6,
  } = params;

  if (durationDays < 2 || participants.length === 0) return [];

  const candidateStartDates = new Set<string>();
  for (const s of summaries.values()) {
    if (s.yes.length > 0 || s.maybe.length > 0) {
      candidateStartDates.add(s.date);
      // Also consider blocks ending/spanning this active date
      for (let back = 1; back < durationDays; back++) {
        candidateStartDates.add(addDaysISO(s.date, -back));
      }
    }
  }

  const validRequired = new Set(
    requiredParticipantIds.filter((id) => participants.some((p) => p.id === id))
  );
  const results: DateRangeSummary[] = [];
  const denom = Math.max(participants.length, 1);

  for (const startDate of candidateStartDates) {
    const dates: string[] = [];
    for (let i = 0; i < durationDays; i++) {
      dates.push(addDaysISO(startDate, i));
    }

    const fullYes: Participant[] = [];
    const fullYesOrMaybe: Participant[] = [];

    for (const p of participants) {
      let allYes = true;
      let allYesOrMaybe = true;
      for (const d of dates) {
        const s = summaries.get(d);
        const isYes = s?.yes.some((x) => x.id === p.id) ?? false;
        const isMaybe = s?.maybe.some((x) => x.id === p.id) ?? false;
        if (!isYes) allYes = false;
        if (!isYes && !isMaybe) {
          allYesOrMaybe = false;
          break;
        }
      }
      if (allYes) fullYes.push(p);
      if (allYesOrMaybe) fullYesOrMaybe.push(p);
    }

    if (fullYes.length === 0 && fullYesOrMaybe.length === 0) continue;

    const onlyMaybeCount = fullYesOrMaybe.length - fullYes.length;
    const allRequiredAvailable =
      validRequired.size === 0 ||
      Array.from(validRequired).every((id) => fullYes.some((p) => p.id === id));

    const includesWeekend = dates.some((d) => isSaturdayOrSunday(d));
    const includesHoliday = dates.some((d) => getHolidayInfo(d, holidayCountry) !== null);
    const score =
      fullYes.length +
      onlyMaybeCount * 0.45 +
      (includesWeekend ? 0.15 : 0) +
      (includesHoliday ? 0.2 : 0);
    const ratio = Math.min(1, (fullYes.length + onlyMaybeCount * 0.45) / denom);

    results.push({
      startDate,
      endDate: dates[dates.length - 1],
      dates,
      durationDays,
      fullYes,
      fullYesOrMaybe,
      allRequiredAvailable,
      includesWeekend,
      includesHoliday,
      score,
      ratio,
    });
  }

  results.sort((a, b) => {
    if (validRequired.size > 0 && a.allRequiredAvailable !== b.allRequiredAvailable) {
      return a.allRequiredAvailable ? -1 : 1;
    }
    if (b.fullYes.length !== a.fullYes.length) return b.fullYes.length - a.fullYes.length;
    if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;
    return a.startDate.localeCompare(b.startDate);
  });

  return results.slice(0, limit);
}

/**
 * Helper to compute end date + time accurately even when crossing midnight.
 */
function computeEndDateTime(
  startDateIso: string,
  startTime: string,
  durationMinutes: number
): { endDateCompact: string; endTimeCompact: string } {
  const [hh, mm] = startTime.split(':').map(Number);
  const start = parseDateISO(startDateIso);
  start.setHours(hh || 0, mm || 0, 0, 0);
  const end = new Date(start.getTime() + Math.max(15, durationMinutes) * 60_000);
  return {
    endDateCompact: formatDateISO(end).replace(/-/g, ''),
    endTimeCompact: `${pad2(end.getHours())}${pad2(end.getMinutes())}00`,
  };
}

/**
 * Builds an .ics calendar file string for a confirmed quedada date (handles midnight rollover & multi-day!).
 */
export function buildIcsContent(params: {
  title: string;
  description?: string;
  location?: string;
  date: string; // YYYY-MM-DD
  endDate?: string | null; // YYYY-MM-DD (inclusive for multi-day)
  time?: string | null; // HH:MM
  durationMinutes?: number;
  timezone?: string | null;
  url?: string;
}): string {
  const cleanDate = params.date.replace(/-/g, '');
  const uid = `shalendar-${cleanDate}-${Math.random().toString(36).slice(2, 10)}@shalendar.app`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const escapeIcs = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

  const isMultiDay = Boolean(params.endDate && params.endDate > params.date);
  let dtLines: string[];

  if (isMultiDay) {
    // All-day multi-day event (DTEND is exclusive in iCalendar RFC 5545)
    const exclusiveEnd = addDaysISO(params.endDate!, 1).replace(/-/g, '');
    dtLines = [
      `DTSTART;VALUE=DATE:${cleanDate}`,
      `DTEND;VALUE=DATE:${exclusiveEnd}`,
    ];
  } else if (params.time && /^\d{2}:\d{2}$/.test(params.time)) {
    const [hh, mm] = params.time.split(':').map(Number);
    const startCompact = `${cleanDate}T${pad2(hh)}${pad2(mm)}00`;
    const { endDateCompact, endTimeCompact } = computeEndDateTime(
      params.date,
      params.time,
      params.durationMinutes ?? 180
    );
    const tzPart = params.timezone ? `;TZID=${params.timezone}` : '';
    dtLines = [
      `DTSTART${tzPart}:${startCompact}`,
      `DTEND${tzPart}:${endDateCompact}T${endTimeCompact}`,
    ];
  } else {
    const cleanNext = addDaysISO(params.date, 1).replace(/-/g, '');
    dtLines = [
      `DTSTART;VALUE=DATE:${cleanDate}`,
      `DTEND;VALUE=DATE:${cleanNext}`,
    ];
  }

  const descParts = [params.description, params.url ? `Ver quedada: ${params.url}` : ''].filter(Boolean);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Shalendar//Quedadas//ES',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    ...dtLines,
    `SUMMARY:${escapeIcs(params.title)}`,
    ...(params.location ? [`LOCATION:${escapeIcs(params.location)}`] : []),
    ...(descParts.length ? [`DESCRIPTION:${escapeIcs(descParts.join('\n'))}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.join('\r\n');
}

export function buildGoogleCalendarUrl(params: {
  title: string;
  description?: string;
  location?: string;
  date: string;
  endDate?: string | null;
  time?: string | null;
  durationMinutes?: number;
  timezone?: string | null;
}): string {
  const cleanDate = params.date.replace(/-/g, '');
  const isMultiDay = Boolean(params.endDate && params.endDate > params.date);
  let datesParam: string;

  if (isMultiDay) {
    const exclusiveEnd = addDaysISO(params.endDate!, 1).replace(/-/g, '');
    datesParam = `${cleanDate}/${exclusiveEnd}`;
  } else if (params.time && /^\d{2}:\d{2}$/.test(params.time)) {
    const [hh, mm] = params.time.split(':').map(Number);
    const { endDateCompact, endTimeCompact } = computeEndDateTime(
      params.date,
      params.time,
      params.durationMinutes ?? 180
    );
    datesParam = `${cleanDate}T${pad2(hh)}${pad2(mm)}00/${endDateCompact}T${endTimeCompact}`;
  } else {
    datesParam = `${cleanDate}/${addDaysISO(params.date, 1).replace(/-/g, '')}`;
  }

  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', params.title);
  url.searchParams.set('dates', datesParam);
  if (params.timezone) url.searchParams.set('ctz', params.timezone);
  if (params.location) url.searchParams.set('location', params.location);
  if (params.description) url.searchParams.set('details', params.description);
  return url.toString();
}
