// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShalendarDB } from '../server/db.js';
import { createApp } from '../server/app.js';
import type { PlanSnapshot } from '../shared/types.js';
import { I18nProvider } from '../src/lib/i18n.js';
import { HomePage } from '../src/components/HomePage.js';
import { PlanView } from '../src/components/PlanView.js';
import { PlanSettingsModal } from '../src/components/PlanSettingsModal.js';
import { saveAdminToken, saveParticipantId, saveParticipantToken } from '../src/lib/storage.js';

vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,AA==' } }));

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    super();
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

let root: Root;
let container: HTMLDivElement;
let db: ShalendarDB;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  localStorage.setItem('shalendar:lang', 'es');
  localStorage.setItem('shalendar:plan-intro-seen', '1');
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  db = new ShalendarDB(':memory:');
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  db.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(node: ReactNode) {
  await act(async () => root.render(<I18nProvider>{node}</I18nProvider>));
}

async function click(el: Element) {
  await act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
}

async function enter(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(input);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function buttonByText(text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text)
  );
  if (!found) throw new Error(`Button containing "${text}" not found`);
  return found;
}

async function settle(predicate: () => boolean, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return;
    await act(async () => new Promise((r) => setTimeout(r, 15)));
  }
  throw new Error('Timed out waiting for UI state');
}

describe('Meal slots UI flows', () => {
  it('HomePage lets organizer pick Comidas -> Solo comida y cena and submits granularity=meals + enabledSlots', async () => {
    const app = createApp(db);
    const opened: string[] = [];
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => app.request(url, init));

    await render(<HomePage onOpenPlan={(slug) => opened.push(slug)} theme="light" onToggleTheme={() => {}} />);

    await enter(container.querySelector<HTMLInputElement>('#plan-title')!, 'Cena Navidad');
    await enter(container.querySelector<HTMLInputElement>('#organizer-name')!, 'Muri');

    // Select "Comidas" mode directly on the main form (without opening advanced options)
    await click(buttonByText('Comidas'));
    expect(container.textContent).toContain('Desayuno');
    expect(container.textContent).toContain('Comida');
    expect(container.textContent).toContain('Merienda');
    expect(container.textContent).toContain('Cena');

    // One-click preset for Christmas lunch & dinner only
    await click(buttonByText('Solo comida y cena'));
    expect(buttonByText('Desayuno').getAttribute('aria-pressed')).toBe('false');
    expect(buttonByText('Comida').getAttribute('aria-pressed')).toBe('true');
    expect(buttonByText('Merienda').getAttribute('aria-pressed')).toBe('false');
    expect(buttonByText('Cena').getAttribute('aria-pressed')).toBe('true');

    // Submit form
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle(() => opened.length === 1);

    const snap = db.getPlanSnapshotBySlug(opened[0])!;
    expect(snap.plan.granularity).toBe('meals');
    expect(snap.plan.enabledSlots).toEqual(['lunch', 'dinner']);
  });

  it('PlanView renders meal breakdown per slot, suggests meal default time on confirm, and filters ComparisonMatrix by meal', async () => {
    const created = db.createPlan({
      title: 'Cena Navidad',
      organizerName: 'Ana',
      granularity: 'meals',
      enabledSlots: ['lunch', 'dinner'],
      startMonth: '2026-12',
      endMonth: '2026-12',
      retentionPolicy: 'persistent',
    });
    const carlos = db.addOrGetParticipant(created.plan.id, { name: 'Carlos' });

    // Dec 19: Ana can do Lunch only; Carlos can do Dinner only
    db.setAvailabilityBatch(created.plan.id, created.participant.id, [
      { date: '2026-12-19', slot: 'lunch', status: 'yes' },
      { date: '2026-12-19', slot: 'dinner', status: 'no' },
    ]);
    db.setAvailabilityBatch(created.plan.id, carlos.participant.id, [
      { date: '2026-12-19', slot: 'lunch', status: 'no' },
      { date: '2026-12-19', slot: 'dinner', status: 'yes' },
    ]);
    // Dec 20: Both can do Dinner (winning meal = Cena -> default time 21:00)
    db.setAvailabilityBatch(created.plan.id, created.participant.id, [
      { date: '2026-12-20', slot: 'dinner', status: 'yes' },
    ]);
    db.setAvailabilityBatch(created.plan.id, carlos.participant.id, [
      { date: '2026-12-20', slot: 'dinner', status: 'yes' },
    ]);

    saveParticipantId(created.plan.slug, created.participant.id);
    saveParticipantToken(created.plan.slug, created.participantToken);
    saveAdminToken(created.plan.slug, created.adminToken);

    const app = createApp(db);
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => app.request(url, init));

    await render(<PlanView slug={created.plan.slug} onGoHome={() => {}} theme="light" onToggleTheme={() => {}} />);
    await settle(() => container.textContent?.includes('Cena Navidad') === true && container.textContent?.includes('Detalle del día') === true);

    // DayInspector shows per-meal people filter and does NOT falsely claim 2/2 on Dec 19
    expect(container.textContent).toContain('Quién puede');
    expect(container.textContent).toContain('Comida');
    expect(container.textContent).toContain('Cena');

    // Open VotingPanel confirm inline picker on Dec 20 (best slot = dinner -> pre-fills 21:00)
    await click(buttonByText('Votación'));
    await settle(() => container.textContent?.includes('Confirmar') === true);
    await click(buttonByText('Confirmar'));
    const timeInput = container.querySelector<HTMLInputElement>('input[type="time"]');
    expect(timeInput?.value).toBe('21:00');

    // Open ComparisonMatrix and filter strictly by Cena, then toggle Ana's Cena cell on Dec 20 (yes -> maybe)
    await click(buttonByText('Comparativa'));
    await settle(() => container.querySelector('table') !== null);
    const mealButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent?.includes('🍷') && b.textContent?.includes('Cena')
    );
    expect(mealButtons.length).toBeGreaterThan(0);
    await click(mealButtons[0]);

    // Click Ana's first column cell (Dec 20, currently dinner=yes -> cycles to dinner=maybe)
    const firstMyCell = container.querySelector('table tbody tr td:nth-child(2) button')!;
    await click(firstMyCell);
    await settle(() => {
      const updated = db.getPlanSnapshotBySlug(created.plan.slug)!.availabilities;
      return updated.some(
        (a) =>
          a.participantId === created.participant.id &&
          a.date === '2026-12-20' &&
          a.slot === 'dinner' &&
          a.status === 'maybe'
      );
    });
    // Ana's Dec 19 lunch=yes remained completely untouched
    const finalEntries = db.getPlanSnapshotBySlug(created.plan.slug)!.availabilities;
    expect(
      finalEntries.find(
        (a) => a.participantId === created.participant.id && a.date === '2026-12-19' && a.slot === 'lunch'
      )?.status
    ).toBe('yes');
  });

  it('PlanSettingsModal lets organizer switch an existing plan to Comidas with only Cena active', async () => {
    const created = db.createPlan({
      title: 'Navidad',
      organizerName: 'Muri',
      granularity: 'day',
      startMonth: '2026-12',
      endMonth: '2026-12',
    });
    const snap: PlanSnapshot = db.getPlanSnapshotBySlug(created.plan.slug)!;
    const saved: any[] = [];

    await render(
      <PlanSettingsModal
        open
        onClose={() => {}}
        plan={snap.plan}
        participants={snap.participants}
        onSave={async (updates) => {
          saved.push(updates);
        }}
        onExtendExpiration={async () => {}}
        onExportBackup={() => {}}
        onRemoveParticipant={async () => {}}
        onDeletePlan={async () => {}}
      />
    );

    const selects = container.querySelectorAll<HTMLSelectElement>('select');
    const granularitySelect = selects[0];
    await act(async () => {
      granularitySelect.value = 'meals';
      granularitySelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Leave only Cena active (toggle off Desayuno, Comida, Merienda)
    await click(buttonByText('Desayuno'));
    await click(buttonByText('Comida'));
    await click(buttonByText('Merienda'));
    // Trying to toggle off the last active slot (Cena) must keep it enabled
    await click(buttonByText('Cena'));
    expect(buttonByText('Cena').getAttribute('aria-pressed')).toBe('true');

    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(saved).toHaveLength(1);
    expect(saved[0].granularity).toBe('meals');
    expect(saved[0].enabledSlots).toEqual(['dinner']);
  });
});
