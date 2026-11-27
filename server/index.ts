import path from 'node:path';
import { serve } from '@hono/node-server';
import { ShalendarDB } from './db.js';
import { PlanEventHub } from './events.js';
import { createApp } from './app.js';
import type { ShalendarStore } from './store.js';
import {
  loadPersistenceConfig,
  PostgresShalendarStore,
  startPurgeScheduler,
  type PurgeSchedulerHandle,
} from './persistence/index.js';
import { SqliteShalendarStore } from './persistence/sqlite-store.js';

const PORT = Number(process.env.PORT || 3001);
const DB_PATH = process.env.SHALENDAR_DB || path.resolve(process.cwd(), 'data', 'shalendar.db');
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
    console.log('🐘 Shalendar conectado a PostgreSQL (migraciones aplicadas)');
  } else {
    const sqliteDb = new ShalendarDB(DB_PATH);
    store = new SqliteShalendarStore(sqliteDb);
    console.log(`💾 Shalendar usando SQLite local en ${DB_PATH} (define DATABASE_URL para PostgreSQL)`);
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
