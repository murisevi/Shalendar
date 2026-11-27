import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTransaction, type PgPoolLike } from './pool.js';

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

const DEFAULT_MIGRATIONS_CANDIDATES = [
  path.resolve(process.cwd(), 'server', 'persistence', 'migrations'),
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'migrations'),
];

async function resolveMigrationsDir(explicitDir?: string): Promise<string> {
  const candidates = explicitDir
    ? [explicitDir, ...DEFAULT_MIGRATIONS_CANDIDATES]
    : DEFAULT_MIGRATIONS_CANDIDATES;

  for (const dir of candidates) {
    try {
      const stat = await fs.stat(dir);
      if (stat.isDirectory()) return dir;
    } catch {
      // Try next candidate
    }
  }

  throw new Error(
    `No se encontró el directorio de migraciones SQL. Rutas comprobadas: ${candidates.join(', ')}`
  );
}

/**
 * Executes numbered `.sql` migration files idempotently, tracking applied files
 * in `schema_migrations`. Each migration runs inside its own PostgreSQL transaction.
 */
export async function runMigrations(
  pool: PgPoolLike,
  migrationsDir?: string
): Promise<MigrationResult> {
  const dir = await resolveMigrationsDir(migrationsDir);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const existing = await pool.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY filename ASC'
  );
  const appliedSet = new Set(existing.rows.map((r) => String(r.filename)));

  const entries = await fs.readdir(dir);
  const sqlFiles = entries.filter((name) => name.endsWith('.sql')).sort();

  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  for (const filename of sqlFiles) {
    if (appliedSet.has(filename)) {
      alreadyApplied.push(filename);
      continue;
    }

    const sql = await fs.readFile(path.join(dir, filename), 'utf8');
    await withTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    });
    applied.push(filename);
  }

  return { applied, alreadyApplied };
}
