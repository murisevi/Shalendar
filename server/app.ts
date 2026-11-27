import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serveStatic } from '@hono/node-server/serve-static';
import { z } from 'zod';
import { calendarDateSchema, calendarMonthSchema, clockTimeSchema, timezoneSchema, deadlineSchema, profilePinSchema, ValidationError } from './validation.js';
import type { ShalendarDB } from './db.js';
import { PlanEventHub } from './events.js';
import type { ShalendarStore } from './store.js';
import { asShalendarStore } from './persistence/sqlite-store.js';
import { PlanExpiredError } from './persistence/repository.js';
import { InMemoryRateLimiter } from './persistence/security.js';
import {
  computeDaySummaries,
  formatDateLong,
  formatDateRange,
  rankBestDates,
} from '../shared/dates.js';
import { localizeServerError, resolveRequestLanguage } from './i18n.js';

const retentionPolicyEnum = z.enum([
  'ephemeral_after_event',
  'fixed_ttl',
  'sliding_inactivity',
  'persistent',
]);

const createPlanSchema = z.object({
  title: z.string().trim().min(2, 'Escribe un título de al menos 2 caracteres').max(80),
  description: z.string().trim().max(400).optional(),
  location: z.string().trim().max(120).optional(),
  emoji: z.string().trim().min(1).max(8).optional(),
  organizerName: z.string().trim().min(1, 'Escribe tu nombre').max(32),
  organizerColor: z.string().trim().max(24).optional(),
  organizerEmoji: z.string().trim().max(8).optional(),
  organizerPin: z.string().trim().min(4).max(12).optional(),
  startMonth: calendarMonthSchema.optional(),
  endMonth: calendarMonthSchema.optional(),
  maxVotesPerUser: z.number().int().min(0).max(20).optional(),
  granularity: z.enum(['day', 'slots']).optional(),
  durationDays: z.number().int().min(1).max(7).optional(),
  votingDeadline: deadlineSchema.nullable().optional(),
  blindVoting: z.boolean().optional(),
  holidayCountry: z.enum(['ES', 'MX', 'AR', 'CO', 'US', 'none']).optional(),
  retentionPolicy: retentionPolicyEnum.optional(),
  retentionDays: z.number().int().min(0).max(365).optional(),
});

const lookupPlansSchema = z.object({
  slugs: z.array(z.string().min(1).max(80)).max(20),
});

const extendExpirationSchema = z.object({
  extraDays: z.number().int().min(1).max(365).optional(),
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
  pin: profilePinSchema.optional(),
});

const availabilityBatchSchema = z.object({
  participantId: z.string().min(1),
  changes: z
    .array(
      z.object({
        date: calendarDateSchema,
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
  date: calendarDateSchema,
});

const nominateDateSchema = z.object({
  participantId: z.string().min(1).optional(),
  date: calendarDateSchema,
  label: z.string().trim().max(80).optional(),
});

const addCommentSchema = z.object({
  participantId: z.string().min(1),
  date: calendarDateSchema.nullable().optional(),
  body: z.string().trim().min(1, 'Escribe un mensaje').max(320),
});

const updateSettingsSchema = z.object({
  title: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(400).optional(),
  location: z.string().trim().max(120).optional(),
  emoji: z.string().trim().min(1).max(8).optional(),
  startMonth: calendarMonthSchema.optional(),
  endMonth: calendarMonthSchema.optional(),
  maxVotesPerUser: z.number().int().min(0).max(20).optional(),
  votingOpen: z.boolean().optional(),
  votingDeadline: deadlineSchema.nullable().optional(),
  blindVoting: z.boolean().optional(),
  granularity: z.enum(['day', 'slots']).optional(),
  durationDays: z.number().int().min(1).max(7).optional(),
  holidayCountry: z.enum(['ES', 'MX', 'AR', 'CO', 'US', 'none']).optional(),
  requiredParticipantIds: z.array(z.string().min(1)).max(30).optional(),
  confirmedDate: calendarDateSchema.nullable().optional(),
  confirmedEndDate: calendarDateSchema.nullable().optional(),
  confirmedTime: clockTimeSchema.nullable().optional(),
  confirmedDurationMinutes: z.number().int().min(30).max(1440).optional(),
  confirmedTimezone: timezoneSchema.nullable().optional(),
  retentionPolicy: retentionPolicyEnum.optional(),
  retentionDays: z.number().int().min(0).max(365).optional(),
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

export interface CreateAppOptions {
  purgeCronSecret?: string | null;
  maxPlansPerHourPerIp?: number;
}

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
  footer: string;
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
  <text x="1088" y="540" font-size="22" font-weight="700" fill="#a8a29e" text-anchor="end" font-family="system-ui, sans-serif">${esc(params.footer)}</text>
</svg>`;
}

function getClientIp(req: { header: (k: string) => string | undefined }): string {
  const xff = req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.header('x-real-ip') ?? 'local';
}

export function createApp(
  dbOrStore: ShalendarStore | ShalendarDB,
  hub = new PlanEventHub(),
  staticDir?: string,
  options: CreateAppOptions = {}
) {
  const store = asShalendarStore(dbOrStore);
  const app = new Hono();
  const planCreationLimiter = new InMemoryRateLimiter(
    options.maxPlansPerHourPerIp ?? 30,
    60 * 60 * 1000
  );

  // Global error mapping (including 410 Gone for expired ephemeral plans)
  app.onError((err, c) => {
    const lang = resolveRequestLanguage(c.req);
    if (err instanceof PlanExpiredError) {
      return c.json({ error: localizeServerError(err.message, lang), expired: true }, 410);
    }
    if (err instanceof ValidationError) return c.json({ error: localizeServerError(err.message, lang) }, 400);
    console.error('[shalendar:api]', err);
    return c.json({ error: localizeServerError('Error interno del servidor', lang) }, 500);
  });

  // Prevent search engines from indexing private plan URLs or API responses,
  // and automatically localize JSON error messages based on X-Language / Accept-Language.
  app.use('/api/plans/*', async (c, next) => {
    await next();
    c.header('X-Robots-Tag', 'noindex, nofollow');
    const lang = resolveRequestLanguage(c.req);
    if (lang === 'en' && c.res.status >= 400) {
      const ct = c.res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        try {
          const data = (await c.res.clone().json()) as { error?: string };
          if (typeof data.error === 'string') {
            const localized = localizeServerError(data.error, lang);
            if (localized !== data.error) {
              const headers = new Headers(c.res.headers);
              headers.delete('content-length');
              c.res = new Response(JSON.stringify({ ...data, error: localized }), {
                status: c.res.status,
                headers,
              });
            }
          }
        } catch {
          // Keep original response if body is not valid JSON
        }
      }
    }
  });

  const getViewerId = async (
    c: { req: { header: (k: string) => string | undefined; query: (k: string) => string | undefined } },
    planId: string
  ): Promise<string | null> => {
    const token = c.req.header('x-participant-token') ?? c.req.query('participantToken');
    if (token) {
      const p = await store.getParticipantByToken(planId, token);
      if (p) return p.id;
    }
    return null;
  };

  const getAuthorId = async (
    c: { req: { header: (key: string) => string | undefined } },
    planId: string,
    claimedId?: string
  ): Promise<string | null> => {
    const token = c.req.header('x-participant-token');
    const participant = token ? await store.getParticipantByToken(planId, token) : null;
    return participant && (!claimedId || claimedId === participant.id) ? participant.id : null;
  };

  const broadcast = async (slug: string, viewerParticipantId: string | null = null) => {
    hub.notifyUpdate(slug);
    return store.getPlanSnapshotBySlug(slug, {
      viewerParticipantId,
      onlineParticipantIds: hub.getOnlineParticipantIds(slug),
    });
  };

  // Readiness & liveness healthcheck (verifies DB connectivity for Northflank / Docker)
  app.get('/api/health', async (c) => {
    const health = await store.checkHealth();
    return c.json(
      {
        ok: health.ok,
        driver: health.driver,
        latencyMs: health.latencyMs,
        ...(health.error ? { error: health.error } : {}),
        time: new Date().toISOString(),
      },
      health.ok ? 200 : 503
    );
  });

  // Optional internal purge trigger for external PaaS Cron Jobs (e.g. Northflank Cron)
  app.post('/api/internal/purge', async (c) => {
    const expectedSecret = options.purgeCronSecret;
    if (!expectedSecret) {
      return c.json({ error: 'Endpoint desactivado' }, 404);
    }
    const auth = c.req.header('authorization') ?? '';
    if (auth !== `Bearer ${expectedSecret}`) {
      return c.json({ error: 'No autorizado' }, 401);
    }
    const summary = await store.purgeExpiredPlans();
    return c.json(summary);
  });

  // Only returns explicitly public demo plans (never leaks private plans)
  app.get('/api/plans', async (c) => {
    return c.json({ plans: await store.listPublicPlans(6) });
  });

  // Safe batch lookup for the user's own locally remembered slugs
  app.post('/api/plans/lookup', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = lookupPlansSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Slugs inválidos' }, 400);
    }
    return c.json({ plans: await store.lookupPlansBySlugs(parsed.data.slugs) });
  });

  app.post('/api/plans', async (c) => {
    const limit = planCreationLimiter.check(getClientIp(c.req));
    if (!limit.allowed) {
      c.header('Retry-After', String(limit.retryAfterSeconds));
      return c.json(
        { error: 'Has creado demasiadas quedadas en poco tiempo. Espera unos minutos.' },
        429
      );
    }

    const body = await c.req.json().catch(() => null);
    const parsed = createPlanSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Datos inválidos' }, 400);
    }
    const created = await store.createPlan(parsed.data);
    return c.json(created, 201);
  });

  app.get('/api/plans/:slug', async (c) => {
    const slug = c.req.param('slug');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) {
      return c.json({ error: 'No encontramos esa quedada' }, 404);
    }
    const viewerId = await getViewerId(c, planRow.id);
    const snapshot = await store.getPlanSnapshotBySlug(slug, {
      viewerParticipantId: viewerId,
      onlineParticipantIds: hub.getOnlineParticipantIds(slug),
    });
    return c.json(snapshot);
  });

  // Portable JSON backup download (adapts to ephemeral & persistent plans alike)
  app.get('/api/plans/:slug/export', async (c) => {
    const slug = c.req.param('slug');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);
    if (!store.verifyAdminToken(planRow, c.req.header('x-admin-token'))) {
      return c.json({ error: 'Solo el organizador puede descargar la copia de seguridad' }, 403);
    }
    c.header('Cache-Control', 'no-store');
    const backup = await store.exportPlanBackup(slug);
    if (!backup) {
      return c.json({ error: 'No encontramos esa quedada' }, 404);
    }
    return c.body(JSON.stringify(backup, null, 2), 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug.replace(/[^a-z0-9-_]/gi, '_')}-backup.json"`,
    });
  });

  // Extend expiration of an ephemeral/sliding plan (admin-protected)
  app.post('/api/plans/:slug/extend', async (c) => {
    const slug = c.req.param('slug');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    if (!store.verifyAdminToken(planRow, c.req.header('x-admin-token'))) {
      return c.json({ error: 'Solo el organizador puede extender la duración de esta quedada' }, 403);
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = extendExpirationSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return c.json({ error: 'Días inválidos' }, 400);
    }

    const updated = await store.extendPlanExpiration(slug, parsed.data.extraDays ?? 30);
    if (!updated) return c.json({ error: 'Quedada no encontrada' }, 404);
    const snapshot = await broadcast(slug, await getViewerId(c, planRow.id));
    return c.json({ plan: updated, snapshot });
  });

  // Resolve a participant session from X-Participant-Token (used for cross-device magic transfer)
  app.get('/api/plans/:slug/session', async (c) => {
    const slug = c.req.param('slug');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);
    const pToken = c.req.header('x-participant-token') ?? '';
    const aToken = c.req.header('x-admin-token') ?? '';
    const participant = pToken ? await store.getParticipantByToken(planRow.id, pToken) : null;
    const isAdmin = aToken ? store.verifyAdminToken(planRow, aToken) : false;
    return c.json({ participant, isAdmin });
  });

  // Dynamic Open Graph SVG card for rich WhatsApp/Telegram previews
  app.get('/api/plans/:slug/og.svg', async (c) => {
    const slug = c.req.param('slug');
    const snapshot = await store.getPlanSnapshotBySlug(slug);
    if (!snapshot) return c.text('Not found', 404);

    const lang = resolveRequestLanguage(c.req);
    const isEn = lang === 'en';
    const { plan, participants } = snapshot;
    const summaries = computeDaySummaries({
      participants: snapshot.participants,
      availabilities: snapshot.availabilities,
      votes: snapshot.votes,
      pollOptions: snapshot.pollOptions,
      granularity: plan.granularity,
    });
    const top = rankBestDates(summaries, 1, 'smart')[0];

    let subtitle = isEn
      ? `${participants.length} ${participants.length === 1 ? 'person joined' : 'people joined'} · Mark your days`
      : `${participants.length} ${participants.length === 1 ? 'persona apuntada' : 'personas apuntadas'} · Marca tus días`;
    let badge = isEn ? 'SHALENDAR · LIVE' : 'SHALENDAR · EN DIRECTO';
    if (plan.confirmedDate) {
      badge = isEn ? 'DATE CONFIRMED!' : '¡FECHA CONFIRMADA!';
      const dateStr = plan.confirmedEndDate
        ? formatDateRange(plan.confirmedDate, plan.confirmedEndDate, lang)
        : formatDateLong(plan.confirmedDate, lang);
      subtitle = `${dateStr}${plan.confirmedTime ? ` · ${plan.confirmedTime}` : ''}`;
    } else if (top) {
      subtitle = isEn
        ? `Best day: ${formatDateLong(top.date, lang)} (${top.yes.length}/${participants.length} available)`
        : `Mejor día: ${formatDateLong(top.date, lang)} (${top.yes.length}/${participants.length} pueden)`;
    }

    const svg = buildOgSvg({
      emoji: plan.emoji,
      title: plan.title,
      location: plan.location,
      subtitle,
      badge,
      footer: isEn ? 'Shalendar · Collaborative calendar' : 'Shalendar · Calendario colaborativo',
    });

    return c.body(svg, 200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    });
  });

  app.get('/api/plans/:slug/stream', async (c) => {
    const slug = c.req.param('slug');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) {
      return c.json({ error: 'No encontramos esa quedada' }, 404);
    }
    const viewerId = await getViewerId(c, planRow.id);
    const sendInitial = c.req.query('skipInitial') !== '1';

    // Disable reverse-proxy response buffering so SSE chunks flush immediately on PaaS edges
    c.header('X-Accel-Buffering', 'no');
    c.header('Cache-Control', 'no-cache, no-transform');

    return streamSSE(c, async (stream) => {
      let active = true;

      const unsubscribe = hub.subscribe(slug, {
        participantId: viewerId,
        onUpdate: (onlineParticipantIds) => {
          if (!active) return;
          void store
            .getPlanSnapshotBySlug(slug, {
              viewerParticipantId: viewerId,
              onlineParticipantIds,
            })
            .then((snap) => {
              if (!active || !snap) return;
              return stream.writeSSE({
                event: 'snapshot',
                data: JSON.stringify(snap),
              });
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
        const initial = await store.getPlanSnapshotBySlug(slug, {
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
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = joinPlanSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Nombre inválido' }, 400);
    }

    try {
      const { participant, participantToken } = await store.addOrGetParticipant(planRow.id, {
        ...parsed.data,
        rejectDuplicate: true,
      });
      const snapshot = await broadcast(slug, participant.id);
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
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = claimParticipantSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Introduce tu nombre y PIN (mínimo 4 caracteres)' }, 400);
    }

    try {
      const { participant, participantToken } = await store.claimParticipantByPin(
        planRow.id,
        parsed.data.name,
        parsed.data.pin
      );
      const snapshot = await store.getPlanSnapshotBySlug(slug, {
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
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const hasPartAuth = await store.verifyParticipantToken(
      planRow.id,
      participantId,
      c.req.header('x-participant-token'),
      planRow.isDemo
    );
    const hasAdminAuth = store.verifyAdminToken(planRow, c.req.header('x-admin-token'));
    if (!hasPartAuth && !hasAdminAuth) {
      return c.json({ error: 'No tienes permiso para editar este perfil' }, 403);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = updateParticipantSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Datos inválidos' }, 400);
    }

    try {
      const participant = await store.updateParticipant(planRow.id, participantId, parsed.data);
      const snapshot = await broadcast(slug, participantId);
      return c.json({ participant, snapshot });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Error al actualizar perfil' }, 400);
    }
  });

  app.delete('/api/plans/:slug/participants/:participantId', async (c) => {
    const slug = c.req.param('slug');
    const participantId = c.req.param('participantId');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const isAdmin = store.verifyAdminToken(planRow, c.req.header('x-admin-token'));
    const isSelf = await store.verifyParticipantToken(
      planRow.id,
      participantId,
      c.req.header('x-participant-token'),
      planRow.isDemo
    );
    if (!isAdmin && !isSelf) {
      return c.json({ error: 'Solo el organizador o el propio participante puede darse de baja' }, 403);
    }

    await store.deleteParticipant(planRow.id, participantId);
    const snapshot = await broadcast(slug, await getViewerId(c, planRow.id));
    return c.json({ snapshot });
  });

  app.put('/api/plans/:slug/availability', async (c) => {
    const slug = c.req.param('slug');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = availabilityBatchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Datos inválidos' }, 400);
    }

    const hasAuth = await store.verifyParticipantToken(
      planRow.id,
      parsed.data.participantId,
      c.req.header('x-participant-token'),
      planRow.isDemo
    );
    if (!hasAuth) {
      return c.json({ error: 'Sesión de participante no válida' }, 403);
    }

    try {
      await store.setAvailabilityBatch(planRow.id, parsed.data.participantId, parsed.data.changes);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Error al guardar' }, 400);
    }

    const snapshot = await broadcast(slug, parsed.data.participantId);
    return c.json({ snapshot });
  });

  app.post('/api/plans/:slug/poll-options', async (c) => {
    const slug = c.req.param('slug');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = nominateDateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Fecha inválida' }, 400);
    }

    const authorId = await getAuthorId(c, planRow.id, parsed.data.participantId);
    if (!authorId) return c.json({ error: 'Sesión de participante no válida' }, 403);

    await store.nominateDate(
      planRow.id,
      parsed.data.date,
      parsed.data.label ?? '',
      authorId
    );
    const snapshot = await broadcast(slug, await getViewerId(c, planRow.id));
    return c.json({ snapshot }, 201);
  });

  app.delete('/api/plans/:slug/poll-options/:date', async (c) => {
    const slug = c.req.param('slug');
    const date = c.req.param('date');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    if (!store.verifyAdminToken(planRow, c.req.header('x-admin-token'))) {
      return c.json({ error: 'Solo el organizador puede eliminar fechas candidatas' }, 403);
    }

    await store.removePollOption(planRow.id, date);
    const snapshot = await broadcast(slug, await getViewerId(c, planRow.id));
    return c.json({ snapshot });
  });

  app.post('/api/plans/:slug/votes/toggle', async (c) => {
    const slug = c.req.param('slug');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = toggleVoteSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Voto inválido' }, 400);
    }

    if (
      !(await store.verifyParticipantToken(
        planRow.id,
        parsed.data.participantId,
        c.req.header('x-participant-token'),
        planRow.isDemo
      ))
    ) {
      return c.json({ error: 'Sesión de participante no válida' }, 403);
    }

    try {
      const result = await store.toggleVote(planRow.id, parsed.data.participantId, parsed.data.date);
      const snapshot = await broadcast(slug, parsed.data.participantId);
      return c.json({ ...result, snapshot });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'No se pudo votar' }, 400);
    }
  });

  app.post('/api/plans/:slug/comments', async (c) => {
    const slug = c.req.param('slug');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = addCommentSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Comentario inválido' }, 400);
    }

    if (
      !(await store.verifyParticipantToken(
        planRow.id,
        parsed.data.participantId,
        c.req.header('x-participant-token'),
        planRow.isDemo
      ))
    ) {
      return c.json({ error: 'Sesión de participante no válida' }, 403);
    }

    try {
      const comment = await store.addComment(
        planRow.id,
        parsed.data.participantId,
        parsed.data.body,
        parsed.data.date ?? null
      );
      const snapshot = await broadcast(slug, parsed.data.participantId);
      return c.json({ comment, snapshot }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Error al comentar' }, 400);
    }
  });

  // ---- RSVP ----
  app.put('/api/plans/:slug/rsvp', async (c) => {
    const slug = c.req.param('slug');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = setRsvpSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'RSVP inválido' }, 400);
    }

    if (
      !(await store.verifyParticipantToken(
        planRow.id,
        parsed.data.participantId,
        c.req.header('x-participant-token'),
        planRow.isDemo
      ))
    ) {
      return c.json({ error: 'Sesión de participante no válida' }, 403);
    }

    try {
      await store.setRsvp(
        planRow.id,
        parsed.data.participantId,
        parsed.data.status,
        parsed.data.guestsCount ?? 0,
        parsed.data.note ?? ''
      );
      const snapshot = await broadcast(slug, parsed.data.participantId);
      return c.json({ snapshot });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Error al guardar asistencia' },
        400
      );
    }
  });

  // ---- Sub-Polls (Where / What) ----
  app.post('/api/plans/:slug/sub-polls', async (c) => {
    const slug = c.req.param('slug');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = createSubPollSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Encuesta inválida' }, 400);
    }

    const authorId = await getAuthorId(c, planRow.id, parsed.data.participantId);
    if (!authorId) return c.json({ error: 'Sesión de participante no válida' }, 403);

    const pollId = await store.createSubPoll(
      planRow.id,
      parsed.data.category,
      parsed.data.question,
      parsed.data.initialOptions ?? [],
      authorId
    );
    const snapshot = await broadcast(slug, await getViewerId(c, planRow.id));
    return c.json({ pollId, snapshot }, 201);
  });

  app.post('/api/plans/:slug/sub-polls/:pollId/options', async (c) => {
    const slug = c.req.param('slug');
    const pollId = c.req.param('pollId');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = addSubPollOptionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Opción inválida' }, 400);
    }

    const authorId = await getAuthorId(c, planRow.id, parsed.data.participantId);
    if (!authorId) return c.json({ error: 'Sesión de participante no válida' }, 403);

    try {
      const optionId = await store.addSubPollOption(
        planRow.id,
        pollId,
        parsed.data.title,
        parsed.data.url ?? '',
        parsed.data.estimatedCost ?? '',
        authorId
      );
      const snapshot = await broadcast(slug, await getViewerId(c, planRow.id));
      return c.json({ optionId, snapshot }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Error al añadir opción' }, 400);
    }
  });

  app.post('/api/plans/:slug/sub-polls/:pollId/vote', async (c) => {
    const slug = c.req.param('slug');
    const pollId = c.req.param('pollId');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = toggleSubPollVoteSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Voto inválido' }, 400);
    }

    if (
      !(await store.verifyParticipantToken(
        planRow.id,
        parsed.data.participantId,
        c.req.header('x-participant-token'),
        planRow.isDemo
      ))
    ) {
      return c.json({ error: 'Sesión de participante no válida' }, 403);
    }

    try {
      const result = await store.toggleSubPollVote(
        planRow.id,
        pollId,
        parsed.data.optionId,
        parsed.data.participantId
      );
      const snapshot = await broadcast(slug, parsed.data.participantId);
      return c.json({ ...result, snapshot });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Error al votar' }, 400);
    }
  });

  app.patch('/api/plans/:slug/sub-polls/:pollId', async (c) => {
    const slug = c.req.param('slug');
    const pollId = c.req.param('pollId');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    if (!store.verifyAdminToken(planRow, c.req.header('x-admin-token'))) {
      return c.json({ error: 'Solo el organizador puede elegir la opción ganadora' }, 403);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = setSubPollWinnerSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Datos inválidos' }, 400);

    await store.setSubPollWinner(planRow.id, pollId, parsed.data.winnerOptionId);
    const snapshot = await broadcast(slug, await getViewerId(c, planRow.id));
    return c.json({ snapshot });
  });

  app.delete('/api/plans/:slug/sub-polls/:pollId', async (c) => {
    const slug = c.req.param('slug');
    const pollId = c.req.param('pollId');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    if (!store.verifyAdminToken(planRow, c.req.header('x-admin-token'))) {
      return c.json({ error: 'Solo el organizador puede eliminar encuestas' }, 403);
    }
    await store.deleteSubPoll(planRow.id, pollId);
    const snapshot = await broadcast(slug, await getViewerId(c, planRow.id));
    return c.json({ snapshot });
  });

  // ---- Checklist ----
  app.post('/api/plans/:slug/checklist', async (c) => {
    const slug = c.req.param('slug');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = addChecklistSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Ítem inválido' }, 400);
    }

    const authorId = await getAuthorId(c, planRow.id, parsed.data.participantId);
    if (!authorId) return c.json({ error: 'Sesión de participante no válida' }, 403);

    const itemId = await store.addChecklistItem(
      planRow.id,
      parsed.data.title,
      parsed.data.assignedTo ?? null,
      authorId
    );
    const snapshot = await broadcast(slug, await getViewerId(c, planRow.id));
    return c.json({ itemId, snapshot }, 201);
  });

  app.patch('/api/plans/:slug/checklist/:itemId', async (c) => {
    const slug = c.req.param('slug');
    const itemId = c.req.param('itemId');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);
    // Checklist is collaborative for authenticated group members and co-organizers.
    if (!(await getAuthorId(c, planRow.id)) && !store.verifyAdminToken(planRow, c.req.header('x-admin-token'))) {
      return c.json({ error: 'Sesión de participante no válida' }, 403);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = updateChecklistSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Datos inválidos' }, 400);

    try {
      await store.updateChecklistItem(planRow.id, itemId, parsed.data);
      const snapshot = await broadcast(slug, await getViewerId(c, planRow.id));
      return c.json({ snapshot });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Error al actualizar' }, 400);
    }
  });

  app.delete('/api/plans/:slug/checklist/:itemId', async (c) => {
    const slug = c.req.param('slug');
    const itemId = c.req.param('itemId');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);
    // Checklist is collaborative for authenticated group members and co-organizers.
    if (!(await getAuthorId(c, planRow.id)) && !store.verifyAdminToken(planRow, c.req.header('x-admin-token'))) {
      return c.json({ error: 'Sesión de participante no válida' }, 403);
    }

    await store.deleteChecklistItem(planRow.id, itemId);
    const snapshot = await broadcast(slug, await getViewerId(c, planRow.id));
    return c.json({ snapshot });
  });

  // ---- Carpooling ----
  app.post('/api/plans/:slug/carpools', async (c) => {
    const slug = c.req.param('slug');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = addCarpoolSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Datos de coche inválidos' }, 400);
    }

    if (
      !(await store.verifyParticipantToken(
        planRow.id,
        parsed.data.driverId,
        c.req.header('x-participant-token'),
        planRow.isDemo
      ))
    ) {
      return c.json({ error: 'Sesión de participante no válida' }, 403);
    }

    try {
      const rideId = await store.addCarpoolRide(
        planRow.id,
        parsed.data.driverId,
        parsed.data.origin,
        parsed.data.seatsTotal,
        parsed.data.departureTime ?? '',
        parsed.data.notes ?? ''
      );
      const snapshot = await broadcast(slug, parsed.data.driverId);
      return c.json({ rideId, snapshot }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Error al añadir coche' }, 400);
    }
  });

  app.post('/api/plans/:slug/carpools/:rideId/toggle', async (c) => {
    const slug = c.req.param('slug');
    const rideId = c.req.param('rideId');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = toggleCarpoolSeatSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Participante inválido' }, 400);

    if (
      !(await store.verifyParticipantToken(
        planRow.id,
        parsed.data.participantId,
        c.req.header('x-participant-token'),
        planRow.isDemo
      ))
    ) {
      return c.json({ error: 'Sesión de participante no válida' }, 403);
    }

    try {
      const result = await store.toggleCarpoolSeat(planRow.id, rideId, parsed.data.participantId);
      const snapshot = await broadcast(slug, parsed.data.participantId);
      return c.json({ ...result, snapshot });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'No se pudo reservar plaza' }, 400);
    }
  });

  app.delete('/api/plans/:slug/carpools/:rideId', async (c) => {
    const slug = c.req.param('slug');
    const rideId = c.req.param('rideId');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    const viewerId = await getAuthorId(c, planRow.id);
    const current = await store.getPlanSnapshotBySlug(slug);
    const ride = current?.carpools.find((entry) => entry.id === rideId);
    const isAdmin = store.verifyAdminToken(planRow, c.req.header('x-admin-token'));
    if (!isAdmin && (!viewerId || ride?.driverId !== viewerId)) {
      return c.json({ error: 'Solo el conductor o el organizador puede borrar este coche' }, 403);
    }
    if (!ride) return c.json({ error: 'Coche no encontrado' }, 404);
    await store.deleteCarpoolRide(planRow.id, rideId);
    const snapshot = await broadcast(slug, await getViewerId(c, planRow.id));
    return c.json({ snapshot });
  });

  // ---- Plan Settings & Delete (Admin-protected) ----
  app.patch('/api/plans/:slug', async (c) => {
    const slug = c.req.param('slug');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    if (!store.verifyAdminToken(planRow, c.req.header('x-admin-token'))) {
      return c.json({ error: 'Solo el organizador puede modificar los ajustes de esta quedada' }, 403);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = updateSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Ajustes inválidos' }, 400);
    }

    const updated = await store.updatePlanSettings(slug, parsed.data);
    if (!updated) return c.json({ error: 'Quedada no encontrada' }, 404);
    const snapshot = await broadcast(slug, await getViewerId(c, planRow.id));
    return c.json({ plan: updated, snapshot });
  });

  app.delete('/api/plans/:slug', async (c) => {
    const slug = c.req.param('slug');
    const planRow = await store.getPlanAuthRowBySlug(slug);
    if (!planRow) return c.json({ error: 'Quedada no encontrada' }, 404);

    if (!store.verifyAdminToken(planRow, c.req.header('x-admin-token'))) {
      return c.json({ error: 'Solo el organizador puede eliminar esta quedada' }, 403);
    }

    await store.deletePlan(slug);
    return c.json({ deleted: true });
  });

  // Production static asset serving + Dynamic Open Graph SPA fallback
  if (staticDir && fs.existsSync(staticDir)) {
    const relRoot = path.relative(process.cwd(), staticDir) || '.';
    app.use('/assets/*', serveStatic({ root: relRoot }));
    app.use('/favicon.svg', serveStatic({ root: relRoot }));
    app.use('/manifest.webmanifest', serveStatic({ root: relRoot }));
    app.use('/sw.js', serveStatic({ root: relRoot }));

    app.get('*', async (c) => {
      let indexHtml = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf-8');
      const reqPath = c.req.path;
      const match = reqPath.match(/^\/e\/([^/]+)\/?$/);

      if (match && match[1]) {
        c.header('X-Robots-Tag', 'noindex, nofollow');
        const slug = decodeURIComponent(match[1]);
        try {
          const snapshot = await store.getPlanSnapshotBySlug(slug);
          if (snapshot) {
            const lang = resolveRequestLanguage(c.req);
            const isEn = lang === 'en';
            const { plan, participants } = snapshot;
            const ogTitle = `${plan.emoji} ${plan.title} — Shalendar`;
            const ogDesc = plan.confirmedDate
              ? isEn
                ? `Date confirmed: ${formatDateRange(plan.confirmedDate, plan.confirmedEndDate, lang)}${plan.confirmedTime ? ` at ${plan.confirmedTime}` : ''}! ${plan.location ? `Location: ${plan.location}.` : ''}`
                : `¡Fecha confirmada: ${formatDateRange(plan.confirmedDate, plan.confirmedEndDate, lang)}${plan.confirmedTime ? ` a las ${plan.confirmedTime}` : ''}! ${plan.location ? `Lugar: ${plan.location}.` : ''}`
              : isEn
                ? `${participants.length} ${participants.length === 1 ? 'person joined' : 'people joined'}${plan.location ? ` · ${plan.location}` : ''}. Open to mark your available days and vote for your favorite.`
                : `${participants.length} ${participants.length === 1 ? 'persona apuntada' : 'personas apuntadas'}${plan.location ? ` · ${plan.location}` : ''}. Entra, marca qué días puedes y vota tu favorito.`;
            const origin = new URL(c.req.url).origin;
            const ogImage = `${origin}/api/plans/${encodeURIComponent(slug)}/og.svg${isEn ? '?lang=en' : ''}`;

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
        } catch (err) {
          if (!(err instanceof PlanExpiredError)) {
            throw err;
          }
        }
      }

      return c.html(indexHtml);
    });
  }

  return app;
}
