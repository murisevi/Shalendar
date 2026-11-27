import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serveStatic } from '@hono/node-server/serve-static';
import { z } from 'zod';
import { ShalendarDB } from './db.js';
import { PlanEventHub } from './events.js';
import {
  computeDaySummaries,
  formatDateLongEs,
  formatDateRangeEs,
  rankBestDates,
} from '../shared/dates.js';

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
const isoMonthRegex = /^\d{4}-\d{2}$/;

const createPlanSchema = z.object({
  title: z.string().trim().min(2, 'Escribe un título de al menos 2 caracteres').max(80),
  description: z.string().trim().max(400).optional(),
  location: z.string().trim().max(120).optional(),
  emoji: z.string().trim().min(1).max(8).optional(),
  organizerName: z.string().trim().min(1, 'Escribe tu nombre').max(32),
  organizerColor: z.string().trim().max(24).optional(),
  organizerEmoji: z.string().trim().max(8).optional(),
  organizerPin: z.string().trim().min(4).max(12).optional(),
  startMonth: z.string().regex(isoMonthRegex).optional(),
  endMonth: z.string().regex(isoMonthRegex).optional(),
  maxVotesPerUser: z.number().int().min(0).max(20).optional(),
  granularity: z.enum(['day', 'slots']).optional(),
  durationDays: z.number().int().min(1).max(7).optional(),
  votingDeadline: z.string().max(40).nullable().optional(),
  blindVoting: z.boolean().optional(),
  holidayCountry: z.enum(['ES', 'MX', 'AR', 'CO', 'US', 'none']).optional(),
});

const lookupPlansSchema = z.object({
  slugs: z.array(z.string().min(1).max(80)).max(20),
});

const joinPlanSchema = z.object({
  name: z.string().trim().min(1, 'Escribe tu nombre').max(32),
  avatarColor: z.string().trim().max(24).optional(),
  avatarEmoji: z.string().trim().max(8).optional(),
  pin: z.string().trim().min(4).max(12).optional(),
});

const claimParticipantSchema = z.object({
  name: z.string().trim().min(1).max(32),
  pin: z.string().trim().min(4).max(12),
});

const updateParticipantSchema = z.object({
  name: z.string().trim().min(1).max(32).optional(),
  avatarColor: z.string().trim().max(24).optional(),
  avatarEmoji: z.string().trim().max(8).optional(),
  pin: z.string().trim().max(12).optional(),
});

const availabilityBatchSchema = z.object({
  participantId: z.string().min(1),
  changes: z
    .array(
      z.object({
        date: z.string().regex(isoDateRegex),
        slot: z.enum(['all', 'morning', 'afternoon', 'evening']).optional(),
        status: z.enum(['yes', 'maybe', 'no']).nullable(),
        note: z.string().max(160).optional(),
      })
    )
    .min(1)
    .max(240),
});

const toggleVoteSchema = z.object({
  participantId: z.string().min(1),
  date: z.string().regex(isoDateRegex),
});

const nominateDateSchema = z.object({
  participantId: z.string().min(1).optional(),
  date: z.string().regex(isoDateRegex),
  label: z.string().trim().max(80).optional(),
});

const addCommentSchema = z.object({
  participantId: z.string().min(1),
  date: z.string().regex(isoDateRegex).nullable().optional(),
  body: z.string().trim().min(1, 'Escribe un mensaje').max(320),
});

const updateSettingsSchema = z.object({
  title: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(400).optional(),
  location: z.string().trim().max(120).optional(),
  emoji: z.string().trim().min(1).max(8).optional(),
  startMonth: z.string().regex(isoMonthRegex).optional(),
  endMonth: z.string().regex(isoMonthRegex).optional(),
  maxVotesPerUser: z.number().int().min(0).max(20).optional(),
  votingOpen: z.boolean().optional(),
  votingDeadline: z.string().max(40).nullable().optional(),
  blindVoting: z.boolean().optional(),
  granularity: z.enum(['day', 'slots']).optional(),
  durationDays: z.number().int().min(1).max(7).optional(),
  holidayCountry: z.enum(['ES', 'MX', 'AR', 'CO', 'US', 'none']).optional(),
  requiredParticipantIds: z.array(z.string().min(1)).max(30).optional(),
  confirmedDate: z.string().regex(isoDateRegex).nullable().optional(),
  confirmedEndDate: z.string().regex(isoDateRegex).nullable().optional(),
  confirmedTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  confirmedDurationMinutes: z.number().int().min(30).max(1440).optional(),
  confirmedTimezone: z.string().max(64).nullable().optional(),
});

const setRsvpSchema = z.object({
  participantId: z.string().min(1),
  status: z.enum(['going', 'maybe', 'not_going']),
  guestsCount: z.number().int().min(0).max(10).optional(),
  note: z.string().max(180).optional(),
});

const createSubPollSchema = z.object({
  participantId: z.string().min(1).optional(),
  category: z.enum(['place', 'activity', 'other']),
  question: z.string().trim().min(2, 'Escribe una pregunta').max(120),
  initialOptions: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(100),
        url: z.string().trim().max(260).optional(),
        estimatedCost: z.string().trim().max(32).optional(),
      })
    )
    .max(12)
    .optional(),
});

const addSubPollOptionSchema = z.object({
  participantId: z.string().min(1).optional(),
  title: z.string().trim().min(1, 'Escribe una opción').max(100),
  url: z.string().trim().max(260).optional(),
  estimatedCost: z.string().trim().max(32).optional(),
});

const toggleSubPollVoteSchema = z.object({
  participantId: z.string().min(1),
  optionId: z.string().min(1),
});

const setSubPollWinnerSchema = z.object({
  winnerOptionId: z.string().min(1).nullable(),
});

const addChecklistSchema = z.object({
  participantId: z.string().min(1).optional(),
  title: z.string().trim().min(1, 'Escribe un ítem').max(120),
  assignedTo: z.string().min(1).nullable().optional(),
});

const updateChecklistSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  assignedTo: z.string().min(1).nullable().optional(),
  completed: z.boolean().optional(),
});

const addCarpoolSchema = z.object({
  driverId: z.string().min(1),
  origin: z.string().trim().min(2, 'Indica desde dónde sales').max(100),
  seatsTotal: z.number().int().min(1).max(9),
  departureTime: z.string().trim().max(24).optional(),
  notes: z.string().trim().max(180).optional(),
});

const toggleCarpoolSeatSchema = z.object({
  participantId: z.string().min(1),
});

function escapeHtmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildOgSvg(params: {
  emoji: string;
  title: string;
  location: string;
  subtitle: string;
  badge: string;
}): string {
  const esc = escapeHtmlAttr;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f766e"/>
      <stop offset="55%" stop-color="#0d9488"/>
      <stop offset="100%" stop-color="#059669"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1060" cy="110" r="240" fill="#ffffff" fill-opacity="0.08"/>
  <circle cx="150" cy="540" r="190" fill="#ffffff" fill-opacity="0.06"/>
  <rect x="64" y="64" width="1072" height="502" rx="36" fill="#ffffff" fill-opacity="0.96"/>
  <rect x="112" y="114" width="96" height="96" rx="26" fill="#f0fdfa" stroke="#99f6e4" stroke-width="2"/>
  <text x="160" y="178" font-size="52" text-anchor="middle" font-family="system-ui, sans-serif">${esc(params.emoji)}</text>
  <rect x="236" y="122" width="320" height="36" rx="18" fill="#ccfbf1"/>
  <text x="256" y="146" font-size="18" font-weight="700" fill="#0f766e" font-family="system-ui, sans-serif">${esc(params.badge)}</text>
  <text x="112" y="292" font-size="52" font-weight="800" fill="#18181b" font-family="system-ui, -apple-system, sans-serif">${esc(params.title.slice(0, 38))}</text>
  ${
    params.location
      ? `<text x="112" y="352" font-size="28" font-weight="500" fill="#57534e" font-family="system-ui, sans-serif">📍 ${esc(params.location.slice(0, 56))}</text>`
      : ''
  }
  <rect x="112" y="400" width="976" height="92" rx="22" fill="#f5f5f4"/>
  <text x="144" y="456" font-size="28" font-weight="700" fill="#0f766e" font-family="system-ui, sans-serif">${esc(params.subtitle.slice(0, 62))}</text>
  <text x="1088" y="540" font-size="22" font-weight="700" fill="#a8a29e" text-anchor="end" font-family="system-ui, sans-serif">Shalendar · Calendario colaborativo</text>
</svg>`;
}

export function createApp(db: ShalendarDB, hub = new PlanEventHub(), staticDir?: string) {
  const app = new Hono();

  // Prevent search engines from indexing private plan URLs or API responses
  app.use('/api/plans/*', async (c, next) => {
    await next();
    c.header('X-Robots-Tag', 'noindex, nofollow');
  });

  const getViewerId = (c: { req: { header: (k: string) => string | undefined; query: (k: string) => string | undefined } }, planId: string): string | null => {
    const token = c.req.header('x-participant-token') ?? c.req.query('participantToken');
    if (token) {
      const p = db.getParticipantByToken(planId, token);
      if (p) return p.id;
    }
    return c.req.header('x-participant-id') ?? c.req.query('participantId') ?? null;
  };

  const broadcast = (slug: string, viewerParticipantId: string | null = null) => {
    hub.notifyUpdate(slug);
    return db.getPlanSnapshotBySlug(slug, {
      viewerParticipantId,
      onlineParticipantIds: hub.getOnlineParticipantIds(slug),
    });
  };

  app.get('/api/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

  // Only returns explicitly public demo plans (never leaks private plans)
  app.get('/api/plans', (c) => {
    return c.json({ plans: db.listPublicPlans(6) });
  });

  // Safe batch lookup for the user's own locally remembered slugs
  app.post('/api/plans/lookup', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = lookupPlansSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Slugs inválidos' }, 400);
    }
    return c.json({ plans: db.lookupPlansBySlugs(parsed.data.slugs) });
  });

  app.post('/api/plans', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createPlanSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message || 'Datos inválidos' },
        400
      );
    }
    const created = db.createPlan(parsed.data);
    return c.json(created, 201);
  });

  app.get('/api/plans/:slug', (c) => {
    const slug = c.req.param('slug');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) {
      return c.json({ error: 'No encontramos esa quedada' }, 404);
    }
    const viewerId = getViewerId(c, String(planRow.id));
    const snapshot = db.getPlanSnapshotBySlug(slug, {
      viewerParticipantId: viewerId,
      onlineParticipantIds: hub.getOnlineParticipantIds(slug),
    });
    return c.json(snapshot);
  });

  // Resolve a participant session from X-Participant-Token (used for cross-device magic transfer)
  app.get('/api/plans/:slug/session', (c) => {
    const slug = c.req.param('slug');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);
    const pToken = c.req.header('x-participant-token') ?? '';
    const aToken = c.req.header('x-admin-token') ?? '';
    const participant = pToken ? db.getParticipantByToken(String(planRow.id), pToken) : null;
    const isAdmin = aToken ? db.verifyAdminToken(planRow, aToken) : false;
    return c.json({ participant, isAdmin });
  });

  // Dynamic Open Graph SVG card for rich WhatsApp/Telegram previews
  app.get('/api/plans/:slug/og.svg', (c) => {
    const slug = c.req.param('slug');
    const snapshot = db.getPlanSnapshotBySlug(slug);
    if (!snapshot) return c.text('Not found', 404);

    const { plan, participants } = snapshot;
    const summaries = computeDaySummaries({
      participants: snapshot.participants,
      availabilities: snapshot.availabilities,
      votes: snapshot.votes,
      pollOptions: snapshot.pollOptions,
      granularity: plan.granularity,
    });
    const top = rankBestDates(summaries, 1, 'smart')[0];

    let subtitle = `${participants.length} ${participants.length === 1 ? 'persona apuntada' : 'personas apuntadas'} · Marca tus días`;
    let badge = 'SHALENDAR · EN DIRECTO';
    if (plan.confirmedDate) {
      badge = '¡FECHA CONFIRMADA!';
      const dateStr = plan.confirmedEndDate
        ? formatDateRangeEs(plan.confirmedDate, plan.confirmedEndDate)
        : formatDateLongEs(plan.confirmedDate);
      subtitle = `${dateStr}${plan.confirmedTime ? ` · ${plan.confirmedTime}` : ''}`;
    } else if (top) {
      subtitle = `Mejor día: ${formatDateLongEs(top.date)} (${top.yes.length}/${participants.length} pueden)`;
    }

    const svg = buildOgSvg({
      emoji: plan.emoji,
      title: plan.title,
      location: plan.location,
      subtitle,
      badge,
    });

    return c.body(svg, 200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    });
  });

  app.get('/api/plans/:slug/stream', (c) => {
    const slug = c.req.param('slug');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) {
      return c.json({ error: 'No encontramos esa quedada' }, 404);
    }
    const viewerId = getViewerId(c, String(planRow.id));
    const sendInitial = c.req.query('skipInitial') !== '1';

    return streamSSE(c, async (stream) => {
      let active = true;

      const unsubscribe = hub.subscribe(slug, {
        participantId: viewerId,
        onUpdate: (onlineParticipantIds) => {
          if (!active) return;
          const snap = db.getPlanSnapshotBySlug(slug, {
            viewerParticipantId: viewerId,
            onlineParticipantIds,
          });
          if (!snap) return;
          stream
            .writeSSE({
              event: 'snapshot',
              data: JSON.stringify(snap),
            })
            .catch(() => {
              active = false;
            });
        },
        onPresence: (onlineParticipantIds) => {
          if (!active) return;
          stream
            .writeSSE({
              event: 'presence',
              data: JSON.stringify({ onlineParticipantIds }),
            })
            .catch(() => {
              active = false;
            });
        },
      });

      if (sendInitial) {
        const initial = db.getPlanSnapshotBySlug(slug, {
          viewerParticipantId: viewerId,
          onlineParticipantIds: hub.getOnlineParticipantIds(slug),
        });
        if (initial) {
          await stream.writeSSE({
            event: 'snapshot',
            data: JSON.stringify(initial),
          });
        }
      } else {
        await stream.writeSSE({
          event: 'presence',
          data: JSON.stringify({ onlineParticipantIds: hub.getOnlineParticipantIds(slug) }),
        });
      }

      stream.onAbort(() => {
        active = false;
        unsubscribe();
      });

      while (active) {
        await stream.sleep(20000);
        if (!active) break;
        await stream.writeSSE({ event: 'ping', data: 'ok' }).catch(() => {
          active = false;
        });
      }
      unsubscribe();
    });
  });

  app.post('/api/plans/:slug/participants', async (c) => {
    const slug = c.req.param('slug');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = joinPlanSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Nombre inválido' }, 400);
    }

    try {
      const { participant, participantToken } = db.addOrGetParticipant(String(planRow.id), {
        ...parsed.data,
        rejectDuplicate: true,
      });
      const snapshot = broadcast(slug, participant.id);
      return c.json({ participant, participantToken, snapshot }, 201);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Ese nombre ya está en uso' },
        409
      );
    }
  });

  app.post('/api/plans/:slug/participants/claim', async (c) => {
    const slug = c.req.param('slug');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = claimParticipantSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Introduce tu nombre y PIN (mínimo 4 caracteres)' }, 400);
    }

    try {
      const { participant, participantToken } = db.claimParticipantByPin(
        String(planRow.id),
        parsed.data.name,
        parsed.data.pin
      );
      const snapshot = db.getPlanSnapshotBySlug(slug, {
        viewerParticipantId: participant.id,
        onlineParticipantIds: hub.getOnlineParticipantIds(slug),
      });
      return c.json({ participant, participantToken, snapshot });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'No se pudo recuperar el perfil' },
        401
      );
    }
  });

  app.patch('/api/plans/:slug/participants/:participantId', async (c) => {
    const slug = c.req.param('slug');
    const participantId = c.req.param('participantId');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const isDemo = Number(planRow.is_demo ?? 0) === 1;
    const hasPartAuth = db.verifyParticipantToken(
      String(planRow.id),
      participantId,
      c.req.header('x-participant-token'),
      isDemo
    );
    const hasAdminAuth = db.verifyAdminToken(planRow, c.req.header('x-admin-token'));
    if (!hasPartAuth && !hasAdminAuth) {
      return c.json({ error: 'No tienes permiso para editar este perfil' }, 403);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = updateParticipantSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Datos inválidos' }, 400);
    }

    try {
      const participant = db.updateParticipant(String(planRow.id), participantId, parsed.data);
      const snapshot = broadcast(slug, participantId);
      return c.json({ participant, snapshot });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Error al actualizar perfil' }, 400);
    }
  });

  app.delete('/api/plans/:slug/participants/:participantId', (c) => {
    const slug = c.req.param('slug');
    const participantId = c.req.param('participantId');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const isDemo = Number(planRow.is_demo ?? 0) === 1;
    const isAdmin = db.verifyAdminToken(planRow, c.req.header('x-admin-token'));
    const isSelf = db.verifyParticipantToken(
      String(planRow.id),
      participantId,
      c.req.header('x-participant-token'),
      isDemo
    );
    if (!isAdmin && !isSelf) {
      return c.json({ error: 'Solo el organizador o el propio participante puede darse de baja' }, 403);
    }

    db.deleteParticipant(String(planRow.id), participantId);
    const snapshot = broadcast(slug, getViewerId(c, String(planRow.id)));
    return c.json({ snapshot });
  });

  app.put('/api/plans/:slug/availability', async (c) => {
    const slug = c.req.param('slug');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = availabilityBatchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Datos inválidos' }, 400);
    }

    const isDemo = Number(planRow.is_demo ?? 0) === 1;
    const hasAuth = db.verifyParticipantToken(
      String(planRow.id),
      parsed.data.participantId,
      c.req.header('x-participant-token'),
      isDemo
    );
    if (!hasAuth) {
      return c.json({ error: 'Sesión de participante no válida' }, 403);
    }

    try {
      db.setAvailabilityBatch(String(planRow.id), parsed.data.participantId, parsed.data.changes);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Error al guardar' }, 400);
    }

    const snapshot = broadcast(slug, parsed.data.participantId);
    return c.json({ snapshot });
  });

  app.post('/api/plans/:slug/poll-options', async (c) => {
    const slug = c.req.param('slug');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = nominateDateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Fecha inválida' }, 400);
    }

    db.nominateDate(
      String(planRow.id),
      parsed.data.date,
      parsed.data.label ?? '',
      parsed.data.participantId ?? null
    );
    const snapshot = broadcast(slug, getViewerId(c, String(planRow.id)));
    return c.json({ snapshot }, 201);
  });

  app.delete('/api/plans/:slug/poll-options/:date', (c) => {
    const slug = c.req.param('slug');
    const date = c.req.param('date');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    if (!db.verifyAdminToken(planRow, c.req.header('x-admin-token'))) {
      return c.json({ error: 'Solo el organizador puede eliminar fechas candidatas' }, 403);
    }

    db.removePollOption(String(planRow.id), date);
    const snapshot = broadcast(slug, getViewerId(c, String(planRow.id)));
    return c.json({ snapshot });
  });

  app.post('/api/plans/:slug/votes/toggle', async (c) => {
    const slug = c.req.param('slug');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = toggleVoteSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Voto inválido' }, 400);
    }

    const isDemo = Number(planRow.is_demo ?? 0) === 1;
    if (
      !db.verifyParticipantToken(
        String(planRow.id),
        parsed.data.participantId,
        c.req.header('x-participant-token'),
        isDemo
      )
    ) {
      return c.json({ error: 'Sesión de participante no válida' }, 403);
    }

    try {
      const result = db.toggleVote(
        String(planRow.id),
        parsed.data.participantId,
        parsed.data.date
      );
      const snapshot = broadcast(slug, parsed.data.participantId);
      return c.json({ ...result, snapshot });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'No se pudo votar' }, 400);
    }
  });

  app.post('/api/plans/:slug/comments', async (c) => {
    const slug = c.req.param('slug');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = addCommentSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Comentario inválido' }, 400);
    }

    const isDemo = Number(planRow.is_demo ?? 0) === 1;
    if (
      !db.verifyParticipantToken(
        String(planRow.id),
        parsed.data.participantId,
        c.req.header('x-participant-token'),
        isDemo
      )
    ) {
      return c.json({ error: 'Sesión de participante no válida' }, 403);
    }

    try {
      const comment = db.addComment(
        String(planRow.id),
        parsed.data.participantId,
        parsed.data.body,
        parsed.data.date ?? null
      );
      const snapshot = broadcast(slug, parsed.data.participantId);
      return c.json({ comment, snapshot }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Error al comentar' }, 400);
    }
  });

  // ---- RSVP ----
  app.put('/api/plans/:slug/rsvp', async (c) => {
    const slug = c.req.param('slug');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = setRsvpSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'RSVP inválido' }, 400);
    }

    const isDemo = Number(planRow.is_demo ?? 0) === 1;
    if (
      !db.verifyParticipantToken(
        String(planRow.id),
        parsed.data.participantId,
        c.req.header('x-participant-token'),
        isDemo
      )
    ) {
      return c.json({ error: 'Sesión de participante no válida' }, 403);
    }

    try {
      db.setRsvp(
        String(planRow.id),
        parsed.data.participantId,
        parsed.data.status,
        parsed.data.guestsCount ?? 0,
        parsed.data.note ?? ''
      );
      const snapshot = broadcast(slug, parsed.data.participantId);
      return c.json({ snapshot });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Error al guardar asistencia' }, 400);
    }
  });

  // ---- Sub-Polls (Where / What) ----
  app.post('/api/plans/:slug/sub-polls', async (c) => {
    const slug = c.req.param('slug');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = createSubPollSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Encuesta inválida' }, 400);
    }

    const pollId = db.createSubPoll(
      String(planRow.id),
      parsed.data.category,
      parsed.data.question,
      parsed.data.initialOptions ?? [],
      parsed.data.participantId ?? null
    );
    const snapshot = broadcast(slug, getViewerId(c, String(planRow.id)));
    return c.json({ pollId, snapshot }, 201);
  });

  app.post('/api/plans/:slug/sub-polls/:pollId/options', async (c) => {
    const slug = c.req.param('slug');
    const pollId = c.req.param('pollId');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = addSubPollOptionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Opción inválida' }, 400);
    }

    try {
      const optionId = db.addSubPollOption(
        String(planRow.id),
        pollId,
        parsed.data.title,
        parsed.data.url ?? '',
        parsed.data.estimatedCost ?? '',
        parsed.data.participantId ?? null
      );
      const snapshot = broadcast(slug, getViewerId(c, String(planRow.id)));
      return c.json({ optionId, snapshot }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Error al añadir opción' }, 400);
    }
  });

  app.post('/api/plans/:slug/sub-polls/:pollId/vote', async (c) => {
    const slug = c.req.param('slug');
    const pollId = c.req.param('pollId');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = toggleSubPollVoteSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Voto inválido' }, 400);
    }

    const isDemo = Number(planRow.is_demo ?? 0) === 1;
    if (
      !db.verifyParticipantToken(
        String(planRow.id),
        parsed.data.participantId,
        c.req.header('x-participant-token'),
        isDemo
      )
    ) {
      return c.json({ error: 'Sesión de participante no válida' }, 403);
    }

    try {
      const result = db.toggleSubPollVote(
        String(planRow.id),
        pollId,
        parsed.data.optionId,
        parsed.data.participantId
      );
      const snapshot = broadcast(slug, parsed.data.participantId);
      return c.json({ ...result, snapshot });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Error al votar' }, 400);
    }
  });

  app.patch('/api/plans/:slug/sub-polls/:pollId', async (c) => {
    const slug = c.req.param('slug');
    const pollId = c.req.param('pollId');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = setSubPollWinnerSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Datos inválidos' }, 400);

    db.setSubPollWinner(String(planRow.id), pollId, parsed.data.winnerOptionId);
    const snapshot = broadcast(slug, getViewerId(c, String(planRow.id)));
    return c.json({ snapshot });
  });

  app.delete('/api/plans/:slug/sub-polls/:pollId', (c) => {
    const slug = c.req.param('slug');
    const pollId = c.req.param('pollId');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    if (!db.verifyAdminToken(planRow, c.req.header('x-admin-token'))) {
      return c.json({ error: 'Solo el organizador puede eliminar encuestas' }, 403);
    }
    db.deleteSubPoll(String(planRow.id), pollId);
    const snapshot = broadcast(slug, getViewerId(c, String(planRow.id)));
    return c.json({ snapshot });
  });

  // ---- Checklist ----
  app.post('/api/plans/:slug/checklist', async (c) => {
    const slug = c.req.param('slug');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = addChecklistSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Ítem inválido' }, 400);
    }

    const itemId = db.addChecklistItem(
      String(planRow.id),
      parsed.data.title,
      parsed.data.assignedTo ?? null,
      parsed.data.participantId ?? null
    );
    const snapshot = broadcast(slug, getViewerId(c, String(planRow.id)));
    return c.json({ itemId, snapshot }, 201);
  });

  app.patch('/api/plans/:slug/checklist/:itemId', async (c) => {
    const slug = c.req.param('slug');
    const itemId = c.req.param('itemId');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = updateChecklistSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Datos inválidos' }, 400);

    try {
      db.updateChecklistItem(String(planRow.id), itemId, parsed.data);
      const snapshot = broadcast(slug, getViewerId(c, String(planRow.id)));
      return c.json({ snapshot });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Error al actualizar' }, 400);
    }
  });

  app.delete('/api/plans/:slug/checklist/:itemId', (c) => {
    const slug = c.req.param('slug');
    const itemId = c.req.param('itemId');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    db.deleteChecklistItem(String(planRow.id), itemId);
    const snapshot = broadcast(slug, getViewerId(c, String(planRow.id)));
    return c.json({ snapshot });
  });

  // ---- Carpooling ----
  app.post('/api/plans/:slug/carpools', async (c) => {
    const slug = c.req.param('slug');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = addCarpoolSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Datos de coche inválidos' }, 400);
    }

    const isDemo = Number(planRow.is_demo ?? 0) === 1;
    if (
      !db.verifyParticipantToken(
        String(planRow.id),
        parsed.data.driverId,
        c.req.header('x-participant-token'),
        isDemo
      )
    ) {
      return c.json({ error: 'Sesión de participante no válida' }, 403);
    }

    try {
      const rideId = db.addCarpoolRide(
        String(planRow.id),
        parsed.data.driverId,
        parsed.data.origin,
        parsed.data.seatsTotal,
        parsed.data.departureTime ?? '',
        parsed.data.notes ?? ''
      );
      const snapshot = broadcast(slug, parsed.data.driverId);
      return c.json({ rideId, snapshot }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Error al añadir coche' }, 400);
    }
  });

  app.post('/api/plans/:slug/carpools/:rideId/toggle', async (c) => {
    const slug = c.req.param('slug');
    const rideId = c.req.param('rideId');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = toggleCarpoolSeatSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Participante inválido' }, 400);

    const isDemo = Number(planRow.is_demo ?? 0) === 1;
    if (
      !db.verifyParticipantToken(
        String(planRow.id),
        parsed.data.participantId,
        c.req.header('x-participant-token'),
        isDemo
      )
    ) {
      return c.json({ error: 'Sesión de participante no válida' }, 403);
    }

    try {
      const result = db.toggleCarpoolSeat(String(planRow.id), rideId, parsed.data.participantId);
      const snapshot = broadcast(slug, parsed.data.participantId);
      return c.json({ ...result, snapshot });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'No se pudo reservar plaza' }, 400);
    }
  });

  app.delete('/api/plans/:slug/carpools/:rideId', (c) => {
    const slug = c.req.param('slug');
    const rideId = c.req.param('rideId');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    db.deleteCarpoolRide(String(planRow.id), rideId);
    const snapshot = broadcast(slug, getViewerId(c, String(planRow.id)));
    return c.json({ snapshot });
  });

  // ---- Plan Settings & Delete (Admin-protected) ----
  app.patch('/api/plans/:slug', async (c) => {
    const slug = c.req.param('slug');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    if (!db.verifyAdminToken(planRow, c.req.header('x-admin-token'))) {
      return c.json({ error: 'Solo el organizador puede modificar los ajustes de esta quedada' }, 403);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = updateSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Ajustes inválidos' }, 400);
    }

    const updated = db.updatePlanSettings(slug, parsed.data);
    if (!updated) return c.json({ error: 'Quedada no encontrada' }, 404);
    const snapshot = broadcast(slug, getViewerId(c, String(planRow.id)));
    return c.json({ plan: updated, snapshot });
  });

  app.delete('/api/plans/:slug', (c) => {
    const slug = c.req.param('slug');
    const planRow = db.getPlanRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    if (!db.verifyAdminToken(planRow, c.req.header('x-admin-token'))) {
      return c.json({ error: 'Solo el organizador puede eliminar esta quedada' }, 403);
    }

    db.deletePlan(slug);
    return c.json({ deleted: true });
  });

  // Production static asset serving + Dynamic Open Graph SPA fallback
  if (staticDir && fs.existsSync(staticDir)) {
    const relRoot = path.relative(process.cwd(), staticDir) || '.';
    app.use('/assets/*', serveStatic({ root: relRoot }));
    app.use('/favicon.svg', serveStatic({ root: relRoot }));
    app.use('/manifest.webmanifest', serveStatic({ root: relRoot }));
    app.use('/sw.js', serveStatic({ root: relRoot }));

    app.get('*', (c) => {
      let indexHtml = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf-8');
      const reqPath = c.req.path;
      const match = reqPath.match(/^\/e\/([^/]+)\/?$/);

      if (match && match[1]) {
        c.header('X-Robots-Tag', 'noindex, nofollow');
        const slug = decodeURIComponent(match[1]);
        const snapshot = db.getPlanSnapshotBySlug(slug);
        if (snapshot) {
          const { plan, participants } = snapshot;
          const ogTitle = `${plan.emoji} ${plan.title} — Shalendar`;
          const ogDesc = plan.confirmedDate
            ? `¡Fecha confirmada: ${formatDateRangeEs(plan.confirmedDate, plan.confirmedEndDate)}${plan.confirmedTime ? ` a las ${plan.confirmedTime}` : ''}! ${plan.location ? `Lugar: ${plan.location}.` : ''}`
            : `${participants.length} ${participants.length === 1 ? 'persona apuntada' : 'personas apuntadas'}${plan.location ? ` · ${plan.location}` : ''}. Entra, marca qué días puedes y vota tu favorito.`;
          const origin = new URL(c.req.url).origin;
          const ogImage = `${origin}/api/plans/${encodeURIComponent(slug)}/og.svg`;

          const metaInjection = [
            `<meta property="og:type" content="website" />`,
            `<meta property="og:title" content="${escapeHtmlAttr(ogTitle)}" />`,
            `<meta property="og:description" content="${escapeHtmlAttr(ogDesc)}" />`,
            `<meta property="og:image" content="${escapeHtmlAttr(ogImage)}" />`,
            `<meta name="twitter:card" content="summary_large_image" />`,
            `<meta name="twitter:title" content="${escapeHtmlAttr(ogTitle)}" />`,
            `<meta name="twitter:description" content="${escapeHtmlAttr(ogDesc)}" />`,
            `<meta name="twitter:image" content="${escapeHtmlAttr(ogImage)}" />`,
          ].join('\n    ');

          indexHtml = indexHtml
            .replace(/<title>.*?<\/title>/, `<title>${escapeHtmlAttr(ogTitle)}</title>`)
            .replace('</head>', `    ${metaInjection}\n  </head>`);
        }
      }

      return c.html(indexHtml);
    });
  }

  return app;
}
