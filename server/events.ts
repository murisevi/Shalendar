import type { PlanSnapshot } from '../shared/types.js';

export interface PlanSubscriber {
  participantId: string | null;
  onUpdate: (onlineParticipantIds: string[], fullSnapshot?: PlanSnapshot) => void;
  onPresence: (onlineParticipantIds: string[]) => void;
}

export class PlanEventHub {
  private channels = new Map<string, Set<PlanSubscriber>>();

  subscribe(slug: string, subscriber: PlanSubscriber): () => void {
    let set = this.channels.get(slug);
    if (!set) {
      set = new Set();
      this.channels.set(slug, set);
    }
    set.add(subscriber);
    if (subscriber.participantId) {
      this.broadcastPresence(slug);
    }

    return () => {
      const current = this.channels.get(slug);
      if (!current) return;
      current.delete(subscriber);
      if (current.size === 0) {
        this.channels.delete(slug);
      } else if (subscriber.participantId) {
        this.broadcastPresence(slug);
      }
    };
  }

  getOnlineParticipantIds(slug: string): string[] {
    const set = this.channels.get(slug);
    if (!set) return [];
    const ids = new Set<string>();
    for (const sub of set) {
      if (sub.participantId) ids.add(sub.participantId);
    }
    return Array.from(ids);
  }

  broadcastPresence(slug: string): void {
    const set = this.channels.get(slug);
    if (!set) return;
    const online = this.getOnlineParticipantIds(slug);
    for (const sub of set) {
      try {
        sub.onPresence(online);
      } catch {
        // Ignore dead listener
      }
    }
  }

  notifyUpdate(slug: string, fullSnapshot?: PlanSnapshot): void {
    const set = this.channels.get(slug);
    if (!set) return;
    const online = this.getOnlineParticipantIds(slug);
    for (const sub of set) {
      try {
        sub.onUpdate(online, fullSnapshot);
      } catch {
        // Ignore dead listener
      }
    }
  }

  listenerCount(slug: string): number {
    return this.channels.get(slug)?.size ?? 0;
  }
}
