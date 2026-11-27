import { useEffect, useState } from 'react';
import { Eye, KeyRound, LogOut, MapPin, Save, UserPlus, X } from 'lucide-react';
import type { Participant, Plan } from '../../shared/types';
import { AVATAR_COLORS, AVATAR_EMOJIS } from '../../shared/dates';
import { useI18n } from '../lib/i18n';

interface IdentityModalProps {
  open: boolean;
  mode: 'join' | 'edit';
  plan: Plan;
  participantCount: number;
  currentParticipant?: Participant | null;
  onClose: () => void;
  onJoinNew: (name: string, color: string, emoji: string, pin?: string) => Promise<void>;
  onClaimExisting: (name: string, pin: string) => Promise<void>;
  onUpdateProfile?: (updates: {
    name?: string;
    avatarColor?: string;
    avatarEmoji?: string;
    pin?: string;
  }) => Promise<void>;
  onLeavePlan?: () => Promise<void>;
}

export function IdentityModal({
  open,
  mode,
  plan,
  participantCount,
  currentParticipant,
  onClose,
  onJoinNew,
  onClaimExisting,
  onUpdateProfile,
  onLeavePlan,
}: IdentityModalProps) {
  const { t } = useI18n();
  const [subTab, setSubTab] = useState<'new' | 'recover'>('new');
  const [name, setName] = useState('');
  const [color, setColor] = useState(AVATAR_COLORS[participantCount % AVATAR_COLORS.length]);
  const [emoji, setEmoji] = useState(AVATAR_EMOJIS[participantCount % AVATAR_EMOJIS.length]);
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPin('');
    if (mode === 'edit' && currentParticipant) {
      setName(currentParticipant.name);
      setColor(currentParticipant.avatarColor);
      setEmoji(currentParticipant.avatarEmoji);
    } else {
      setName('');
      setColor(AVATAR_COLORS[participantCount % AVATAR_COLORS.length]);
      setEmoji(AVATAR_EMOJIS[participantCount % AVATAR_EMOJIS.length]);
      setSubTab('new');
    }
  }, [open, mode, currentParticipant, participantCount]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === 'edit' && onUpdateProfile) {
      if (!name.trim()) {
        setError(t.identity.errWriteName);
        return;
      }
      if (pin.trim() && pin.trim().length < 4) {
        setError(t.identity.errPinLength);
        return;
      }
      setLoading(true);
      try {
        await onUpdateProfile({
          name: name.trim(),
          avatarColor: color,
          avatarEmoji: emoji,
          ...(pin.trim() ? { pin: pin.trim() } : {}),
        });
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.identity.errUpdateFailed);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (subTab === 'recover') {
      if (!name.trim() || pin.trim().length < 4) {
        setError(t.identity.errRecoverInput);
        return;
      }
      setLoading(true);
      try {
        await onClaimExisting(name.trim(), pin.trim());
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.identity.errRecoverFailed);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!name.trim()) {
      setError(t.identity.errJoinName);
      return;
    }
    if (pin.trim() && pin.trim().length < 4) {
      setError(t.identity.errOptionalPin);
      return;
    }

    setLoading(true);
    try {
      await onJoinNew(name.trim(), color, emoji, pin.trim() || undefined);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.identity.errJoinFailed);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl border border-stone-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-7 shadow-2xl space-y-5 animate-pop max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-2">
          {mode === 'join' ? (
            <div className="flex-1 rounded-2xl border border-teal-200/70 dark:border-teal-800/50 bg-teal-50/70 dark:bg-teal-950/40 p-3.5 flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white dark:bg-slate-800 text-2xl shadow-xs">
                {plan.emoji}
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300">
                  {t.identity.invitedEyebrow}
                </p>
                <h2 className="font-display text-base font-extrabold tracking-tight text-stone-900 dark:text-white truncate">
                  {plan.title}
                </h2>
                {plan.location && (
                  <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-stone-600 dark:text-slate-300 truncate">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate">{plan.location}</span>
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div>
              <h2 className="font-display text-xl font-extrabold tracking-tight">
                {t.identity.editTitle}
              </h2>
              <p className="text-xs text-stone-500 dark:text-slate-400">
                {t.identity.editSubtitle}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.close}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-stone-100 dark:hover:bg-slate-800 text-stone-500 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode toggle when joining */}
        {mode === 'join' && (
          <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-stone-100 dark:bg-slate-800/80 p-1">
            <button
              type="button"
              onClick={() => {
                setSubTab('new');
                setError(null);
              }}
              className={`rounded-xl py-2 text-xs font-bold transition cursor-pointer ${
                subTab === 'new'
                  ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-300 shadow-2xs'
                  : 'text-stone-500 dark:text-slate-400'
              }`}
            >
              {t.identity.tabNew}
            </button>
            <button
              type="button"
              onClick={() => {
                setSubTab('recover');
                setError(null);
              }}
              className={`rounded-xl py-2 text-xs font-bold transition cursor-pointer ${
                subTab === 'recover'
                  ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-300 shadow-2xs'
                  : 'text-stone-500 dark:text-slate-400'
              }`}
            >
              {t.identity.tabRecover}
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {subTab === 'recover' && mode === 'join' ? (
            <div className="space-y-3">
              <p className="text-xs text-stone-500 dark:text-slate-400">
                {t.identity.recoverDesc}
              </p>
              <input
                type="text"
                autoFocus
                required
                maxLength={32}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.identity.recoverNamePlaceholder}
                className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm outline-none focus:border-teal-500"
              />
              <input
                type="password"
                inputMode="numeric"
                required
                maxLength={12}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder={t.identity.recoverPinPlaceholder}
                className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm outline-none focus:border-teal-500"
              />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span
                  style={{ backgroundColor: color }}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-xl text-white shadow-sm"
                >
                  {emoji}
                </span>
                <input
                  type="text"
                  autoFocus
                  required
                  maxLength={32}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t.identity.namePlaceholder}
                  className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-3 focus:ring-teal-500/15"
                />
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {AVATAR_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      style={{ backgroundColor: c }}
                      aria-label={t.identity.colorAria(c)}
                      className={`h-6 w-6 rounded-full transition cursor-pointer ${
                        color === c
                          ? 'ring-2 ring-offset-2 ring-stone-900 dark:ring-white dark:ring-offset-slate-900 scale-110'
                          : 'opacity-80 hover:opacity-100'
                      }`}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-1">
                  {AVATAR_EMOJIS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => setEmoji(em)}
                      className={`flex h-8 w-8 items-center justify-center rounded-lg text-base transition cursor-pointer ${
                        emoji === em
                          ? 'bg-teal-100 dark:bg-teal-900/70 ring-1 ring-teal-500'
                          : 'hover:bg-stone-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-stone-600 dark:text-slate-300 mb-1">
                  <KeyRound className="h-3.5 w-3.5 text-teal-600" />
                  <span>
                    {t.identity.pinLabel}{' '}
                    <span className="text-stone-400 font-normal">
                      ({t.common.optional}
                      {currentParticipant?.hasPin ? ` · ${t.identity.pinAlreadySet}` : ''})
                    </span>
                  </span>
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={12}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder={t.identity.pinPlaceholder}
                  className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 px-3 py-2 text-xs outline-none focus:border-teal-500"
                />
              </div>
            </>
          )}

          {error && (
            <p className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 py-3 text-sm font-bold text-white shadow-sm transition cursor-pointer"
          >
            {mode === 'edit' ? (
              <>
                <Save className="h-4 w-4" />
                {loading ? t.common.saving : t.identity.saveChangesBtn}
              </>
            ) : subTab === 'recover' ? (
              <>
                <KeyRound className="h-4 w-4" />
                {loading ? t.identity.verifyingBtn : t.identity.recoverSessionBtn}
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" />
                {loading ? t.identity.joiningBtn : t.identity.joinBtn}
              </>
            )}
          </button>

          {mode === 'join' && (
            <button
              type="button"
              onClick={onClose}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-200 dark:border-slate-700 hover:bg-stone-50 dark:hover:bg-slate-800 py-2.5 text-xs font-semibold text-stone-600 dark:text-slate-300 transition cursor-pointer"
            >
              <Eye className="h-3.5 w-3.5" />
              {t.identity.justBrowseBtn}
            </button>
          )}

          {mode === 'edit' && onLeavePlan && (
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm(t.identity.leaveConfirm)) {
                  return;
                }
                setLoading(true);
                try {
                  await onLeavePlan();
                  onClose();
                } finally {
                  setLoading(false);
                }
              }}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-950/60 py-2.5 text-xs font-bold text-rose-700 dark:text-rose-300 transition cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              {t.identity.leaveBtn}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
