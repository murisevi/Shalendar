import type { AvailabilityEntry, AvailabilitySlot, AvailabilityStatus, PlanGranularity } from '../../shared/types';

/** A whole-day edit in slot mode updates every slot in one request. Clear legacy all-day entries. */
export function dayAvailabilityChanges(date: string, status: AvailabilityStatus | null, granularity: PlanGranularity, note?: string) {
  const slots: AvailabilitySlot[] = granularity === 'slots' ? ['morning', 'afternoon', 'evening'] : ['all'];
  const changes = slots.map((slot) => ({ date, slot, status, ...(note === undefined ? {} : { note }) }));
  if (granularity === 'slots') changes.push({ date, slot: 'all', status: null });
  return changes;
}

/** Keep each stored slot's status; never copy the aggregate day status into a slot. */
export function personalNoteChanges(entries: AvailabilityEntry[], participantId: string, date: string, note: string) {
  return entries.filter((entry) => entry.participantId === participantId && entry.date === date)
    .map((entry) => ({ date, slot: entry.slot, status: entry.status, note }));
}
