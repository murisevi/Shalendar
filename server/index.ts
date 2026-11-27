import path from 'node:path';
import { serve } from '@hono/node-server';
import { ShalendarDB } from './db.js';
import { PlanEventHub } from './events.js';
import { createApp } from './app.js';
import type { ShalendarStore } from './store.js';
import {
  loadPersistenceConfig,
  PostgresShalendarStore,
  resolveWritableSqlitePath,
  startPurgeScheduler,
  type PurgeSchedulerHandle,
} from './persistence/index.js';
import { SqliteShalendarStore } from './persistence/sqlite-store.js';

const PORT = Number(process.env.PORT || 3001);
const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data', 'shalendar.db');
const STATIC_DIR = path.resolve(process.cwd(), 'dist', 'client');

async function main() {
  const config = loadPersistenceConfig();

  let store: ShalendarStore;
  let purgeHandle: PurgeSchedulerHandle | null = null;

  if (config.databaseUrl) {
    const pgStore = await PostgresShalendarStore.connect(config);
    store = pgStore;
    purgeHandle = startPurgeScheduler(pgStore.getPool(), {
      intervalHours: config.purgeIntervalHours,
    });
    console.log(
      `🐘 Shalendar conectado a PostgreSQL vía ${config.databaseUrlSource ?? 'DATABASE_URL'} (migraciones aplicadas)`
    );
  } else {
    if (config.unresolvedDatabaseUrlVars && config.unresolvedDatabaseUrlVars.length > 0) {
      console.warn(
        `⚠️  Se detectaron variables de PostgreSQL sin resolver (${config.unresolvedDatabaseUrlVars.join(', ')}). Revisa el enlace con el addon o Secret Group en tu PaaS.`
      );
    }

    const sqliteTarget = resolveWritableSqlitePath({
      explicitDbPath: process.env.SHALENDAR_DB,
      defaultDbPath: DEFAULT_DB_PATH,
    });
    if (sqliteTarget.usedFallback) {
      console.warn(
        `⚠️  ${sqliteTarget.fallbackReason}. Usando almacenamiento temporal SQLite en ${sqliteTarget.dbPath}.`
      );
    }
    if (config.isProduction) {
      console.warn(
        '⚠️  Shalendar está arrancando en producción sin DATABASE_URL/POSTGRES_URI. Los datos en SQLite local pueden perderse al reiniciar el contenedor salvo que enlaces PostgreSQL o montes un volumen persistente en /app/data.'
      );
    }

    const sqliteDb = new ShalendarDB(sqliteTarget.dbPath);
    store = new SqliteShalendarStore(sqliteDb);
    console.log(
      `💾 Shalendar usando SQLite local en ${sqliteTarget.dbPath} (define DATABASE_URL o POSTGRES_URI para PostgreSQL)`
    );
  }

  if (config.allowPublicDemo) {
    await store.seedDemoPlanIfEmpty();
  }

  const hub = new PlanEventHub();
  const app = createApp(store, hub, STATIC_DIR, {
    purgeCronSecret: config.purgeCronSecret,
  });

  const server = serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, (info) => {
    console.log(`✨ Shalendar API lista en http://localhost:${info.port}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Recibida señal ${signal}, cerrando Shalendar...`);
    purgeHandle?.stop();
    server.close();
    await store.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

main().catch((err) => {
  console.error('❌ Error fatal al iniciar Shalendar:', err);
  process.exit(1);
});
