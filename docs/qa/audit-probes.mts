// QA reproduction harness: isolated SQLite in memory; no changes to application data.
// Run: node --no-warnings --import tsx docs/qa/audit-probes.mts
// Subsequent runs preserve the initial audit's api-evidence.json.
import fs from 'node:fs';
import { ShalendarDB } from '../../server/db.ts';
import { createApp } from '../../server/app.ts';
import { PlanEventHub } from '../../server/events.ts';

const db = new ShalendarDB(':memory:');
const app = createApp(db, new PlanEventHub(), undefined, { maxPlansPerHourPerIp: 200 });
const results: Array<{ test: string; expected: string; status: number; passed: boolean; evidence?: unknown }> = [];
async function req(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const response = await app.request('/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => null) as any;
  return { status: response.status, data };
}
function record(test: string, r: { status: number; data: any }, expected: string, passed: boolean, evidence?: unknown) {
  results.push({ test, expected, status: r.status, passed, ...(evidence === undefined ? {} : { evidence }) });
}
const created = await req('/plans', 'POST', { title: 'QA isolated', organizerName: 'Organizer', organizerPin: '9246', retentionPolicy: 'persistent', maxVotesPerUser: 1, blindVoting: true });
const { plan, participant: owner, adminToken, participantToken } = created.data;
const base = '/plans/' + plan.slug;
const admin = { 'X-Admin-Token': adminToken };
const auth = { 'X-Participant-Token': participantToken };
record('Create private plan', created, '201', created.status === 201);
const joined = await req(base + '/participants', 'POST', { name: 'Guest', pin: '4826' });
const guest = joined.data.participant;
const guestAuth = { 'X-Participant-Token': joined.data.participantToken };
record('Join as guest', joined, '201', joined.status === 201);
let r = await req(base, 'PATCH', { title: 'Unauthorized' });
record('Settings reject anonymous', r, '403', r.status === 403);
r = await req(base + '/availability', 'PUT', { participantId: owner.id, changes: [{ date: '2026-12-04', status: 'yes' }] }, guestAuth);
record('Guest cannot paint owner days', r, '403', r.status === 403);
r = await req(base + '/availability', 'PUT', { participantId: owner.id, changes: [{ date: '2026-12-04', status: 'yes' }] }, auth);
record('Owner paints day', r, '200', r.status === 200);
r = await req(base + '/votes/toggle', 'POST', { participantId: owner.id, date: '2026-12-04' }, auth);
record('Owner casts blind vote', r, '200', r.status === 200);
r = await req(base + '/votes/toggle', 'POST', { participantId: owner.id, date: '2026-12-05' }, auth);
record('Vote limit enforced', r, '400', r.status === 400);
r = await req(base);
record('Anonymous cannot read blind votes', r, 'votes=[]', r.data.votes.length === 0);
r = await req(base, 'GET', undefined, { 'X-Participant-Id': owner.id });
record('Blind votes cannot be read by spoofing participant ID', r, 'votes=[] without valid token', r.data.votes.length === 0, { votesVisible: r.data.votes.length });
r = await req(base + '/export', 'GET', undefined, admin);
record('Organizer backup preserves blind votes', r, 'backup contains saved vote', r.data.snapshot?.votes.length === 1, { exportedVotes: r.data.snapshot?.votes.length });
r = await req(base + '/participants/claim', 'POST', { name: 'Guest', pin: '0000' });
record('Incorrect recovery PIN', r, '401', r.status === 401);
r = await req(base + '/participants/claim', 'POST', { name: 'Guest', pin: '4826' });
record('Correct recovery PIN', r, '200', r.status === 200);
r = await req(base + '/participants/' + guest.id, 'PATCH', { pin: '1' }, guestAuth);
record('Reject PIN shorter than recovery minimum', r, '400', r.status === 400, { hasPin: r.data.participant?.hasPin });

const poll = await req(base + '/sub-polls', 'POST', { category: 'place', question: 'Where?', initialOptions: [{ title: 'A' }, { title: 'B' }] }, auth);
const pollId = poll.data.pollId;
const optionId = poll.data.snapshot.subPolls[0].options[0].id;
record('Create subpoll authenticated', poll, '201', poll.status === 201);
r = await req(base + '/sub-polls/' + pollId, 'PATCH', { winnerOptionId: optionId });
record('Only organizer can choose subpoll winner', r, '403', r.status === 403, { winnerSaved: r.data.snapshot?.subPolls[0]?.winnerOptionId === optionId });
r = await req(base + '/sub-polls', 'POST', { participantId: owner.id, category: 'other', question: 'Forged anonymous poll' });
record('Anonymous cannot create poll attributed to owner', r, '403', r.status === 403);
r = await req(base + '/sub-polls/' + pollId + '/options', 'POST', { participantId: owner.id, title: 'Forged option' });
record('Anonymous cannot add option attributed to owner', r, '403', r.status === 403);
r = await req(base + '/sub-polls/' + pollId, 'PATCH', { winnerOptionId: 'nonexistent-option' }, admin);
record('Reject nonexistent winning option', r, '400 or 404', r.status === 400 || r.status === 404, { winnerSaved: r.data.snapshot?.subPolls.find((p: any) => p.id === pollId)?.winnerOptionId });
const item = await req(base + '/checklist', 'POST', { title: 'QA item', participantId: owner.id, assignedTo: owner.id }, auth);
const itemId = item.data.itemId;
r = await req(base + '/checklist/' + itemId, 'PATCH', { completed: true });
record('Anonymous cannot complete another user task', r, '403', r.status === 403, { completed: r.data.snapshot?.checklist[0]?.completed });
r = await req(base + '/checklist/' + itemId, 'DELETE');
record('Anonymous cannot delete task', r, '403', r.status === 403, { remaining: r.data.snapshot?.checklist.length });
const car = await req(base + '/carpools', 'POST', { driverId: owner.id, origin: 'QA city', seatsTotal: 1 }, auth);
r = await req(base + '/carpools/' + car.data.rideId + '/toggle', 'POST', { participantId: guest.id }, guestAuth);
record('Reserve car seat', r, '200 joined=true', r.status === 200 && r.data.joined === true);
const third = await req(base + '/participants', 'POST', { name: 'Third' });
r = await req(base + '/carpools/' + car.data.rideId + '/toggle', 'POST', { participantId: third.data.participant.id }, { 'X-Participant-Token': third.data.participantToken });
record('Reject overbooking', r, '400', r.status === 400);
r = await req(base + '/carpools/' + car.data.rideId, 'DELETE');
record('Anonymous cannot delete another user car', r, '403', r.status === 403, { remaining: r.data.snapshot?.carpools.length });

r = await req(base + '/availability', 'PUT', { participantId: owner.id, changes: [{ date: '2026-02-30', status: 'yes' }] }, auth);
record('Reject impossible calendar date', r, '400', r.status === 400, { dates: r.data.snapshot?.availabilities.map((a: any) => a.date) });
r = await req(base, 'PATCH', { confirmedDate: '2026-12-10', confirmedEndDate: '2026-12-01', confirmedTime: '99:99', confirmedTimezone: 'Invalid/Zone' }, admin);
record('Reject reversed range and invalid time/timezone', r, '400', r.status === 400, { date: r.data.snapshot?.plan.confirmedDate, end: r.data.snapshot?.plan.confirmedEndDate, time: r.data.snapshot?.plan.confirmedTime, timezone: r.data.snapshot?.plan.confirmedTimezone });
r = await req(base, 'PATCH', { votingDeadline: 'not-a-date' }, admin);
record('Reject invalid voting deadline', r, '400', r.status === 400, { deadline: r.data.snapshot?.plan.votingDeadline });
r = await req('/plans', 'POST', { title: 'QA invalid month', organizerName: 'QA', startMonth: '2026-99', endMonth: '2026-00', retentionPolicy: 'persistent' });
record('Reject invalid months', r, '400', r.status === 400, { start: r.data.plan?.startMonth, end: r.data.plan?.endMonth });
r = await req('/plans', 'POST', { title: 'QA reversed months', organizerName: 'QA', startMonth: '2026-12', endMonth: '2026-01', retentionPolicy: 'persistent' });
record('Reject reversed month interval', r, '400', r.status === 400);
r = await req(base + '/checklist', 'POST', { title: 'Foreign assignment', assignedTo: third.data.participant.id, participantId: owner.id }, auth);
record('Valid checklist assignment', r, '201', r.status === 201);
const other = await req('/plans', 'POST', { title: 'QA other plan', organizerName: 'Foreign', retentionPolicy: 'persistent' });
r = await req(base + '/checklist', 'POST', { title: 'Cross-plan assignee', assignedTo: other.data.participant.id, participantId: owner.id }, auth);
record('Reject task assigned to participant from other plan', r, '400', r.status === 400, { foreignIdStored: r.data.snapshot?.checklist.some((i: any) => i.assignedTo === other.data.participant.id) });
r = await req(base + '/poll-options', 'POST', { date: '2026-12-06', participantId: owner.id, label: 'Forged nomination' });
record('Anonymous cannot nominate on behalf of owner', r, '403', r.status === 403);
r = await req(base, 'PATCH', { votingOpen: false }, admin);
r = await req(base + '/votes/toggle', 'POST', { participantId: guest.id, date: '2026-12-06' }, guestAuth);
record('Voting closed rejects votes', r, '400', r.status === 400);
r = await req(base + '/rsvp', 'PUT', { participantId: guest.id, status: 'going', guestsCount: 2, note: 'QA' }, guestAuth);
record('Save RSVP', r, '200', r.status === 200);
const activityPlan = await req('/plans', 'POST', { title: 'QA activity expiry', organizerName: 'QA', retentionPolicy: 'sliding_inactivity', retentionDays: 30 });
const oldActivity = new Date(Date.now() - 86400000).toISOString();
const oldExpiry = new Date(Date.now() + 29 * 86400000).toISOString();
// Fixture setup only; this database is in memory and belongs exclusively to this harness.
(db as any).db.prepare('UPDATE plans SET last_activity_at = ?, expires_at = ? WHERE id = ?').run(oldActivity, oldExpiry, activityPlan.data.plan.id);
r = await req('/plans/' + activityPlan.data.plan.slug + '/comments', 'POST', { participantId: activityPlan.data.participant.id, body: 'Active group comment' }, { 'X-Participant-Token': activityPlan.data.participantToken });
record('Comment activity extends sliding retention', r, 'lastActivityAt and expiresAt advance', r.data.snapshot.plan.lastActivityAt > oldActivity && r.data.snapshot.plan.expiresAt > oldExpiry, { activityAdvanced: r.data.snapshot.plan.lastActivityAt > oldActivity, expiryAdvanced: r.data.snapshot.plan.expiresAt > oldExpiry });
r = await req(base, 'DELETE', undefined, admin);
record('Organizer deletes plan', r, '200', r.status === 200);
r = await req(base);
record('Deleted plan missing', r, '404', r.status === 404);
db.close();
const report = { generatedAt: new Date().toISOString(), storage: 'SQLite :memory:', total: results.length, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, results };
fs.writeFileSync(new URL('./api-evidence-corrections.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.failed > 0) process.exitCode = 1;
