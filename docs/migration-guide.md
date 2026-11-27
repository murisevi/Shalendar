# Guía de integración y migración: SQLite → PostgreSQL + Northflank

Esta rama (`docs/deploy-and-persistence`) contiene **únicamente archivos nuevos y sin conflictos** para que puedas integrarla limpiamente en cuanto se fusione `feat/future-improvements` en `master`.

## 1. Qué incluye ya este esqueleto

| Archivo | Propósito |
| --- | --- |
| `Dockerfile` & `.dockerignore` | Build multi-stage Node 22 Alpine (compila Vite + `tsc`, usuario no-root, healthcheck `/api/health`, copia migraciones SQL). |
| `docker-compose.yml` | PostgreSQL 16 local en 1 comando (`docker compose up -d postgres`) + perfil opcional `--profile app`. |
| `.env.example` | Todas las variables de entorno para desarrollo local, Northflank Sandbox y Neon. |
| `deploy/northflank/template.json` & `deploy/northflank/README.md` | Plantilla y guía paso a paso para desplegar gratis ($0/mes, *always-on*, sin tarjeta) en **Northflank Developer Sandbox**. |
| `shared/persistence.ts` | Tipos de retención (`RetentionPolicy`), presets para la UI en español (`RETENTION_PRESETS`), cálculo puro `computeExpiresAt`, `isPlanExpired` y contratos de resúmenes privados y backup JSON. |
| `server/persistence/migrations/001_initial_schema.sql` | Esquema completo de PostgreSQL con las **13 tablas** de `feat/future-improvements` + columnas de visibilidad, retención/TTL y tokens hasheados. |
| `server/persistence/config.ts` & `pool.ts` | Carga tipada de configuración, detección SSL automática (`auto`), helper `withTransaction` y `checkDatabaseHealth` para `/api/health`. |
| `server/persistence/migrator.ts` | Ejecutor idempotente de migraciones SQL con tabla `schema_migrations`. |
| `server/persistence/repository.ts` | Contrato asíncrono `PlanRepository` + clases de error (`PlanExpiredError` 410, `UnauthorizedTokenError` 403, `DuplicateParticipantError` 409). |
| `server/persistence/security.ts` | Slugs con ~64 bits de entropía (`generateSecureSlug`), tokens opacos SHA-256 + `timingSafeEqual` y `InMemoryRateLimiter`. |
| `server/persistence/purge-worker.ts` | Purga SQL de planes caducados (`purgeExpiredPlansSql`) y planificador de baja frecuencia (`startPurgeScheduler`). |

---

## 2. Pasos de integración una vez fusionado `feat/future-improvements`

### Paso 1 — Integrar ramas e instalar driver de PostgreSQL
```bash
git checkout master
git merge feat/future-improvements
git merge docs/deploy-and-persistence
npm install pg
npm install -D @types/pg
```

### Paso 2 — Implementar `PostgresPlanRepository`
Crear `server/persistence/postgres-repository.ts` implementando `PlanRepository` (vinculado a los tipos de `shared/types.ts`) con `new Pool(buildPgPoolOptions(config))`:
- Al crear plan (`createPlan`): usar `generateSecureSlug(title)`, guardar `hashToken(adminToken)` y `hashToken(participantToken)`, y calcular `expires_at` con `computeExpiresAt(...)`.
- En cada lectura (`getPlanSnapshotBySlug`): comprobar `isPlanExpired(plan.expiresAt)` → si venció (y no es demo), borrar y lanzar `PlanExpiredError` (`410 Gone`).
- En cada mutación: actualizar `last_activity_at = NOW()` y recalcular `expires_at` si `retention_policy = 'sliding_inactivity'` (o si cambia `confirmed_date` en `ephemeral_after_event`).

### Paso 3 — Adaptar `server/app.ts` y `server/index.ts`
1. Hacer los handlers que llaman al repositorio `async` (`await repo.*`).
2. Actualizar `/api/health` para consultar `checkDatabaseHealth(pool)` (devuelve `503` si Postgres no responde).
3. **Privacidad sin cuentas:**
   - Reemplazar el listado global `GET /api/plans` por `POST /api/plans/summaries` (recibe `{ slugs: string[] }`, máx. 15) + `GET /api/plans/demo`.
   - Añadir cabecera `X-Robots-Tag: noindex, nofollow` en rutas `/e/*`.
   - Añadir endpoints de ciclo de vida:
     - `PATCH /api/plans/:slug/retention` (requiere `X-Admin-Token`)
     - `POST /api/plans/:slug/extend` (requiere `X-Admin-Token`)
     - `DELETE /api/plans/:slug` (requiere `X-Admin-Token`)
     - `GET /api/plans/:slug/export` (descarga `ExportedPlanBackup`)
4. En `server/index.ts`:
   - Ejecutar `await runMigrations(pool)` al arrancar.
   - Iniciar `startPurgeScheduler(pool, { intervalHours: config.purgeIntervalHours })`.
   - Cerrar limpiamente `purgeHandle.stop()` y `await pool.end()` en `SIGTERM` / `SIGINT`.

### Paso 4 — Adaptar la UI (100 % sin cuentas)
1. **`HomePage.tsx`:**
   - Mostrar selector de retención usando `RETENTION_PRESETS` (por defecto *Efímero*).
   - Cargar «Tus quedadas recientes» enviando los slugs guardados en `localStorage` a `POST /api/plans/summaries` (en vez de listar quedadas de desconocidos).
2. **`PlanView.tsx` & `ShareModal.tsx`:**
   - Mostrar badge discreto cuando queden ≤ 5 días para caducar con botones *Extender* / *Hacer persistente* (si tiene `adminToken`) y *Exportar copia (.json)*.
   - Añadir botón **«Copiar enlace privado de organizador»** (`/e/<slug>#admin=<token>`) y soporte al abrir la URL para guardar `#admin=` en `localStorage` y limpiar el fragmento con `history.replaceState`.
   - Manejar HTTP `410 Gone` con una pantalla clara (*«Esta quedada caducó y sus datos se eliminaron»*).

### Paso 5 — Probar localmente con Docker y desplegar en Northflank
```bash
cp .env.example .env
docker compose up -d postgres
npm run typecheck
npm test
npm run dev
```
Cuando pase todo en local, sigue [`deploy/northflank/README.md`](../deploy/northflank/README.md) para desplegar en **Northflank Developer Sandbox ($0/mes)**.
