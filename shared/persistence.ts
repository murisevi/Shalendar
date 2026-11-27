import type { Language } from './types.js';

export type RetentionPolicy =
  | 'ephemeral_after_event'
  | 'fixed_ttl'
  | 'sliding_inactivity'
  | 'persistent';

export type PlanVisibility = 'unlisted' | 'public_demo';

export interface PlanRetentionConfig {
  policy: RetentionPolicy;
  /** Number of days used for fixed_ttl, sliding_inactivity, or pre-confirmation fallback. */
  retentionDays: number;
}

export interface PlanLifecycleMeta {
  visibility: PlanVisibility;
  retentionPolicy: RetentionPolicy;
  retentionDays: number;
  lastActivityAt: string;
  /** ISO datetime when the plan will be purged, or null when persistent. */
  expiresAt: string | null;
}

export interface RetentionPreset {
  id: string;
  policy: RetentionPolicy;
  retentionDays: number;
  label: string;
  shortLabel: string;
  description: string;
  recommended?: boolean;
}

export const RETENTION_PRESETS: readonly RetentionPreset[] = [
  {
    id: 'ephemeral-default',
    policy: 'ephemeral_after_event',
    retentionDays: 30,
    label: 'Efímero (recomendado)',
    shortLabel: 'Efímero',
    description:
      'Se borra automáticamente 14 días tras la fecha confirmada (o 30 días sin actividad). Ideal para quedadas puntuales.',
    recommended: true,
  },
  {
    id: 'express-7d',
    policy: 'fixed_ttl',
    retentionDays: 7,
    label: 'Temporal (7 días)',
    shortLabel: '7 días',
    description: 'Se elimina automáticamente a los 7 días de crearse. Enlace rápido y sin rastro.',
  },
  {
    id: 'sliding-90d',
    policy: 'sliding_inactivity',
    retentionDays: 90,
    label: 'Mientras siga vivo',
    shortLabel: 'Por actividad',
    description:
      'Se mantiene activo indefinidamente mientras haya cambios y caduca tras 90 días sin actividad.',
  },
  {
    id: 'persistent',
    policy: 'persistent',
    retentionDays: 0,
    label: 'Persistente',
    shortLabel: 'Persistente',
    description:
      'Sin borrado automático. El organizador puede archivarlo o borrarlo manualmente cuando quiera.',
  },
] as const;

export const RETENTION_PRESETS_EN: readonly RetentionPreset[] = [
  {
    id: 'ephemeral-default',
    policy: 'ephemeral_after_event',
    retentionDays: 30,
    label: 'Ephemeral (recommended)',
    shortLabel: 'Ephemeral',
    description:
      'Automatically deleted 14 days after the confirmed date (or 30 days of inactivity). Ideal for one-off hangouts.',
    recommended: true,
  },
  {
    id: 'express-7d',
    policy: 'fixed_ttl',
    retentionDays: 7,
    label: 'Temporary (7 days)',
    shortLabel: '7 days',
    description: 'Automatically deleted 7 days after creation. Fast link with no trace left behind.',
  },
  {
    id: 'sliding-90d',
    policy: 'sliding_inactivity',
    retentionDays: 90,
    label: 'While active',
    shortLabel: 'By activity',
    description:
      'Stays active indefinitely while updates happen and expires after 90 days of inactivity.',
  },
  {
    id: 'persistent',
    policy: 'persistent',
    retentionDays: 0,
    label: 'Persistent',
    shortLabel: 'Persistent',
    description:
      'No automatic deletion. The organizer can archive or delete it manually anytime.',
  },
] as const;

export function getRetentionPresets(lang: Language = 'es'): readonly RetentionPreset[] {
  return lang === 'en' ? RETENTION_PRESETS_EN : RETENTION_PRESETS;
}

export const DEFAULT_POST_EVENT_GRACE_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isValidRetentionPolicy(value: string): value is RetentionPolicy {
  return (
    value === 'ephemeral_after_event' ||
    value === 'fixed_ttl' ||
    value === 'sliding_inactivity' ||
    value === 'persistent'
  );
}

/**
 * Computes the next expires_at ISO timestamp for a plan based on its retention policy.
 * Returns null for persistent plans.
 */
export function computeExpiresAt(params: {
  policy: RetentionPolicy;
  retentionDays: number;
  now?: Date;
  createdAt?: Date;
  confirmedDate?: string | null;
  confirmedEndDate?: string | null;
  postEventGraceDays?: number;
}): string | null {
  const {
    policy,
    retentionDays,
    now = new Date(),
    createdAt = now,
    confirmedDate = null,
    confirmedEndDate = null,
    postEventGraceDays = DEFAULT_POST_EVENT_GRACE_DAYS,
  } = params;

  if (policy === 'persistent') {
    return null;
  }

  const clampedDays = Math.max(1, Math.min(365, Math.round(retentionDays || 30)));

  if (policy === 'fixed_ttl') {
    return new Date(createdAt.getTime() + clampedDays * MS_PER_DAY).toISOString();
  }

  if (policy === 'sliding_inactivity') {
    return new Date(now.getTime() + clampedDays * MS_PER_DAY).toISOString();
  }

  // ephemeral_after_event
  const anchorIso = confirmedEndDate || confirmedDate;
  if (anchorIso) {
    const anchorDate = new Date(`${anchorIso}T23:59:59.000Z`);
    if (!Number.isNaN(anchorDate.getTime())) {
      const postEventMs = anchorDate.getTime() + Math.max(1, postEventGraceDays) * MS_PER_DAY;
      // Never expire in the past immediately upon confirming a recent date; give at least 48h grace
      const minGraceMs = now.getTime() + 2 * MS_PER_DAY;
      return new Date(Math.max(postEventMs, minGraceMs)).toISOString();
    }
  }

  // No confirmed date yet: behave like inactivity TTL from now
  return new Date(now.getTime() + clampedDays * MS_PER_DAY).toISOString();
}

export function isPlanExpired(expiresAt: string | null, now = new Date()): boolean {
  if (!expiresAt) return false;
  const ts = Date.parse(expiresAt);
  if (Number.isNaN(ts)) return false;
  return ts <= now.getTime();
}

export function getRemainingDays(expiresAt: string | null, now = new Date()): number | null {
  if (!expiresAt) return null;
  const ts = Date.parse(expiresAt);
  if (Number.isNaN(ts)) return null;
  return Math.max(0, Math.ceil((ts - now.getTime()) / MS_PER_DAY));
}

export interface PlanSummaryBatchRequest {
  /** Slugs read from the user's browser localStorage (capped server-side, e.g. max 15). */
  slugs: string[];
}

export interface PlanSummaryItem {
  slug: string;
  title: string;
  emoji: string;
  location: string;
  participantCount: number;
  confirmedDate: string | null;
  createdAt: string;
  retentionPolicy: RetentionPolicy;
  expiresAt: string | null;
}

export interface UpdatePlanRetentionRequest {
  retentionPolicy: RetentionPolicy;
  retentionDays?: number;
}

export interface ExtendPlanExpirationRequest {
  extraDays?: number;
}

export interface ExportedPlanBackup<TSnapshot = unknown> {
  format: 'shalendar-backup-v1';
  exportedAt: string;
  snapshot: TSnapshot;
}
