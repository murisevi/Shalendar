import type {
  AvailabilityEntry,
  AvailabilitySlot,
  AvailabilityStatus,
  PlanGranularity,
  SpecificSlot,
} from '../../shared/types';
import { isSlotGranularity, normalizeEnabledSlots } from '../../shared/dates';

/** A whole-day edit in slot mode updates every enabled slot in one request. Clear legacy all-day entries. */
export function dayAvailabilityChanges(
  date: string,
  status: AvailabilityStatus | null,
  granularity: PlanGranularity,
  note?: string,
  enabledSlots?: readonly SpecificSlot[] | null
) {
  const useSlots = isSlotGranularity(granularity);
  const slots: AvailabilitySlot[] = useSlots
    ? normalizeEnabledSlots(granularity, enabledSlots)
    : ['all'];
  const changes = slots.map((slot) => ({ date, slot, status, ...(note === undefined ? {} : { note }) }));
  if (useSlots) changes.push({ date, slot: 'all', status: null });
  return changes;
}

/** Keep each stored slot's status; never copy the aggregate day status into a slot. */
export function personalNoteChanges(entries: AvailabilityEntry[], participantId: string, date: string, note: string) {
  return entries.filter((entry) => entry.participantId === participantId && entry.date === date)
    .map((entry) => ({ date, slot: entry.slot, status: entry.status, note }));
}
