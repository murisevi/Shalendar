import type { Participant, Plan, RsvpEntry } from '../../shared/types';
import { formatDateLongEs, formatDateRangeEs } from '../../shared/dates';

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 2
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = test;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

/**
 * Generates a crisp PNG invitation card (1080×720) ready to paste in WhatsApp/Telegram.
 */
export async function generateInviteCardBlob(params: {
  plan: Plan;
  participants: Participant[];
  rsvps: RsvpEntry[];
  shareUrl: string;
}): Promise<Blob> {
  const { plan, participants, rsvps, shareUrl } = params;
  const W = 1080;
  const H = 720;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Rich emerald-teal background gradient
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#0f766e');
  grad.addColorStop(0.55, '#0d9488');
  grad.addColorStop(1, '#059669');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Decorative circles
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.arc(960, 110, 200, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(110, 620, 160, 0, Math.PI * 2);
  ctx.fill();

  // Main white card
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.22)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 16;
  drawRoundedRect(ctx, 56, 56, W - 112, H - 112, 36);
  ctx.fillStyle = '#faf9f6';
  ctx.fill();
  ctx.restore();

  // Emoji badge
  drawRoundedRect(ctx, 102, 102, 92, 92, 26);
  ctx.fillStyle = '#ccfbf1';
  ctx.fill();
  ctx.font = '50px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(plan.emoji || '🎉', 148, 152);

  // Status pill
  const isConfirmed = Boolean(plan.confirmedDate);
  drawRoundedRect(ctx, 218, 112, isConfirmed ? 270 : 250, 38, 19);
  ctx.fillStyle = isConfirmed ? '#fef3c7' : '#ccfbf1';
  ctx.fill();
  ctx.font = '700 17px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = isConfirmed ? '#92400e' : '#0f766e';
  ctx.fillText(isConfirmed ? '★  ¡FECHA CONFIRMADA!' : '📅  PLAN EN MARCHA', 238, 132);

  // Title
  ctx.fillStyle = '#18181b';
  ctx.font = '800 44px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textBaseline = 'top';
  const titleLines = wrapText(ctx, plan.title, W - 340, 2);
  titleLines.forEach((line, idx) => {
    ctx.fillText(line, 218, 162 + idx * 52);
  });

  // Details box
  const boxY = 290;
  drawRoundedRect(ctx, 102, boxY, W - 204, 190, 24);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#e7e5e4';
  ctx.lineWidth = 2;
  ctx.stroke();

  const dateText = plan.confirmedDate
    ? `${plan.confirmedEndDate ? formatDateRangeEs(plan.confirmedDate, plan.confirmedEndDate) : formatDateLongEs(plan.confirmedDate)}${plan.confirmedTime ? ` · ${plan.confirmedTime}` : ''}`
    : 'Fecha por decidir · ¡Entra y vota!';

  ctx.fillStyle = '#0f766e';
  ctx.font = '800 32px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(`🗓  ${dateText}`, 136, boxY + 34);

  ctx.fillStyle = '#57534e';
  ctx.font = '600 24px "Inter", system-ui, sans-serif';
  const locText = plan.location ? `📍  ${plan.location}` : '📍  Lugar por concretar en Shalendar';
  ctx.fillText(locText.slice(0, 58), 136, boxY + 92);

  // Headcount line
  const goingRsvps = rsvps.filter((r) => r.status === 'going');
  const totalGoing = goingRsvps.reduce((sum, r) => sum + 1 + r.guestsCount, 0);
  const peopleLine =
    totalGoing > 0
      ? `👥  ${totalGoing} ${totalGoing === 1 ? 'confirmado' : 'confirmados'} · ${participants.length} en el grupo`
      : `👥  ${participants.length} ${participants.length === 1 ? 'amigo apuntado' : 'amigos apuntados'}`;
  ctx.fillStyle = '#059669';
  ctx.font = '700 22px "Inter", system-ui, sans-serif';
  ctx.fillText(peopleLine, 136, boxY + 138);

  // Participant colored avatars strip
  const shown = participants.slice(0, 8);
  shown.forEach((p, idx) => {
    const cx = 128 + idx * 46;
    const cy = 548;
    ctx.beginPath();
    ctx.arc(cx, cy, 24, 0, Math.PI * 2);
    ctx.fillStyle = p.avatarColor;
    ctx.fill();
    ctx.strokeStyle = '#faf9f6';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.font = '20px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.avatarEmoji || p.name[0], cx, cy + 1);
  });

  if (participants.length > 8) {
    const cx = 128 + 8 * 46;
    ctx.beginPath();
    ctx.arc(cx, 548, 24, 0, Math.PI * 2);
    ctx.fillStyle = '#e7e5e4';
    ctx.fill();
    ctx.fillStyle = '#44403c';
    ctx.font = '700 16px "Inter", system-ui, sans-serif';
    ctx.fillText(`+${participants.length - 8}`, cx, 549);
  }

  // Footer link + branding
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#78716c';
  ctx.font = '500 19px ui-monospace, monospace';
  ctx.fillText(shareUrl.replace(/^https?:\/\//, '').slice(0, 56), 102, 622);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#0d9488';
  ctx.font = '800 24px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('Shalendar', W - 102, 622);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('No se pudo generar la tarjeta PNG'));
    }, 'image/png');
  });
}

export async function downloadOrShareInviteCard(params: {
  plan: Plan;
  participants: Participant[];
  rsvps: RsvpEntry[];
  shareUrl: string;
}): Promise<'shared' | 'downloaded'> {
  const blob = await generateInviteCardBlob(params);
  const fileName = `${params.plan.slug}-invitacion.png`;
  const file = new File([blob], fileName, { type: 'image/png' });

  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({
        title: `${params.plan.emoji} ${params.plan.title}`,
        text: `Detalles de la quedada: ${params.shareUrl}`,
        files: [file],
      });
      return 'shared';
    } catch {
      // Fallback to download if share dismissed/unsupported
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return 'downloaded';
}
