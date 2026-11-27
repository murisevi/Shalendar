import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

// PGlite runs PostgreSQL itself in WASM: exercise production SQL and migrations,
// with the same contract as SQLite, without touching any local/user database.
describe.each(['SQLite', 'PostgreSQL'] as const)('QA regressions: %s', (driver) => {
  let store: ShalendarStore;
  let sqlite: ShalendarDB | undefined;
  let pg: PGlite | undefined;
  let app: ReturnType<typeof createApp>;
  const hub = new PlanEventHub();
  beforeAll(async () => {
    if (driver === 'SQLite') {
      sqlite = new ShalendarDB(':memory:');
      store = asShalendarStore(sqlite);
    } else {
      pg = new PGlite();
      await pg.exec(fs.readFileSync(new URL('../server/persistence/migrations/001_initial_schema.sql', import.meta.url), 'utf8'));
      const pool: PgPoolLike = {
        async query<T>(sql: string, values?: readonly unknown[]) {
          const result = await pg!.query<T>(sql, values ? [...values] : []);
          return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
        },
        async connect() { return { query: pool.query, release() {} }; },
        async end() { await pg!.close(); },
      };
      store = new PostgresShalendarStore(pool, loadPersistenceConfig({}));
    }
    app = createApp(store, hub, undefined, { maxPlansPerHourPerIp: 500 });
  }, 30000);
  afterAll(async () => { await store?.close(); });

  async function req(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
    const response = await app.request('/api' + path, {
      method, headers: { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() as any };
  }
  async function fixture(extra = {}) {
    const created = await req('/plans', 'POST', {
      title: 'QA regression', organizerName: 'Owner', organizerPin: '1234',
      retentionPolicy: 'persistent', startMonth: '2026-11', endMonth: '2027-01', ...extra,
    });
    expect(created.status).toBe(201);
    const data = created.data as CreatePlanResponse;
    const base = '/plans/' + data.plan.slug;
    const guest = await req(base + '/participants', 'POST', { name: 'Guest', pin: '5678' });
    expect(guest.status).toBe(201);
    return {
      base, ...data, owner: data.participant, guest: guest.data.participant,
      auth: { 'X-Participant-Token': data.participantToken },
      admin: { 'X-Admin-Token': data.adminToken },
      guestAuth: { 'X-Participant-Token': guest.data.participantToken },
    };
  }

  it('QA-01/13: hidden votes require a real session; only organizer backup includes every vote', async () => {
    const f = await fixture({ blindVoting: true });
    for (const [id, auth] of [[f.owner.id, f.auth], [f.guest.id, f.guestAuth]] as const) {
      expect((await req(f.base + '/votes/toggle', 'POST', { participantId: id, date: '2026-12-04' }, auth)).status).toBe(200);
    }
    for (const headers of [{}, { 'X-Participant-Id': f.owner.id }, { 'X-Participant-Token': 'invalid', 'X-Participant-Id': f.owner.id }]) {
      expect((await req(f.base + '?participantId=' + f.owner.id, 'GET', undefined, headers)).data.votes).toEqual([]);
    }
    const view = await req(f.base, 'GET', undefined, { ...f.guestAuth, 'X-Participant-Id': f.owner.id });
    expect(view.data.votes.map((v: any) => v.participantId)).toEqual([f.guest.id]);
    expect((await req(f.base + '/export')).status).toBe(403);
    expect((await req(f.base + '/export', 'GET', undefined, f.guestAuth)).status).toBe(403);
    const backup = await req(f.base + '/export', 'GET', undefined, f.admin);
    expect(backup.status).toBe(200);
    expect(backup.data.snapshot.votes).toHaveLength(2);
    expect(backup.data.snapshot.blindVoteStats).toBeUndefined();
    const serialized = JSON.stringify(backup.data);
    expect(serialized).not.toContain(f.participantToken);
    expect(serialized).not.toContain(f.adminToken);
    expect(serialized).not.toContain('pinHash');
  });

  async function openStream(path: string) {
    const controller = new AbortController();
    const response = await app.request('/api' + path, { signal: controller.signal });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    async function snapshot(): Promise<PlanSnapshot> {
      while (true) {
        const end = pending.indexOf('\n\n');
        if (end >= 0) {
          const event = pending.slice(0, end); pending = pending.slice(end + 2);
          if (event.startsWith('event: snapshot')) return JSON.parse(event.split('\ndata: ')[1]);
          continue;
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error('Stream ended before a snapshot');
        pending += decoder.decode(chunk.value, { stream: true });
      }
    }
    return { snapshot, close: async () => { controller.abort(); await reader.cancel(); } };
  }

  it('QA-01/15: initial and external SSE snapshots use token identity, including after recovery', async () => {
    const f = await fixture({ blindVoting: true });
    await req(f.base + '/votes/toggle', 'POST', { participantId: f.owner.id, date: '2026-12-04' }, f.auth);
    const anonymous = await openStream(f.base + '/stream?participantId=' + f.owner.id);
    try { expect((await anonymous.snapshot()).votes).toEqual([]); } finally { await anonymous.close(); }
    const recovered = await req(f.base + '/participants/claim', 'POST', { name: 'Owner', pin: '1234' });
    const authenticated = await openStream(f.base + '/stream?participantToken=' + recovered.data.participantToken + '&participantId=' + f.guest.id);
    try {
      expect((await authenticated.snapshot()).votes).toHaveLength(1);
      await req(f.base + '/comments', 'POST', { participantId: f.guest.id, body: 'External change' }, f.guestAuth);
      expect((await authenticated.snapshot()).votes.map((v) => v.participantId)).toEqual([f.owner.id]);
    } finally { await authenticated.close(); }
  });

  it('QA-02/05/06: authors cannot be forged; only admin selects an option from this poll', async () => {
    const f = await fixture();
    const other = await fixture();
    const poll = await req(f.base + '/sub-polls', 'POST', { category: 'place', question: 'Where?', initialOptions: [{ title: 'Here' }] }, f.guestAuth);
    expect(poll.status).toBe(201);
    const pollId = poll.data.pollId;
    const optionId = poll.data.snapshot.subPolls[0].options[0].id;
    expect(poll.data.snapshot.subPolls[0].options[0].proposedBy).toBe(f.guest.id);
    const actions = [
      ['/sub-polls', { category: 'place', question: 'Forged poll' }],
      ['/sub-polls/' + pollId + '/options', { title: 'Option' }],
      ['/poll-options', { date: '2026-12-05' }],
      ['/checklist', { title: 'Task' }],
    ] as const;
    for (const [path, body] of actions) {
      for (const headers of [{}, f.guestAuth, other.auth]) {
        expect((await req(f.base + path, 'POST', { ...body, participantId: f.owner.id }, headers)).status).toBe(403);
      }
      expect((await req(f.base + path, 'POST', body, f.guestAuth)).status).toBe(201);
    }
    const path = f.base + '/sub-polls/' + pollId;
    for (const headers of [{}, f.guestAuth, f.auth, other.admin]) {
      expect((await req(path, 'PATCH', { winnerOptionId: optionId }, headers)).status).toBe(403);
    }
    expect((await req(path, 'PATCH', { winnerOptionId: 'missing' }, f.admin)).status).toBe(400);
    const second = await req(f.base + '/sub-polls', 'POST', { category: 'place', question: 'Second?', initialOptions: [{ title: 'Elsewhere' }] }, f.auth);
    const foreignOption = second.data.snapshot.subPolls.find((p: any) => p.id === second.data.pollId).options[0].id;
    expect((await req(path, 'PATCH', { winnerOptionId: foreignOption }, f.admin)).status).toBe(400);
    expect((await req(path, 'PATCH', { winnerOptionId: optionId }, f.admin)).status).toBe(200);
    expect((await req(path, 'PATCH', { winnerOptionId: null }, f.admin)).status).toBe(200);
  });

  it('QA-03/07: members can collaborate on tasks, visitors cannot; assignments stay in this plan', async () => {
    const f = await fixture(); const other = await fixture();
    const item = await req(f.base + '/checklist', 'POST', { title: 'Group task', assignedTo: f.owner.id }, f.auth);
    expect(item.status).toBe(201);
    const path = f.base + '/checklist/' + item.data.itemId;
    for (const headers of [{}, other.auth]) {
      expect((await req(path, 'PATCH', { completed: true }, headers)).status).toBe(403);
      expect((await req(path, 'DELETE', undefined, headers)).status).toBe(403);
    }
    expect((await req(f.base + '/checklist', 'POST', { title: 'Foreign task', assignedTo: other.owner.id }, f.auth)).status).toBe(400);
    expect((await req(path, 'PATCH', { assignedTo: other.owner.id }, f.guestAuth)).status).toBe(400);
    const valid = await req(path, 'PATCH', { completed: true, assignedTo: f.guest.id }, f.guestAuth);
    expect(valid.status).toBe(200);
    expect(valid.data.snapshot.checklist[0]).toMatchObject({ completed: true, assignedTo: f.guest.id });
    expect((await req(path, 'DELETE', undefined, f.guestAuth)).status).toBe(200);
  });

  it('QA-04: only driver or organizer can delete a car', async () => {
    const f = await fixture();
    async function car() {
      const response = await req(f.base + '/carpools', 'POST', { driverId: f.owner.id, origin: 'Madrid', seatsTotal: 2 }, f.auth);
      expect(response.status).toBe(201);
      return f.base + '/carpools/' + response.data.rideId;
    }
    const path = await car();
    for (const headers of [{}, f.guestAuth, { 'X-Participant-Id': f.owner.id }]) {
      expect((await req(path, 'DELETE', undefined, headers)).status).toBe(403);
    }
    expect((await req(path, 'DELETE', undefined, f.auth)).status).toBe(200);
    expect((await req(await car(), 'DELETE', undefined, f.admin)).status).toBe(200);
  });

  it('QA-08/09/10/11: validates each temporal field and effective relations on partial updates', async () => {
    const f = await fixture();
    for (const date of ['2026-02-30', '2026-04-31', '2026-13-01', '0000-01-01']) {
      for (const [path, method, body] of [
        ['/availability', 'PUT', { participantId: f.owner.id, changes: [{ date, status: 'yes' }] }],
        ['/votes/toggle', 'POST', { participantId: f.owner.id, date }],
        ['/poll-options', 'POST', { date }],
        ['/comments', 'POST', { participantId: f.owner.id, date, body: 'Hello' }],
      ] as const) expect((await req(f.base + path, method, body, f.auth)).status).toBe(400);
      for (const field of ['confirmedDate', 'confirmedEndDate']) {
        expect((await req(f.base, 'PATCH', { [field]: date }, f.admin)).status).toBe(400);
      }
    }
    for (const body of [
      { startMonth: '2026-99' }, { endMonth: '2026-00' },
      { startMonth: '2026-12', endMonth: '2026-01' }, { endMonth: '2000-01' },
      { votingDeadline: 'not-a-date' }, { votingDeadline: '2026-02-30T10:00:00Z' },
      { votingDeadline: '2026-12-01T25:00:00Z' },
    ]) {
      expect((await req('/plans', 'POST', { title: 'Invalid dates', organizerName: 'QA', ...body })).status).toBe(400);
      expect((await req(f.base, 'PATCH', body, f.admin)).status).toBe(400);
    }
    for (const body of [
      { confirmedTime: '99:99' }, { confirmedTime: '23:60' },
      { confirmedTimezone: 'Invalid/Zone' },
      { confirmedEndDate: '2026-12-01' },
      { confirmedDate: '2026-12-10', confirmedEndDate: '2026-12-01' },
    ]) expect((await req(f.base, 'PATCH', body, f.admin)).status).toBe(400);
    expect((await req(f.base, 'PATCH', {
      confirmedDate: '2026-12-10', confirmedEndDate: '2026-12-12', confirmedTime: '23:59',
      confirmedTimezone: 'Europe/Madrid', votingDeadline: '2026-12-01T10:00:00+01:00',
    }, f.admin)).status).toBe(200);
    expect((await req(f.base, 'PATCH', { confirmedDate: '2026-12-13' }, f.admin)).status).toBe(400);
    expect((await req(f.base, 'PATCH', { confirmedEndDate: '2026-12-09' }, f.admin)).status).toBe(400);
    expect((await req(f.base, 'PATCH', { startMonth: '2027-02' }, f.admin)).status).toBe(400);
    expect((await req(f.base, 'PATCH', { confirmedDate: null, votingDeadline: null }, f.admin)).status).toBe(200);
    expect((await req(f.base + '/availability', 'PUT', { participantId: f.owner.id, changes: [{ date: '2028-02-29', status: 'yes' }] }, f.auth)).status).toBe(200);
  });

  it('QA-12: short PIN rejection preserves the old PIN, explicit empty PIN removes it', async () => {
    const f = await fixture();
    const path = f.base + '/participants/' + f.owner.id;
    for (const pin of ['1', '12', '123', ' 12 ', '1234567890123']) {
      expect((await req(path, 'PATCH', { pin }, f.auth)).status).toBe(400);
    }
    expect((await req(f.base + '/participants/claim', 'POST', { name: 'Owner', pin: '1234' })).status).toBe(200);
    expect((await req(path, 'PATCH', { pin: '' }, f.auth)).data.participant.hasPin).toBe(false);
    expect((await req(f.base + '/participants/claim', 'POST', { name: 'Owner', pin: '1234' })).status).toBe(401);
  });

  it('QA-14: comments, joins, voting/unvoting, RSVP and logistics refresh sliding retention', async () => {
    const f = await fixture({ retentionPolicy: 'sliding_inactivity', retentionDays: 30 });
    const oldActivity = new Date(Date.now() - 86400000).toISOString();
    const oldExpiry = new Date(Date.now() + 29 * 86400000).toISOString();
    async function check(action: () => Promise<{ status: number }>) {
      if (sqlite) (sqlite as any).db.prepare('UPDATE plans SET last_activity_at = ?, expires_at = ? WHERE id = ?').run(oldActivity, oldExpiry, f.plan.id);
      else await pg!.query('UPDATE plans SET last_activity_at = $1, expires_at = $2 WHERE id = $3', [oldActivity, oldExpiry, f.plan.id]);
      const result = await action();
      expect(result.status).toBeLessThan(300);
      const snapshot = (await req(f.base)).data as PlanSnapshot;
      expect(Date.parse(snapshot.plan.lastActivityAt)).toBeGreaterThan(Date.parse(oldActivity));
      expect(Date.parse(snapshot.plan.expiresAt!)).toBeGreaterThan(Date.parse(oldExpiry));
    }
    await check(() => req(f.base + '/comments', 'POST', { participantId: f.owner.id, body: 'Active comment' }, f.auth));
    await check(() => req(f.base + '/participants', 'POST', { name: 'New member' }));
    for (let i = 0; i < 2; i++) await check(() => req(f.base + '/votes/toggle', 'POST', { participantId: f.owner.id, date: '2026-12-04' }, f.auth));
    await check(() => req(f.base + '/rsvp', 'PUT', { participantId: f.owner.id, status: 'going' }, f.auth));
    await check(() => req(f.base + '/checklist', 'POST', { title: 'Activity task' }, f.auth));
    await check(() => req(f.base + '/carpools', 'POST', { driverId: f.owner.id, origin: 'Madrid', seatsTotal: 2 }, f.auth));
    await check(() => req(f.base + '/sub-polls', 'POST', { category: 'place', question: 'Where?' }, f.auth));
    let current = (await req(f.base)).data as PlanSnapshot;
    const itemId = current.checklist[0].id;
    const rideId = current.carpools[0].id;
    const pollId = current.subPolls[0].id;
    await check(() => req(f.base + '/availability', 'PUT', { participantId: f.owner.id, changes: [{ date: '2026-12-04', status: 'yes' }] }, f.auth));
    await check(() => req(f.base + '/poll-options', 'POST', { date: '2026-12-05' }, f.auth));
    await check(() => req(f.base + '/poll-options/2026-12-05', 'DELETE', undefined, f.admin));
    await check(() => req(f.base + '/checklist/' + itemId, 'PATCH', { completed: true }, f.guestAuth));
    await check(() => req(f.base + '/checklist/' + itemId, 'DELETE', undefined, f.guestAuth));
    for (let i = 0; i < 2; i++) await check(() => req(f.base + '/carpools/' + rideId + '/toggle', 'POST', { participantId: f.guest.id }, f.guestAuth));
    await check(() => req(f.base + '/carpools/' + rideId, 'DELETE', undefined, f.auth));
    await check(() => req(f.base + '/sub-polls/' + pollId + '/options', 'POST', { title: 'Here' }, f.guestAuth));
    current = (await req(f.base)).data;
    const optionId = current.subPolls[0].options[0].id;
    for (let i = 0; i < 2; i++) await check(() => req(f.base + '/sub-polls/' + pollId + '/vote', 'POST', { participantId: f.guest.id, optionId }, f.guestAuth));
    await check(() => req(f.base + '/sub-polls/' + pollId, 'PATCH', { winnerOptionId: optionId }, f.admin));
    await check(() => req(f.base + '/sub-polls/' + pollId, 'DELETE', undefined, f.admin));
    await check(() => req(f.base + '/participants/' + f.guest.id, 'PATCH', { avatarEmoji: 'X' }, f.guestAuth));
    await check(() => req(f.base + '/participants/' + f.guest.id, 'DELETE', undefined, f.guestAuth));
  });

  it('QA-01/02/13: a public demo does not bypass sessions or expose its full backup', async () => {
    const f = await store.createPlan({ title: 'Public demo', organizerName: 'Demo owner', isDemo: true });
    const base = '/plans/' + f.plan.slug;
    expect((await req(base + '/export')).status).toBe(403);
    expect((await req(base, 'PATCH', { title: 'Anonymous edit' })).status).toBe(403);
    expect((await req(base + '/availability', 'PUT', { participantId: f.participant.id, changes: [{ date: '2026-12-04', status: 'yes' }] })).status).toBe(403);
    expect((await req(base + '/export', 'GET', undefined, { 'X-Admin-Token': f.adminToken })).status).toBe(200);
  });
});
