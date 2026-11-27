import { useState } from 'react';
import {
  Car,
  Check,
  CheckSquare,
  Crown,
  ExternalLink,
  ListChecks,
  MapPin,
  Plus,
  Square,
  ThumbsUp,
  Trash2,
  UserCheck,
} from 'lucide-react';
import type {
  CarpoolRide,
  ChecklistItem,
  Participant,
  SubPoll,
  SubPollCategory,
} from '../../shared/types';
import { useI18n } from '../lib/i18n';
import { Avatar, AvatarStack } from './Avatar';

interface PlanLogisticsPanelProps {
  participants: Participant[];
  me: Participant | null;
  isAdmin: boolean;
  subPolls: SubPoll[];
  checklist: ChecklistItem[];
  carpools: CarpoolRide[];
  onCreateSubPoll: (
    category: SubPollCategory,
    question: string,
    initialOptions: Array<{ title: string; url?: string; estimatedCost?: string }>
  ) => Promise<void>;
  onAddSubPollOption: (
    pollId: string,
    title: string,
    url: string,
    estimatedCost: string
  ) => Promise<void>;
  onToggleSubPollVote: (pollId: string, optionId: string) => Promise<void>;
  onSetSubPollWinner: (pollId: string, winnerOptionId: string | null) => Promise<void>;
  onDeleteSubPoll: (pollId: string) => Promise<void>;
  onAddChecklistItem: (title: string, assignToMe: boolean) => Promise<void>;
  onUpdateChecklistItem: (
    itemId: string,
    updates: { assignedTo?: string | null; completed?: boolean }
  ) => Promise<void>;
  onDeleteChecklistItem: (itemId: string) => Promise<void>;
  onAddCarpool: (
    origin: string,
    seatsTotal: number,
    departureTime: string,
    notes: string
  ) => Promise<void>;
  onToggleCarpoolSeat: (rideId: string) => Promise<void>;
  onDeleteCarpool: (rideId: string) => Promise<void>;
  onRequireIdentity: () => void;
  /** Show a single module (mobile segmented view) or all of them stacked (desktop). */
  section?: LogisticsSection;
}

export type LogisticsSection = 'all' | 'polls' | 'checklist' | 'carpool';

export function PlanLogisticsPanel({
  participants,
  me,
  isAdmin,
  subPolls,
  checklist,
  carpools,
  onCreateSubPoll,
  onAddSubPollOption,
  onToggleSubPollVote,
  onSetSubPollWinner,
  onDeleteSubPoll,
  onAddChecklistItem,
  onUpdateChecklistItem,
  onDeleteChecklistItem,
  onAddCarpool,
  onToggleCarpoolSeat,
  onDeleteCarpool,
  onRequireIdentity,
  section = 'all',
}: PlanLogisticsPanelProps) {
  const { t } = useI18n();

  // Sub-poll creation state
  const [showNewPoll, setShowNewPoll] = useState(false);
  const [pollCategory, setPollCategory] = useState<SubPollCategory>('place');
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptionsRaw, setPollOptionsRaw] = useState('');

  // Per-poll new option form
  const [addingOptPollId, setAddingOptPollId] = useState<string | null>(null);
  const [optTitle, setOptTitle] = useState('');
  const [optUrl, setOptUrl] = useState('');
  const [optCost, setOptCost] = useState('');

  // Checklist input
  const [taskTitle, setTaskTitle] = useState('');
  const [assignTaskToMe, setAssignTaskToMe] = useState(false);

  // Carpool form
  const [showNewCar, setShowNewCar] = useState(false);
  const [carOrigin, setCarOrigin] = useState('');
  const [carSeats, setCarSeats] = useState(3);
  const [carTime, setCarTime] = useState('');
  const [carNotes, setCarNotes] = useState('');

  const participantById = new Map(participants.map((p) => [p.id, p]));
  const categoryMeta = t.logistics.categories;

  async function handleCreatePoll(e: React.FormEvent) {
    e.preventDefault();
    if (!pollQuestion.trim()) return;
    if (!me) {
      onRequireIdentity();
      return;
    }
    const initialOptions = pollOptionsRaw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((title) => ({ title }));
    await onCreateSubPoll(pollCategory, pollQuestion.trim(), initialOptions);
    setPollQuestion('');
    setPollOptionsRaw('');
    setShowNewPoll(false);
  }

  async function handleAddOption(e: React.FormEvent, pollId: string) {
    e.preventDefault();
    if (!optTitle.trim()) return;
    if (!me) {
      onRequireIdentity();
      return;
    }
    await onAddSubPollOption(pollId, optTitle.trim(), optUrl.trim(), optCost.trim());
    setOptTitle('');
    setOptUrl('');
    setOptCost('');
    setAddingOptPollId(null);
  }

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    if (!me) {
      onRequireIdentity();
      return;
    }
    await onAddChecklistItem(taskTitle.trim(), assignTaskToMe);
    setTaskTitle('');
    setAssignTaskToMe(false);
  }

  async function handleAddCar(e: React.FormEvent) {
    e.preventDefault();
    if (!carOrigin.trim()) return;
    if (!me) {
      onRequireIdentity();
      return;
    }
    await onAddCarpool(carOrigin.trim(), carSeats, carTime.trim(), carNotes.trim());
    setCarOrigin('');
    setCarSeats(3);
    setCarTime('');
    setCarNotes('');
    setShowNewCar(false);
  }

  return (
    <div className="space-y-5 min-w-0">
      {/* 1. SUB-POLLS (WHERE / WHAT) */}
      {(section === 'all' || section === 'polls') && (
      <section className="rounded-3xl border border-stone-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-base sm:text-lg font-extrabold tracking-tight flex items-center gap-2">
              <MapPin className="h-4.5 w-4.5 text-teal-600 dark:text-teal-400" />
              {t.logistics.pollsTitle}
            </h3>
            <p className="text-xs text-stone-500 dark:text-slate-400">
              {t.logistics.pollsSubtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowNewPoll((v) => !v)}
            className="inline-flex items-center gap-1 rounded-xl bg-teal-600 hover:bg-teal-700 px-3 py-1.5 text-xs font-bold text-white transition cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            {t.logistics.newPollBtn}
          </button>
        </div>

        {showNewPoll && (
          <form
            onSubmit={handleCreatePoll}
            className="rounded-2xl border border-teal-200 dark:border-teal-800/60 bg-teal-50/50 dark:bg-teal-950/25 p-4 space-y-3 animate-pop"
          >
            <div className="flex flex-wrap gap-1.5">
              {(['place', 'activity', 'other'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setPollCategory(cat)}
                  className={`rounded-xl border px-2.5 py-1 text-xs font-bold transition cursor-pointer ${
                    pollCategory === cat
                      ? 'border-teal-500 bg-teal-600 text-white'
                      : 'border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-stone-600 dark:text-slate-300'
                  }`}
                >
                  {categoryMeta[cat].emoji} {categoryMeta[cat].label}
                </button>
              ))}
            </div>

            <input
              type="text"
              required
              maxLength={120}
              value={pollQuestion}
              onChange={(e) => setPollQuestion(e.target.value)}
              placeholder={t.logistics.pollQuestionPlaceholder}
              className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs outline-none focus:border-teal-500"
            />
            <textarea
              rows={3}
              value={pollOptionsRaw}
              onChange={(e) => setPollOptionsRaw(e.target.value)}
              placeholder={t.logistics.pollOptionsPlaceholder}
              className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs outline-none focus:border-teal-500 resize-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewPoll(false)}
                className="rounded-lg px-2.5 py-1 text-xs font-medium text-stone-500 cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                className="rounded-lg bg-teal-600 hover:bg-teal-700 px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
              >
                {t.logistics.createPollBtn}
              </button>
            </div>
          </form>
        )}

        {subPolls.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-stone-200 dark:border-slate-800 py-6 text-center text-xs text-stone-500 dark:text-slate-400">
            {t.logistics.pollsEmpty}
          </p>
        ) : (
          <div className="space-y-4">
            {subPolls.map((poll) => {
              const sortedOpts = [...poll.options].sort((a, b) => b.voterIds.length - a.voterIds.length);
              const maxVotes = Math.max(...sortedOpts.map((o) => o.voterIds.length), 1);
              return (
                <div
                  key={poll.id}
                  className="rounded-2xl border border-stone-200/80 dark:border-slate-800 bg-stone-50/50 dark:bg-slate-800/35 p-3.5 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-lg shrink-0">{categoryMeta[poll.category].emoji}</span>
                      <h4 className="min-w-0 break-words font-display text-sm font-extrabold">
                        {poll.question}
                      </h4>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setAddingOptPollId(addingOptPollId === poll.id ? null : poll.id)
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-[11px] font-semibold hover:border-teal-400 cursor-pointer"
                      >
                        <Plus className="h-3 w-3" />
                        {t.logistics.addOptionBtn}
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => onDeleteSubPoll(poll.id)}
                          title={t.logistics.deletePollTitle}
                          className="p-1 text-stone-400 hover:text-rose-500 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {addingOptPollId === poll.id && (
                    <form
                      onSubmit={(e) => handleAddOption(e, poll.id)}
                      className="grid min-w-0 gap-2 sm:grid-cols-3 rounded-xl bg-white dark:bg-slate-900 border border-teal-200 dark:border-teal-800 p-2.5 animate-pop"
                    >
                      <input
                        type="text"
                        required
                        maxLength={100}
                        value={optTitle}
                        onChange={(e) => setOptTitle(e.target.value)}
                        placeholder={t.logistics.optTitlePlaceholder}
                        className="sm:col-span-3 rounded-lg border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs outline-none focus:border-teal-500"
                      />
                      <input
                        type="url"
                        maxLength={240}
                        value={optUrl}
                        onChange={(e) => setOptUrl(e.target.value)}
                        placeholder={t.logistics.optUrlPlaceholder}
                        className="sm:col-span-2 rounded-lg border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs outline-none focus:border-teal-500"
                      />
                      <input
                        type="text"
                        maxLength={24}
                        value={optCost}
                        onChange={(e) => setOptCost(e.target.value)}
                        placeholder={t.logistics.optCostPlaceholder}
                        className="rounded-lg border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs outline-none focus:border-teal-500"
                      />
                      <div className="sm:col-span-3 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setAddingOptPollId(null)}
                          className="text-xs text-stone-500 px-2 py-1 cursor-pointer"
                        >
                          {t.common.cancel}
                        </button>
                        <button
                          type="submit"
                          className="rounded-lg bg-teal-600 px-3 py-1 text-xs font-bold text-white cursor-pointer"
                        >
                          {t.logistics.addBtn}
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="space-y-2">
                    {sortedOpts.map((opt) => {
                      const voted = me ? opt.voterIds.includes(me.id) : false;
                      const isWinner = poll.winnerOptionId === opt.id;
                      const voters = opt.voterIds
                        .map((id) => participantById.get(id))
                        .filter((p): p is Participant => Boolean(p));
                      const pct = Math.round((opt.voterIds.length / maxVotes) * 100);

                      return (
                        <div
                          key={opt.id}
                          className={`rounded-xl border p-2.5 transition ${
                            isWinner
                              ? 'border-amber-400 bg-amber-50/70 dark:bg-amber-950/35'
                              : 'border-stone-200/80 dark:border-slate-800 bg-white dark:bg-slate-900'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="min-w-0 break-words text-xs font-bold text-stone-900 dark:text-white">
                                  {opt.title}
                                </span>
                                {isWinner && (
                                  <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-950">
                                    <Crown className="h-2.5 w-2.5" />
                                    {t.logistics.chosenBadge}
                                  </span>
                                )}
                                {opt.estimatedCost && (
                                  <span className="rounded-full bg-stone-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-stone-600 dark:text-slate-300">
                                    {opt.estimatedCost}
                                  </span>
                                )}
                                {opt.url && (
                                  <a
                                    href={opt.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-teal-600 dark:text-teal-400 hover:underline"
                                  >
                                    {t.logistics.viewLink}
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200/80 dark:bg-slate-800">
                                  <div
                                    style={{ width: `${opt.voterIds.length > 0 ? Math.max(10, pct) : 0}%` }}
                                    className="h-full rounded-full bg-teal-500 transition-all"
                                  />
                                </div>
                                {voters.length > 0 && <AvatarStack participants={voters} max={4} size="xs" />}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  if (!me) {
                                    onRequireIdentity();
                                    return;
                                  }
                                  onToggleSubPollVote(poll.id, opt.id);
                                }}
                                className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1 text-xs font-bold transition cursor-pointer ${
                                  voted
                                    ? 'border-teal-600 bg-teal-600 text-white'
                                    : 'border-stone-200 dark:border-slate-700 hover:border-teal-400'
                                }`}
                              >
                                <ThumbsUp className="h-3 w-3" />
                                <span className="tabular-nums">{opt.voterIds.length}</span>
                              </button>
                              {isAdmin && (
                                <button
                                  type="button"
                                  title={isWinner ? t.logistics.removeWinnerTitle : t.logistics.markWinnerTitle}
                                  onClick={() => onSetSubPollWinner(poll.id, isWinner ? null : opt.id)}
                                  className={`p-1.5 rounded-lg transition cursor-pointer ${
                                    isWinner
                                      ? 'text-amber-600 bg-amber-100 dark:bg-amber-950/60'
                                      : 'text-stone-400 hover:text-amber-500'
                                  }`}
                                >
                                  <Crown className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      )}

      {/* 2. COLLABORATIVE CHECKLIST */}
      {(section === 'all' || section === 'checklist') && (
      <section className="rounded-3xl border border-stone-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-base sm:text-lg font-extrabold tracking-tight flex items-center gap-2">
              <ListChecks className="h-4.5 w-4.5 text-emerald-600 dark:text-emerald-400" />
              {t.logistics.checklistTitle}
            </h3>
            <p className="text-xs text-stone-500 dark:text-slate-400">
              {t.logistics.checklistSubtitle}
            </p>
          </div>
          {checklist.length > 0 && (
            <span className="rounded-full bg-stone-100 dark:bg-slate-800 px-2.5 py-1 text-xs font-bold tabular-nums text-stone-600 dark:text-slate-300">
              {t.logistics.checklistProgress(
                checklist.filter((i) => i.completed).length,
                checklist.length
              )}
            </span>
          )}
        </div>

        <form onSubmit={handleAddTask} className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            maxLength={120}
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder={t.logistics.taskPlaceholder}
            className="min-w-0 basis-full sm:basis-auto sm:min-w-[200px] flex-1 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50/70 dark:bg-slate-800/70 px-3 py-2 text-xs outline-none focus:border-teal-500"
          />
          <label className="inline-flex items-center gap-1.5 text-xs text-stone-600 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={assignTaskToMe}
              onChange={(e) => setAssignTaskToMe(e.target.checked)}
              className="rounded accent-teal-600"
            />
            {t.logistics.assignToMe}
          </label>
          <button
            type="submit"
            disabled={!taskTitle.trim()}
            className="inline-flex items-center gap-1 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 px-3 py-2 text-xs font-bold text-white cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            {t.logistics.addBtn}
          </button>
        </form>

        {checklist.length === 0 ? (
          <p className="text-center text-xs text-stone-400 dark:text-slate-500 py-4">
            {t.logistics.checklistEmpty}
          </p>
        ) : (
          <div className="space-y-1.5">
            {checklist.map((item) => {
              const assignee = item.assignedTo ? participantById.get(item.assignedTo) : null;
              const isMine = me && item.assignedTo === me.id;
              return (
                <div
                  key={item.id}
                  className={`flex items-center justify-between gap-2 rounded-2xl border px-3 py-2.5 text-xs transition ${
                    item.completed
                      ? 'border-stone-200/60 dark:border-slate-800/60 bg-stone-50/50 dark:bg-slate-800/30 opacity-65'
                      : 'border-stone-200/90 dark:border-slate-800 bg-white dark:bg-slate-900'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onUpdateChecklistItem(item.id, { completed: !item.completed })}
                    className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                  >
                    {item.completed ? (
                      <CheckSquare className="h-4 w-4 text-emerald-600 shrink-0" />
                    ) : (
                      <Square className="h-4 w-4 text-stone-400 shrink-0" />
                    )}
                    <span className={`font-medium truncate ${item.completed ? 'line-through' : ''}`}>
                      {item.title}
                    </span>
                  </button>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {assignee ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (!me) {
                            onRequireIdentity();
                            return;
                          }
                          onUpdateChecklistItem(item.id, {
                            assignedTo: isMine ? null : me.id,
                          });
                        }}
                        title={isMine ? t.logistics.unassignTaskTitle : t.logistics.reassignTaskTitle}
                        className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 dark:border-teal-800 bg-teal-50/80 dark:bg-teal-950/50 pl-1 pr-2.5 py-0.5 text-[11px] font-semibold text-teal-900 dark:text-teal-200 cursor-pointer"
                      >
                        <Avatar participant={assignee} size="xs" />
                        <span>{assignee.name}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (!me) {
                            onRequireIdentity();
                            return;
                          }
                          onUpdateChecklistItem(item.id, { assignedTo: me.id });
                        }}
                        className="inline-flex items-center gap-1 rounded-full border border-dashed border-stone-300 dark:border-slate-700 hover:border-teal-500 hover:text-teal-700 dark:hover:text-teal-300 px-2.5 py-0.5 text-[11px] font-semibold text-stone-500 cursor-pointer"
                      >
                        <UserCheck className="h-3 w-3" />
                        {t.logistics.claimTaskBtn}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onDeleteChecklistItem(item.id)}
                      title={t.common.delete}
                      className="p-1 text-stone-300 hover:text-rose-500 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      )}

      {/* 3. CARPOOLING */}
      {(section === 'all' || section === 'carpool') && (
      <section className="rounded-3xl border border-stone-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-base sm:text-lg font-extrabold tracking-tight flex items-center gap-2">
              <Car className="h-4.5 w-4.5 text-sky-600 dark:text-sky-400" />
              {t.logistics.carpoolTitle}
            </h3>
            <p className="text-xs text-stone-500 dark:text-slate-400">
              {t.logistics.carpoolSubtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowNewCar((v) => !v)}
            className="inline-flex items-center gap-1 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 hover:bg-sky-100 dark:hover:bg-sky-950 px-3 py-1.5 text-xs font-bold text-sky-800 dark:text-sky-200 transition cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            {t.logistics.offerCarBtn}
          </button>
        </div>

        {showNewCar && (
          <form
            onSubmit={handleAddCar}
            className="rounded-2xl border border-sky-200 dark:border-sky-800/60 bg-sky-50/50 dark:bg-sky-950/25 p-4 grid gap-2.5 sm:grid-cols-3 animate-pop"
          >
            <input
              type="text"
              required
              maxLength={100}
              value={carOrigin}
              onChange={(e) => setCarOrigin(e.target.value)}
              placeholder={t.logistics.carOriginPlaceholder}
              className="min-w-0 sm:col-span-2 rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs outline-none focus:border-sky-500"
            />
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-stone-600 dark:text-slate-300 shrink-0">
                {t.logistics.seatsLabel}
              </label>
              <input
                type="number"
                min={1}
                max={9}
                value={carSeats}
                onChange={(e) => setCarSeats(Math.max(1, Math.min(9, Number(e.target.value))))}
                className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 text-xs font-bold outline-none"
              />
            </div>
            <input
              type="text"
              maxLength={24}
              value={carTime}
              onChange={(e) => setCarTime(e.target.value)}
              placeholder={t.logistics.carTimePlaceholder}
              className="rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs outline-none"
            />
            <input
              type="text"
              maxLength={160}
              value={carNotes}
              onChange={(e) => setCarNotes(e.target.value)}
              placeholder={t.logistics.carNotesPlaceholder}
              className="sm:col-span-2 rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs outline-none"
            />
            <div className="sm:col-span-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewCar(false)}
                className="text-xs text-stone-500 px-2 py-1 cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                className="rounded-xl bg-sky-600 hover:bg-sky-700 px-3.5 py-1.5 text-xs font-bold text-white cursor-pointer"
              >
                {t.logistics.publishCarBtn}
              </button>
            </div>
          </form>
        )}

        {carpools.length === 0 ? (
          <p className="text-center text-xs text-stone-400 dark:text-slate-500 py-4">
            {t.logistics.carpoolEmpty}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {carpools.map((ride) => {
              const driver = participantById.get(ride.driverId);
              const passengers = ride.passengerIds
                .map((id) => participantById.get(id))
                .filter((p): p is Participant => Boolean(p));
              const seatsLeft = Math.max(0, ride.seatsTotal - passengers.length);
              const isDriver = me?.id === ride.driverId;
              const isPassenger = me ? ride.passengerIds.includes(me.id) : false;

              return (
                <div
                  key={ride.id}
                  className="rounded-2xl border border-stone-200/80 dark:border-slate-800 bg-stone-50/50 dark:bg-slate-800/35 p-3.5 space-y-2.5 flex flex-col justify-between"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {driver && <Avatar participant={driver} size="sm" />}
                        <div className="min-w-0">
                          <p className="text-xs font-extrabold text-stone-900 dark:text-white truncate">
                            {t.logistics.carOf(driver?.name ?? t.common.friendFallback)}
                          </p>
                          <p className="text-[11px] text-stone-500 dark:text-slate-400 truncate">
                            {ride.origin}
                            {ride.departureTime ? ` · ${ride.departureTime}` : ''}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold tabular-nums ${
                          seatsLeft > 0
                            ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-200'
                            : 'bg-stone-200 dark:bg-slate-700 text-stone-600 dark:text-slate-300'
                        }`}
                      >
                        {seatsLeft > 0 ? t.logistics.seatsLeft(seatsLeft) : t.logistics.carFull}
                      </span>
                    </div>

                    {ride.notes && (
                      <p className="text-[11px] text-stone-600 dark:text-slate-300">{ride.notes}</p>
                    )}

                    {passengers.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 pt-1">
                        {passengers.map((p) => (
                          <span
                            key={p.id}
                            className="inline-flex items-center gap-1 rounded-full bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 pl-0.5 pr-2 py-0.5 text-[10px] font-semibold"
                          >
                            <Avatar participant={p} size="xs" />
                            {p.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-stone-200/60 dark:border-slate-800">
                    {!isDriver ? (
                      <button
                        type="button"
                        disabled={!isPassenger && seatsLeft === 0}
                        onClick={() => {
                          if (!me) {
                            onRequireIdentity();
                            return;
                          }
                          onToggleCarpoolSeat(ride.id);
                        }}
                        className={`flex-1 inline-flex items-center justify-center gap-1 rounded-xl py-1.5 text-xs font-bold transition cursor-pointer disabled:opacity-40 ${
                          isPassenger
                            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                            : 'bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 hover:border-sky-500 text-stone-700 dark:text-slate-200'
                        }`}
                      >
                        {isPassenger ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            {t.logistics.releaseSeatBtn}
                          </>
                        ) : (
                          t.logistics.reserveSeatBtn
                        )}
                      </button>
                    ) : (
                      <span className="text-[11px] font-semibold text-sky-700 dark:text-sky-300">
                        {t.logistics.youAreDriver}
                      </span>
                    )}

                    {(isDriver || isAdmin) && (
                      <button
                        type="button"
                        onClick={() => onDeleteCarpool(ride.id)}
                        title={t.logistics.deleteCarTitle}
                        className="p-1.5 text-stone-400 hover:text-rose-500 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      )}
    </div>
  );
}
