import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  BellRing,
  Check,
  Copy,
  ImageDown,
  MessageCircle,
  QrCode,
  Share2,
  Smartphone,
  X,
} from 'lucide-react';
import type {
  AvailabilityEntry,
  DaySummary,
  Participant,
  Plan,
  RsvpEntry,
  VoteEntry,
} from '../../shared/types';
import { formatDateLongEs, formatDateRangeEs } from '../../shared/dates';
import { buildDeviceTransferUrl } from '../lib/storage';
import { downloadOrShareInviteCard } from '../lib/inviteCard';

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  plan: Plan;
  participants: Participant[];
  availabilities: AvailabilityEntry[];
  votes: VoteEntry[];
  rsvps: RsvpEntry[];
  topDates: DaySummary[];
  hasSession: boolean;
  onToast?: (msg: string) => void;
}

type ShareTab = 'whatsapp' | 'qr' | 'device';

function renderFormattedLine(line: string) {
  const parts = line.split(/(\*[^*]+\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <strong key={idx} className="font-bold text-stone-900 dark:text-white">
          {part.slice(1, -1)}
        </strong>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

export function ShareModal({
  open,
  onClose,
  plan,
  participants,
  availabilities,
  votes,
  rsvps,
  topDates,
  hasSession,
  onToast,
}: ShareModalProps) {
  const [tab, setTab] = useState<ShareTab>('whatsapp');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [copiedNudge, setCopiedNudge] = useState(false);
  const [copiedDevice, setCopiedDevice] = useState(false);
  const [exportingCard, setExportingCard] = useState(false);
  const [inviteQr, setInviteQr] = useState<string>('');
  const [deviceQr, setDeviceQr] = useState<string>('');

  const shareUrl = `${window.location.origin}/e/${plan.slug}`;
  const transferUrl = useMemo(
    () => (open && hasSession ? buildDeviceTransferUrl(plan.slug, true) : ''),
    [open, hasSession, plan.slug]
  );

  useEffect(() => {
    if (!open) return;
    QRCode.toDataURL(shareUrl, { width: 240, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } })
      .then(setInviteQr)
      .catch(() => {});
    if (transferUrl) {
      QRCode.toDataURL(transferUrl, { width: 220, margin: 2, color: { dark: '#0f766e', light: '#ffffff' } })
        .then(setDeviceQr)
        .catch(() => {});
    }
  }, [open, shareUrl, transferUrl]);

  // Detect friends who haven't marked days / voted / RSVP'd yet for smart nudge
  const missingFriends = useMemo(() => {
    if (plan.confirmedDate) {
      const rsvpIds = new Set(rsvps.map((r) => r.participantId));
      return participants.filter((p) => !rsvpIds.has(p.id));
    }
    const availIds = new Set(availabilities.map((a) => a.participantId));
    const voteIds = new Set(votes.map((v) => v.participantId));
    const noAvail = participants.filter((p) => !availIds.has(p.id));
    if (noAvail.length > 0) return noAvail;
    if (plan.votingOpen && votes.length > 0) {
      return participants.filter((p) => !voteIds.has(p.id));
    }
    return [];
  }, [plan.confirmedDate, plan.votingOpen, participants, availabilities, votes, rsvps]);

  if (!open) return null;

  const blocks: string[] = [];
  if (plan.confirmedDate) {
    blocks.push(`*¡Fecha confirmada! ${plan.title}*`);
    const dateLabel = plan.confirmedEndDate
      ? formatDateRangeEs(plan.confirmedDate, plan.confirmedEndDate)
      : formatDateLongEs(plan.confirmedDate);
    blocks.push(`Cuándo: *${dateLabel}*${plan.confirmedTime ? ` a las ${plan.confirmedTime}` : ''}`);
    if (plan.location) blocks.push(`Lugar: ${plan.location}`);
    blocks.push('');
    blocks.push('Confirma tu asistencia (RSVP), mira los coches y añádelo a tu calendario:');
    blocks.push(shareUrl);
  } else if (topDates.length > 0) {
    blocks.push(`*¡Vamos a organizar "${plan.title}"!*`);
    if (plan.location) blocks.push(`Lugar: ${plan.location}`);
    blocks.push('');
    blocks.push(
      `*Mejores días hasta ahora* (${participants.length} ${participants.length === 1 ? 'persona' : 'personas'}):`
    );
    topDates.slice(0, 3).forEach((d, i) => {
      const voteInfo =
        !plan.blindVoting && d.votes.length > 0
          ? ` · ${d.votes.length} ${d.votes.length === 1 ? 'voto' : 'votos'}`
          : '';
      blocks.push(`${i + 1}. ${formatDateLongEs(d.date)} — ${d.yes.length} pueden${voteInfo}`);
    });
    blocks.push('');
    blocks.push('Entra en el calendario, apunta qué días puedes y vota tu favorito:');
    blocks.push(shareUrl);
  } else {
    blocks.push(`*¡Hola! Vamos a organizar "${plan.title}"*`);
    if (plan.location) blocks.push(`Lugar: ${plan.location}`);
    if (plan.description) blocks.push(plan.description);
    blocks.push('');
    blocks.push('Entra en el calendario, marca los días que puedes y vota tu favorito:');
    blocks.push(shareUrl);
  }

  const messageText = blocks.join('\n');
  const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(messageText)}`;

  const nudgeNames = missingFriends.map((p) => p.name).join(', ');
  const nudgeText = plan.confirmedDate
    ? `¡Hey ${nudgeNames}! Ya tenemos fecha para *${plan.title}* (${formatDateRangeEs(plan.confirmedDate, plan.confirmedEndDate)}). Confirma si vienes aquí:\n${shareUrl}`
    : `¡Hey ${nudgeNames}! Solo faltáis vosotros por marcar días o votar en *${plan.title}*:\n${shareUrl}`;

  async function copyText(text: string, which: 'link' | 'summary' | 'nudge' | 'device') {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    const setters = {
      link: setCopiedLink,
      summary: setCopiedSummary,
      nudge: setCopiedNudge,
      device: setCopiedDevice,
    };
    setters[which](true);
    setTimeout(() => setters[which](false), 2000);
  }

  async function handleExportCard() {
    setExportingCard(true);
    try {
      const result = await downloadOrShareInviteCard({
        plan,
        participants,
        rsvps,
        shareUrl,
      });
      onToast?.(
        result === 'shared'
          ? 'Tarjeta compartida'
          : 'Tarjeta de invitación PNG descargada'
      );
    } catch {
      onToast?.('No se pudo generar la tarjeta PNG');
    } finally {
      setExportingCard(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl border border-stone-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4 animate-pop max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-teal-100 dark:bg-teal-950/70 text-teal-700 dark:text-teal-300">
              <Share2 className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-lg font-extrabold tracking-tight">
                Compartir quedada
              </h2>
              <p className="text-xs text-stone-500 dark:text-slate-400">
                Enlace, tarjeta visual PNG, código QR o traspaso de dispositivo.
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

        {/* Sub-tabs */}
        <div className="grid grid-cols-3 gap-1 rounded-2xl bg-stone-100 dark:bg-slate-800/80 p-1">
          {[
            { id: 'whatsapp' as const, label: 'Enlace y Chat', icon: MessageCircle },
            { id: 'qr' as const, label: 'Código QR', icon: QrCode },
            { id: 'device' as const, label: 'Otro móvil', icon: Smartphone },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`inline-flex items-center justify-center gap-1 rounded-xl py-1.5 text-xs font-bold transition cursor-pointer ${
                  tab === item.id
                    ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-300 shadow-2xs'
                    : 'text-stone-500 dark:text-slate-400'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {tab === 'whatsapp' && (
          <div className="space-y-4">
            {/* URL copy bar */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-stone-500 dark:text-slate-400">
                Enlace directo del calendario
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 px-3 py-2 text-xs font-mono text-stone-700 dark:text-slate-200 outline-none"
                />
                <button
                  type="button"
                  onClick={() => copyText(shareUrl, 'link')}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 px-3.5 py-2 text-xs font-bold text-white transition cursor-pointer shrink-0"
                >
                  {copiedLink ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedLink ? '¡Copiado!' : 'Copiar'}
                </button>
              </div>
            </div>

            {/* WhatsApp preview */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-stone-500 dark:text-slate-400">
                Vista previa para WhatsApp / Telegram
              </label>
              <div className="rounded-2xl border border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/35 p-3.5 text-xs text-stone-700 dark:text-slate-200 leading-relaxed space-y-1">
                {blocks.map((line, i) =>
                  line === '' ? (
                    <div key={i} className="h-1.5" />
                  ) : (
                    <p key={i} className="break-words">
                      {line === shareUrl ? (
                        <span className="text-teal-700 dark:text-teal-300 underline break-all">
                          {line}
                        </span>
                      ) : (
                        renderFormattedLine(line)
                      )}
                    </p>
                  )
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#25D366] hover:bg-[#20bd5a] py-2.5 text-xs font-bold text-white shadow-xs transition"
              >
                <MessageCircle className="h-4 w-4" />
                WhatsApp
              </a>
              <button
                type="button"
                onClick={() => copyText(messageText, 'summary')}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-200 dark:border-slate-700 hover:bg-stone-100 dark:hover:bg-slate-800 py-2.5 text-xs font-bold transition cursor-pointer"
              >
                {copiedSummary ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                {copiedSummary ? '¡Copiado!' : 'Copiar mensaje'}
              </button>
            </div>

            {/* PNG Invite Card Export */}
            <button
              type="button"
              disabled={exportingCard}
              onClick={handleExportCard}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-teal-200 dark:border-teal-800/70 bg-teal-50/80 dark:bg-teal-950/40 hover:bg-teal-100 dark:hover:bg-teal-950/70 py-2.5 text-xs font-bold text-teal-800 dark:text-teal-200 transition cursor-pointer"
            >
              <ImageDown className="h-4 w-4" />
              {exportingCard ? 'Generando tarjeta...' : 'Descargar tarjeta invitación (PNG)'}
            </button>

            {/* Smart Nudge */}
            {missingFriends.length > 0 && (
              <div className="rounded-2xl border border-amber-200/80 dark:border-amber-800/50 bg-amber-50/60 dark:bg-amber-950/25 p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900 dark:text-amber-200">
                  <BellRing className="h-3.5 w-3.5" />
                  <span>
                    Faltan por responder: {missingFriends.map((p) => p.name).join(', ')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`https://api.whatsapp.com/send?text=${encodeURIComponent(nudgeText)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-center rounded-xl bg-amber-400 hover:bg-amber-500 py-1.5 text-xs font-bold text-amber-950 transition"
                  >
                    Dar un toque en WhatsApp
                  </a>
                  <button
                    type="button"
                    onClick={() => copyText(nudgeText, 'nudge')}
                    className="rounded-xl border border-amber-300 dark:border-amber-700 px-3 py-1.5 text-xs font-bold text-amber-900 dark:text-amber-200 cursor-pointer"
                  >
                    {copiedNudge ? '¡Copiado!' : 'Copiar'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'qr' && (
          <div className="flex flex-col items-center text-center space-y-3 py-2">
            <p className="text-xs text-stone-500 dark:text-slate-400 max-w-xs">
              Escanea este QR con cualquier móvil para abrir la quedada al instante sin escribir
              nada.
            </p>
            {inviteQr && (
              <div className="rounded-3xl border border-stone-200 dark:border-slate-700 bg-white p-4 shadow-sm">
                <img src={inviteQr} alt="QR de invitación" className="h-52 w-52" />
              </div>
            )}
            <p className="text-[11px] font-mono text-stone-400 break-all">{shareUrl}</p>
          </div>
        )}

        {tab === 'device' && (
          <div className="space-y-3 py-1">
            {hasSession && transferUrl ? (
              <div className="flex flex-col items-center text-center space-y-3">
                <p className="text-xs text-stone-600 dark:text-slate-300">
                  Escanea este QR personal o copia el enlace para seguir editando con{' '}
                  <strong>tu mismo perfil</strong> (y permisos de organizador si los tienes) en otro
                  móvil u ordenador.
                </p>
                {deviceQr && (
                  <div className="rounded-3xl border border-teal-200 dark:border-teal-800 bg-white p-3.5 shadow-sm">
                    <img src={deviceQr} alt="QR de traspaso de sesión" className="h-44 w-44" />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => copyText(transferUrl, 'device')}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 py-2.5 text-xs font-bold text-white cursor-pointer"
                >
                  {copiedDevice ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copiedDevice ? '¡Enlace personal copiado!' : 'Copiar mi enlace personal'}
                </button>
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  ⚠️ Enlace privado: no lo compartas en el grupo, es solo para tus dispositivos.
                </p>
              </div>
            ) : (
              <p className="text-center text-xs text-stone-500 dark:text-slate-400 py-6">
                Primero entra con tu nombre para generar tu enlace de traspaso entre dispositivos.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
