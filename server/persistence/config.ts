import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_POST_EVENT_GRACE_DAYS,
  isValidRetentionPolicy,
  type RetentionPolicy,
} from '../../shared/persistence.js';

export type DatabaseSslMode = 'auto' | 'true' | 'false';

export const DATABASE_URL_ENV_KEYS = [
  'DATABASE_URL',
  'POSTGRES_URI',
  'POSTGRES_URL',
  'POSTGRESQL_URL',
  'POSTGRES_URI_ADMIN',
] as const;

export type DatabaseUrlEnvKey = (typeof DATABASE_URL_ENV_KEYS)[number];

export interface PersistenceConfig {
  databaseUrl: string;
  databaseUrlSource?: DatabaseUrlEnvKey | null;
  unresolvedDatabaseUrlVars?: DatabaseUrlEnvKey[];
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
  requirePostgres: boolean;
  isProduction: boolean;
}

export interface SqlitePathResolution {
  dbPath: string;
  usedFallback: boolean;
  fallbackReason?: string;
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

function isUnresolvedTemplatePlaceholder(value: string): boolean {
  return /^\$\{.+\}$/.test(value);
}

function resolveDatabaseUrl(env: Record<string, string | undefined>): {
  databaseUrl: string;
  databaseUrlSource: DatabaseUrlEnvKey | null;
  unresolvedDatabaseUrlVars: DatabaseUrlEnvKey[];
} {
  const unresolved: DatabaseUrlEnvKey[] = [];

  for (const key of DATABASE_URL_ENV_KEYS) {
    const raw = (env[key] ?? '').trim();
    if (!raw) continue;
    if (isUnresolvedTemplatePlaceholder(raw)) {
      unresolved.push(key);
      continue;
    }
    return {
      databaseUrl: raw,
      databaseUrlSource: key,
      unresolvedDatabaseUrlVars: unresolved,
    };
  }

  return {
    databaseUrl: '',
    databaseUrlSource: null,
    unresolvedDatabaseUrlVars: unresolved,
  };
}

export function loadPersistenceConfig(
  env: Record<string, string | undefined> = process.env
): PersistenceConfig {
  const { databaseUrl, databaseUrlSource, unresolvedDatabaseUrlVars } = resolveDatabaseUrl(env);
  const isProduction = env.NODE_ENV === 'production';

  const rawPolicy = (env.DEFAULT_RETENTION_POLICY ?? 'ephemeral_after_event').trim();
  const defaultRetentionPolicy: RetentionPolicy = isValidRetentionPolicy(rawPolicy)
    ? rawPolicy
    : 'ephemeral_after_event';

  return {
    databaseUrl,
    databaseUrlSource,
    unresolvedDatabaseUrlVars,
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
    requirePostgres:
      (env.REQUIRE_POSTGRES ?? 'false').trim().toLowerCase() === 'true' ||
      (env.REQUIRE_POSTGRES ?? '').trim() === '1',
    isProduction,
  };
}

export function resolveWritableSqlitePath(options: {
  explicitDbPath?: string;
  defaultDbPath: string;
  fallbackDir?: string;
}): SqlitePathResolution {
  const explicit = options.explicitDbPath?.trim();
  if (explicit === ':memory:') {
    return { dbPath: ':memory:', usedFallback: false };
  }

  const preferredPath = explicit || options.defaultDbPath;
  const preferredDir = path.dirname(preferredPath);

  try {
    if (!fs.existsSync(preferredDir)) {
      fs.mkdirSync(preferredDir, { recursive: true });
    }
    fs.accessSync(preferredDir, fs.constants.W_OK);
    return { dbPath: preferredPath, usedFallback: false };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (explicit || (code !== 'EACCES' && code !== 'EROFS' && code !== 'EPERM')) {
      throw err;
    }

    const fallbackBase = options.fallbackDir ?? path.join(os.tmpdir(), 'shalendar');
    if (!fs.existsSync(fallbackBase)) {
      fs.mkdirSync(fallbackBase, { recursive: true });
    }
    return {
      dbPath: path.join(fallbackBase, path.basename(preferredPath)),
      usedFallback: true,
      fallbackReason: `${code}: sin permisos de escritura en ${preferredDir}`,
    };
  }
}

export function shouldUseSsl(config: PersistenceConfig): boolean {
  if (config.databaseSsl === 'true') return true;
  if (config.databaseSsl === 'false') return false;

  try {
    const parsed = new URL(config.databaseUrl);
    const sslMode = parsed.searchParams.get('sslmode')?.trim().toLowerCase();
    if (sslMode === 'disable') return false;
    if (
      sslMode === 'require' ||
      sslMode === 'verify-ca' ||
      sslMode === 'verify-full' ||
      sslMode === 'no-verify'
    ) {
      return true;
    }

    if (!config.isProduction) return false;

    const host = parsed.hostname.toLowerCase();
    // Local / docker-compose / internal cluster hostnames without dots typically do not require SSL
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]' ||
      host === 'postgres' ||
      !host.includes('.') ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
