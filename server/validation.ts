import { z } from 'zod';

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const calendarDateSchema = z.string().refine(isCalendarDate, 'Fecha inválida');
export const calendarMonthSchema = z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/, 'Mes inválido');
export const clockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida');
export const timezoneSchema = z.string().max(64).refine((value) => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; }
  catch { return false; }
}, 'Zona horaria inválida');
export const deadlineSchema = z.string().max(40).refine((value) => {
  // Require an unambiguous timestamp, including its offset, and a real calendar day.
  return /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/.test(value)
    && isCalendarDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}, 'Fecha límite inválida');
export const profilePinSchema = z.string().trim().max(12).refine(
  (pin) => pin.length === 0 || pin.length >= 4, 'El PIN debe tener al menos 4 caracteres'
);

export class ValidationError extends Error {}

// Run against the effective values after defaults/partial updates, before writing either store.
export function validatePlanDates(input: {
  startMonth: string; endMonth: string; votingDeadline?: string | null;
  confirmedDate?: string | null; confirmedEndDate?: string | null;
  confirmedTime?: string | null; confirmedTimezone?: string | null;
}): void {
  const result = z.object({
    startMonth: calendarMonthSchema, endMonth: calendarMonthSchema,
    votingDeadline: deadlineSchema.nullable().optional(),
    confirmedDate: calendarDateSchema.nullable().optional(),
    confirmedEndDate: calendarDateSchema.nullable().optional(),
    confirmedTime: clockTimeSchema.nullable().optional(),
    confirmedTimezone: timezoneSchema.nullable().optional(),
  }).safeParse(input);
  if (!result.success) throw new ValidationError(result.error.issues[0].message);
  if (input.endMonth < input.startMonth) throw new ValidationError('El mes final es anterior al inicial');
  if (input.confirmedEndDate && (!input.confirmedDate || input.confirmedEndDate < input.confirmedDate)) {
    throw new ValidationError('La fecha final es anterior al inicio o falta la fecha inicial');
  }
}
