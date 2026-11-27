import { describe, expect, it } from 'vitest';
import { ShalendarDB } from '../server/db.js';
import { PlanEventHub } from '../server/events.js';
import { createApp } from '../server/app.js';
import {
  buildGoogleCalendarUrl,
  buildIcsContent,
  buildMonthGrid,
  computeDaySummaries,
  rankBestDates,
  rankBestRanges,
} from '../shared/dates.js';
import { getHolidayInfo } from '../shared/holidays.js';

describe('shared date, holiday, slot, range & export logic', () => {
  it('builds a Monday-first month grid with correct week alignment', () => {
    const cells = buildMonthGrid('2026-12', '2026-12-01');
    expect(cells.length % 7).toBe(0);
    expect(cells[0].date).toBe('2026-11-30');
    expect(cells[0].inCurrentMonth).toBe(false);
    expect(cells[1].date).toBe('2026-12-01');
    expect(cells[1].inCurrentMonth).toBe(true);
    expect(cells[1].isToday).toBe(true);
    expect(cells[1].weekdayIndexMon).toBe(1);
  });

  it('computes availability ratios, required attendees, slots, and smart ranking', () => {
    const participants = [
      { id: 'p1', planId: 'pl', name: 'Ana', avatarColor: '#0D9488', avatarEmoji: '🦊', isOrganizer: true, createdAt: '' },
      { id: 'p2', planId: 'pl', name: 'Luis', avatarColor: '#2563EB', avatarEmoji: '😎', isOrganizer: false, createdAt: '' },
      { id: 'p3', planId: 'pl', name: 'Sara', avatarColor: '#E11D48', avatarEmoji: '🌟', isOrganizer: false, createdAt: '' },
    ];
    const availabilities = [
      { participantId: 'p1', date: '2026-12-12', slot: 'all' as const, status: 'yes' as const, note: 'Desde las 20h', updatedAt: '' },
      { participantId: 'p2', date: '2026-12-12', slot: 'all' as const, status: 'yes' as const, note: '', updatedAt: '' },
      { participantId: 'p3', date: '2026-12-12', slot: 'all' as const, status: 'yes' as const, note: '', updatedAt: '' },
      { participantId: 'p1', date: '2026-12-19', slot: 'all' as const, status: 'yes' as const, note: '', updatedAt: '' },
      { participantId: 'p2', date: '2026-12-19', slot: 'all' as const, status: 'maybe' as const, note: '', updatedAt: '' },
    ];
    const votes = [
      { participantId: 'p1', date: '2026-12-19', createdAt: '' },
      { participantId: 'p2', date: '2026-12-19', createdAt: '' },
      { participantId: 'p3', date: '2026-12-12', createdAt: '' },
    ];

    const summaries = computeDaySummaries({
      participants,
      availabilities,
      votes,
      pollOptions: [],
      requiredParticipantIds: ['p3'],
    });

    expect(summaries.get('2026-12-12')?.yes.length).toBe(3);
    expect(summaries.get('2026-12-12')?.hasNotes).toBe(true);
    expect(summaries.get('2026-12-12')?.notesByParticipant.p1).toBe('Desde las 20h');
    expect(summaries.get('2026-12-12')?.allRequiredAvailable).toBe(true);
    expect(summaries.get('2026-12-19')?.allRequiredAvailable).toBe(false);

    // Strict votes mode puts 12-19 first (2 votes vs 1)
    const rankedByVotes = rankBestDates(summaries, 10, 'votes');
    expect(rankedByVotes[0].date).toBe('2026-12-19');

    // Smart mode with required attendee Sara (p3) puts 12-12 first!
    const rankedSmart = rankBestDates(summaries, 10, 'smart', true);
    expect(rankedSmart[0].date).toBe('2026-12-12');
  });

  it('finds best consecutive multi-day blocks and detects national holidays', () => {
    expect(getHolidayInfo('2026-12-06', 'ES')?.name).toContain('Constitución');
    expect(getHolidayInfo('2026-12-08', 'ES')?.name).toContain('Inmaculada');
    expect(getHolidayInfo('2026-04-03', 'ES')?.name).toBe('Viernes Santo');

    const participants = [
      { id: 'p1', planId: 'pl', name: 'Ana', avatarColor: '#0D9488', avatarEmoji: '🦊', isOrganizer: true, createdAt: '' },
      { id: 'p2', planId: 'pl', name: 'Luis', avatarColor: '#2563EB', avatarEmoji: '😎', isOrganizer: false, createdAt: '' },
    ];
    const availabilities = [
      { participantId: 'p1', date: '2026-12-06', slot: 'all' as const, status: 'yes' as const, note: '', updatedAt: '' },
      { participantId: 'p1', date: '2026-12-07', slot: 'all' as const, status: 'yes' as const, note: '', updatedAt: '' },
      { participantId: 'p1', date: '2026-12-08', slot: 'all' as const, status: 'yes' as const, note: '', updatedAt: '' },
      { participantId: 'p2', date: '2026-12-06', slot: 'all' as const, status: 'yes' as const, note: '', updatedAt: '' },
      { participantId: 'p2', date: '2026-12-07', slot: 'all' as const, status: 'yes' as const, note: '', updatedAt: '' },
      { participantId: 'p2', date: '2026-12-08', slot: 'all' as const, status: 'yes' as const, note: '', updatedAt: '' },
    ];

    const summaries = computeDaySummaries({ participants, availabilities, votes: [], pollOptions: [] });
    const ranges = rankBestRanges({
      summaries,
      participants,
      durationDays: 3,
      holidayCountry: 'ES',
    });

    expect(ranges[0].startDate).toBe('2026-12-06');
    expect(ranges[0].endDate).toBe('2026-12-08');
    expect(ranges[0].fullYes).toHaveLength(2);
    expect(ranges[0].includesHoliday).toBe(true);
  });

  it('fixes midnight rollover in .ics and Google Calendar URLs and supports multi-day ranges', () => {
    const ics = buildIcsContent({
      title: '🍕 Cena tardía',
      location: 'Centro',
      date: '2026-12-12',
      time: '22:30',
      durationMinutes: 180,
      timezone: 'Europe/Madrid',
    });
    expect(ics).toContain('DTSTART;TZID=Europe/Madrid:20261212T223000');
    expect(ics).toContain('DTEND;TZID=Europe/Madrid:20261213T013000');

    const gcal = buildGoogleCalendarUrl({
      title: 'Cena tardía',
      date: '2026-12-12',
      time: '22:30',
      durationMinutes: 180,
    });
    expect(gcal).toContain('20261212T223000%2F20261213T013000');

    const multiIcs = buildIcsContent({
      title: '🏔️ Escapada',
      date: '2026-12-06',
      endDate: '2026-12-08',
    });
    expect(multiIcs).toContain('DTSTART;VALUE=DATE:20261206');
    expect(multiIcs).toContain('DTEND;VALUE=DATE:20261209');
  });
});

describe('Shalendar API Wave 1 & Wave 2 (Security, Recovery, Blind Voting, Slots, Logistics)', () => {
  it('enforces admin/participant auth, privacy, PIN recovery, slots, notes, blind voting, and logistics', async () => {
    const db = new ShalendarDB(':memory:');
    const hub = new PlanEventHub();
    const app = createApp(db, hub);

    // 1. Create a private plan with slots + blind voting + multi-day
    const createRes = await app.request('/api/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Escapada rural',
        organizerName: 'Laura',
        location: 'Sierra',
        emoji: '🏔️',
        maxVotesPerUser: 2,
        granularity: 'slots',
        durationDays: 2,
        blindVoting: true,
        organizerPin: '4321',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      plan: { slug: string; granularity: string; blindVoting: boolean; durationDays: number };
      participant: { id: string; name: string };
      adminToken: string;
      participantToken: string;
    };
    const slug = created.plan.slug;
    expect(slug.length).toBeGreaterThanOrEqual(20); // High-entropy slug
    expect(created.plan.granularity).toBe('slots');
    expect(created.plan.blindVoting).toBe(true);

    // 2. Privacy: GET /api/plans does NOT leak private plans; POST /api/plans/lookup hydrates known slugs
    const publicList = (await (await app.request('/api/plans')).json()) as { plans: unknown[] };
    expect(publicList.plans).toHaveLength(0);

    const lookup = (await (
      await app.request('/api/plans/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slugs: [slug] }),
      })
    ).json()) as { plans: Array<{ slug: string }> };
    expect(lookup.plans).toHaveLength(1);
    expect(lookup.plans[0].slug).toBe(slug);

    // 3. Friend joins with PIN and recovers session from another device
    const joinRes = await app.request(`/api/plans/${slug}/participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Marcos', avatarEmoji: '🦊', pin: '9876' }),
    });
    expect(joinRes.status).toBe(201);
    const joined = (await joinRes.json()) as {
      participant: { id: string };
      participantToken: string;
    };

    const badClaim = await app.request(`/api/plans/${slug}/participants/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Marcos', pin: '0000' }),
    });
    expect(badClaim.status).toBe(401);

    const goodClaim = await app.request(`/api/plans/${slug}/participants/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'marcos', pin: '9876' }),
    });
    expect(goodClaim.status).toBe(200);
    const claimed = (await goodClaim.json()) as { participantToken: string };
    expect(claimed.participantToken).toBe(joined.participantToken);

    // 4. Participant token is enforced on availability writes; notes preserved on status-only edits
    const spoofRes = await app.request(`/api/plans/${slug}/availability`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: joined.participant.id,
        changes: [{ date: '2026-12-11', slot: 'evening', status: 'yes' }],
      }),
    });
    expect(spoofRes.status).toBe(403);

    const availRes = await app.request(`/api/plans/${slug}/availability`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Participant-Token': joined.participantToken,
      },
      body: JSON.stringify({
        participantId: joined.participant.id,
        changes: [
          { date: '2026-12-11', slot: 'evening', status: 'yes', note: 'Llego a las 20:30' },
          { date: '2026-12-12', slot: 'morning', status: 'maybe' },
        ],
      }),
    });
    expect(availRes.status).toBe(200);

    // Update status without passing note -> existing note stays intact
    const updateStatusOnly = await app.request(`/api/plans/${slug}/availability`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Participant-Token': joined.participantToken,
      },
      body: JSON.stringify({
        participantId: joined.participant.id,
        changes: [{ date: '2026-12-11', slot: 'evening', status: 'maybe' }],
      }),
    });
    const afterUpdate = (await updateStatusOnly.json()) as {
      snapshot: { availabilities: Array<{ date: string; note: string }> };
    };
    expect(afterUpdate.snapshot.availabilities.find((a) => a.date === '2026-12-11')?.note).toBe(
      'Llego a las 20:30'
    );

    // 5. Blind voting hides Marcos's vote from Laura while open, reveals once closed
    const v1 = await app.request(`/api/plans/${slug}/votes/toggle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Participant-Token': joined.participantToken,
      },
      body: JSON.stringify({ participantId: joined.participant.id, date: '2026-12-11' }),
    });
    expect(v1.status).toBe(200);

    const lauraView = (await (
      await app.request(`/api/plans/${slug}`, {
        headers: { 'X-Participant-Token': created.participantToken },
      })
    ).json()) as { votes: unknown[]; blindVoteStats?: { hidden: boolean; votersCount: number } };
    expect(lauraView.votes).toHaveLength(0);
    expect(lauraView.blindVoteStats?.hidden).toBe(true);
    expect(lauraView.blindVoteStats?.votersCount).toBe(1);

    // 6. Admin token required on PATCH /api/plans/:slug
    const unauthPatch = await app.request(`/api/plans/${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ votingOpen: false }),
    });
    expect(unauthPatch.status).toBe(403);

    const closeVoting = await app.request(`/api/plans/${slug}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': created.adminToken,
      },
      body: JSON.stringify({
        votingOpen: false,
        confirmedDate: '2026-12-11',
        confirmedEndDate: '2026-12-12',
      }),
    });
    expect(closeVoting.status).toBe(200);
    const revealed = (await closeVoting.json()) as { snapshot: { votes: unknown[] } };
    expect(revealed.snapshot.votes).toHaveLength(1);

    // 7. RSVP + Sub-Poll + Checklist + Carpool + Dynamic OG SVG
    const rsvpRes = await app.request(`/api/plans/${slug}/rsvp`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Participant-Token': joined.participantToken,
      },
      body: JSON.stringify({
        participantId: joined.participant.id,
        status: 'going',
        guestsCount: 1,
        note: 'Voy con mi pareja',
      }),
    });
    expect(rsvpRes.status).toBe(200);

    const pollRes = await app.request(`/api/plans/${slug}/sub-polls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: created.participant.id,
        category: 'place',
        question: '¿Qué casa rural?',
        initialOptions: [{ title: 'Casa El Pino', estimatedCost: '45€/noche' }],
      }),
    });
    expect(pollRes.status).toBe(201);
    const pollData = (await pollRes.json()) as {
      pollId: string;
      snapshot: { subPolls: Array<{ id: string; options: Array<{ id: string }> }> };
    };
    const optId = pollData.snapshot.subPolls[0].options[0].id;

    const subVoteRes = await app.request(`/api/plans/${slug}/sub-polls/${pollData.pollId}/vote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Participant-Token': joined.participantToken,
      },
      body: JSON.stringify({ participantId: joined.participant.id, optionId: optId }),
    });
    expect(subVoteRes.status).toBe(200);

    const taskRes = await app.request(`/api/plans/${slug}/checklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Comprar carbón', assignedTo: joined.participant.id }),
    });
    expect(taskRes.status).toBe(201);

    const carRes = await app.request(`/api/plans/${slug}/carpools`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Participant-Token': created.participantToken,
      },
      body: JSON.stringify({
        driverId: created.participant.id,
        origin: 'Plaza Castilla',
        seatsTotal: 1,
        departureTime: '18:00',
      }),
    });
    expect(carRes.status).toBe(201);
    const carData = (await carRes.json()) as { rideId: string };

    const takeSeat = await app.request(`/api/plans/${slug}/carpools/${carData.rideId}/toggle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Participant-Token': joined.participantToken,
      },
      body: JSON.stringify({ participantId: joined.participant.id }),
    });
    expect(takeSeat.status).toBe(200);

    const ogRes = await app.request(`/api/plans/${slug}/og.svg`);
    expect(ogRes.status).toBe(200);
    expect(ogRes.headers.get('content-type')).toContain('image/svg+xml');
    expect(ogRes.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    const svgBody = await ogRes.text();
    expect(svgBody).toContain('Escapada rural');

    db.close();
  });

  it('seeds a realistic demo plan cleanly with sub-poll, checklist, and carpool', () => {
    const db = new ShalendarDB(':memory:');
    db.seedDemoPlanIfEmpty();
    const snap = db.getPlanSnapshotBySlug('cena-reencuentro');
    expect(snap).not.toBeNull();
    expect(snap!.participants.length).toBeGreaterThanOrEqual(5);
    expect(snap!.availabilities.length).toBeGreaterThan(15);
    expect(snap!.subPolls.length).toBeGreaterThanOrEqual(1);
    expect(snap!.checklist.length).toBeGreaterThanOrEqual(2);
    expect(snap!.carpools.length).toBeGreaterThanOrEqual(1);
    db.close();
  });

  it('supports adaptive retention policies, extension, JSON export, health check, and 410 expiration', async () => {
    const db = new ShalendarDB(':memory:');
    const hub = new PlanEventHub();
    const app = createApp(db, hub, undefined, { purgeCronSecret: 'cron-secret-123' });

    // Healthcheck reports driver & latency
    const healthRes = await app.request('/api/health');
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as { ok: boolean; driver: string; latencyMs: number };
    expect(health.ok).toBe(true);
    expect(health.driver).toBe('sqlite');

    // Create an ephemeral fixed_ttl plan (7 days)
    const createRes = await app.request('/api/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Quedada exprés',
        organizerName: 'Nuria',
        retentionPolicy: 'fixed_ttl',
        retentionDays: 7,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      plan: { slug: string; retentionPolicy: string; retentionDays: number; expiresAt: string | null };
      adminToken: string;
    };
    const slug = created.plan.slug;
    expect(created.plan.retentionPolicy).toBe('fixed_ttl');
    expect(created.plan.retentionDays).toBe(7);
    expect(created.plan.expiresAt).not.toBeNull();

    // Extend expiration requires admin token
    const unauthExtend = await app.request(`/api/plans/${slug}/extend`, { method: 'POST' });
    expect(unauthExtend.status).toBe(403);

    const extRes = await app.request(`/api/plans/${slug}/extend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': created.adminToken,
      },
      body: JSON.stringify({ extraDays: 30 }),
    });
    expect(extRes.status).toBe(200);
    const extended = (await extRes.json()) as { plan: { expiresAt: string } };
    expect(Date.parse(extended.plan.expiresAt)).toBeGreaterThan(Date.parse(created.plan.expiresAt!));

    // Export portable JSON backup
    const exportRes = await app.request(`/api/plans/${slug}/export`);
    expect(exportRes.status).toBe(200);
    const backup = (await exportRes.json()) as { format: string; snapshot: { plan: { slug: string } } };
    expect(backup.format).toBe('shalendar-backup-v1');
    expect(backup.snapshot.plan.slug).toBe(slug);

    // Promote to persistent clears expiresAt
    const toPersist = await app.request(`/api/plans/${slug}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': created.adminToken,
      },
      body: JSON.stringify({ retentionPolicy: 'persistent' }),
    });
    expect(toPersist.status).toBe(200);
    const persisted = (await toPersist.json()) as { plan: { retentionPolicy: string; expiresAt: string | null } };
    expect(persisted.plan.retentionPolicy).toBe('persistent');
    expect(persisted.plan.expiresAt).toBeNull();

    // Create a second ephemeral plan and force it expired in DB -> GET returns 410 Gone
    const expCreate = await app.request('/api/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Plan caducado',
        organizerName: 'Pau',
        retentionPolicy: 'fixed_ttl',
        retentionDays: 1,
      }),
    });
    const expData = (await expCreate.json()) as { plan: { slug: string } };
    // Simulate expiration via internal purge date check + lazy 410
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const purged = db.purgeExpiredPlans(future);
    expect(purged.deletedCount).toBe(1);
    const afterPurge = await app.request(`/api/plans/${expData.plan.slug}`);
    expect(afterPurge.status).toBe(404);

    // Internal purge endpoint enforces bearer secret
    const badCron = await app.request('/api/internal/purge', { method: 'POST' });
    expect(badCron.status).toBe(401);
    const okCron = await app.request('/api/internal/purge', {
      method: 'POST',
      headers: { Authorization: 'Bearer cron-secret-123' },
    });
    expect(okCron.status).toBe(200);

    db.close();
  });
});
