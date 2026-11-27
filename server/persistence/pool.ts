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
 * Builds options ready to pass into `new pg.Pool(buildPgPoolOptions(config))`.
 * Tuned for PaaS deployments (Northflank Sandbox & serverless Neon scale-to-zero).
 */
export function buildPgPoolOptions(config: PersistenceConfig): PgPoolConstructorOptions {
  if (!config.databaseUrl) {
    throw new Error(
      'DATABASE_URL no está configurada. Define DATABASE_URL apuntando a tu instancia de PostgreSQL.'
    );
  }

  return {
    connectionString: config.databaseUrl,
    max: config.poolMax,
    idleTimeoutMillis: config.idleTimeoutMs,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    ssl: shouldUseSsl(config) ? { rejectUnauthorized: false } : false,
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
