import path from 'node:path';
import { serve } from '@hono/node-server';
import { ShalendarDB } from './db.js';
import { PlanEventHub } from './events.js';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT || 3001);
const DB_PATH = process.env.SHALENDAR_DB || path.resolve(process.cwd(), 'data', 'shalendar.db');
const STATIC_DIR = path.resolve(process.cwd(), 'dist', 'client');

const db = new ShalendarDB(DB_PATH);
db.seedDemoPlanIfEmpty();

const hub = new PlanEventHub();
const app = createApp(db, hub, STATIC_DIR);

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`✨ Shalendar API lista en http://localhost:${info.port}`);
});
