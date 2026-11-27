import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck,
  Check,
  HelpCircle,
  MessageSquare,
  Save,
  Send,
  Sparkles,
  Star,
  StickyNote,
  X,
} from 'lucide-react';
import type {
  AvailabilitySlot,
  AvailabilityStatus,
  CommentEntry,
  DaySummary,
  HolidayCountry,
  Participant,
  PlanGranularity,
} from '../../shared/types';
import { formatDateLong, getTimeSlots } from '../../shared/dates';
import { getHolidayInfo } from '../../shared/holidays';
import { useI18n } from '../lib/i18n';
import { Avatar } from './Avatar';

interface DayInspectorProps {
  date: string | null;
  summary: DaySummary | null;
  participants: Participant[];
  me: Participant | null;
  granularity: PlanGranularity;
  holidayCountry: HolidayCountry;
  requiredParticipantIds: string[];
  myStatus: AvailabilityStatus | undefined;
  myNote: string;
  mySlotAvailabilityMap: Map<string, AvailabilityStatus>;
  hasVoted: boolean;
  votingOpen: boolean;
  comments: CommentEntry[];
  onSetMyStatus: (
    date: string,
    status: AvailabilityStatus | null,
    slot?: AvailabilitySlot,
    note?: string
  ) => void;
  onSetMyDayStatus: (date: string, status: AvailabilityStatus | null, note?: string) => void;
  onSaveMyNote: (date: string, note: string) => void;
  onToggleVote: (date: string) => void;
  onAddComment: (date: string, body: string) => void;
  onRequireIdentity: () => void;
  /** `sheet` renders without card chrome and with larger touch targets (mobile bottom sheet). */
  variant?: 'card' | 'sheet';
}

export function DayInspector({
  date,
  summary,
  participants,
  me,
  granularity,
  holidayCountry,
  requiredParticipantIds,
  myStatus,
  myNote,
  mySlotAvailabilityMap,
  hasVoted,
  votingOpen,
  comments,
  onSetMyStatus,
  onSetMyDayStatus,
  onSaveMyNote,
  onToggleVote,
  onAddComment,
  onRequireIdentity,
  variant = 'card',
}: DayInspectorProps) {
  const { language, t } = useI18n();
  const isSheet = variant === 'sheet';
  const statusBtnSize = isSheet ? 'py-3 text-sm rounded-2xl' : 'py-2 text-xs rounded-xl';
  const fieldSize = isSheet ? 'py-2.5 text-sm' : 'py-1.5 text-xs';
  const [noteInput, setNoteInput] = useState('');
  const [personalNoteDraft, setPersonalNoteDraft] = useState(myNote);

  useEffect(() => {
    setPersonalNoteDraft(myNote);
  }, [date, myNote]);

  if (!date) {
    return (
      <div className="rounded-3xl border border-stone-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-sm text-center space-y-2">
        <CalendarCheck className="mx-auto h-7 w-7 text-teal-500/70" />
        <p className="font-display text-sm font-bold">{t.inspector.emptyTitle}</p>
        <p className="text-xs text-stone-500 dark:text-slate-400">
          {t.inspector.emptyDesc}
        </p>
      </div>
    );
  }

  const timeSlots = getTimeSlots(language);
  const yes = summary?.yes ?? [];
  const maybe = summary?.maybe ?? [];
  const no = summary?.no ?? [];
  const pending = summary?.pending ?? participants;
  const dayComments = comments.filter((c) => c.date === date);
  const participantById = new Map(participants.map((p) => [p.id, p]));
  const requiredSet = new Set(requiredParticipantIds);
  const holiday = getHolidayInfo(date, holidayCountry, language);

  const missingRequiredNames = requiredParticipantIds
    .filter((id) => !yes.some((p) => p.id === id))
    .map((id) => participantById.get(id)?.name)
    .filter((n): n is string => Boolean(n));

  function handleQuickStatus(next: AvailabilityStatus) {
    if (!date) return;
    if (!me) {
      onRequireIdentity();
      return;
    }
    const targetStatus = myStatus === next ? null : next;
    onSetMyDayStatus(date, targetStatus, targetStatus ? personalNoteDraft : undefined);
  }

  function handleToggleSlot(slotId: 'morning' | 'afternoon' | 'evening') {
    if (!date) return;
    if (!me) {
      onRequireIdentity();
      return;
    }
    const cur = mySlotAvailabilityMap.get(`${date}:${slotId}`);
    const next: AvailabilityStatus | null =
      cur === 'yes' ? 'maybe' : cur === 'maybe' ? 'no' : cur === 'no' ? null : 'yes';
    onSetMyStatus(date, next, slotId);
  }

  function handleSavePersonalNote(e: React.FormEvent) {
    e.preventDefault();
    if (!date) return;
    if (!me) {
      onRequireIdentity();
      return;
    }
    onSaveMyNote(date, personalNoteDraft.trim());
  }

  function handleSubmitComment(e: React.FormEvent) {
    e.preventDefault();
    if (!date || !noteInput.trim()) return;
    if (!me) {
      onRequireIdentity();
      return;
    }
    onAddComment(date, noteInput.trim());
    setNoteInput('');
  }

  return (
    <div
      className={
        isSheet
          ? 'space-y-4 pb-2'
          : 'rounded-3xl border border-stone-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-sm space-y-4 animate-pop'
      }
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400">
            {t.inspector.dayDetailEyebrow}
          </p>
          <h3 className={`font-display font-extrabold tracking-tight ${isSheet ? 'text-xl first-letter:uppercase' : 'text-lg'}`}>
            {formatDateLong(date, language)}
          </h3>
          {holiday && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-rose-50 dark:bg-rose-950/60 border border-rose-200/80 dark:border-rose-800/60 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
              <Sparkles className="h-3 w-3" />
              {t.inspector.holidayTag(holiday.name)}
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={!votingOpen}
          onClick={() => {
            if (!me) {
              onRequireIdentity();
              return;
            }
            onToggleVote(date);
          }}
          className={`inline-flex shrink-0 items-center gap-1 border font-bold transition cursor-pointer disabled:opacity-50 ${
            isSheet ? 'rounded-2xl px-3.5 py-2.5 text-sm' : 'rounded-xl px-3 py-1.5 text-xs'
          } ${
            hasVoted
              ? 'border-amber-400 bg-amber-400 text-amber-950 shadow-xs'
              : 'border-stone-200 dark:border-slate-700 hover:border-amber-400 hover:text-amber-700 dark:hover:text-amber-300'
          }`}
        >
          <Star className={`h-3.5 w-3.5 ${hasVoted ? 'fill-current' : ''}`} />
          <span>{hasVoted ? t.inspector.votedBtn : t.inspector.voteDayBtn}</span>
        </button>
      </div>

      {/* Required attendee warning */}
      {missingRequiredNames.length > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/35 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>{t.inspector.missingRequired(missingRequiredNames.join(', '))}</span>
        </div>
      )}

      {/* Quick personal availability controls */}
      <div className="space-y-2.5">
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => handleQuickStatus('yes')}
            className={`inline-flex items-center justify-center gap-1 border font-bold transition cursor-pointer ${statusBtnSize} ${
              myStatus === 'yes'
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-stone-200 dark:border-slate-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 text-stone-700 dark:text-slate-200'
            }`}
          >
            <Check className={isSheet ? "h-4 w-4" : "h-3.5 w-3.5"} />
            {t.inspector.yesBtn}
          </button>
          <button
            type="button"
            onClick={() => handleQuickStatus('maybe')}
            className={`inline-flex items-center justify-center gap-1 border font-bold transition cursor-pointer ${statusBtnSize} ${
              myStatus === 'maybe'
                ? 'border-amber-500 bg-amber-500 text-white'
                : 'border-stone-200 dark:border-slate-700 hover:bg-amber-50 dark:hover:bg-amber-950/50 text-stone-700 dark:text-slate-200'
            }`}
          >
            <HelpCircle className="h-3.5 w-3.5" />
            {t.inspector.maybeBtn}
          </button>
          <button
            type="button"
            onClick={() => handleQuickStatus('no')}
            className={`inline-flex items-center justify-center gap-1 border font-bold transition cursor-pointer ${statusBtnSize} ${
              myStatus === 'no'
                ? 'border-rose-500 bg-rose-500 text-white'
                : 'border-stone-200 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-stone-700 dark:text-slate-200'
            }`}
          >
            <X className="h-3.5 w-3.5" />
            {t.inspector.noBtn}
          </button>
        </div>

        {/* Time-slot toggles when granularity === 'slots' */}
        {granularity === 'slots' && (
          <div className="grid grid-cols-3 gap-1.5 pt-0.5">
            {timeSlots.map((slot) => {
              const mySlotSt = mySlotAvailabilityMap.get(`${date}:${slot.id}`);
              const sSum = summary?.slots?.[slot.id];
              return (
                <button
                  key={slot.id}
                  type="button"
                  onClick={() => handleToggleSlot(slot.id)}
                  className={`rounded-xl border p-2 text-left transition cursor-pointer ${
                    mySlotSt === 'yes'
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-100'
                      : mySlotSt === 'maybe'
                        ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-100'
                        : mySlotSt === 'no'
                          ? 'border-rose-300 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200'
                          : 'border-stone-200 dark:border-slate-700 bg-stone-50/60 dark:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span>
                      {slot.emoji} {slot.label}
                    </span>
                    <span className="tabular-nums text-[10px] opacity-80">
                      {sSum?.yes.length ?? 0}✓
                    </span>
                  </div>
                  <p className="text-[10px] text-stone-500 dark:text-slate-400 mt-0.5">
                    {mySlotSt === 'yes'
                      ? t.inspector.youYes
                      : mySlotSt === 'maybe'
                        ? t.inspector.youMaybe
                        : mySlotSt === 'no'
                          ? t.inspector.youNo
                          : slot.hint}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {/* Personal availability note for this day */}
        <form onSubmit={handleSavePersonalNote} className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <StickyNote className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
            <input
              type="text"
              maxLength={140}
              disabled={Boolean(me) && !myStatus}
              value={personalNoteDraft}
              onChange={(e) => setPersonalNoteDraft(e.target.value)}
              placeholder={me && !myStatus ? t.inspector.personalNoteNeedsStatus : t.inspector.personalNotePlaceholder}
              className={`w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50/70 dark:bg-slate-800/70 pl-8 pr-3 ${fieldSize} outline-none focus:border-teal-500 transition`}
            />
          </div>
          {personalNoteDraft !== myNote && (
            <button
              type="submit"
              title={t.inspector.saveNoteTitle}
              className="inline-flex items-center gap-1 rounded-xl bg-teal-600 hover:bg-teal-700 px-2.5 py-1.5 text-xs font-bold text-white transition cursor-pointer shrink-0"
            >
              <Save className="h-3.5 w-3.5" />
              {t.common.save}
            </button>
          )}
        </form>
      </div>

      {/* People Breakdown (with personal availability notes shown inline!) */}
      <div className="space-y-2.5 text-xs">
        {[
          {
            label: t.inspector.groupYes,
            list: yes,
            dotClass: 'bg-emerald-500',
            pillClass:
              'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200/80 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-100',
          },
          {
            label: t.inspector.groupMaybe,
            list: maybe,
            dotClass: 'bg-amber-400',
            pillClass:
              'bg-amber-50 dark:bg-amber-950/50 border-amber-200/80 dark:border-amber-800/60 text-amber-900 dark:text-amber-100',
          },
          {
            label: t.inspector.groupNo,
            list: no,
            dotClass: 'bg-rose-500',
            pillClass:
              'bg-rose-50 dark:bg-rose-950/50 border-rose-200/80 dark:border-rose-800/60 text-rose-900 dark:text-rose-100',
          },
          {
            label: t.inspector.groupPending,
            list: pending,
            dotClass: 'bg-stone-300 dark:bg-slate-600',
            pillClass:
              'bg-stone-100/80 dark:bg-slate-800/70 border-stone-200 dark:border-slate-700 text-stone-600 dark:text-slate-300',
          },
        ].map((group) =>
          group.list.length > 0 ? (
            <div key={group.label} className="space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-stone-500 dark:text-slate-400">
                <span className={`h-2 w-2 rounded-full ${group.dotClass}`} />
                <span>
                  {group.label} ({group.list.length})
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.list.map((p) => {
                  const pNote = summary?.notesByParticipant[p.id];
                  return (
                    <span
                      key={p.id}
                      className={`inline-flex items-center gap-1.5 rounded-full border pl-1 pr-2.5 py-0.5 font-medium ${group.pillClass}`}
                    >
                      <Avatar participant={p} size="xs" required={requiredSet.has(p.id)} />
                      <span>{p.name}</span>
                      {pNote && (
                        <span className="text-[10px] opacity-80 italic max-w-[160px] truncate">
                          · «{pNote}»
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null
        )}
      </div>

      {/* Day comments */}
      <div className="border-t border-stone-100 dark:border-slate-800 pt-3 space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-stone-400 dark:text-slate-500">
          <MessageSquare className="h-3.5 w-3.5" />
          {t.inspector.dayCommentsTitle}
        </div>

        {dayComments.length > 0 && (
          <div className="space-y-1.5">
            {dayComments.map((c) => {
              const author = participantById.get(c.participantId);
              return (
                <div
                  key={c.id}
                  className="rounded-xl bg-stone-50 dark:bg-slate-800/60 px-3 py-2 text-xs space-y-0.5"
                >
                  <span className="font-bold text-stone-800 dark:text-slate-100">
                    {author?.name ?? t.common.someoneFallback}:
                  </span>{' '}
                  <span className="text-stone-600 dark:text-slate-300">{c.body}</span>
                </div>
              );
            })}
          </div>
        )}

        <form onSubmit={handleSubmitComment} className="flex items-center gap-1.5">
          <input
            type="text"
            maxLength={240}
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            placeholder={t.inspector.dayCommentPlaceholder}
            className={`min-w-0 flex-1 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50/70 dark:bg-slate-800/70 px-3 ${fieldSize} outline-none focus:border-teal-500 transition`}
          />
          <button
            type="submit"
            disabled={!noteInput.trim()}
            aria-label={t.inspector.sendCommentAria}
            className={`flex shrink-0 items-center justify-center rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white transition cursor-pointer ${isSheet ? 'h-10 w-10' : 'h-8 w-8'}`}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
