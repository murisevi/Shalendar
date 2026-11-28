import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { ShalendarDB } from '../server/db.js';
import { createApp } from '../server/app.js';
import { PlanEventHub } from '../server/events.js';
import { PostgresShalendarStore } from '../server/persistence/postgres-store.js';
import { loadPersistenceConfig } from '../server/persistence/config.js';
import { runMigrations } from '../server/persistence/migrator.js';
import type { PgPoolLike } from '../server/persistence/pool.js';
import { asShalendarStore } from '../server/persistence/sqlite-store.js';
import type { ShalendarStore } from '../server/store.js';
import {
  computeDaySummaries,
  getPlanTimeSlots,
  getSlotMeta,
  normalizeEnabledSlots,
  rankBestDates,
} from '../shared/dates.js';
import type { CreatePlanResponse, PlanSnapshot } from '../shared/types.js';

describe('Meal & configurable slot domain logic', () => {
  it('normalizes enabled slots canonically and falls back cleanly for legacy plans', () => {
    expect(normalizeEnabledSlots('day', ['lunch'])).toEqual([]);
    expect(normalizeEnabledSlots('slots', [])).toEqual(['morning', 'afternoon', 'evening']);
    expect(normalizeEnabledSlots('meals', [])).toEqual(['breakfast', 'lunch', 'snack', 'dinner']);
    expect(normalizeEnabledSlots('meals', ['dinner', 'lunch', 'dinner', 'morning'])).toEqual([
      'lunch',
      'dinner',
    ]);
    expect(getPlanTimeSlots('meals', ['lunch', 'dinner'], 'es').map((s) => s.label)).toEqual([
      'Comida',
      'Cena',
    ]);
    expect(getPlanTimeSlots('meals', ['breakfast', 'snack'], 'en').map((s) => s.label)).toEqual([
      'Breakfast',
      'Snack',
    ]);
    expect(getSlotMeta('breakfast', 'es').defaultTime).toBe('10:00');
    expect(getSlotMeta('lunch', 'es').defaultTime).toBe('14:00');
    expect(getSlotMeta('snack', 'es').defaultTime).toBe('17:30');
    expect(getSlotMeta('dinner', 'es').defaultTime).toBe('21:00');
  });

  it('prevents false consensus when friends only match on disjoint meal slots', () => {
    const participants = [
      { id: 'p1', planId: 'pl', name: 'Ana', avatarColor: '#0D9488', avatarEmoji: '🦊', isOrganizer: true, createdAt: '' },
      { id: 'p2', planId: 'pl', name: 'Carlos', avatarColor: '#2563EB', avatarEmoji: '😎', isOrganizer: false, createdAt: '' },
    ];
    const availabilities = [
      // Dec 19: Ana ONLY Lunch, Carlos ONLY Dinner -> 0 real overlap!
      { participantId: 'p1', date: '2026-12-19', slot: 'lunch' as const, status: 'yes' as const, note: '', updatedAt: '' },
      { participantId: 'p1', date: '2026-12-19', slot: 'dinner' as const, status: 'no' as const, note: '', updatedAt: '' },
      { participantId: 'p2', date: '2026-12-19', slot: 'lunch' as const, status: 'no' as const, note: '', updatedAt: '' },
      { participantId: 'p2', date: '2026-12-19', slot: 'dinner' as const, status: 'yes' as const, note: '', updatedAt: '' },
      // Dec 20: Both Dinner -> 2/2 true consensus!
      { participantId: 'p1', date: '2026-12-20', slot: 'dinner' as const, status: 'yes' as const, note: '', updatedAt: '' },
      { participantId: 'p2', date: '2026-12-20', slot: 'dinner' as const, status: 'yes' as const, note: '', updatedAt: '' },
    ];

    const summaries = computeDaySummaries({
      participants,
      availabilities,
      votes: [],
      pollOptions: [],
      granularity: 'meals',
      enabledSlots: ['lunch', 'dinner'],
    });

    const dec19 = summaries.get('2026-12-19')!;
    const dec20 = summaries.get('2026-12-20')!;

    expect(dec19.yes).toHaveLength(1);
    expect(dec19.ratio).toBe(0.5);
    expect(dec19.allFilteredAvailable).toBe(false);
    expect(dec19.slots?.lunch?.yes.map((p) => p.name)).toEqual(['Ana']);
    expect(dec19.slots?.dinner?.yes.map((p) => p.name)).toEqual(['Carlos']);

    expect(dec20.yes).toHaveLength(2);
    expect(dec20.ratio).toBe(1);
    expect(dec20.allFilteredAvailable).toBe(true);
    expect(dec20.bestSlot).toBe('dinner');

    const ranked = rankBestDates(summaries, 5, 'smart', false, '2026-12-01');
    expect(ranked[0].date).toBe('2026-12-20');
    expect(ranked[1].date).toBe('2026-12-19');
  });

  it('prefers the slot where required attendees are available and supports slotFilter', () => {
    const participants = [
      { id: 'p1', planId: 'pl', name: 'Ana', avatarColor: '#0D9488', avatarEmoji: '🦊', isOrganizer: true, createdAt: '' },
      { id: 'p2', planId: 'pl', name: 'Carlos', avatarColor: '#2563EB', avatarEmoji: '😎', isOrganizer: false, createdAt: '' },
      { id: 'p3', planId: 'pl', name: 'VIP', avatarColor: '#E11D48', avatarEmoji: '🌟', isOrganizer: false, createdAt: '' },
    ];
    const availabilities = [
      { participantId: 'p1', date: '2026-12-18', slot: 'lunch' as const, status: 'yes' as const, note: '', updatedAt: '' },
      { participantId: 'p2', date: '2026-12-18', slot: 'lunch' as const, status: 'yes' as const, note: '', updatedAt: '' },
      { participantId: 'p3', date: '2026-12-18', slot: 'lunch' as const, status: 'no' as const, note: '', updatedAt: '' },
      { participantId: 'p1', date: '2026-12-18', slot: 'dinner' as const, status: 'yes' as const, note: '', updatedAt: '' },
      { participantId: 'p3', date: '2026-12-18', slot: 'dinner' as const, status: 'yes' as const, note: '', updatedAt: '' },
    ];

    const summaries = computeDaySummaries({
      participants,
      availabilities,
      votes: [],
      pollOptions: [],
      granularity: 'meals',
      enabledSlots: ['lunch', 'dinner'],
      requiredParticipantIds: ['p3'],
    });
    const day = summaries.get('2026-12-18')!;
    expect(day.bestSlot).toBe('dinner');
    expect(day.allRequiredAvailable).toBe(true);

    const lunchOnly = computeDaySummaries({
      participants,
      availabilities,
      votes: [],
      pollOptions: [],
      granularity: 'meals',
      enabledSlots: ['lunch', 'dinner'],
      requiredParticipantIds: ['p3'],
      slotFilter: 'lunch',
    }).get('2026-12-18')!;
    expect(lunchOnly.allRequiredAvailable).toBe(false);
    expect(lunchOnly.yes.map((p) => p.name)).toEqual(['Ana', 'Carlos']);
  });
});

describe('SQLite online upgrade from legacy v2 slot CHECK constraint', () => {
  it('migrates an existing SQLite DB cleanly without losing rows and allows meal slots', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shalendar-legacy-sqlite-'));
    const dbPath = path.join(tmpDir, 'legacy.db');
    try {
      // Seed an old pre-meal-slots database with old CHECK constraint & missing enabled_slots column
      const raw = new DatabaseSync(dbPath);
      raw.exec(`
        CREATE TABLE plans (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          location TEXT NOT NULL DEFAULT '',
          emoji TEXT NOT NULL DEFAULT '🍕',
          start_month TEXT NOT NULL,
          end_month TEXT NOT NULL,
          max_votes_per_user INTEGER NOT NULL DEFAULT 3,
          voting_open INTEGER NOT NULL DEFAULT 1,
          granularity TEXT NOT NULL DEFAULT 'slots',
          confirmed_date TEXT,
          confirmed_time TEXT,
          admin_token TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE participants (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          avatar_color TEXT NOT NULL,
          avatar_emoji TEXT NOT NULL,
          is_organizer INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE availabilities (
          plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
          participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          slot TEXT NOT NULL DEFAULT 'all' CHECK(slot IN ('all', 'morning', 'afternoon', 'evening')),
          status TEXT NOT NULL CHECK(status IN ('yes', 'maybe', 'no')),
          note TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL,
          PRIMARY KEY (plan_id, participant_id, date, slot)
        );
        INSERT INTO plans (id, slug, title, start_month, end_month, granularity, admin_token, created_at)
        VALUES ('p-old', 'legacy-plan', 'Legacy Plan', '2026-12', '2027-01', 'slots', 'adm', '2026-11-01T00:00:00.000Z');
        INSERT INTO participants (id, plan_id, name, avatar_color, avatar_emoji, is_organizer, created_at)
        VALUES ('u-old', 'p-old', 'Ana', '#0D9488', '🦊', 1, '2026-11-01T00:00:00.000Z');
        INSERT INTO availabilities (plan_id, participant_id, date, slot, status, note, updated_at)
        VALUES ('p-old', 'u-old', '2026-12-18', 'evening', 'yes', 'Keep me', '2026-11-01T00:00:00.000Z');
      `);
      raw.close();

      // Open with ShalendarDB -> online migration must preserve legacy row and allow 'dinner'
      const upgraded = new ShalendarDB(dbPath);
      try {
        const legacySnap = upgraded.getPlanSnapshotBySlug('legacy-plan');
        expect(legacySnap?.plan.granularity).toBe('slots');
        expect(legacySnap?.plan.enabledSlots).toEqual(['morning', 'afternoon', 'evening']);
        expect(legacySnap?.availabilities).toHaveLength(1);
        expect(legacySnap?.availabilities[0].slot).toBe('evening');
        expect(legacySnap?.availabilities[0].note).toBe('Keep me');

        const mealPlan = upgraded.createPlan({
          title: 'Cena Navidad',
          organizerName: 'Muri',
          granularity: 'meals',
          enabledSlots: ['lunch', 'dinner'],
          startMonth: '2026-12',
          endMonth: '2026-12',
        });
        upgraded.setAvailabilityBatch(mealPlan.plan.id, mealPlan.participant.id, [
          { date: '2026-12-19', slot: 'dinner', status: 'yes' },
        ]);
        const mealSnap = upgraded.getPlanSnapshotBySlug(mealPlan.plan.slug)!;
        expect(mealSnap.plan.granularity).toBe('meals');
        expect(mealSnap.plan.enabledSlots).toEqual(['lunch', 'dinner']);
        expect(mealSnap.availabilities[0].slot).toBe('dinner');
      } finally {
        upgraded.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe.each(['SQLite', 'PostgreSQL'] as const)('Meal slots API & persistence: %s', (driver) => {
  let store: ShalendarStore;
  let sqlite: ShalendarDB | undefined;
  let pg: PGlite | undefined;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const hub = new PlanEventHub();
    if (driver === 'SQLite') {
      sqlite = new ShalendarDB(':memory:');
      store = asShalendarStore(sqlite);
    } else {
      pg = new PGlite();
      let lockTail = Promise.resolve();
      const rawQuery = async <T>(sql: string, values?: readonly unknown[]) => {
        if (!values || values.length === 0) {
          const results = await pg!.exec(sql);
          const last = results[results.length - 1];
          return {
            rows: (last?.rows ?? []) as T[],
            rowCount: last?.affectedRows ?? last?.rows?.length ?? 0,
          };
        }
        const result = await pg!.query<T>(sql, [...values]);
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
      // Verify the actual numbered migrations (001 + 002) execute cleanly end-to-end!
      const migResult = await runMigrations(pool);
      expect(migResult.applied).toContain('001_initial_schema.sql');
      expect(migResult.applied).toContain('002_meal_slots.sql');
      store = new PostgresShalendarStore(pool, loadPersistenceConfig({}));
    }
    app = createApp(store, hub, undefined, { maxPlansPerHourPerIp: 500 });
  }, 30000);

  afterAll(async () => {
    await store?.close();
  });

  async function req(route: string, method = 'GET', body?: unknown, headers?: Record<string, string>) {
    return app.request(route, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(headers ?? {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  it('creates a Christmas meals plan, saves breakfast/lunch/snack/dinner availability, updates settings, and renders meal in OG card', async () => {
    const createRes = await req('/api/plans', 'POST', {
      title: 'Cena de Navidad',
      organizerName: 'Muri',
      startMonth: '2026-12',
      endMonth: '2026-12',
      granularity: 'meals',
      enabledSlots: ['dinner', 'lunch'],
      retentionPolicy: 'persistent',
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as CreatePlanResponse;
    expect(created.plan.granularity).toBe('meals');
    expect(created.plan.enabledSlots).toEqual(['lunch', 'dinner']);

    const joinRes = await req(`/api/plans/${created.plan.slug}/participants`, 'POST', {
      name: 'Elena',
    });
    expect(joinRes.status).toBe(201);
    const elena = (await joinRes.json()) as { participant: { id: string }; participantToken: string };

    // Muri can do lunch & dinner on Dec 19; Elena can only do dinner on Dec 19
    const put1 = await req(
      `/api/plans/${created.plan.slug}/availability`,
      'PUT',
      {
        participantId: created.participant.id,
        changes: [
          { date: '2026-12-19', slot: 'lunch', status: 'yes' },
          { date: '2026-12-19', slot: 'dinner', status: 'yes' },
        ],
      },
      { 'X-Participant-Token': created.participantToken }
    );
    expect(put1.status).toBe(200);

    const put2 = await req(
      `/api/plans/${created.plan.slug}/availability`,
      'PUT',
      {
        participantId: elena.participant.id,
        changes: [
          { date: '2026-12-19', slot: 'lunch', status: 'no' },
          { date: '2026-12-19', slot: 'dinner', status: 'yes' },
        ],
      },
      { 'X-Participant-Token': elena.participantToken }
    );
    expect(put2.status).toBe(200);
    const snap = ((await put2.json()) as { snapshot: PlanSnapshot }).snapshot;
    expect(snap.availabilities).toHaveLength(4);

    // OG SVG mentions the winning meal ("Cena")
    const ogRes = await req(`/api/plans/${created.plan.slug}/og.svg`);
    expect(ogRes.status).toBe(200);
    const ogSvg = await ogRes.text();
    expect(ogSvg).toContain('Cena');

    // Organizer expands to all 4 meals (including breakfast & snack)
    const patchRes = await req(
      `/api/plans/${created.plan.slug}`,
      'PATCH',
      {
        granularity: 'meals',
        enabledSlots: ['breakfast', 'lunch', 'snack', 'dinner'],
      },
      { 'X-Admin-Token': created.adminToken }
    );
    expect(patchRes.status).toBe(200);
    const patched = ((await patchRes.json()) as { snapshot: PlanSnapshot }).snapshot;
    expect(patched.plan.enabledSlots).toEqual(['breakfast', 'lunch', 'snack', 'dinner']);

    // Save breakfast & snack availabilities to prove DB CHECK constraint permits all 4 meals
    const put3 = await req(
      `/api/plans/${created.plan.slug}/availability`,
      'PUT',
      {
        participantId: created.participant.id,
        changes: [
          { date: '2026-12-20', slot: 'breakfast', status: 'maybe' },
          { date: '2026-12-20', slot: 'snack', status: 'yes' },
        ],
      },
      { 'X-Participant-Token': created.participantToken }
    );
    expect(put3.status).toBe(200);

    // Switching granularity to 'slots' without explicit enabledSlots resets cleanly to M/T/N
    const switchRes = await req(
      `/api/plans/${created.plan.slug}`,
      'PATCH',
      { granularity: 'slots' },
      { 'X-Admin-Token': created.adminToken }
    );
    expect(switchRes.status).toBe(200);
    const switched = ((await switchRes.json()) as { snapshot: PlanSnapshot }).snapshot;
    expect(switched.plan.granularity).toBe('slots');
    expect(switched.plan.enabledSlots).toEqual(['morning', 'afternoon', 'evening']);
  });
});
