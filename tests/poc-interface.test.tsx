// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShalendarDB } from '../server/db.js';
import { createApp } from '../server/app.js';
import type { PlanSnapshot } from '../shared/types.js';
import { I18nProvider } from '../src/lib/i18n.js';
import { IdentityModal } from '../src/components/IdentityModal.js';
import { PlanSettingsModal } from '../src/components/PlanSettingsModal.js';
import { RsvpPanel } from '../src/components/RsvpPanel.js';
import { ShareModal } from '../src/components/ShareModal.js';
import { PlanLogisticsPanel } from '../src/components/PlanLogisticsPanel.js';
import { PlanView } from '../src/components/PlanView.js';
import {
  buildCoOrganizerUrl,
  buildDeviceTransferUrl,
  getAdminToken,
  getParticipantToken,
  saveAdminToken,
  saveParticipantId,
  saveParticipantToken,
} from '../src/lib/storage.js';

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
  emit(snapshot: PlanSnapshot) {
    this.dispatchEvent(new MessageEvent('snapshot', { data: JSON.stringify(snapshot) }));
  }
}

let root: Root;
let container: HTMLDivElement;
let db: ShalendarDB;
let created: ReturnType<ShalendarDB['createPlan']>;
let snapshot: PlanSnapshot;

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
  created = db.createPlan({
    title: 'Cena de Navidad',
    organizerName: 'Muri',
    retentionPolicy: 'ephemeral_after_event',
    startMonth: '2026-12',
    endMonth: '2027-01',
  });
  snapshot = db.getPlanSnapshotBySlug(created.plan.slug)!;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  db.close();
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(node: ReactNode) {
  await act(async () => root.render(<I18nProvider>{node}</I18nProvider>));
}

async function enter(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function settle(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (predicate()) return;
  }
  throw new Error('UI condition did not become true');
}

describe('PoC UI resilience under real-time SSE & multi-friend concurrency', () => {
  it('IdentityModal keeps typed name/PIN when another friend joins via SSE', async () => {
    await render(
      <IdentityModal
        open={true}
        mode="join"
        plan={snapshot.plan}
        participantCount={2}
        onClose={() => {}}
        onJoinNew={async () => {}}
        onClaimExisting={async () => {}}
      />
    );
    const nameInput = container.querySelector<HTMLInputElement>('input[type="text"]')!;
    const pinInput = container.querySelector<HTMLInputElement>('input[type="password"]')!;
    await enter(nameInput, 'Alejandro');
    await enter(pinInput, '4567');

    // Simulate another friend joining via SSE -> participantCount increments 2 -> 3
    await render(
      <IdentityModal
        open={true}
        mode="join"
        plan={{ ...snapshot.plan, lastActivityAt: new Date().toISOString() }}
        participantCount={3}
        onClose={() => {}}
        onJoinNew={async () => {}}
        onClaimExisting={async () => {}}
      />
    );
    expect(nameInput.value).toBe('Alejandro');
    expect(pinInput.value).toBe('4567');
  });

  it('PlanSettingsModal keeps unsaved edits when background SSE updates plan.lastActivityAt', async () => {
    await render(
      <PlanSettingsModal
        open={true}
        onClose={() => {}}
        plan={snapshot.plan}
        participants={snapshot.participants}
        onSave={async () => {}}
        onExtendExpiration={async () => {}}
        onExportBackup={() => {}}
        onRemoveParticipant={async () => {}}
        onDeletePlan={async () => {}}
      />
    );
    const titleInput = container.querySelector<HTMLInputElement>('input[type="text"]')!;
    await enter(titleInput, 'Cena Navidad Definitiva');

    // SSE delivers a fresh plan reference
    await render(
      <PlanSettingsModal
        open={true}
        onClose={() => {}}
        plan={{ ...snapshot.plan, lastActivityAt: new Date(Date.now() + 1000).toISOString() }}
        participants={snapshot.participants}
        onSave={async () => {}}
        onExtendExpiration={async () => {}}
        onExportBackup={() => {}}
        onRemoveParticipant={async () => {}}
        onDeletePlan={async () => {}}
      />
    );
    expect(titleInput.value).toBe('Cena Navidad Definitiva');
  });

  it('RsvpPanel keeps draft note and +1 guests when another friend updates RSVP via SSE', async () => {
    const myRsvp = {
      participantId: created.participant.id,
      status: 'going' as const,
      guestsCount: 0,
      note: '',
      updatedAt: new Date().toISOString(),
    };
    await render(
      <RsvpPanel
        participants={snapshot.participants}
        rsvps={[myRsvp]}
        me={created.participant}
        onSaveRsvp={async () => {}}
        onRequireIdentity={() => {}}
      />
    );
    const noteInput = container.querySelector<HTMLInputElement>('input[type="text"]')!;
    await enter(noteInput, 'Llego a las 21:15');

    // SSE replaces rsvps array with a brand-new object reference containing identical server fields
    await render(
      <RsvpPanel
        participants={snapshot.participants}
        rsvps={[{ ...myRsvp }]}
        me={created.participant}
        onSaveRsvp={async () => {}}
        onRequireIdentity={() => {}}
      />
    );
    expect(noteInput.value).toBe('Llego a las 21:15');
  });

  it('ShareModal does not nudge friends for missing votes while blind voting is active', async () => {
    const friend = db.addOrGetParticipant(created.plan.id, { name: 'Carlos' }).participant;
    db.setAvailabilityBatch(created.plan.id, created.participant.id, [{ date: '2026-12-19', status: 'yes' }]);
    db.setAvailabilityBatch(created.plan.id, friend.id, [{ date: '2026-12-19', status: 'yes' }]);
    const blindPlan = { ...snapshot.plan, blindVoting: true, votingOpen: true, confirmedDate: null };

    await render(
      <ShareModal
        open={true}
        onClose={() => {}}
        plan={blindPlan}
        participants={[created.participant, friend]}
        availabilities={[
          { participantId: created.participant.id, date: '2026-12-19', slot: 'all', status: 'yes', note: '', updatedAt: '' },
          { participantId: friend.id, date: '2026-12-19', slot: 'all', status: 'yes', note: '', updatedAt: '' },
        ]}
        votes={[{ participantId: created.participant.id, date: '2026-12-19', createdAt: '' }]}
        rsvps={[]}
        topDates={[]}
        hasSession={true}
      />
    );
    expect(container.textContent).not.toContain('Faltan por responder');
  });

  it('PlanLogisticsPanel prompts identity for anonymous checklist actions and blocks javascript: links', async () => {
    const requireId = vi.fn();
    const updateItem = vi.fn(async () => {});
    const deleteItem = vi.fn(async () => {});

    await render(
      <PlanLogisticsPanel
        participants={snapshot.participants}
        me={null}
        isAdmin={false}
        subPolls={[
          {
            id: 'p1',
            category: 'place',
            question: '¿Sitio?',
            winnerOptionId: null,
            createdAt: '',
            options: [
              {
                id: 'o1',
                pollId: 'p1',
                title: 'Peligroso',
                url: 'javascript:alert(1)',
                estimatedCost: '',
                proposedBy: null,
                voterIds: [],
                createdAt: '',
              },
              {
                id: 'o2',
                pollId: 'p1',
                title: 'Seguro',
                url: 'https://restaurante.example.com',
                estimatedCost: '',
                proposedBy: null,
                voterIds: [],
                createdAt: '',
              },
            ],
          },
        ]}
        checklist={[
          {
            id: 'c1',
            title: 'Reservar mesa',
            assignedTo: null,
            completed: false,
            createdBy: null,
            createdAt: '',
          },
        ]}
        carpools={[]}
        onCreateSubPoll={async () => {}}
        onAddSubPollOption={async () => {}}
        onToggleSubPollVote={async () => {}}
        onSetSubPollWinner={async () => {}}
        onDeleteSubPoll={async () => {}}
        onAddChecklistItem={async () => {}}
        onUpdateChecklistItem={updateItem}
        onDeleteChecklistItem={deleteItem}
        onAddCarpool={async () => {}}
        onToggleCarpoolSeat={async () => {}}
        onDeleteCarpool={async () => {}}
        onRequireIdentity={requireId}
      />
    );

    const links = Array.from(container.querySelectorAll('a'));
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://restaurante.example.com/');

    // Clicking checklist toggle as visitor prompts identity instead of calling PATCH
    const taskBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Reservar mesa')
    )!;
    await act(async () => taskBtn.click());
    expect(requireId).toHaveBeenCalledTimes(1);
    expect(updateItem).not.toHaveBeenCalled();

    // Clicking delete task as visitor prompts identity instead of calling DELETE
    const delBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('title') === 'Eliminar'
    )!;
    await act(async () => delBtn.click());
    expect(requireId).toHaveBeenCalledTimes(2);
    expect(deleteItem).not.toHaveBeenCalled();
  });

  it('PlanView shows retryable error screen on network glitch (NOT "Quedada no encontrada") and recovers on retry', async () => {
    const app = createApp(db);
    let failFirst = true;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      if (failFirst && url.includes(`/api/plans/${created.plan.slug}`)) {
        failFirst = false;
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      return app.request(url, init);
    });

    await render(
      <PlanView slug={created.plan.slug} onGoHome={() => {}} theme="light" onToggleTheme={() => {}} />
    );
    await settle(() => container.textContent?.includes('No se pudo conectar') ?? false);
    expect(container.textContent).not.toContain('Quedada no encontrada');

    const retryBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Reintentar'
    )!;
    await act(async () => retryBtn.click());
    await settle(() => container.textContent?.includes('Cena de Navidad') ?? false);
  });

  it('device transfer & co-organizer URLs use URL hash fragments and PlanView restores & cleans them', async () => {
    saveParticipantToken(created.plan.slug, created.participantToken);
    saveAdminToken(created.plan.slug, created.adminToken);
    const transfer = buildDeviceTransferUrl(created.plan.slug, true);
    const coOrg = buildCoOrganizerUrl(created.plan.slug)!;

    expect(transfer).toContain('#pt=');
    expect(transfer).not.toContain('?pt=');
    expect(coOrg).toContain('#at=');
    expect(coOrg).not.toContain('?at=');

    // Clear storage to simulate opening the transfer link on a new phone
    localStorage.clear();
    localStorage.setItem('shalendar:lang', 'es');
    localStorage.setItem('shalendar:plan-intro-seen', '1');
    const parsedTransfer = new URL(transfer);
    window.history.replaceState({}, '', parsedTransfer.pathname + parsedTransfer.hash);

    const app = createApp(db);
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => app.request(url, init));

    await render(
      <PlanView slug={created.plan.slug} onGoHome={() => {}} theme="light" onToggleTheme={() => {}} />
    );
    await settle(() => container.textContent?.includes('Participando como Muri') ?? false);
    expect(getParticipantToken(created.plan.slug)).toBe(created.participantToken);
    expect(getAdminToken(created.plan.slug)).toBe(created.adminToken);
    expect(window.location.hash).toBe('');
  });

  it('PlanView serializes rapid availability taps so slow first response never clobbers newer taps', async () => {
    saveParticipantId(created.plan.slug, created.participant.id);
    saveParticipantToken(created.plan.slug, created.participantToken);

    const app = createApp(db);
    let releaseFirstPut: (() => void) | null = null;
    let putCount = 0;

    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT' && url.includes('/availability')) {
        putCount += 1;
        if (putCount === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstPut = resolve;
          });
        }
      }
      return app.request(url, init);
    });

    await render(
      <PlanView slug={created.plan.slug} onGoHome={() => {}} theme="light" onToggleTheme={() => {}} />
    );
    await settle(() => container.querySelector('[data-calendar-date="2026-12-18"]') !== null);

    const cell18 = container.querySelector<HTMLElement>('[data-calendar-date="2026-12-18"]')!;
    const cell19 = container.querySelector<HTMLElement>('[data-calendar-date="2026-12-19"]')!;

    // Tap Dec 18, then immediately tap Dec 19 while PUT #1 is still in flight
    await act(async () => {
      cell18.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });
    await act(async () => {
      cell19.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });

    // Release PUT #1 and let queued PUT #2 finish
    await act(async () => {
      releaseFirstPut?.();
    });

    await settle(() => {
      const avail = db.getPlanSnapshotBySlug(created.plan.slug)!.availabilities;
      return avail.some((a) => a.date === '2026-12-18') && avail.some((a) => a.date === '2026-12-19');
    });

    // Both days must be persisted AND visible in UI!
    const finalAvail = db.getPlanSnapshotBySlug(created.plan.slug)!.availabilities;
    expect(finalAvail.map((a) => a.date).sort()).toEqual(['2026-12-18', '2026-12-19']);
    expect(putCount).toBe(2);
  });
});
