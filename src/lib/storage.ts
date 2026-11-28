import type { Language } from '../../shared/types';

export interface RecentPlanItem {
  slug: string;
  title: string;
  emoji: string;
  lastVisitedAt: string;
}

const RECENT_KEY = 'shalendar:recent-plans';
const THEME_KEY = 'shalendar:theme';
const LANGUAGE_KEY = 'shalendar:lang';
const PLAN_INTRO_KEY = 'shalendar:plan-intro-seen';

/** Whether the first-visit "how it works" mini tutorial was already shown on this device. */
export function hasSeenPlanIntro(): boolean {
  try {
    return localStorage.getItem(PLAN_INTRO_KEY) === '1';
  } catch {
    return true;
  }
}

export function markPlanIntroSeen(): void {
  try {
    localStorage.setItem(PLAN_INTRO_KEY, '1');
  } catch {
    // Ignore storage errors
  }
}

export function getSavedParticipantId(slug: string): string | null {
  try {
    return localStorage.getItem(`shalendar:me:${slug}`);
  } catch {
    return null;
  }
}

export function saveParticipantId(slug: string, participantId: string | null): void {
  try {
    if (participantId) {
      localStorage.setItem(`shalendar:me:${slug}`, participantId);
    } else {
      localStorage.removeItem(`shalendar:me:${slug}`);
    }
  } catch {
    // Ignore storage errors
  }
}

export function getParticipantToken(slug: string): string | null {
  try {
    return localStorage.getItem(`shalendar:ptoken:${slug}`);
  } catch {
    return null;
  }
}

export function saveParticipantToken(slug: string, token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(`shalendar:ptoken:${slug}`, token);
    } else {
      localStorage.removeItem(`shalendar:ptoken:${slug}`);
    }
  } catch {
    // Ignore storage errors
  }
}

export function saveAdminToken(slug: string, token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(`shalendar:admin:${slug}`, token);
    } else {
      localStorage.removeItem(`shalendar:admin:${slug}`);
    }
  } catch {
    // Ignore
  }
}

export function getAdminToken(slug: string): string | null {
  try {
    return localStorage.getItem(`shalendar:admin:${slug}`);
  } catch {
    return null;
  }
}

export function getRecentPlans(): RecentPlanItem[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function rememberPlan(item: Omit<RecentPlanItem, 'lastVisitedAt'>): void {
  try {
    const current = getRecentPlans().filter((p) => p.slug !== item.slug);
    const next: RecentPlanItem[] = [
      { ...item, lastVisitedAt: new Date().toISOString() },
      ...current,
    ].slice(0, 12);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Ignore
  }
}

export function forgetPlan(slug: string): void {
  try {
    const next = getRecentPlans().filter((p) => p.slug !== slug);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    saveParticipantId(slug, null);
    saveParticipantToken(slug, null);
    saveAdminToken(slug, null);
  } catch {
    // Ignore
  }
}

export function buildDeviceTransferUrl(slug: string, includeAdmin = true): string {
  const url = new URL(`${window.location.origin}/e/${encodeURIComponent(slug)}`);
  const pToken = getParticipantToken(slug);
  const aToken = includeAdmin ? getAdminToken(slug) : null;
  if (pToken) url.searchParams.set('pt', pToken);
  if (aToken) url.searchParams.set('at', aToken);
  return url.toString();
}

export function buildCoOrganizerUrl(slug: string): string | null {
  const aToken = getAdminToken(slug);
  if (!aToken) return null;
  const url = new URL(`${window.location.origin}/e/${encodeURIComponent(slug)}`);
  url.searchParams.set('at', aToken);
  return url.toString();
}

export type ThemeMode = 'light' | 'dark';

export function getInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Ignore
  }
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function applyTheme(theme: ThemeMode): void {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Ignore
  }
}

export function getInitialLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (saved === 'es' || saved === 'en') return saved;
  } catch {
    // Ignore
  }
  if (typeof navigator !== 'undefined') {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const raw of langs) {
      const code = (raw || '').toLowerCase();
      if (code.startsWith('es')) return 'es';
      if (code.startsWith('en')) return 'en';
    }
  }
  return 'es';
}

export function getSavedLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (saved === 'es' || saved === 'en') return saved;
  } catch {
    // Ignore
  }
  return getInitialLanguage();
}

export function saveLanguage(lang: Language): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
  }
  try {
    localStorage.setItem(LANGUAGE_KEY, lang);
  } catch {
    // Ignore
  }
}
