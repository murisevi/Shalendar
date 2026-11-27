import type { HolidayCountry, Language } from './types.js';

export interface HolidayInfo {
  date: string; // YYYY-MM-DD
  name: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toISO(year: number, month1: number, day: number): string {
  return `${year}-${pad2(month1)}-${pad2(day)}`;
}

function addDays(year: number, month1: number, day: number, delta: number): string {
  const d = new Date(year, month1 - 1, day + delta);
  return toISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * Anonymous Gregorian Easter Sunday algorithm (Meeus/Jones/Butcher).
 */
export function getEasterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function nthWeekdayOfMonth(year: number, month1: number, weekday: number, nth: number): string {
  const first = new Date(year, month1 - 1, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  return toISO(year, month1, day);
}

function lastWeekdayOfMonth(year: number, month1: number, weekday: number): string {
  const last = new Date(year, month1, 0);
  const offset = (last.getDay() - weekday + 7) % 7;
  return toISO(year, month1, last.getDate() - offset);
}

const cache = new Map<string, Map<string, HolidayInfo>>();

export function getHolidaysForYear(
  year: number,
  country: HolidayCountry,
  lang: Language = 'es'
): Map<string, HolidayInfo> {
  if (country === 'none') return new Map();
  const key = `${country}:${year}:${lang}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const map = new Map<string, HolidayInfo>();
  const add = (date: string, es: string, en: string) => {
    if (!map.has(date)) map.set(date, { date, name: lang === 'en' ? en : es });
  };

  const easter = getEasterSunday(year);
  const goodFriday = addDays(year, easter.month, easter.day, -2);
  const maundyThursday = addDays(year, easter.month, easter.day, -3);

  if (country === 'ES') {
    add(toISO(year, 1, 1), 'Año Nuevo', "New Year's Day");
    add(toISO(year, 1, 6), 'Día de Reyes', 'Epiphany');
    add(maundyThursday, 'Jueves Santo', 'Maundy Thursday');
    add(goodFriday, 'Viernes Santo', 'Good Friday');
    add(toISO(year, 5, 1), 'Día del Trabajo', 'Labor Day');
    add(toISO(year, 8, 15), 'Asunción de la Virgen', 'Assumption Day');
    add(toISO(year, 10, 12), 'Fiesta Nacional de España', 'National Day of Spain');
    add(toISO(year, 11, 1), 'Todos los Santos', "All Saints' Day");
    add(toISO(year, 12, 6), 'Día de la Constitución', 'Constitution Day');
    add(toISO(year, 12, 8), 'Inmaculada Concepción', 'Immaculate Conception');
    add(toISO(year, 12, 25), 'Navidad', 'Christmas Day');
  } else if (country === 'MX') {
    add(toISO(year, 1, 1), 'Año Nuevo', "New Year's Day");
    add(nthWeekdayOfMonth(year, 2, 1, 1), 'Día de la Constitución', 'Constitution Day');
    add(nthWeekdayOfMonth(year, 3, 1, 3), 'Natalicio de Benito Juárez', "Benito Juárez's Birthday");
    add(goodFriday, 'Viernes Santo', 'Good Friday');
    add(toISO(year, 5, 1), 'Día del Trabajo', 'Labor Day');
    add(toISO(year, 9, 16), 'Día de la Independencia', 'Independence Day');
    add(nthWeekdayOfMonth(year, 11, 1, 3), 'Revolución Mexicana', 'Revolution Day');
    add(toISO(year, 12, 25), 'Navidad', 'Christmas Day');
  } else if (country === 'AR') {
    add(toISO(year, 1, 1), 'Año Nuevo', "New Year's Day");
    add(toISO(year, 3, 24), 'Día de la Memoria', 'Day of Remembrance');
    add(toISO(year, 4, 2), 'Día del Veterano y Malvinas', 'Malvinas Day');
    add(goodFriday, 'Viernes Santo', 'Good Friday');
    add(toISO(year, 5, 1), 'Día del Trabajador', 'Labor Day');
    add(toISO(year, 5, 25), 'Revolución de Mayo', 'May Revolution Day');
    add(toISO(year, 6, 20), 'Día de la Bandera', 'Flag Day');
    add(toISO(year, 7, 9), 'Día de la Independencia', 'Independence Day');
    add(toISO(year, 12, 8), 'Inmaculada Concepción', 'Immaculate Conception');
    add(toISO(year, 12, 25), 'Navidad', 'Christmas Day');
  } else if (country === 'CO') {
    add(toISO(year, 1, 1), 'Año Nuevo', "New Year's Day");
    add(maundyThursday, 'Jueves Santo', 'Maundy Thursday');
    add(goodFriday, 'Viernes Santo', 'Good Friday');
    add(toISO(year, 5, 1), 'Día del Trabajo', 'Labor Day');
    add(toISO(year, 7, 20), 'Día de la Independencia', 'Independence Day');
    add(toISO(year, 8, 7), 'Batalla de Boyacá', 'Battle of Boyacá');
    add(toISO(year, 12, 8), 'Inmaculada Concepción', 'Immaculate Conception');
    add(toISO(year, 12, 25), 'Navidad', 'Christmas Day');
  } else if (country === 'US') {
    add(toISO(year, 1, 1), 'Año Nuevo', "New Year's Day");
    add(nthWeekdayOfMonth(year, 1, 1, 3), 'Día de Martin Luther King Jr.', 'Martin Luther King Jr. Day');
    add(nthWeekdayOfMonth(year, 2, 1, 3), 'Día de los Presidentes', "Presidents' Day");
    add(lastWeekdayOfMonth(year, 5, 1), 'Día de los Caídos', 'Memorial Day');
    add(toISO(year, 6, 19), 'Juneteenth', 'Juneteenth');
    add(toISO(year, 7, 4), 'Día de la Independencia', 'Independence Day');
    add(nthWeekdayOfMonth(year, 9, 1, 1), 'Día del Trabajo', 'Labor Day');
    add(nthWeekdayOfMonth(year, 11, 4, 4), 'Acción de Gracias', 'Thanksgiving');
    add(toISO(year, 12, 25), 'Navidad', 'Christmas Day');
  }

  cache.set(key, map);
  return map;
}

export function getHolidayInfo(
  isoDate: string,
  country: HolidayCountry,
  lang: Language = 'es'
): HolidayInfo | null {
  if (country === 'none' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const year = Number(isoDate.slice(0, 4));
  return getHolidaysForYear(year, country, lang).get(isoDate) ?? null;
}

export const HOLIDAY_COUNTRIES: Array<{ id: HolidayCountry; label: string }> = [
  { id: 'ES', label: '🇪🇸 España' },
  { id: 'MX', label: '🇲🇽 México' },
  { id: 'AR', label: '🇦🇷 Argentina' },
  { id: 'CO', label: '🇨🇴 Colombia' },
  { id: 'US', label: '🇺🇸 EE. UU.' },
  { id: 'none', label: 'Sin festivos' },
];

export const HOLIDAY_COUNTRIES_EN: Array<{ id: HolidayCountry; label: string }> = [
  { id: 'ES', label: '🇪🇸 Spain' },
  { id: 'MX', label: '🇲🇽 Mexico' },
  { id: 'AR', label: '🇦🇷 Argentina' },
  { id: 'CO', label: '🇨🇴 Colombia' },
  { id: 'US', label: '🇺🇸 United States' },
  { id: 'none', label: 'No holidays' },
];

export function getHolidayCountries(lang: Language = 'es'): Array<{ id: HolidayCountry; label: string }> {
  return lang === 'en' ? HOLIDAY_COUNTRIES_EN : HOLIDAY_COUNTRIES;
}
