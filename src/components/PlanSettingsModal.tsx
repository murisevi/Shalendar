import { useModalDialog } from '../lib/useModalDialog';
import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Clock,
  Copy,
  Crown,
  Database,
  Download,
  EyeOff,
  Save,
  Settings,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import type {
  HolidayCountry,
  Participant,
  Plan,
  PlanGranularity,
  RetentionPolicy,
  SpecificSlot,
  UpdatePlanSettingsRequest,
} from '../../shared/types';
import {
  PLAN_EMOJIS,
  getMealSlots,
  getPresetSlotIds,
  getTimeSlots,
  isSlotGranularity,
  normalizeEnabledSlots,
} from '../../shared/dates';
import { getHolidayCountries } from '../../shared/holidays';
import { getRemainingDays, getRetentionPresets } from '../../shared/persistence';
import { buildCoOrganizerUrl } from '../lib/storage';
import { useI18n } from '../lib/i18n';
import { Avatar } from './Avatar';

interface PlanSettingsModalProps {
  open: boolean;
  onClose: () => void;
  plan: Plan;
  participants: Participant[];
  onSave: (updates: UpdatePlanSettingsRequest) => Promise<void>;
  onExtendExpiration: (extraDays?: number) => Promise<void>;
  onExportBackup: () => void;
  onRemoveParticipant: (participantId: string) => Promise<void>;
  onDeletePlan: () => Promise<void>;
}

function isoToDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PlanSettingsModal({
  open,
  onClose,
  plan,
  participants,
  onSave,
  onExtendExpiration,
  onExportBackup,
  onRemoveParticipant,
  onDeletePlan,
}: PlanSettingsModalProps) {
  const { language, t } = useI18n();
  const { dialogRef, titleId } = useModalDialog(open, onClose);
  const [title, setTitle] = useState(plan.title);
  const [description, setDescription] = useState(plan.description);
  const [location, setLocation] = useState(plan.location);
  const [emoji, setEmoji] = useState(plan.emoji);
  const [maxVotesPerUser, setMaxVotesPerUser] = useState(plan.maxVotesPerUser);
  const [granularity, setGranularity] = useState<PlanGranularity>(plan.granularity);
  const [enabledSlots, setEnabledSlots] = useState<SpecificSlot[]>(
    normalizeEnabledSlots(plan.granularity, plan.enabledSlots)
  );
  const [durationDays, setDurationDays] = useState(plan.durationDays);
  const [holidayCountry, setHolidayCountry] = useState<HolidayCountry>(plan.holidayCountry);
  const [blindVoting, setBlindVoting] = useState(plan.blindVoting);
  const [votingDeadline, setVotingDeadline] = useState(isoToDatetimeLocal(plan.votingDeadline));
  const [requiredIds, setRequiredIds] = useState<string[]>(plan.requiredParticipantIds);
  const [retentionPolicy, setRetentionPolicy] = useState<RetentionPolicy>(plan.retentionPolicy);
  const [retentionDays, setRetentionDays] = useState<number>(plan.retentionDays);
  const [saving, setSaving] = useState(false);
  const [extending, setExtending] = useState(false);
  const [copiedCoAdmin, setCopiedCoAdmin] = useState(false);
  const wasOpenRef = useRef(false);

  // Only populate form state when the modal opens (not on every background SSE snapshot)
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setTitle(plan.title);
    setDescription(plan.description);
    setLocation(plan.location);
    setEmoji(plan.emoji);
    setMaxVotesPerUser(plan.maxVotesPerUser);
    setGranularity(plan.granularity);
    setEnabledSlots(normalizeEnabledSlots(plan.granularity, plan.enabledSlots));
    setDurationDays(plan.durationDays);
    setHolidayCountry(plan.holidayCountry);
    setBlindVoting(plan.blindVoting);
    setVotingDeadline(isoToDatetimeLocal(plan.votingDeadline));
    setRequiredIds(plan.requiredParticipantIds);
    setRetentionPolicy(plan.retentionPolicy);
    setRetentionDays(plan.retentionDays);
  }, [open, plan]);

  if (!open) return null;

  const coOrgUrl = buildCoOrganizerUrl(plan.slug);
  const holidayCountries = getHolidayCountries(language);
  const retentionPresets = getRetentionPresets(language);
  const mealSlotOptions = getMealSlots(language);
  const dayPartSlotOptions = getTimeSlots(language);

  function handleChangeGranularity(next: PlanGranularity) {
    setGranularity(next);
    setEnabledSlots(getPresetSlotIds(next));
  }

  function toggleEnabledSlot(slotId: SpecificSlot) {
    setEnabledSlots((prev) => {
      const normalized = normalizeEnabledSlots(granularity, prev);
      if (normalized.includes(slotId)) {
        if (normalized.length <= 1) return normalized;
        return normalized.filter((s) => s !== slotId);
      }
      return normalizeEnabledSlots(granularity, [...normalized, slotId]);
    });
  }

  function toggleRequired(id: string) {
    setRequiredIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    let deadlineIso: string | null = null;
    if (votingDeadline) {
      const parsedDeadline = new Date(votingDeadline);
      if (!Number.isNaN(parsedDeadline.getTime())) {
        deadlineIso = parsedDeadline.toISOString();
      }
    }
    try {
      await onSave({
        title: title.trim(),
        description: description.trim(),
        location: location.trim(),
        emoji,
        maxVotesPerUser,
        granularity,
        enabledSlots: isSlotGranularity(granularity)
          ? normalizeEnabledSlots(granularity, enabledSlots)
          : [],
        durationDays,
        holidayCountry,
        blindVoting,
        votingDeadline: deadlineIso,
        requiredParticipantIds: requiredIds,
        retentionPolicy,
        retentionDays,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs sm:p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl rounded-t-[28px] sm:rounded-3xl border border-stone-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 pt-7 sm:pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-6 shadow-2xl space-y-5 animate-sheet-sm-pop max-h-[92dvh] sm:max-h-[90vh] overflow-y-auto overscroll-contain"
      >
        <span aria-hidden className="sm:hidden absolute left-1/2 top-2.5 h-1.5 w-10 -translate-x-1/2 rounded-full bg-stone-300 dark:bg-slate-700" />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-teal-100 dark:bg-teal-950/70 text-teal-700 dark:text-teal-300">
              <Settings className="h-5 w-5" />
            </span>
            <div>
              <h2 id={titleId} className="font-display text-lg font-extrabold tracking-tight">
                {t.settings.title}
              </h2>
              <p className="text-xs text-stone-500 dark:text-slate-400">
                {t.settings.subtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.close}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-stone-100 dark:hover:bg-slate-800 text-stone-500 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Emoji */}
          <div className="flex flex-wrap gap-1.5">
            {PLAN_EMOJIS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setEmoji(item)}
                className={`flex h-9 w-9 items-center justify-center rounded-xl text-lg transition cursor-pointer ${
                  emoji === item
                    ? 'bg-teal-100 dark:bg-teal-900/70 ring-2 ring-teal-500'
                    : 'bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 dark:hover:bg-slate-700'
                }`}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-stone-600 dark:text-slate-300 mb-1">
                {t.settings.fieldTitle}
              </label>
              <input
                type="text"
                required
                maxLength={80}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:border-teal-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-stone-600 dark:text-slate-300 mb-1">
                {t.settings.fieldLocation}
              </label>
              <input
                type="text"
                maxLength={120}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:border-teal-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-stone-600 dark:text-slate-300 mb-1">
                {t.settings.fieldDescription}
              </label>
              <textarea
                rows={2}
                maxLength={400}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:border-teal-500 resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-600 dark:text-slate-300 mb-1">
                {t.settings.fieldGranularity}
              </label>
              <select
                value={granularity}
                onChange={(e) => handleChangeGranularity(e.target.value as PlanGranularity)}
                className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold outline-none focus:border-teal-500"
              >
                <option value="day">{t.settings.granularityDay}</option>
                <option value="meals">{t.settings.granularityMeals}</option>
                <option value="slots">{t.settings.granularitySlots}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-600 dark:text-slate-300 mb-1">
                {t.settings.fieldDuration}
              </label>
              <select
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
                className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold outline-none focus:border-teal-500"
              >
                <option value={1}>{t.settings.durationDay(1)}</option>
                <option value={2}>{t.settings.durationDay(2)}</option>
                <option value={3}>{t.settings.durationDay(3)}</option>
                <option value={4}>{t.settings.durationDay(4)}</option>
                <option value={5}>{t.settings.durationDay(5)}</option>
                <option value={7}>{t.settings.durationDay(7)}</option>
              </select>
            </div>

            {isSlotGranularity(granularity) && (
              <div className="sm:col-span-2 rounded-2xl border border-teal-200/80 dark:border-teal-800/50 bg-teal-50/45 dark:bg-teal-950/25 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <span className="text-[11px] font-semibold text-teal-900 dark:text-teal-200">
                    {t.settings.enabledSlotsLabel}
                  </span>
                  {granularity === 'meals' && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEnabledSlots(['lunch', 'dinner'])}
                        className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold transition cursor-pointer ${
                          enabledSlots.length === 2 &&
                          enabledSlots.includes('lunch') &&
                          enabledSlots.includes('dinner')
                            ? 'bg-teal-600 text-white'
                            : 'bg-white/80 dark:bg-slate-900/70 text-teal-700 dark:text-teal-300 border border-teal-200/80 dark:border-teal-800/60'
                        }`}
                      >
                        {t.home.presetLunchDinner}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEnabledSlots(getPresetSlotIds('meals'))}
                        className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold transition cursor-pointer ${
                          enabledSlots.length === 4
                            ? 'bg-teal-600 text-white'
                            : 'bg-white/80 dark:bg-slate-900/70 text-teal-700 dark:text-teal-300 border border-teal-200/80 dark:border-teal-800/60'
                        }`}
                      >
                        {t.home.presetAll}
                      </button>
                    </div>
                  )}
                </div>
                <div
                  className={`grid gap-1.5 ${
                    granularity === 'meals' ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'
                  }`}
                >
                  {(granularity === 'meals' ? mealSlotOptions : dayPartSlotOptions).map((slot) => {
                    const active = enabledSlots.includes(slot.id);
                    return (
                      <button
                        key={slot.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleEnabledSlot(slot.id)}
                        className={`flex items-center justify-center gap-1 rounded-xl border px-2 py-1.5 text-xs font-semibold transition cursor-pointer ${
                          active
                            ? 'border-teal-500 bg-white dark:bg-slate-900 text-teal-800 dark:text-teal-200 shadow-2xs ring-1 ring-teal-500/20'
                            : 'border-stone-200/80 dark:border-slate-700 bg-white/40 dark:bg-slate-900/35 text-stone-400 dark:text-slate-500 line-through'
                        }`}
                      >
                        <span>{slot.emoji}</span>
                        <span>{slot.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-stone-600 dark:text-slate-300 mb-1">
                {t.settings.fieldMaxVotes}
              </label>
              <input
                type="number"
                min={0}
                max={20}
                value={maxVotesPerUser}
                onChange={(e) => setMaxVotesPerUser(Math.max(0, Number(e.target.value)))}
                className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold outline-none focus:border-teal-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-600 dark:text-slate-300 mb-1">
                {t.settings.fieldHolidays}
              </label>
              <select
                value={holidayCountry}
                onChange={(e) => setHolidayCountry(e.target.value as HolidayCountry)}
                className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold outline-none focus:border-teal-500"
              >
                {holidayCountries.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-stone-600 dark:text-slate-300 mb-1">
                {t.settings.fieldDeadline}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="datetime-local"
                  value={votingDeadline}
                  onChange={(e) => setVotingDeadline(e.target.value)}
                  className="flex-1 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 px-3 py-2 text-xs outline-none focus:border-teal-500"
                />
                {votingDeadline && (
                  <button
                    type="button"
                    onClick={() => setVotingDeadline('')}
                    className="rounded-xl border border-stone-200 dark:border-slate-700 px-2.5 py-2 text-xs font-semibold text-stone-500 hover:text-stone-800 cursor-pointer"
                  >
                    {t.settings.clearDeadline}
                  </button>
                )}
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2.5 rounded-2xl border border-stone-200/80 dark:border-slate-800 bg-stone-50/70 dark:bg-slate-800/40 px-3.5 py-2.5 text-xs font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={blindVoting}
              onChange={(e) => setBlindVoting(e.target.checked)}
              className="h-4 w-4 rounded accent-teal-600"
            />
            <EyeOff className="h-4 w-4 text-amber-600 shrink-0" />
            <span>{t.settings.blindVotingLabel}</span>
          </label>

          {/* Adaptive Persistence / Retention Controls */}
          <div className="space-y-2.5 rounded-2xl border border-stone-200/80 dark:border-slate-800 bg-stone-50/60 dark:bg-slate-800/35 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-stone-700 dark:text-slate-200">
                <Database className="h-3.5 w-3.5 text-teal-600" />
                {t.settings.retentionTitle}
              </span>
              {(() => {
                const rem = getRemainingDays(plan.expiresAt);
                return rem !== null ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-950/60 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
                    <Clock className="h-3 w-3" />
                    {t.settings.autoDeleteIn(rem)}
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-100 dark:bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-200">
                    {t.settings.noAutoExpiration}
                  </span>
                );
              })()}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {retentionPresets.map((preset) => {
                const selected =
                  retentionPolicy === preset.policy &&
                  (preset.policy !== 'fixed_ttl' || retentionDays === preset.retentionDays);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setRetentionPolicy(preset.policy);
                      setRetentionDays(preset.retentionDays);
                    }}
                    className={`rounded-xl px-2 py-2 text-xs font-semibold border transition cursor-pointer ${
                      selected
                        ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/70 text-teal-800 dark:text-teal-200'
                        : 'border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-stone-600 dark:text-slate-300'
                    }`}
                  >
                    {preset.shortLabel}
                  </button>
                );
              })}
            </div>

            <p className="text-[11px] text-stone-500 dark:text-slate-400">
              {retentionPresets.find((p) => p.policy === retentionPolicy)?.description}
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {plan.expiresAt && (
                <button
                  type="button"
                  disabled={extending}
                  onClick={async () => {
                    setExtending(true);
                    try {
                      await onExtendExpiration(30);
                    } finally {
                      setExtending(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-teal-300 dark:border-teal-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/50 transition cursor-pointer disabled:opacity-50"
                >
                  <Clock className="h-3.5 w-3.5" />
                  {extending ? t.settings.extendingBtn : t.settings.extend30Btn}
                </button>
              )}
              <button
                type="button"
                onClick={onExportBackup}
                className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-stone-700 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                {t.settings.exportBackupBtn}
              </button>
            </div>
          </div>

          {/* Required attendees & participant management */}
          <div className="space-y-2 border-t border-stone-100 dark:border-slate-800 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-slate-400">
                {t.settings.participantsHeader(participants.length)}
              </span>
            </div>
            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
              {participants.map((p) => {
                const isReq = requiredIds.includes(p.id);
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-stone-200/70 dark:border-slate-800 bg-stone-50/60 dark:bg-slate-800/40 px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar participant={p} size="xs" required={isReq} />
                      <span className="text-xs font-semibold truncate">{p.name}</span>
                      {p.isOrganizer && (
                        <span className="rounded-full bg-teal-100 dark:bg-teal-950/70 px-1.5 py-0.5 text-[10px] font-bold text-teal-700 dark:text-teal-300">
                          {t.settings.orgBadge}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleRequired(p.id)}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-bold transition cursor-pointer ${
                          isReq
                            ? 'border-amber-400 bg-amber-100 dark:bg-amber-950/70 text-amber-900 dark:text-amber-200'
                            : 'border-stone-200 dark:border-slate-700 text-stone-500 hover:border-amber-400'
                        }`}
                      >
                        <Crown className="h-3 w-3" />
                        {isReq ? t.settings.requiredBadge : t.settings.markKeyBtn}
                      </button>
                      {!p.isOrganizer && (
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(t.settings.removeParticipantConfirm(p.name))) {
                              onRemoveParticipant(p.id);
                            }
                          }}
                          title={t.settings.removeParticipantTitle}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/50 transition cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Co-organizer link */}
          {coOrgUrl && (
            <div className="rounded-2xl border border-teal-200/70 dark:border-teal-800/50 bg-teal-50/50 dark:bg-teal-950/25 p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs min-w-0">
                <ShieldCheck className="h-4 w-4 text-teal-600 shrink-0" />
                <span className="text-stone-700 dark:text-slate-200 truncate">
                  {t.settings.coOrgPrompt}
                </span>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(coOrgUrl);
                  } catch {
                    const ta = document.createElement('textarea');
                    ta.value = coOrgUrl;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                  }
                  setCopiedCoAdmin(true);
                  setTimeout(() => setCopiedCoAdmin(false), 2000);
                }}
                className="shrink-0 inline-flex items-center gap-1 rounded-xl bg-teal-600 hover:bg-teal-700 px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
              >
                {copiedCoAdmin ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedCoAdmin ? t.common.copied : t.settings.coOrgBtn}
              </button>
            </div>
          )}

          {/* Footer actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 dark:border-slate-800 pt-4">
            <button
              type="button"
              onClick={async () => {
                if (window.confirm(t.settings.deletePlanConfirm)) {
                  await onDeletePlan();
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t.settings.deletePlanBtn}
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-3.5 py-2 text-xs font-semibold text-stone-500 hover:text-stone-800 cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-4 py-2 text-xs font-bold text-white shadow-xs transition cursor-pointer"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? t.common.saving : t.settings.saveSettingsBtn}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
