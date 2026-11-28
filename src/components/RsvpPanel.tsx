import { useEffect, useState } from 'react';
import { CheckCircle2, HelpCircle, Minus, Plus, Save, Users, XCircle } from 'lucide-react';
import type { Participant, RsvpEntry, RsvpStatus } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import { Avatar } from './Avatar';

interface RsvpPanelProps {
  participants: Participant[];
  rsvps: RsvpEntry[];
  me: Participant | null;
  onSaveRsvp: (status: RsvpStatus, guestsCount: number, note: string) => Promise<void>;
  onRequireIdentity: () => void;
}

export function RsvpPanel({
  participants,
  rsvps,
  me,
  onSaveRsvp,
  onRequireIdentity,
}: RsvpPanelProps) {
  const { t } = useI18n();
  const myRsvp = me ? rsvps.find((r) => r.participantId === me.id) : undefined;
  const [status, setStatus] = useState<RsvpStatus>(myRsvp?.status ?? 'going');
  const [guestsCount, setGuestsCount] = useState<number>(myRsvp?.guestsCount ?? 0);
  const [note, setNote] = useState<string>(myRsvp?.note ?? '');
  const [saving, setSaving] = useState(false);

  const myRsvpStatus = myRsvp?.status;
  const myRsvpGuests = myRsvp?.guestsCount;
  const myRsvpNote = myRsvp?.note;

  useEffect(() => {
    if (myRsvpStatus !== undefined) {
      setStatus(myRsvpStatus);
      setGuestsCount(myRsvpGuests ?? 0);
      setNote(myRsvpNote ?? '');
    } else {
      setStatus('going');
      setGuestsCount(0);
      setNote('');
    }
  }, [me?.id, myRsvpStatus, myRsvpGuests, myRsvpNote]);

  const participantById = new Map(participants.map((p) => [p.id, p]));
  const goingList = rsvps.filter((r) => r.status === 'going');
  const maybeList = rsvps.filter((r) => r.status === 'maybe');
  const notGoingList = rsvps.filter((r) => r.status === 'not_going');

  const extraGuestsTotal = goingList.reduce((acc, r) => acc + r.guestsCount, 0);
  const totalHeadcount = goingList.length + extraGuestsTotal;

  async function handleQuickSelect(next: RsvpStatus) {
    if (!me) {
      onRequireIdentity();
      return;
    }
    setStatus(next);
    setSaving(true);
    try {
      await onSaveRsvp(next, next === 'going' ? guestsCount : 0, note);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!me) {
      onRequireIdentity();
      return;
    }
    setSaving(true);
    try {
      await onSaveRsvp(status, status === 'going' ? guestsCount : 0, note);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-3xl border border-emerald-200/80 dark:border-emerald-800/60 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-sm space-y-4 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="h-4.5 w-4.5 text-emerald-600 dark:text-emerald-400" />
          <h3 className="font-display text-sm sm:text-base font-extrabold tracking-tight">
            {t.rsvp.title}
          </h3>
        </div>
        <span className="rounded-full bg-emerald-100 dark:bg-emerald-950/70 px-3 py-1 text-xs font-extrabold text-emerald-800 dark:text-emerald-200 tabular-nums">
          {t.common.confirmedCount(totalHeadcount)}
          {extraGuestsTotal > 0 ? t.rsvp.extraGuests(extraGuestsTotal) : ''}
        </span>
      </div>

      {/* My RSVP Controls */}
      <div className="space-y-2.5 rounded-2xl bg-stone-50/90 dark:bg-slate-800/50 p-3">
        <div className="grid grid-cols-3 gap-1.5">
          {(
            [
              {
                id: 'going' as const,
                label: t.rsvp.going,
                icon: CheckCircle2,
                active: 'border-emerald-600 bg-emerald-600 text-white',
              },
              {
                id: 'maybe' as const,
                label: t.rsvp.maybe,
                icon: HelpCircle,
                active: 'border-amber-500 bg-amber-500 text-white',
              },
              {
                id: 'not_going' as const,
                label: t.rsvp.notGoing,
                icon: XCircle,
                active: 'border-rose-500 bg-rose-500 text-white',
              },
            ] as const
          ).map((opt) => {
            const Icon = opt.icon;
            const active = myRsvp?.status === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={saving}
                onClick={() => handleQuickSelect(opt.id)}
                className={`inline-flex items-center justify-center gap-1 rounded-xl border py-2 text-xs font-bold transition cursor-pointer ${
                  active
                    ? opt.active
                    : 'border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-stone-700 dark:text-slate-200 hover:border-teal-400'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>

        <form onSubmit={handleSaveDetails} className="flex flex-wrap items-center gap-2">
          {status === 'going' && (
            <div className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs">
              <span className="text-stone-500 dark:text-slate-400 font-medium">
                {t.rsvp.guestsLabel}
              </span>
              <button
                type="button"
                onClick={() => setGuestsCount((g) => Math.max(0, g - 1))}
                className="flex h-5 w-5 items-center justify-center rounded-md hover:bg-stone-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className="font-bold tabular-nums min-w-[18px] text-center">+{guestsCount}</span>
              <button
                type="button"
                onClick={() => setGuestsCount((g) => Math.min(10, g + 1))}
                className="flex h-5 w-5 items-center justify-center rounded-md hover:bg-stone-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          )}

          <input
            type="text"
            maxLength={160}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.rsvp.notePlaceholder}
            className="flex-1 min-w-[180px] rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs outline-none focus:border-teal-500"
          />

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" />
            {t.common.save}
          </button>
        </form>
      </div>

      {/* Confirmed Breakdown */}
      {rsvps.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {[...goingList, ...maybeList, ...notGoingList].map((r) => {
            const p = participantById.get(r.participantId);
            if (!p) return null;
            const tone =
              r.status === 'going'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100'
                : r.status === 'maybe'
                  ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100'
                  : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200';
            return (
              <span
                key={r.participantId}
                className={`inline-flex items-center gap-1.5 rounded-full border pl-1 pr-2.5 py-0.5 font-medium ${tone}`}
              >
                <Avatar participant={p} size="xs" />
                <span>
                  {p.name}
                  {r.status === 'going' && r.guestsCount > 0 ? ` (+${r.guestsCount})` : ''}
                </span>
                {r.note && <span className="text-[10px] opacity-80 italic">· {r.note}</span>}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
