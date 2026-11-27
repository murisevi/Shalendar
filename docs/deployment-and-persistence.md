# Diseño de Despliegue, PostgreSQL y Persistencia Adaptativa para Shalendar

> **Rama aislada:** `docs/deploy-and-persistence`  
> **Decisiones cerradas:**
> - **Hosting inicial:** PaaS sencillo (con análisis en profundidad de calidad/precio y opciones más económicas).
> - **Base de datos:** **PostgreSQL**.
> - **Identidad y retención (Fase 1):** **100 % sin cuentas** + **persistencia adaptativa por quedada** (efímero por defecto, configurable hasta persistente).

---

## 1. Diagnóstico del código actual frente a producción multiusuario

Al revisar la implementación actual (`server/db.ts`, `server/app.ts`, `server/events.ts`, `server/index.ts`, `shared/types.ts` y `src/lib/storage.ts`), hay **6 puntos que debemos resolver** al desplegar para terceros:

| Área | Estado actual | Cambio necesario para producción |
| --- | --- | --- |
| **Base de datos** | `node:sqlite` (`DatabaseSync`, síncrono, archivo local `data/shalendar.db`). | Migrar a **PostgreSQL** detrás de una interfaz `PlanRepository` asíncrona (manteniendo opcionalmente un adaptador en memoria o Postgres efímero para tests). |
| **Tiempo real (SSE)** | `PlanEventHub` en memoria (`Map<string, Set<Listener>>`) en `/api/plans/:slug/stream` con *ping* cada 20 s. | Funciona muy bien en cualquier PaaS con contenedor persistente de 1 instancia (y evita despertar una BD serverless). Añadir cabeceras anti-buffering (`X-Accel-Buffering: no`, `Cache-Control: no-cache`). |
| **Privacidad del listado** | `GET /api/plans` expone las últimas 15 quedadas de toda la BD en la portada. | **Eliminar el listado global público.** Sustituir por `POST /api/plans/summaries` (el cliente envía solo los slugs de su `localStorage`) + una demo pública aislada (`cena-reencuentro`). |
| **Autorización** | `admin_token` se genera al crear el plan, pero `PATCH`/`DELETE` aún no lo verifican. | Validar `X-Admin-Token` (comparación segura con hash SHA-256) en ajustes, borrado de plan y moderación; añadir `participantToken` ligero para que cada persona edite solo sus propios datos. |
| **Entropía del `slug`** | Solo 4 caracteres hexadecimales (~65.536 combinaciones). | Aumentar a **10–12 caracteres base64url** (~64 bits de entropía) para que las URLs privadas no sean enumerables. |
| **Ciclo de vida** | Sin caducidad ni política de retención. | Añadir `retention_policy`, `expires_at`, `last_activity_at`, expiración perezosa (`410 Gone`) y limpieza periódica compatible con BD serverless. |

---

## 2. Investigación de PaaS sencillos para Node.js + SSE + PostgreSQL

### El factor clave del coste con PostgreSQL
Un servidor Node.js 22 + Hono sirviendo el frontend estático + API + SSE consume **~80–150 MB de RAM** y casi 0 % de CPU en reposo. En la mayoría de PaaS, **lo que dispara la factura mensual no es el backend Node, sino un PostgreSQL gestionado 24/7** ($6–$30/mes).

Por eso hay dos arquitecturas de PaaS igual de sencillas:
1. **Todo en el mismo PaaS (App + Postgres):** 1 solo panel, red interna (<1 ms).
2. **PaaS ligero para Node.js + Neon PostgreSQL (región Frankfurt `eu-central-1`):**
   - **Neon Free Plan ($0/mes permanentes, sin tarjeta)** incluye **1 GB de almacenamiento**, **100 CU-hours/mes** (~400 h activas/mes en 0,25 CU), auto-pausa tras 5 min de inactividad y **despertar automático en <1 s** (a diferencia de Supabase Free que se pausa manualmente tras 7 días, o Render Postgres Free que **caduca y se borra a los 30 días**).
   - Al crecer, Neon Launch es pago por uso puro sin cuota mínima fija (~$0.106/CU-h + $0.35/GB-mes).

### Comparativa detallada de PaaS (precios verificados 2026)

| Opción | Tipo | Coste mensual estimado (App + PG) | Región EU | Soporte SSE | Sueño / Cold Start | Veredicto |
| --- | --- | --- | --- | --- | --- | --- |
| **Railway Hobby + Neon Free** | Híbrido | **$5/mes** (los $5 incluidos cubren sobradamente el servicio Node) | Ámsterdam + Frankfurt | Excelente (HTTP/2 nativo) | **No duerme** la app; Neon despierta en <1 s | 🏆 **Mejor calidad/precio + máxima sencillez** |
| **Railway Hobby (Todo en uno)** | Todo en uno | **~$6–$10/mes** (uso real Node + Postgres en Railway) | Ámsterdam | Excelente | Sin sleep obligatorio (opcional) | Muy cómodo si quieres 1 solo panel y factura |
| **Fly.io (`shared-cpu-1x`) + Neon Free** | Híbrido | **~$2.20–$2.50/mes** always-on (~$1/mes con auto-suspend) | **Madrid (`mad`)** o Frankfurt (`fra`) | Excelente | **No duerme** (o <500 ms si suspendes) | 🥇 **Más económico en producción real y servidor en Madrid** |
| **Fly.io + Fly Managed Postgres Dev** | Todo en uno | **~$6.50/mes** ($2.50 app + $4 MPG Dev con HA) | Madrid / Frankfurt | Excelente | Postgres Dev duerme a los 15 min (8–15 s despertar) | Buena opción integrada si toleras 10 s de wake en BD |
| **Northflank Developer Sandbox** | Todo en uno | **$0/mes** (sin tarjeta; 2 servicios + 1 BD + 2 crons) | Europa / US | Bueno | **No duerme** dentro de cuota Sandbox | 💸 **Mejor opción $0 real sin sleep** (panel más técnico; salto a pago ~$15+/mes) |
| **Railway Free ($0)** | Todo en uno | **$0/mes** (sin tarjeta; $1/mes de crédito recurrente) | Ámsterdam | Bueno mientras despierto | Duerme a los 5–10 min; si agota $1 pausa hasta el mes siguiente | Bueno solo para demos muy esporádicas |
| **Koyeb Free + Neon Free** | Híbrido | **$0/mes** (suele pedir tarjeta antifraude) | Frankfurt + Frankfurt | Bueno (0.1 vCPU limitado) | Duerme tras 1 h (despierta en 1–5 s) | Viable gratis, pero el salto a Pro es caro ($29/mes) |
| **Render (Free)** | Todo en uno | **$0/mes** *(solo 30 días en Postgres)* | Frankfurt | Limitado por sleep | **Duerme a los 15 min (~60 s cold start)** y **PG se borra a los 30 días** | ❌ Descartado para uso real gratuito |
| **Render (Starter + PG pago)** | Todo en uno | **~$13–$14/mes** ($7 app + $6–7 PG) | Frankfurt | Bueno (con ping 20 s) | Always-on | Sencillo, pero más del doble que Railway/Fly+Neon |
| **DigitalOcean App Platform** | Todo en uno | **$12–$20+/mes** ($5 app + $7 Dev PG / $15 Managed PG) | Ámsterdam / Frankfurt | Bueno | Always-on | Sólido, pero menos competitivo en precio inicial |
| **Zeabur** | — | — | — | — | — | ❌ **Descartado** (anunció cierre a finales de 2026) |

### Recomendación final de hosting

1. **Si quieres la mejor experiencia *calidad / precio / cero dolores de cabeza*:**  
   **Railway Hobby ($5/mes) + Neon PostgreSQL Free ($0/mes)** → **Total: $5/mes fijos.**  
   Despliegue automático al hacer `git push`, logs en vivo, HTTPS automático, región en Europa, sin cold starts de 1 minuto y con 1 GB de PostgreSQL real que escala a cero cuando nadie entra. Si prefieres no gestionar dos cuentas (Railway + Neon), **Railway Todo-en-Uno** son solo ~$1–$5 más al mes.

2. **Si priorizas el *mínimo coste mensual* en producción seria (y latencia mínima en España):**  
   **Fly.io (`shared-cpu-1x`, 256 MB RAM en Madrid `mad` o Frankfurt `fra`) + Neon Free** → **Total: ~$2.50/mes.**  
   Un poco más técnico en la configuración inicial (`fly.toml` + `flyctl`), pero rapidísimo desde España y baratísimo.

3. **Si quieres empezar a *0 € absolutos* para probar con amigos antes de pagar nada:**  
   - **Northflank Sandbox ($0/mes)** si quieres app + Postgres siempre encendidos sin tarjeta.
   - O **Railway Free / Koyeb Free + Neon Free ($0/mes)** sabiendo que puede haber un breve despertar tras inactividad y que luego migrar a Railway Hobby ($5) o Fly.io ($2.50) es inmediato porque el contenedor Docker y `DATABASE_URL` son idénticos.

> **Portabilidad garantizada:** Si empaquetamos Shalendar con un `Dockerfile` estándar + variable `DATABASE_URL` (PostgreSQL), cambiar entre Northflank, Railway, Fly.io o Render lleva **menos de 5 minutos** sin tocar una línea de código.

---

## 3. Arquitectura PostgreSQL + Persistencia Adaptativa (100 % sin cuentas)

### 3.1. Espectro de persistencia por quedada (`retention_policy`)

Al crear una quedada, el usuario mantiene la misma fluidez actual (solo título y su nombre), y dentro de *«Opciones extra»* (o con un selector compacto) puede adaptar la memoria del plan:

| Modo | Código | Duración / Limpieza | Ideal para |
| --- | --- | --- | --- |
| **Efímero *(por defecto)*** | `ephemeral_after_event` | Se borra automáticamente **14 días después de la fecha confirmada** (o tras **30 días sin actividad** si no se confirmó fecha). | Cenas, quedadas puntuales. Privacidad por diseño y BD siempre ligera. |
| **Exprés / Temporal** | `fixed_ttl` | El organizador elige **24 h**, **7 días** o **30 días** exactos desde la creación. | Planes rápidos o enlaces desechables. |
| **Mientras siga vivo** | `sliding_inactivity` | No caduca mientras alguien participe; se borra tras **90 días de inactividad total**. | Viajes o grupos que deciden con calma. |
| **Persistente** | `persistent` | `expires_at = NULL` (no caduca automáticamente). El organizador puede borrarla manualmente cuando quiera. | Grupos recurrentes (pádel, rol, equipo, familia). |

Además, **cualquier quedada** (efímera o persistente) incluirá:
- **Aviso visual de caducidad:** cuando falten ≤ 5 días para `expires_at`, un aviso discreto permite al organizador **Extender +30 días** o pasarla a **Persistente** en 1 clic.
- **Exportar / Clonar (`.json`):** descarga local del snapshot para guardar historial propio o crear una quedada nueva reutilizando participantes.
- **Borrado inmediato («Borrar quedada ahora»):** disponible para el organizador con su `adminToken`.

### 3.2. Esquema PostgreSQL propuesto

Migración directa desde el SQLite actual (`server/db.ts`), usando tipos nativos de PostgreSQL e índices optimizados para limpieza TTL:

```sql
CREATE TABLE IF NOT EXISTS plans (
  id                  TEXT PRIMARY KEY,
  slug                TEXT NOT NULL UNIQUE,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  location            TEXT NOT NULL DEFAULT '',
  emoji               TEXT NOT NULL DEFAULT '🍕',
  start_month         TEXT NOT NULL,
  end_month           TEXT NOT NULL,
  max_votes_per_user  INTEGER NOT NULL DEFAULT 3,
  voting_open         BOOLEAN NOT NULL DEFAULT TRUE,
  confirmed_date      TEXT,
  confirmed_time      TEXT,
  admin_token_hash    TEXT NOT NULL,
  visibility          TEXT NOT NULL DEFAULT 'unlisted'
                      CHECK (visibility IN ('unlisted', 'public_demo')),
  retention_policy    TEXT NOT NULL DEFAULT 'ephemeral_after_event'
                      CHECK (retention_policy IN (
                        'ephemeral_after_event',
                        'fixed_ttl',
                        'sliding_inactivity',
                        'persistent'
                      )),
  retention_days      INTEGER NOT NULL DEFAULT 30,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS participants (
  id                  TEXT PRIMARY KEY,
  plan_id             TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  avatar_color        TEXT NOT NULL,
  avatar_emoji        TEXT NOT NULL,
  is_organizer        BOOLEAN NOT NULL DEFAULT FALSE,
  edit_token_hash     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unicidad case-insensitive equivalente a UNIQUE(plan_id, name COLLATE NOCASE)
CREATE UNIQUE INDEX IF NOT EXISTS uq_participants_plan_lower_name
  ON participants (plan_id, LOWER(name));

CREATE TABLE IF NOT EXISTS availabilities (
  plan_id             TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  participant_id      TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  date                TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('yes', 'maybe', 'no')),
  note                TEXT NOT NULL DEFAULT '',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (plan_id, participant_id, date)
);

CREATE TABLE IF NOT EXISTS poll_options (
  plan_id             TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  date                TEXT NOT NULL,
  label               TEXT NOT NULL DEFAULT '',
  proposed_by         TEXT REFERENCES participants(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (plan_id, date)
);

CREATE TABLE IF NOT EXISTS votes (
  plan_id             TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  participant_id      TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  date                TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (plan_id, participant_id, date)
);

CREATE TABLE IF NOT EXISTS comments (
  id                  TEXT PRIMARY KEY,
  plan_id             TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  participant_id      TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  date                TEXT,
  body                TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_avail_plan ON availabilities (plan_id);
CREATE INDEX IF NOT EXISTS idx_votes_plan ON votes (plan_id);
CREATE INDEX IF NOT EXISTS idx_comments_plan_created ON comments (plan_id, created_at DESC);
-- Índice parcial: solo indexa planes con caducidad para que el barrido TTL sea instantáneo
CREATE INDEX IF NOT EXISTS idx_plans_expires_at
  ON plans (expires_at)
  WHERE expires_at IS NOT NULL;
```

### 3.3. Reglas clave para PostgreSQL serverless (Neon) + SSE

Si usamos **Neon Free** (o cualquier Postgres con *scale-to-zero*), 4 detalles técnicos hacen que el consumo sea mínimo y la UX perfecta:

1. **Pool de conexiones ligero (`pg`):**
   - `max: 5` (o `10` usando el *pooled connection string* de Neon con PgBouncer).
   - `idleTimeoutMillis: 15_000` (15 s) para cerrar conexiones inactivas y permitir que Neon escale a cero a los 5 minutos sin gastar CU-hours en vacío.
2. **SSE en memoria (`PlanEventHub`), no en BD:**
   - Mientras estemos en 1 instancia Node (sobrado para miles de usuarios simultáneos), el stream `/api/plans/:slug/stream` se alimenta desde `PlanEventHub` en RAM. **El ping cada 20 s no toca PostgreSQL**, así que tener pestañas abiertas mirando un calendario sin editar **no mantiene despierta la BD**.
   - Si algún día escalamos a ≥ 2 réplicas, la interfaz `RealtimeBus` permite conectar `LISTEN/NOTIFY` de PostgreSQL o Redis Pub/Sub sin cambiar `app.ts`.
3. **Limpieza de caducados sin despertar la BD innecesariamente:**
   - **Expiración perezosa (*lazy*):** al leer `GET /api/plans/:slug`, si `expires_at <= NOW()`, se elimina ese plan (o se marca vencido) y se devuelve `410 Gone`.
   - **Barrido de fondo espaciado:** en lugar de un `setInterval` cada minuto (que despertaría Neon 24/7), ejecutar la purga **solo 1 vez cada 12–24 horas** (o mediante un endpoint protegido con secreto llamado por cron diario).
4. **Migraciones versionadas:**
   - Añadir una tabla `schema_migrations(version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ)` y ejecutar migraciones idempotentes al arrancar el servidor (`runMigrations(pool)`).

### 3.4. Identidad 100 % sin cuentas (flujo completo)

Sin registro, sin contraseñas y sin emails, garantizando buena UX y privacidad:

- **En la portada (`/`):**
  - El navegador lee `shalendar:recent-plans` de `localStorage` y envía los slugs (máx. 15) a `POST /api/plans/summaries` para mostrar **solo las quedadas de ese usuario** con su estado actualizado (y retirar automáticamente de la lista las que hayan caducado).
  - La demo (`cena-reencuentro`) es el único plan con `visibility = 'public_demo'`.
- **Al crear una quedada:**
  - El servidor devuelve `adminToken` una sola vez (en BD solo se guarda `SHA-256(adminToken)`).
  - Se guarda en `localStorage` (`shalendar:admin:<slug>`) **y** en el modal de compartir se ofrece copiar el **«Enlace privado de organizador»** (`/e/<slug>#admin=<token>`). Como va en el fragmento `#`, nunca se envía al servidor ni aparece en logs de proxy; el frontend lo lee al abrir, lo guarda en `localStorage` y limpia el `#` de la URL con `history.replaceState`.
- **Al unirse un amigo:**
  - El servidor devuelve un `editToken` ligero guardado en `localStorage` (`shalendar:token:<slug>`).
  - Las escrituras de ese participante envían `X-Participant-Token` (o `X-Admin-Token` si es el organizador).
- **Seguridad mínima adicional:**
  - Slugs de alta entropía: `slugify(title) + '-' + base64url(8 bytes)` (~64 bits aleatorios).
  - Cabecera `X-Robots-Tag: noindex, nofollow` en `/e/*`.
  - Rate limiting en memoria en Hono (p. ej. 10 planes/hora por IP, 90 escrituras/min por IP) + límites por plan (máx. 100 participantes, 200 comentarios).

---

## 4. Plan de implementación (listo para ejecutar tras sincronizar con `master`)

Cuando los cambios de los otros agentes estén commiteados en `master` (o cuando me indiques que rebase/integre esta rama), el trabajo de código queda dividido en 5 pasos limpios:

1. **Capa de repositorio asíncrona + PostgreSQL (`server/db/`):**
   - Definir interfaz `PlanRepository` y migrar `ShalendarDB` a `PostgresPlanRepository` (usando `pg` + migraciones SQL + soporte `DATABASE_URL`).
   - Añadir `docker-compose.yml` para desarrollo local con PostgreSQL en 1 comando (`docker compose up -d`).
2. **Persistencia adaptativa + limpieza TTL:**
   - Añadir campos `retentionPolicy`, `retentionDays`, `expiresAt`, `lastActivityAt` en `shared/types.ts`, API y UI (`HomePage` + barra de estado / botón *Extender* / *Exportar JSON* / *Borrar* en `PlanView`).
3. **Privacidad y seguridad sin cuentas:**
   - Reemplazar `GET /api/plans` global por `POST /api/plans/summaries` + `GET /api/plans/demo`.
   - Verificar `X-Admin-Token` y `X-Participant-Token`, subir entropía de slugs, añadir enlace de recuperación `#admin=...`, `X-Robots-Tag: noindex` y rate limiting.
4. **Empaquetado de despliegue:**
   - Crear `Dockerfile` multi-stage (Node 22 Alpine, build Vite + `tsc`, usuario no-root, healthcheck `/api/health`) + `.dockerignore` + configuración mínima del PaaS elegido (`railway.toml` o `fly.toml`).
5. **Tests de integración:**
   - Adaptar la suite de Vitest para validar ciclo completo: creación con distintas políticas de retención, expiración `410 Gone`, aislamiento de privacidad (`summaries`), tokens de admin y SSE.
