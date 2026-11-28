import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { ShalendarDB } from '../server/db.js';
import { createApp } from '../server/app.js';
import { PlanEventHub } from '../server/events.js';
import { PostgresShalendarStore } from '../server/persistence/postgres-store.js';
import { loadPersistenceConfig } from '../server/persistence/config.js';
import type { PgPoolLike } from '../server/persistence/pool.js';
import { asShalendarStore } from '../server/persistence/sqlite-store.js';
import type { ShalendarStore } from '../server/store.js';
import type { CreatePlanResponse, PlanSnapshot } from '../shared/types.js';

describe.each(['SQLite', 'PostgreSQL'] as const)('PoC readiness & persistence safety: %s', (driver) => {
  let store: ShalendarStore;
  let sqlite: ShalendarDB | undefined;
  let pg: PGlite | undefined;
  let app: ReturnType<typeof createApp>;
  let hub: PlanEventHub;

  beforeAll(async () => {
    hub = new PlanEventHub();
    if (driver === 'SQLite') {
      sqlite = new ShalendarDB(':memory:');
      store = asShalendarStore(sqlite);
    } else {
      pg = new PGlite();
      await pg.exec(
        fs.readFileSync(
          new URL('../server/persistence/migrations/001_initial_schema.sql', import.meta.url),
          'utf8'
        )
      );
      await pg.exec(
        fs.readFileSync(
          new URL('../server/persistence/migrations/002_meal_slots.sql', import.meta.url),
          'utf8'
        )
      );
      // Emulate a real pg.Pool(max=1) checkout lock so concurrent withTransaction calls
      // never interleave BEGIN/COMMIT on PGlite's single underlying connection.
      let lockTail = Promise.resolve();
      const rawQuery = async <T>(sql: string, values?: readonly unknown[]) => {
        const result = await pg!.query<T>(sql, values ? [...values] : []);
        return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
      };
      const pool: PgPoolLike = {
        async query<T>(sql: string, values?: readonly unknown[]) {
          const prev = lockTail;
          let release!: () => void;
          lockTail = new Promise<void>((r) => {
            release = r;
          });
          await prev;
          try {
            return await rawQuery<T>(sql, values);
          } finally {
            release();
          }
        },
        async connect() {
          const prev = lockTail;
          let release!: () => void;
          lockTail = new Promise<void>((r) => {
            release = r;
          });
          await prev;
          let released = false;
          return {
            query: rawQuery,
            release() {
              if (!released) {
                released = true;
                release();
              }
            },
          };
        },
        async end() {
          await pg!.close();
        },
      };
      store = new PostgresShalendarStore(pool, loadPersistenceConfig({}));
    }
    app = createApp(store, hub, undefined, { maxPlansPerHourPerIp: 500 });
  }, 30000);

  afterAll(async () => {
    await store?.close();
  });

  async function req(
    route: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {}
  ) {
    const response = await app.request('/api' + route, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: (await response.json()) as any };
  }

  it('never shortens an extended expiration on subsequent activity or unrelated settings edits', async () => {
    const created = await req('/plans', 'POST', {
      title: 'Cena Navidad Extendida',
      organizerName: 'Organizador',
      retentionPolicy: 'ephemeral_after_event',
      retentionDays: 30,
    });
    expect(created.status).toBe(201);
    const { plan, participant, adminToken, participantToken } = created.data as CreatePlanResponse;
    const base = `/plans/${plan.slug}`;

    // Extend expiration by +60 days (now ~90 days from now)
    const ext = await req(`${base}/extend`, 'POST', { extraDays: 60 }, { 'X-Admin-Token': adminToken });
    expect(ext.status).toBe(200);
    const extendedMs = Date.parse(ext.data.plan.expiresAt);
    expect(extendedMs).toBeGreaterThan(Date.now() + 80 * 86400_000);

    // Friend joins, marks availability, comments — must NOT shrink expiresAt back to 30 days!
    const friend = await req(`${base}/participants`, 'POST', { name: 'Lucía' });
    expect(friend.status).toBe(201);
    await req(
      `${base}/availability`,
      'PUT',
      { participantId: friend.data.participant.id, changes: [{ date: '2026-12-19', status: 'yes' }] },
      { 'X-Participant-Token': friend.data.participantToken }
    );
    await req(
      `${base}/comments`,
      'POST',
      { participantId: participant.id, body: '¿Qué os parece el 19?' },
      { 'X-Participant-Token': participantToken }
    );

    const afterActivity = await req(base);
    expect(afterActivity.status).toBe(200);
    expect(Date.parse(afterActivity.data.plan.expiresAt)).toBeGreaterThanOrEqual(extendedMs);

    // Also test sliding_inactivity + editing title/location never shrinks an extension
    const sliding = await req('/plans', 'POST', {
      title: 'Grupo Sliding',
      organizerName: 'Ana',
      retentionPolicy: 'sliding_inactivity',
      retentionDays: 30,
    });
    const sBase = `/plans/${sliding.data.plan.slug}`;
    const sAdmin = { 'X-Admin-Token': sliding.data.adminToken };
    const sExt = await req(`${sBase}/extend`, 'POST', { extraDays: 45 }, sAdmin);
    const sExtMs = Date.parse(sExt.data.plan.expiresAt);

    const renamed = await req(sBase, 'PATCH', { location: 'Restaurante Nuevo' }, sAdmin);
    expect(renamed.status).toBe(200);
    expect(Date.parse(renamed.data.plan.expiresAt)).toBeGreaterThanOrEqual(sExtMs);
  });

  it('switching an older plan to fixed_ttl (7 days) anchors from now instead of self-deleting', async () => {
    const created = await req('/plans', 'POST', {
      title: 'Plan Antiguo',
      organizerName: 'Organizador',
      retentionPolicy: 'ephemeral_after_event',
      retentionDays: 30,
    });
    expect(created.status).toBe(201);
    const { plan, adminToken } = created.data as CreatePlanResponse;

    // Backdate created_at by 15 days (simulating a plan created 2 weeks ago)
    const fifteenDaysAgo = new Date(Date.now() - 15 * 86400_000).toISOString();
    if (sqlite) {
      (sqlite as any).db
        .prepare('UPDATE plans SET created_at = ? WHERE id = ?')
        .run(fifteenDaysAgo, plan.id);
    } else {
      await pg!.query('UPDATE plans SET created_at = $1::timestamptz WHERE id = $2', [
        fifteenDaysAgo,
        plan.id,
      ]);
    }

    // Organizer switches to 7-day fixed_ttl -> must stay alive for ~7 days from NOW, NOT be deleted!
    const updated = await req(
      `/plans/${plan.slug}`,
      'PATCH',
      { retentionPolicy: 'fixed_ttl', retentionDays: 7 },
      { 'X-Admin-Token': adminToken }
    );
    expect(updated.status).toBe(200);
    const expiresMs = Date.parse(updated.data.plan.expiresAt);
    expect(expiresMs).toBeGreaterThan(Date.now() + 6 * 86400_000);

    const fetched = await req(`/plans/${plan.slug}`);
    expect(fetched.status).toBe(200);
    expect(fetched.data.plan.title).toBe('Plan Antiguo');
  });

  it('validates and normalizes sub-poll URLs (blocks javascript: XSS, normalizes bare domains)', async () => {
    const created = await req('/plans', 'POST', {
      title: 'Cena Navidad Links',
      organizerName: 'Host',
    });
    const base = `/plans/${created.data.plan.slug}`;
    const auth = { 'X-Participant-Token': created.data.participantToken };

    const badInitial = await req(
      `${base}/sub-polls`,
      'POST',
      {
        category: 'place',
        question: '¿Dónde cenamos?',
        initialOptions: [{ title: 'Malicioso', url: 'javascript:alert(1)' }],
      },
      auth
    );
    expect(badInitial.status).toBe(400);

    const goodPoll = await req(
      `${base}/sub-polls`,
      'POST',
      {
        category: 'place',
        question: '¿Dónde cenamos?',
        initialOptions: [{ title: 'La Taberna', url: 'maps.app.goo.gl/abc123' }],
      },
      auth
    );
    expect(goodPoll.status).toBe(201);
    const pollId = goodPoll.data.pollId;
    expect(goodPoll.data.snapshot.subPolls[0].options[0].url).toBe('https://maps.app.goo.gl/abc123');

    const badOpt = await req(
      `${base}/sub-polls/${pollId}/options`,
      'POST',
      { title: 'XSS', url: 'data:text/html,<script>alert(1)</script>' },
      auth
    );
    expect(badOpt.status).toBe(400);

    const goodOpt = await req(
      `${base}/sub-polls/${pollId}/options`,
      'POST',
      { title: 'Asador', url: 'https://asador.example.com/menu' },
      auth
    );
    expect(goodOpt.status).toBe(201);
    expect(goodOpt.data.snapshot.subPolls[0].options[1].url).toBe(
      'https://asador.example.com/menu'
    );
  });

  it('prevents carpool overbooking and handles vote limits cleanly under concurrent requests', async () => {
    const created = await req('/plans', 'POST', {
      title: 'Cena Navidad Concurrencia',
      organizerName: 'Driver',
      maxVotesPerUser: 1,
    });
    const base = `/plans/${created.data.plan.slug}`;
    const driverAuth = { 'X-Participant-Token': created.data.participantToken };

    const f1 = await req(`${base}/participants`, 'POST', { name: 'Amigo 1' });
    const f2 = await req(`${base}/participants`, 'POST', { name: 'Amigo 2' });
    const auth1 = { 'X-Participant-Token': f1.data.participantToken };
    const auth2 = { 'X-Participant-Token': f2.data.participantToken };

    // Driver offers 1 seat; both friends race to claim it simultaneously
    const car = await req(
      `${base}/carpools`,
      'POST',
      { driverId: created.data.participant.id, origin: 'Centro', seatsTotal: 1 },
      driverAuth
    );
    expect(car.status).toBe(201);
    const rideId = car.data.rideId;

    const [r1, r2] = await Promise.all([
      req(`${base}/carpools/${rideId}/toggle`, 'POST', { participantId: f1.data.participant.id }, auth1),
      req(`${base}/carpools/${rideId}/toggle`, 'POST', { participantId: f2.data.participant.id }, auth2),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 400]);

    const afterCar = (await req(base)).data as PlanSnapshot;
    expect(afterCar.carpools[0].passengerIds).toHaveLength(1);

    // Participant with maxVotesPerUser=1 races two votes on different dates -> at most 1 vote recorded
    const [v1, v2] = await Promise.all([
      req(`${base}/votes/toggle`, 'POST', { participantId: f1.data.participant.id, date: '2026-12-18' }, auth1),
      req(`${base}/votes/toggle`, 'POST', { participantId: f1.data.participant.id, date: '2026-12-19' }, auth1),
    ]);
    expect([v1.status, v2.status].sort()).toEqual([200, 400]);
    const afterVotes = (await req(base)).data as PlanSnapshot;
    const f1Votes = afterVotes.votes.filter((v) => v.participantId === f1.data.participant.id);
    expect(f1Votes).toHaveLength(1);
  });

  it('runs a full multi-friend Christmas Dinner PoC end-to-end with zero data loss', async () => {
    // 1. Organizer creates the Christmas dinner plan
    const created = await req('/plans', 'POST', {
      title: 'Cena de Navidad 2026',
      description: '¡A cuadrar fecha antes de que se llenen los restaurantes!',
      location: 'Centro',
      emoji: '🎄',
      organizerName: 'Muri',
      organizerPin: '2026',
      maxVotesPerUser: 3,
      retentionPolicy: 'ephemeral_after_event',
      retentionDays: 30,
    });
    expect(created.status).toBe(201);
    const { plan, participant: org, adminToken, participantToken: orgToken } =
      created.data as CreatePlanResponse;
    const base = `/plans/${plan.slug}`;
    const orgAuth = { 'X-Participant-Token': orgToken };
    const adminAuth = { 'X-Admin-Token': adminToken };

    // 2. 6 friends join from the WhatsApp group
    const friendNames = ['Carlos', 'Lucía', 'Marta', 'Diego', 'Sofía', 'Javi'];
    const friends: Array<{ id: string; name: string; token: string }> = [];
    for (const name of friendNames) {
      const joined = await req(`${base}/participants`, 'POST', { name, pin: '1234' });
      expect(joined.status).toBe(201);
      friends.push({
        id: joined.data.participant.id,
        name,
        token: joined.data.participantToken,
      });
    }

    // 3. Organizer + friends mark December availability
    const decDates = ['2026-12-11', '2026-12-12', '2026-12-18', '2026-12-19'];
    await req(
      `${base}/availability`,
      'PUT',
      {
        participantId: org.id,
        changes: [
          { date: '2026-12-12', status: 'yes' },
          { date: '2026-12-18', status: 'maybe', note: 'Salgo tarde del curro' },
          { date: '2026-12-19', status: 'yes', note: 'Perfecto para reservar' },
        ],
      },
      orgAuth
    );

    for (let i = 0; i < friends.length; i++) {
      const f = friends[i];
      const avail = await req(
        `${base}/availability`,
        'PUT',
        {
          participantId: f.id,
          changes: [
            { date: decDates[i % 2], status: 'maybe' },
            { date: '2026-12-18', status: i % 2 === 0 ? 'yes' : 'no' },
            { date: '2026-12-19', status: 'yes' },
          ],
        },
        { 'X-Participant-Token': f.token }
      );
      expect(avail.status).toBe(200);
    }

    // 4. Everyone votes for Dec 19, plus comments, restaurant sub-poll, checklist & carpool
    for (const f of friends) {
      const voted = await req(
        `${base}/votes/toggle`,
        'POST',
        { participantId: f.id, date: '2026-12-19' },
        { 'X-Participant-Token': f.token }
      );
      expect(voted.status).toBe(200);
    }
    const poll = await req(
      `${base}/sub-polls`,
      'POST',
      {
        category: 'place',
        question: '¿Restaurante para Navidad?',
        initialOptions: [
          { title: 'Casa Lucio', estimatedCost: '~40€', url: 'https://casalucio.es' },
          { title: 'La Taberna', estimatedCost: '~30€' },
        ],
      },
      orgAuth
    );
    expect(poll.status).toBe(201);
    const firstOptId = poll.data.snapshot.subPolls[0].options[0].id;
    await req(
      `${base}/sub-polls/${poll.data.pollId}/vote`,
      'POST',
      { participantId: friends[0].id, optionId: firstOptId },
      { 'X-Participant-Token': friends[0].token }
    );
    await req(
      `${base}/checklist`,
      'POST',
      { title: 'Reservar mesa para 7', assignedTo: org.id },
      orgAuth
    );
    await req(
      `${base}/comments`,
      'POST',
      { participantId: friends[1].id, date: '2026-12-19', body: '¡Me apunto seguro!' },
      { 'X-Participant-Token': friends[1].token }
    );

    // 5. Organizer confirms Saturday Dec 19 at 21:00
    const confirm = await req(
      base,
      'PATCH',
      {
        confirmedDate: '2026-12-19',
        confirmedTime: '21:00',
        confirmedDurationMinutes: 210,
        confirmedTimezone: 'Europe/Madrid',
      },
      adminAuth
    );
    expect(confirm.status).toBe(200);
    // Expiration must be at least 14 days after 2026-12-19 (i.e. Jan 2, 2027)
    expect(Date.parse(confirm.data.plan.expiresAt)).toBeGreaterThanOrEqual(
      Date.parse('2027-01-02T00:00:00Z')
    );

    // 6. Friends submit RSVPs with +1
    const rsvp = await req(
      `${base}/rsvp`,
      'PUT',
      { participantId: friends[0].id, status: 'going', guestsCount: 1, note: 'Voy con mi pareja' },
      { 'X-Participant-Token': friends[0].token }
    );
    expect(rsvp.status).toBe(200);

    // 7. Purge running on Christmas Eve (Dec 24) MUST NOT delete the confirmed Christmas plan
    // (earlier test fixtures with 7-day TTL may legitimately be purged, so verify our plan survives!)
    await store.purgeExpiredPlans(new Date('2026-12-24T12:00:00Z'));

    // 8. Re-read snapshot & full backup — every single piece of data persisted cleanly!
    const finalRes = await req(base);
    expect(finalRes.status).toBe(200);
    const finalSnap = finalRes.data as PlanSnapshot;
    expect(finalSnap.participants).toHaveLength(7);
    expect(finalSnap.availabilities.length).toBe(3 + 6 * 3);
    expect(finalSnap.votes).toHaveLength(6);
    expect(finalSnap.plan.confirmedDate).toBe('2026-12-19');
    expect(finalSnap.plan.confirmedTime).toBe('21:00');
    expect(finalSnap.rsvps).toHaveLength(1);
    expect(finalSnap.rsvps[0].guestsCount).toBe(1);
    expect(finalSnap.subPolls[0].options[0].voterIds).toEqual([friends[0].id]);
    expect(finalSnap.checklist).toHaveLength(1);
    expect(finalSnap.comments).toHaveLength(1);

    const backup = await req(`${base}/export`, 'GET', undefined, adminAuth);
    expect(backup.status).toBe(200);
    expect(backup.data.snapshot.participants).toHaveLength(7);
  });

  it('broadcasts to multiple SSE subscribers with a single DB snapshot read and preserves blind-vote masking', async () => {
    const created = await req('/plans', 'POST', {
      title: 'SSE Fanout',
      organizerName: 'Owner',
      blindVoting: true,
    });
    const base = `/plans/${created.data.plan.slug}`;
    const ownerId = created.data.participant.id;
    const ownerToken = created.data.participantToken;
    const guest = await req(`${base}/participants`, 'POST', { name: 'Guest' });
    const guestId = guest.data.participant.id;
    const guestToken = guest.data.participantToken;

    await req(
      `${base}/votes/toggle`,
      'POST',
      { participantId: ownerId, date: '2026-12-19' },
      { 'X-Participant-Token': ownerToken }
    );

    const receivedByOwner: PlanSnapshot[] = [];
    const receivedByGuest: PlanSnapshot[] = [];
    const receivedByAnon: PlanSnapshot[] = [];

    // Open 3 SSE streams (owner, guest, anonymous)
    async function connectSse(qs: string, sink: PlanSnapshot[]) {
      const controller = new AbortController();
      const response = await app.request(`/api${base}/stream${qs}`, { signal: controller.signal });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const pump = (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              if (block.startsWith('event: snapshot')) {
                const line = block.split('\n').find((l) => l.startsWith('data: '));
                if (line) sink.push(JSON.parse(line.slice(6)));
              }
            }
          }
        } catch {
          // Stream closed
        }
      })();
      return async () => {
        controller.abort();
        await reader.cancel().catch(() => {});
        await pump;
      };
    }

    const close1 = await connectSse(`?skipInitial=1&participantToken=${ownerToken}`, receivedByOwner);
    const close2 = await connectSse(`?skipInitial=1&participantToken=${guestToken}`, receivedByGuest);
    const close3 = await connectSse(`?skipInitial=1`, receivedByAnon);

    const spy = vi.spyOn(store, 'getPlanSnapshotBySlug');
    try {
      await req(
        `${base}/comments`,
        'POST',
        { participantId: guestId, body: 'Hola grupo!' },
        { 'X-Participant-Token': guestToken }
      );
      await new Promise((r) => setTimeout(r, 40));

      // Only 1 DB snapshot read for broadcast (NOT 1 + 3 = 4)!
      expect(spy).toHaveBeenCalledTimes(1);
      expect(receivedByOwner.at(-1)?.votes.map((v) => v.participantId)).toEqual([ownerId]);
      expect(receivedByGuest.at(-1)?.votes).toEqual([]);
      expect(receivedByAnon.at(-1)?.votes).toEqual([]);
      expect(receivedByGuest.at(-1)?.blindVoteStats?.votersCount).toBe(1);
    } finally {
      spy.mockRestore();
      await close1();
      await close2();
      await close3();
    }
  });
});

describe('Production proxy OG tags, malformed URLs, static fallback & config safety', () => {
  it('uses X-Forwarded-Proto/Host for OG tags, handles malformed URLs safely, and 404s missing API/assets', async () => {
    const tmpStatic = fs.mkdtempSync(path.join(os.tmpdir(), 'shalendar-static-test-'));
    fs.writeFileSync(
      path.join(tmpStatic, 'index.html'),
      '<!doctype html><html><head><title>Shalendar</title></head><body><div id="root"></div></body></html>'
    );

    const db = new ShalendarDB(':memory:');
    const app = createApp(db, new PlanEventHub(), tmpStatic, {
      persistentStorage: true,
      maxPinClaimsPerWindow: 2,
    });

    try {
      const created = (await (
        await app.request('/api/plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Cena Navidad',
            organizerName: 'Ana',
            organizerPin: '1234',
          }),
        })
      ).json()) as CreatePlanResponse;

      // Health reports persistentStorage flag
      const health = (await (await app.request('/api/health')).json()) as {
        ok: boolean;
        persistentStorage: boolean;
      };
      expect(health.ok).toBe(true);
      expect(health.persistentStorage).toBe(true);

      // Behind HTTPS reverse proxy -> og:image and og:url must use https:// and forwarded host
      const ogHtmlRes = await app.request(`http://127.0.0.1:3001/e/${created.plan.slug}`, {
        headers: {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'shalendar.example.com',
        },
      });
      expect(ogHtmlRes.status).toBe(200);
      expect(ogHtmlRes.headers.get('cache-control')).toBe('no-cache');
      const html = await ogHtmlRes.text();
      expect(html).toContain(`https://shalendar.example.com/e/${created.plan.slug}`);
      expect(html).toContain(`https://shalendar.example.com/api/plans/${created.plan.slug}/og.svg`);

      // Malformed percent-encoding must NOT crash with 500
      const malformedRes = await app.request('/e/%E0%A4%A');
      expect(malformedRes.status).toBe(200);

      // Unknown /api/* and missing /assets/* must return 404 (not index.html!)
      const unknownApi = await app.request('/api/does-not-exist');
      expect(unknownApi.status).toBe(404);
      expect(unknownApi.headers.get('content-type')).toContain('application/json');

      const missingAsset = await app.request('/assets/old-bundle-hash.js');
      expect(missingAsset.status).toBe(404);

      // PIN claim rate limiter blocks brute force
      for (let i = 0; i < 2; i++) {
        const res = await app.request(`/api/plans/${created.plan.slug}/participants/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Ana', pin: '0000' }),
        });
        expect(res.status).toBe(401);
      }
      const blocked = await app.request(`/api/plans/${created.plan.slug}/participants/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ana', pin: '0000' }),
      });
      expect(blocked.status).toBe(429);

      // REQUIRE_POSTGRES env flag parsing
      expect(loadPersistenceConfig({ REQUIRE_POSTGRES: 'true' }).requirePostgres).toBe(true);
      expect(loadPersistenceConfig({}).requirePostgres).toBe(false);
    } finally {
      db.close();
      fs.rmSync(tmpStatic, { recursive: true, force: true });
    }
  });
});
