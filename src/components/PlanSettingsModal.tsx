import { useEffect, useState } from 'react';
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
  UpdatePlanSettingsRequest,
} from '../../shared/types';
import { PLAN_EMOJIS } from '../../shared/dates';
import { HOLIDAY_COUNTRIES } from '../../shared/holidays';
import { getRemainingDays, RETENTION_PRESETS } from '../../shared/persistence';
import { buildCoOrganizerUrl } from '../lib/storage';
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
  const [title, setTitle] = useState(plan.title);
  const [description, setDescription] = useState(plan.description);
  const [location, setLocation] = useState(plan.location);
  const [emoji, setEmoji] = useState(plan.emoji);
  const [maxVotesPerUser, setMaxVotesPerUser] = useState(plan.maxVotesPerUser);
  const [granularity, setGranularity] = useState<PlanGranularity>(plan.granularity);
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

  useEffect(() => {
    if (!open) return;
    setTitle(plan.title);
    setDescription(plan.description);
    setLocation(plan.location);
    setEmoji(plan.emoji);
    setMaxVotesPerUser(plan.maxVotesPerUser);
    setGranularity(plan.granularity);
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

  function toggleRequired(id: string) {
    setRequiredIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        description: description.trim(),
        location: location.trim(),
        emoji,
        maxVotesPerUser,
        granularity,
        durationDays,
        holidayCountry,
        blindVoting,
        votingDeadline: votingDeadline ? new Date(votingDeadline).toISOString() : null,
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-3xl border border-stone-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-5 animate-pop max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-teal-100 dark:bg-teal-950/70 text-teal-700 dark:text-teal-300">
              <Settings className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-lg font-extrabold tracking-tight">
                Ajustes de la quedada
              </h2>
              <p className="text-xs text-stone-500 dark:text-slate-400">
                Control del organizador · cambios sincronizados en vivo.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
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
                Título
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
                Lugar
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
                Descripción
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
                Modo de disponibilidad
              </label>
              <select
                value={granularity}
                onChange={(e) => setGranularity(e.target.value as PlanGranularity)}
                className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold outline-none focus:border-teal-500"
              >
                <option value="day">Días completos</option>
                <option value="slots">Franjas (Mañana / Tarde / Noche)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-600 dark:text-slate-300 mb-1">
                Duración (búsqueda multi-día)
              </label>
              <select
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
                className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold outline-none focus:border-teal-500"
              >
                <option value={1}>1 día</option>
                <option value={2}>2 días consecutivos</option>
                <option value={3}>3 días consecutivos</option>
                <option value={4}>4 días consecutivos</option>
                <option value={5}>5 días consecutivos</option>
                <option value={7}>7 días consecutivos</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-600 dark:text-slate-300 mb-1">
                Máximo votos por persona (0 = sin límite)
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
                Festivos en el calendario
              </label>
              <select
                value={holidayCountry}
                onChange={(e) => setHolidayCountry(e.target.value as HolidayCountry)}
                className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold outline-none focus:border-teal-500"
              >
                {HOLIDAY_COUNTRIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-stone-600 dark:text-slate-300 mb-1">
                Fecha límite de votación (opcional)
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
                    Quitar
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
            <span>Voto oculto (esconde los votos de los demás hasta cerrar votación)</span>
          </label>

          {/* Adaptive Persistence / Retention Controls */}
          <div className="space-y-2.5 rounded-2xl border border-stone-200/80 dark:border-slate-800 bg-stone-50/60 dark:bg-slate-800/35 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-stone-700 dark:text-slate-200">
                <Database className="h-3.5 w-3.5 text-teal-600" />
                Memoria y caducidad
              </span>
              {(() => {
                const rem = getRemainingDays(plan.expiresAt);
                return rem !== null ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-950/60 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
                    <Clock className="h-3 w-3" />
                    Auto-borrado en {rem} {rem === 1 ? 'día' : 'días'}
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-100 dark:bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-200">
                    Sin caducidad automática
                  </span>
                );
              })()}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {RETENTION_PRESETS.map((preset) => {
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
              {RETENTION_PRESETS.find((p) => p.policy === retentionPolicy)?.description}
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
                  {extending ? 'Extendiendo...' : 'Extender +30 días'}
                </button>
              )}
              <button
                type="button"
                onClick={onExportBackup}
                className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-stone-700 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                Exportar copia (.json)
              </button>
            </div>
          </div>

          {/* Required attendees & participant management */}
          <div className="space-y-2 border-t border-stone-100 dark:border-slate-800 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-slate-400">
                Participantes ({participants.length}) · Marca los imprescindibles ★
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
                          Org
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
                        {isReq ? 'Imprescindible' : 'Marcar clave'}
                      </button>
                      {!p.isOrganizer && (
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`¿Eliminar a ${p.name} y sus respuestas?`)) {
                              onRemoveParticipant(p.id);
                            }
                          }}
                          title="Eliminar participante"
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
                  ¿Compartir permisos de organizador con alguien de confianza?
                </span>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(coOrgUrl).catch(() => {});
                  setCopiedCoAdmin(true);
                  setTimeout(() => setCopiedCoAdmin(false), 2000);
                }}
                className="shrink-0 inline-flex items-center gap-1 rounded-xl bg-teal-600 hover:bg-teal-700 px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
              >
                {copiedCoAdmin ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedCoAdmin ? '¡Copiado!' : 'Enlace admin'}
              </button>
            </div>
          )}

          {/* Footer actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 dark:border-slate-800 pt-4">
            <button
              type="button"
              onClick={async () => {
                if (
                  window.confirm(
                    '¿Eliminar definitivamente esta quedada para todos? Esta acción no se puede deshacer.'
                  )
                ) {
                  await onDeletePlan();
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Borrar quedada
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-3.5 py-2 text-xs font-semibold text-stone-500 hover:text-stone-800 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-4 py-2 text-xs font-bold text-white shadow-xs transition cursor-pointer"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Guardando...' : 'Guardar ajustes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
