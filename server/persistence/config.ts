import {
  DEFAULT_POST_EVENT_GRACE_DAYS,
  isValidRetentionPolicy,
  type RetentionPolicy,
} from '../../shared/persistence.js';

export type DatabaseSslMode = 'auto' | 'true' | 'false';

export interface PersistenceConfig {
  databaseUrl: string;
  databaseSsl: DatabaseSslMode;
  poolMax: number;
  idleTimeoutMs: number;
  connectionTimeoutMs: number;
  defaultRetentionPolicy: RetentionPolicy;
  defaultRetentionDays: number;
  postEventGraceDays: number;
  purgeIntervalHours: number;
  purgeCronSecret: string | null;
  allowPublicDemo: boolean;
  isProduction: boolean;
}

function parseIntEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseSslMode(raw: string | undefined): DatabaseSslMode {
  const normalized = (raw ?? 'auto').trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'require') return 'true';
  if (normalized === 'false' || normalized === '0' || normalized === 'disable') return 'false';
  return 'auto';
}

export function loadPersistenceConfig(
  env: Record<string, string | undefined> = process.env
): PersistenceConfig {
  const databaseUrl = (env.DATABASE_URL ?? '').trim();
  const isProduction = env.NODE_ENV === 'production';

  const rawPolicy = (env.DEFAULT_RETENTION_POLICY ?? 'ephemeral_after_event').trim();
  const defaultRetentionPolicy: RetentionPolicy = isValidRetentionPolicy(rawPolicy)
    ? rawPolicy
    : 'ephemeral_after_event';

  return {
    databaseUrl,
    databaseSsl: parseSslMode(env.DATABASE_SSL),
    poolMax: parseIntEnv(env.DATABASE_POOL_MAX, 5, 1, 50),
    idleTimeoutMs: parseIntEnv(env.DATABASE_IDLE_TIMEOUT_MS, 15_000, 1_000, 300_000),
    connectionTimeoutMs: parseIntEnv(env.DATABASE_CONNECT_TIMEOUT_MS, 10_000, 1_000, 60_000),
    defaultRetentionPolicy,
    defaultRetentionDays: parseIntEnv(env.DEFAULT_RETENTION_DAYS, 30, 1, 365),
    postEventGraceDays: parseIntEnv(
      env.POST_EVENT_GRACE_DAYS,
      DEFAULT_POST_EVENT_GRACE_DAYS,
      1,
      90
    ),
    purgeIntervalHours: parseIntEnv(env.PURGE_INTERVAL_HOURS, 12, 0, 168),
    purgeCronSecret: env.PURGE_CRON_SECRET?.trim() || null,
    allowPublicDemo: (env.ALLOW_PUBLIC_DEMO ?? 'true').trim().toLowerCase() !== 'false',
    isProduction,
  };
}

export function shouldUseSsl(config: PersistenceConfig): boolean {
  if (config.databaseSsl === 'true') return true;
  if (config.databaseSsl === 'false') return false;
  if (!config.isProduction) return false;

  try {
    const parsed = new URL(config.databaseUrl);
    const host = parsed.hostname.toLowerCase();
    // Local / docker-compose / internal cluster hostnames without dots typically do not require SSL
    if (host === 'localhost' || host === '127.0.0.1' || host === 'postgres') {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
