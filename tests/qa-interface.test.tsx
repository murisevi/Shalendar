// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShalendarDB } from '../server/db.js';
import { createApp } from '../server/app.js';
import { computeDaySummaries, rankBestDates, rankBestRanges } from '../shared/dates.js';
import type { AvailabilityEntry, PlanSnapshot } from '../shared/types.js';
import { dayAvailabilityChanges, personalNoteChanges } from '../src/lib/availabilityChanges.js';
import { I18nProvider } from '../src/lib/i18n.js';
import { ShareModal } from '../src/components/ShareModal.js';
import { PlanSettingsModal } from '../src/components/PlanSettingsModal.js';
import { IdentityModal } from '../src/components/IdentityModal.js';
import { PlanView } from '../src/components/PlanView.js';
import { api, subscribePlanStream } from '../src/lib/api.js';
import { getParticipantToken, saveParticipantToken, saveParticipantId } from '../src/lib/storage.js';

vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,AA==' } }));

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) { super(); FakeEventSource.instances.push(this); }
  close() { this.closed = true; }
  emit(snapshot: PlanSnapshot) { this.dispatchEvent(new MessageEvent('snapshot', { data: JSON.stringify(snapshot) })); }
}

let root: Root;
let container: HTMLDivElement;
let db: ShalendarDB;
let created: ReturnType<ShalendarDB['createPlan']>;
let snapshot: PlanSnapshot;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); localStorage.setItem('shalendar:lang', 'en');
  localStorage.setItem('shalendar:plan-intro-seen', '1'); // First-visit tutorial has its own test.
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  db = new ShalendarDB(':memory:');
  created = db.createPlan({ title: 'QA UI', organizerName: 'Owner', organizerPin: '1234', blindVoting: true, granularity: 'slots', retentionPolicy: 'persistent', startMonth: '2099-12', endMonth: '2100-01' });
  snapshot = db.getPlanSnapshotBySlug(created.plan.slug)!;
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); db.close();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function render(node: ReactNode) { await act(async () => root.render(<I18nProvider>{node}</I18nProvider>)); }
async function click(element: Element) { await act(async () => { (element as HTMLElement).click(); }); }
async function settle(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    if (predicate()) return;
  }
  throw new Error('UI condition did not become true');
}
function button(text: string) {
  const found = Array.from(container.querySelectorAll('button')).find((element) => element.textContent?.trim() === text || element.getAttribute('title') === text || element.getAttribute('aria-label') === text);
  if (!found) throw new Error('Button missing: ' + text);
  return found;
}
async function enter(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('QA-18 accessible modals', () => {
  it.each(['share', 'settings', 'identity'] as const)('%s announces its title, traps focus, closes on Escape, and restores focus', async (kind) => {
    const opener = document.createElement('button'); opener.textContent = 'Open'; document.body.appendChild(opener); opener.focus();
    const close = vi.fn();
    function modal(open: boolean) {
      if (kind === 'share') return <ShareModal open={open} onClose={close} plan={snapshot.plan} participants={snapshot.participants} availabilities={[]} votes={[]} rsvps={[]} topDates={[]} hasSession={false} />;
      if (kind === 'settings') return <PlanSettingsModal open={open} onClose={close} plan={snapshot.plan} participants={snapshot.participants} onSave={async () => {}} onExtendExpiration={async () => {}} onExportBackup={() => {}} onRemoveParticipant={async () => {}} onDeletePlan={async () => {}} />;
      return <IdentityModal open={open} mode="join" onClose={close} plan={snapshot.plan} participantCount={1} onJoinNew={async () => {}} onClaimExisting={async () => {}} />;
    }
    try {
      await render(modal(true));
      const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent?.trim()).toBeTruthy();
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(opener.inert).toBe(true);
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled])'));
      controls.at(-1)!.focus();
      await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
      expect(document.activeElement).toBe(controls[0]);
      await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
      expect(document.activeElement).toBe(controls.at(-1));
      await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
      expect(close).toHaveBeenCalledTimes(1);
      await render(modal(false));
      expect(document.activeElement).toBe(opener);
      expect(opener.inert).toBeFalsy();
      expect(document.body.style.overflow).toBe('');
    } finally { opener.remove(); }
  });
});

it('QA-16/17: repeated whole-day edits advance every slot; notes preserve mixed slot statuses and undo data', async () => {
  const id = created.participant.id;
  const date = '2099-12-05';
  db.setAvailabilityBatch(created.plan.id, id, [
    { date, slot: 'morning', status: 'no' }, { date, slot: 'afternoon', status: 'no' }, { date, slot: 'evening', status: 'yes' },
  ]);
  const before = db.getPlanSnapshotBySlug(created.plan.slug)!.availabilities;
  db.setAvailabilityBatch(created.plan.id, id, personalNoteChanges(before, id, date, 'Only at night'));
  const after = db.getPlanSnapshotBySlug(created.plan.slug)!.availabilities;
  expect(after.map(({ slot, status }) => ({ slot, status }))).toEqual(before.map(({ slot, status }) => ({ slot, status })));
  expect(after.every((entry) => entry.note === 'Only at night')).toBe(true);
  db.setAvailabilityBatch(created.plan.id, id, [{ date, slot: 'all', status: 'yes' }]); // Legacy aggregate must not win over explicit edits.
  for (const status of ['maybe', 'no', null, 'yes'] as const) {
    db.setAvailabilityBatch(created.plan.id, id, dayAvailabilityChanges(date, status, 'slots'));
    const entries = db.getPlanSnapshotBySlug(created.plan.slug)!.availabilities;
    expect(entries.some((entry) => entry.slot === 'all')).toBe(false);
    expect(entries).toHaveLength(status ? 3 : 0);
    expect(entries.every((entry) => entry.status === status)).toBe(true);
    const summaries = computeDaySummaries({ participants: snapshot.participants, availabilities: entries, votes: [], pollOptions: [], granularity: 'slots', extraDates: [date] });
    expect(summaries.get(date)![status ?? 'pending'].map((p) => p.id)).toEqual([id]);
  }
  expect(personalNoteChanges([], id, date, 'No status')).toEqual([]);
});

it('QA-19: recommendations exclude the past in all modes and ranges while calendar history remains', () => {
  const entries: AvailabilityEntry[] = ['2026-11-26', '2026-11-27', '2026-11-28'].map((date) => ({ participantId: created.participant.id, date, slot: 'all', status: 'yes', note: '', updatedAt: '' }));
  const summaries = computeDaySummaries({ participants: snapshot.participants, availabilities: entries, votes: [], pollOptions: [] });
  for (const mode of ['smart', 'votes', 'availability'] as const) {
    expect(rankBestDates(summaries, 10, mode, false, '2026-11-27').map((day) => day.date)).toEqual(['2026-11-27', '2026-11-28']);
  }
  expect(rankBestRanges({ summaries, participants: snapshot.participants, durationDays: 2, today: '2026-11-27' }).map((range) => range.startDate)).toEqual(['2026-11-27']);
  expect(summaries.get('2026-11-26')?.yes).toHaveLength(1);
});

it('QA-13: the client downloads backups with organizer auth, reports errors, and revokes the blob URL', async () => {
  const response = { format: 'shalendar-backup-v1', snapshot };
  const fetch = vi.fn(async () => new Response(JSON.stringify(response)));
  vi.stubGlobal('fetch', fetch);
  localStorage.setItem('shalendar:admin:' + created.plan.slug, created.adminToken);
  const createURL = vi.fn(() => 'blob:backup');
  const revokeURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeURL });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await api.downloadBackup(created.plan.slug);
  expect((fetch.mock.calls[0] as any)[1].headers['X-Admin-Token']).toBe(created.adminToken);
  expect(createURL).toHaveBeenCalledTimes(1);
  await new Promise((resolve) => setTimeout(resolve, 1050));
  expect(revokeURL).toHaveBeenCalledWith('blob:backup');
  fetch.mockImplementation(async () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));
  await expect(api.downloadBackup(created.plan.slug)).rejects.toThrow('Forbidden');
});

it('QA-15: client discards queued snapshots from an old identity even before its stream closes', () => {
  const onSnapshot = vi.fn();
  const stopAnonymous = subscribePlanStream(created.plan.slug, { onSnapshot });
  const anonymous = FakeEventSource.instances[0];
  saveParticipantToken(created.plan.slug, created.participantToken);
  anonymous.emit(snapshot);
  expect(onSnapshot).not.toHaveBeenCalled();
  stopAnonymous(); expect(anonymous.closed).toBe(true);
  const stopAuthenticated = subscribePlanStream(created.plan.slug, { onSnapshot });
  const authenticated = FakeEventSource.instances[1];
  expect(authenticated.url).toContain('participantToken=' + created.participantToken);
  authenticated.emit(snapshot); expect(onSnapshot).toHaveBeenCalledTimes(1);
  saveParticipantToken(created.plan.slug, null);
  authenticated.emit(snapshot); expect(onSnapshot).toHaveBeenCalledTimes(1);
  stopAuthenticated();
});

it('QA-15: joining through PlanView without reload reconnects SSE and keeps own blind vote after external change', async () => {
  const app = createApp(db);
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => app.request(url, init));
  await render(<PlanView slug={created.plan.slug} onGoHome={() => {}} theme="light" onToggleTheme={() => {}} />);
  await settle(() => FakeEventSource.instances.length === 1);
  const anonymous = FakeEventSource.instances[0];
  await click(button('Join with my name'));
  const dialog = container.querySelector('[role="dialog"]')!;
  await enter(dialog.querySelector<HTMLInputElement>('input[type="text"]')!, 'New guest');
  await click(button('Join & participate'));
  await settle(() => FakeEventSource.instances.length === 2);
  expect(anonymous.closed).toBe(true);
  const token = getParticipantToken(created.plan.slug)!;
  const participant = db.getParticipantByToken(created.plan.id, token)!;
  expect(FakeEventSource.instances[1].url).toContain('participantToken=' + token);
  db.toggleVote(created.plan.id, participant.id, '2099-12-05');
  db.addComment(created.plan.id, created.participant.id, 'External comment');
  const next = db.getPlanSnapshotBySlug(created.plan.slug, { viewerParticipantId: participant.id })!;
  await act(async () => FakeEventSource.instances[1].emit(next));
  expect(container.textContent).toContain('2 of 3 votes left');
  await act(async () => anonymous.emit(snapshot));
  expect(container.textContent).toContain('2 of 3 votes left');
});

it('QA-16/17: PlanView saves a note without changing morning/no, then comparison advances all slots', async () => {
  const date = '2099-12-05';
  const id = created.participant.id;
  db.setAvailabilityBatch(created.plan.id, id, [
    { date, slot: 'morning', status: 'no' }, { date, slot: 'afternoon', status: 'no' }, { date, slot: 'evening', status: 'yes' },
  ]);
  // Keep the comparison column visible even when all availability is cleared.
  db.nominateDate(created.plan.id, date, 'Test day', id);
  saveParticipantToken(created.plan.slug, created.participantToken);
  saveParticipantId(created.plan.slug, id);
  const app = createApp(db);
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => app.request(url, init));
  await render(<PlanView slug={created.plan.slug} onGoHome={() => {}} theme="light" onToggleTheme={() => {}} />);
  await settle(() => container.querySelector('input[placeholder^="Your note"]') !== null);
  const input = container.querySelector<HTMLInputElement>('input[placeholder^="Your note"]')!;
  await enter(input, 'Only at night');
  await act(async () => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await settle(() => db.getPlanSnapshotBySlug(created.plan.slug)!.availabilities.every((entry) => entry.note === 'Only at night'));
  const entries = db.getPlanSnapshotBySlug(created.plan.slug)!.availabilities;
  expect(entries.find((entry) => entry.slot === 'morning')?.status).toBe('no');
  expect(entries.find((entry) => entry.slot === 'afternoon')?.status).toBe('no');
  expect(entries.find((entry) => entry.slot === 'evening')?.status).toBe('yes');
  await click(button('Comparison'));
  for (const expected of ['maybe', 'no', null, 'yes'] as const) {
    const cell = container.querySelector('table tbody tr td:nth-child(2) button')!;
    expect(cell).toBeTruthy();
    await click(cell);
    await settle(() => {
      const current = db.getPlanSnapshotBySlug(created.plan.slug)!.availabilities;
      return expected ? current.length === 3 && current.every((entry) => entry.status === expected) : current.length === 0;
    });
  }
});

it('QA-19: opening a confirmed historical plan keeps its confirmed date visible', async () => {
  db.updatePlanSettings(created.plan.slug, { confirmedDate: '2000-01-05', confirmedTime: '18:00' });
  const app = createApp(db);
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => app.request(url, init));
  await render(<PlanView slug={created.plan.slug} onGoHome={() => {}} theme="light" onToggleTheme={() => {}} />);
  await settle(() => FakeEventSource.instances.length === 1);
  expect(container.textContent).toContain('18:00');
  expect(container.textContent).toContain('January 2000');
});

it('QA-15: recovery and leaving also replace the stream and reject old session events', async () => {
  db.toggleVote(created.plan.id, created.participant.id, '2099-12-05');
  const app = createApp(db);
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => app.request(url, init));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await render(<PlanView slug={created.plan.slug} onGoHome={() => {}} theme="light" onToggleTheme={() => {}} />);
  await settle(() => FakeEventSource.instances.length === 1);
  await click(button('Join with my name'));
  await click(button('Joined on another device'));
  const dialog = container.querySelector('[role="dialog"]')!;
  await enter(dialog.querySelector<HTMLInputElement>('input[type="text"]')!, 'Owner');
  await enter(dialog.querySelector<HTMLInputElement>('input[type="password"]')!, '1234');
  await click(button('Recover my session'));
  await settle(() => FakeEventSource.instances.length === 2);
  expect(FakeEventSource.instances[0].closed).toBe(true);
  expect(container.textContent).toContain('2 of 3 votes left');
  const prior = db.getPlanSnapshotBySlug(created.plan.slug, { viewerParticipantId: created.participant.id })!;
  await click(button('My profile / PIN'));
  await click(button('Leave this plan'));
  await settle(() => FakeEventSource.instances.length === 3);
  expect(FakeEventSource.instances[1].closed).toBe(true);
  expect(FakeEventSource.instances[2].url).not.toContain('participantToken');
  expect(getParticipantToken(created.plan.slug)).toBeNull();
  await act(async () => FakeEventSource.instances[1].emit(prior));
  expect(container.textContent).not.toContain('2 of 3 votes left');
});

it('first visit shows the two-step mini tutorial once and remembers it was dismissed', async () => {
  localStorage.removeItem('shalendar:plan-intro-seen');
  const app = createApp(db);
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => app.request(url, init));
  await render(<PlanView slug={created.plan.slug} onGoHome={() => {}} theme="light" onToggleTheme={() => {}} />);
  await settle(() => container.querySelector('[role="dialog"]') !== null);
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('How it works, in two steps');
  expect(dialog.textContent).toContain('Mark the days you can make');
  expect(dialog.textContent).toContain('Vote for a day');
  await click(button('Got it!'));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(localStorage.getItem('shalendar:plan-intro-seen')).toBe('1');
});
