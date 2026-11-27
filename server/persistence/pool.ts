import { shouldUseSsl, type PersistenceConfig } from './config.js';

export interface PgQueryResult<TRow = Record<string, unknown>> {
  rows: TRow[];
  rowCount: number | null;
}

export interface PgQueryClient {
  query<TRow = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[]
  ): Promise<PgQueryResult<TRow>>;
  release(): void;
}

/**
 * Structural subset of `pg.Pool` so the persistence layer stays decoupled
 * from driver internals and easy to test with fakes or real PostgreSQL pools.
 */
export interface PgPoolLike {
  query<TRow = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[]
  ): Promise<PgQueryResult<TRow>>;
  connect(): Promise<PgQueryClient>;
  end(): Promise<void>;
}

export interface PgPoolConstructorOptions {
  connectionString: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  ssl?: false | { rejectUnauthorized: boolean };
}

/**
 * Strips `sslmode` from connectionString when `pg-connection-string` would otherwise
 * clobber our explicit `ssl` option (e.g., turning `sslmode=require` into strict CA check
 * that fails on PaaS self-signed Postgres certs, or overriding `DATABASE_SSL=false`).
 * Preserves explicit `verify-ca` / `verify-full` / `sslrootcert` when `DATABASE_SSL=auto`.
 */
function normalizeConnectionStringForPg(config: PersistenceConfig): {
  connectionString: string;
  preserveStrictUrlSsl: boolean;
} {
  try {
    const parsed = new URL(config.databaseUrl);
    const sslMode = parsed.searchParams.get('sslmode')?.trim().toLowerCase();
    const hasRootCert = parsed.searchParams.has('sslrootcert');

    if (
      config.databaseSsl === 'auto' &&
      (hasRootCert || sslMode === 'verify-ca' || sslMode === 'verify-full')
    ) {
      return { connectionString: config.databaseUrl, preserveStrictUrlSsl: true };
    }

    if (parsed.searchParams.has('sslmode')) {
      parsed.searchParams.delete('sslmode');
      return { connectionString: parsed.toString(), preserveStrictUrlSsl: false };
    }
  } catch {
    // Keep original connectionString if URL parsing fails
  }
  return { connectionString: config.databaseUrl, preserveStrictUrlSsl: false };
}

/**
 * Builds options ready to pass into `new pg.Pool(buildPgPoolOptions(config))`.
 * Tuned for PaaS deployments (Northflank Sandbox & serverless Neon scale-to-zero).
 */
export function buildPgPoolOptions(config: PersistenceConfig): PgPoolConstructorOptions {
  if (!config.databaseUrl) {
    throw new Error(
      'DATABASE_URL no está configurada. Define DATABASE_URL (o POSTGRES_URI) apuntando a tu instancia de PostgreSQL.'
    );
  }

  const { connectionString, preserveStrictUrlSsl } = normalizeConnectionStringForPg(config);

  return {
    connectionString,
    max: config.poolMax,
    idleTimeoutMillis: config.idleTimeoutMs,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    ...(preserveStrictUrlSsl
      ? {}
      : { ssl: shouldUseSsl(config) ? { rejectUnauthorized: false } : false }),
  };
}

/**
 * Runs a callback inside an explicit BEGIN / COMMIT / ROLLBACK transaction.
 */
export async function withTransaction<T>(
  pool: PgPoolLike,
  fn: (client: PgQueryClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve original error
    }
    throw err;
  } finally {
    client.release();
  }
}

export interface DatabaseHealthStatus {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Lightweight connectivity check for `/api/health` readiness & liveness probes.
 */
export async function checkDatabaseHealth(pool: PgPoolLike): Promise<DatabaseHealthStatus> {
  const startedAt = Date.now();
  try {
    await pool.query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : 'Database connection error',
    };
  }
}
