# Diseño de Despliegue, Base de Datos y Persistencia Adaptativa para Shalendar

> **Estado:** Propuesta arquitectónica (rama aislada `docs/deploy-and-persistence`).  
> **Objetivo:** Definir cómo desplegar Shalendar para uso público multiusuario y cómo diseñar una capa de persistencia flexible —desde planes efímeros hasta calendarios persistentes— que se adapte a las necesidades de cada usuario sin perder la filosofía de **cero fricción y sin registro obligatorio**.

---

## 1. Diagnóstico del estado actual

Tras revisar el código actual de Shalendar (`server/db.ts`, `server/app.ts`, `server/events.ts`, `server/index.ts`, `shared/types.ts` y `src/lib/storage.ts`), el proyecto ya tiene una base limpia y fácil de desplegar como monolito ligero, pero presenta **6 puntos críticos** antes de abrirlo a terceros:

| Área | Estado actual | Implicación en despliegue público |
| --- | --- | --- |
| **Base de datos** | `node:sqlite` (`DatabaseSync`, síncrono) sobre archivo local `data/shalendar.db` en modo WAL. | En plataformas sin disco persistente (p. ej. Vercel o contenedores efímeros), los datos se pierden en cada deploy o reinicio. Además, la API síncrona acopla `server/app.ts` a SQLite local. |
| **Tiempo real (SSE)** | `PlanEventHub` en memoria (`Map<string, Set<Listener>>`) sirviendo `/api/plans/:slug/stream` con *ping* cada 20 s. | Funciona perfecto en una única instancia con proceso persistente, pero **no funciona** en funciones *serverless* de corta duración ni en despliegues horizontales con varias réplicas sin un bus pub/sub. |
| **Privacidad del listado** | `GET /api/plans` ejecuta `listPublicPlans(15)` y muestra todas las quedadas de la BD en la portada. | En un entorno multiusuario, cualquier visitante vería las quedadas privadas de otros grupos. |
| **Autorización** | `createPlan` genera un `admin_token` guardado en `localStorage`, pero `PATCH /api/plans/:slug` y los `DELETE` todavía no lo validan en servidor. | Cualquiera con el enlace podría borrar participantes, cerrar votaciones o cambiar la fecha confirmada. |
| **Entropía de enlaces (`slug`)** | `slug` añade solo 4 caracteres hexadecimales (~65.536 combinaciones por título). | Si el acceso es "privado por enlace" (*capability URL*), 16 bits son enumerables por fuerza bruta. Conviene subir a 10–12 caracteres base36/nanoid (≥ 60 bits). |
| **Ciclo de vida de los datos** | No hay `expires_at`, `last_activity_at`, políticas de retención ni limpieza automática. | La BD crecería indefinidamente y retendría datos personales (nombres, disponibilidad, comentarios) aunque la quedada haya terminado hace meses. |

---

## 2. Persistencia adaptativa: «persistente o no persistente del todo»

Una de las mayores fortalezas de Shalendar es que no obliga a crear cuenta. Pero no todos los usuarios usan una app de quedadas igual: quien organiza una cena este sábado quiere **cero rastro** después; un grupo que queda todos los meses quiere un **calendario que no desaparezca**.

La propuesta es tratar la persistencia como un **espectro configurable por quedada**, con un valor por defecto sensato y sin fricción.

### 2.1. Modos de retención por quedada (`retention_policy`)

Al crear una quedada (en el bloque desplegable *«Opciones extra»*, con un valor por defecto ya seleccionado), el organizador elige cuánto debe vivir el plan:

| Modo | Código | Comportamiento | Caso de uso ideal |
| --- | --- | --- | --- |
| **Efímero (recomendado por defecto)** | `ephemeral_after_event` | Vive mientras se organiza y se **auto-elimina 14 días después de la fecha confirmada** (o tras 30 días de inactividad si nunca se confirmó fecha). | Cenas, escapadas puntuales, reuniones únicas. Máxima privacidad y mínimo uso de BD. |
| **Temporal fijo (TTL)** | `fixed_ttl` | El usuario elige caducidad exacta: **24 h**, **7 días** o **30 días** desde su creación. | Planes relámpago (*«¿quién puede esta semana?»*) o uso tipo *burner link*. |
| **Vivo por actividad (deslizante)** | `sliding_inactivity` | Se mantiene activo indefinidamente **mientras haya actividad** (votos, disponibilidad o comentarios). Caduca automáticamente tras **90 días de inactividad total**. | Viajes largos o grupos que deciden sin prisa. |
| **Persistente** | `persistent` | Sin caducidad automática en servidor (o sujeto solo a una política global de archivo en frío tras 1 año sin visitas). Puede archivarse o borrarse manualmente con el token de organizador. | Grupos recurrentes (pádel, rol, equipo de trabajo, familia). |

> **Modo extra opcional (cliente / portátil): «Copia local y clonado»**  
> Cualquier plan —incluso uno efímero a punto de caducar— ofrece:
> - **Descargar copia (`.json`)**: guarda el snapshot completo en el dispositivo del usuario.
> - **Clonar / Reabrir desde archivo**: permite recrear una quedada nueva partiendo de los participantes o estructura anterior sin depender de almacenamiento perpetuo en servidor.
> - **Modo «Solo mi navegador» (borrador local)** *(opcional futuro)*: si alguien quiere probar o preparar una propuesta antes de publicarla, vive solo en `localStorage`/IndexedDB hasta que pulse *Publicar y compartir*.

### 2.2. Memoria del usuario sin obligar a registrarse

Hay dos capas de memoria distintas: **la de la quedada** (en servidor) y **la del usuario** (qué quedadas ha visitado y quién es en cada una):

1. **Nivel 0 — Sin cuenta (actual, mejorado):**
   - `localStorage` ya guarda `shalendar:me:<slug>`, `shalendar:admin:<slug>` y `shalendar:recent-plans`.
   - **Mejora clave:** la portada deja de consultar un listado global de quedadas de otros usuarios (`GET /api/plans`) y en su lugar muestra **solo «Tus quedadas recientes»** (leyendo los slugs de `localStorage` y pidiendo su estado actual por lote: `POST /api/plans/batch-summary`) + opcionalmente la quedada demo pública (`cena-reencuentro`).
   - **Recuperación de organizador:** al crear la quedada, ofrecer un **«Enlace privado de organizador»** (p. ej. `/e/<slug>#admin=<token>` en el fragmento `#` para que no viaje en logs HTTP ni referers) por si cambia de navegador o borra cookies.
2. **Nivel 1 — Código de sincronización portátil (sin email ni contraseña):**
   - El usuario puede pulsar *«Llevar mis quedadas a otro dispositivo»* y obtiene un enlace/QR temporal o un token de sesión ligera que sincroniza su lista de slugs recientes y sus tokens de participante/organizador (opcionalmente cifrados en cliente).
3. **Nivel 2 — Cuentas ligeras opcionales (solo si el producto crece):**
   - *Magic link* por email o *Passkey* (WebAuthn), **100 % opcional**. Desbloquea: historial permanente entre dispositivos, retención `persistent` ampliada y panel de gestión de tus quedadas activas.

### 2.3. Cómo funciona la caducidad y limpieza en servidor

Para que la retención sea fiable y no deje basura huérfana:

1. **Columnas nuevas en `plans`:**
   ```sql
   visibility TEXT NOT NULL DEFAULT 'unlisted' CHECK(visibility IN ('unlisted', 'public_demo')),
   retention_policy TEXT NOT NULL DEFAULT 'ephemeral_after_event'
     CHECK(retention_policy IN ('ephemeral_after_event', 'fixed_ttl', 'sliding_inactivity', 'persistent')),
   retention_days INTEGER NOT NULL DEFAULT 30,
   last_activity_at TEXT NOT NULL,
   expires_at TEXT,          -- NULL solo si retention_policy = 'persistent'
   archived_at TEXT          -- opcional: fase intermedia de solo lectura antes de borrado definitivo
   ```
2. **Recálculo automático de `expires_at`:**
   - Al crear el plan: se calcula según `retention_policy` y `retention_days`.
   - En cada mutación (disponibilidad, voto, comentario, nuevo participante): se actualiza `last_activity_at = now`. Si la política es `sliding_inactivity`, se extiende `expires_at = now + retention_days`.
   - Al confirmar fecha (`confirmed_date`): si la política es `ephemeral_after_event`, `expires_at = confirmed_date + 14 días`.
3. **Borrado en dos fases (opcional y amigable):**
   - **Aviso en UI:** cuando falten ≤ 5 días para `expires_at`, la cabecera del plan muestra un badge discreto (*«Esta quedada se borrará en 4 días · Extender / Exportar»*).
   - **Expiración perezosa (*lazy*):** `getPlanSnapshotBySlug` comprueba si `expires_at < now`; si venció, responde `410 Gone` con un mensaje claro (*«Esta quedada caducó y sus datos se eliminaron»*).
   - **Barrido periódico (*cron / interval*):** un job ligero cada hora ejecuta `DELETE FROM plans WHERE expires_at IS NOT NULL AND expires_at < ?` (el `ON DELETE CASCADE` ya existente en `server/db.ts` limpia automáticamente `participants`, `availabilities`, `poll_options`, `votes` y `comments`).

---

## 3. Opciones de base de datos

El modelo de datos de Shalendar es **relacional, pequeño y de alta lectura / escritura moderada**: un plan típico tiene 3–25 participantes, 30–150 celdas de disponibilidad y decenas de votos/comentarios (~5–20 KB por plan). Incluso con **10.000 quedadas activas**, la base de datos ocuparía menos de **200 MB**.

### Comparativa de motores

| Opción | Cómo encaja con Shalendar | Pros | Contras | Coste orientativo |
| --- | --- | --- | --- | --- |
| **A. SQLite + Volumen persistente + Litestream (backup a S3/R2)** | Mantiene casi intacto el SQL actual (`node:sqlite` o `better-sqlite3`). | Latencia sub-milisegundo, cero servicios externos de BD, backups incrementales continuos a Cloudflare R2 (~0 €), sencillísimo de operar. | Un solo nodo escritor (escalado vertical, aunque aguanta miles de usuarios concurrentes sin despeinarse). | **0–5 €/mes** (incluido en VPS / Fly.io / Railway + R2 gratis). |
| **B. Turso (libSQL / SQLite gestionado)** | Mismo dialecto SQLite, pero accesible por HTTP/WebSocket con `@libsql/client`. | Compatible con contenedores *stateless* y *serverless*, réplicas globales, *branching* de BD, tier gratuito muy generoso (5–9 GB / millones de lecturas). | Requiere pasar `ShalendarDB` a métodos `async`; añade ~5–25 ms de latencia de red por consulta. | **0 €/mes** (tier gratis amplio) → desde ~29 $/mes si escala mucho. |
| **C. PostgreSQL gestionado (Neon / Supabase / Railway Postgres)** | Estándar de industria. Permite usar `LISTEN/NOTIFY` para sincronizar SSE entre múltiples réplicas. | Escalado horizontal real, ecosistema maduro, backups PITR, JSONB y transacciones concurrentes robustas. | Requiere adaptar pequeñas diferencias SQL (`INTEGER` boolean, `COLLATE NOCASE` → `CITEXT` o `LOWER()`), pasar el repositorio a `async` y gestionar pool de conexiones. | **0 €/mes** (Neon/Supabase free) → **5–20 €/mes** producción sin pausas. |
| **D. Cloudflare D1 + Durable Objects** | Arquitectura 100 % *edge*. Cada quedada (`slug`) puede ser un **Durable Object** con su propio SQLite embebido + WebSocket/SSE nativo. | Escalado casi infinito, latencia mínima global, tiempo real trivial por sala (`slug`), coste casi nulo en tráfico bajo/medio. | Mayor reescritura (salir de `@hono/node-server` y `node:sqlite`, adaptar a Cloudflare Workers) y cierto *vendor lock-in*. | **0–5 €/mes** (Workers Paid 5 $/mes incluye DO + D1 muy generosos). |

### Desacoplamiento imprescindible: interfaz `PlanRepository` asíncrona

Sea cual sea la BD elegida, el primer refactor técnico (limpio y de bajo riesgo) es extraer una interfaz asíncrona en `server/storage/repository.ts`:

```ts
export interface PlanRepository {
  getPlanSnapshotBySlug(slug: string): Promise<PlanSnapshot | null>;
  createPlan(input: CreatePlanInput): Promise<CreatePlanResult>;
  addParticipant(planId: string, input: JoinPlanInput): Promise<Participant>;
  deleteParticipant(planId: string, participantId: string): Promise<boolean>;
  setAvailabilityBatch(planId: string, participantId: string, changes: AvailabilityChange[]): Promise<void>;
  nominateDate(planId: string, date: string, label: string, proposedBy: string | null): Promise<void>;
  removePollOption(planId: string, date: string): Promise<void>;
  toggleVote(planId: string, participantId: string, date: string): Promise<{ voted: boolean }>;
  addComment(planId: string, participantId: string, body: string, date: string | null): Promise<CommentEntry>;
  updatePlanSettings(slug: string, updates: UpdatePlanSettingsInput): Promise<Plan | null>;
  purgeExpiredPlans(nowIso?: string): Promise<number>;
}
```

Y hacer lo mismo para tiempo real con `RealtimeBus`:
- `InMemoryEventHub` (1 instancia: Fly.io / Railway / VPS).
- `PostgresEventBus` o `RedisEventBus` (si algún día hay ≥ 2 réplicas).

Con esto, el mismo código de `server/app.ts` puede correr en desarrollo con `SqlitePlanRepository` local (`:memory:` en tests, archivo en local) y en producción con **SQLite persistente**, **Turso** o **PostgreSQL** cambiando solo una variable de entorno (`DATABASE_URL` / `STORAGE_DRIVER`).

---

## 4. Opciones de despliegue

El factor decisivo para desplegar Shalendar es el **SSE de larga duración** (`/api/plans/:slug/stream`) y la **simplicidad operativa** de servir frontend (`dist/client`) + backend (`dist/server`) desde un único proceso Node 22.

| Plataforma | Compatibilidad con SSE actual | Persistencia SQLite local | Esfuerzo de migración | Coste estimado | Veredicto |
| --- | --- | --- | --- | --- | --- |
| **1. Fly.io (1 máquina + Volumen + Docker)** | Excelente (proceso persistente, proxy soporta SSE largo). | Sí (Volumen montado en `/data` + backup opcional Litestream a R2). | **Muy bajo** (solo añadir `Dockerfile` y `fly.toml`). | ~2–6 $/mes (puede escalar a 0 si no hay tráfico o quedar 1 VM mínima siempre viva). | **Mejor relación simplicidad/calidad para arrancar rápido.** |
| **2. Railway / Render (Web Service + Disk o Postgres)** | Excelente (servicio Node continuo). | Sí en Railway Volume / Render Persistent Disk, o BD Postgres integrada a 1 clic. | **Muy bajo** (deploy directo desde GitHub). | ~5–7 $/mes (Railway Hobby 5 $; Render Starter 7 $ + disco). | **La más cómoda si no quieres tocar CLI ni infraestructura.** |
| **3. VPS propio (Hetzner / DigitalOcean) + Docker Compose + Caddy** | Excelente (Caddy gestiona HTTPS automático + SSE sin timeouts raros). | Sí (carpeta en host + Litestream o snapshot diario). | **Bajo-Medio** (requiere mantener el servidor/actualizaciones). | **~4 €/mes** (Hetzner CX22 sobradísimo para miles de usuarios). | **Mejor relación potencia/precio y control total.** |
| **4. Cloudflare Workers + Assets + Durable Objects** | Excelente usando Durable Objects (WebSockets/SSE por quedada) y Hono ya es nativo de Workers. | No archivo local; sí SQLite embebido por Durable Object o D1. | **Medio-Alto** (refactor de servidor y capa de persistencia). | **0–5 $/mes**. | **Mejor opción a largo plazo si se espera tráfico viral global con coste mínimo.** |
| **5. Vercel / Netlify (Serverless)** | **Mala** para SSE continuo (timeouts de función y sin estado en memoria compartido). | **No** (sistema de archivos efímero). | **Alto** (obligaría a sustituir SSE por polling o servicio externo tipo Ably/Pusher/Supabase Realtime + BD externa). | 0–20 $/mes. | **Descartada** salvo que se reemplace SSE por Realtime externo. |

---

## 5. Privacidad, seguridad y protección anti-abuso (imprescindible al abrir a terceros)

Abrir Shalendar a internet requiere unos mínimos de seguridad que hoy no hacían falta en local:

1. **Eliminar el escaparate global de quedadas privadas:**
   - `GET /api/plans` no debe devolver quedadas de otros usuarios.
   - Sustituirlo por:
     - `GET /api/plans/demo` (solo la quedada demo pública, idealmente reiniciable o en modo solo-lectura/sandbox).
     - `POST /api/plans/summaries` recibiendo una lista acotada de `slugs` (máx. 15) que el cliente ya conoce en su `localStorage`.
2. **Aumentar la entropía del `slug`:**
   - Pasar de 4 hex chars (`crypto.randomBytes(3).toString('hex').slice(0, 4)`) a mínimo **10–12 caracteres alfanuméricos aleatorios** (`crypto.randomBytes(8).toString('base64url')`, ~64 bits de entropía), manteniendo el prefijo legible opcional (`cena-viernes-a8k3m9p2x1`).
3. **Validar `adminToken` en operaciones sensibles:**
   - Guardarlo **hasheado** (SHA-256) en BD o compararlo con `crypto.timingSafeEqual`.
   - Exigirlo (vía header `X-Admin-Token`) en:
     - `PATCH /api/plans/:slug` (cambiar título, cerrar votación, confirmar fecha, cambiar retención, extender TTL).
     - `DELETE /api/plans/:slug` (borrado inmediato por el organizador: *"Derecho al olvido en 1 clic"*).
     - `DELETE /api/plans/:slug/participants/:id` y `DELETE /api/plans/:slug/poll-options/:date` (o permitir también al propio participante con un `participantToken` ligero devuelto al unirse).
4. **Protección de identidad de participante (opcional pero recomendable):**
   - Al unirse (`POST /api/plans/:slug/participants`), devolver además un `participantToken` guardado en `localStorage` para que otro participante no pueda sobreescribir accidentalmente los días de un amigo enviando otro `participantId` por API.
   - Mantener la opción UX de *"¿Ya te apuntaste desde otro dispositivo? Reclamar mi nombre"* solo si el organizador habilita modo abierto (por defecto en grupos de confianza puede seguir siendo fluido, pero protegiendo la API contra bots).
5. **Límites anti-abuso y *Rate Limiting*:**
   - Límite por IP en creación de planes (p. ej. máx. 10 planes/hora por IP) y en escritura (p. ej. 60 req/min).
   - Cuotas por plan: máx. 100 participantes, máx. 200 comentarios, rango máximo de 12 meses, máx. 15 conexiones SSE simultáneas por IP.
   - Cabeceras `X-Robots-Tag: noindex, nofollow` en `/e/*` para que Google nunca indexe enlaces privados de quedadas.

---

## 6. Recomendación concreta por fases

### Fase 1 — Despliegue rápido, barato y sólido (MVP público)
- **Despliegue:** Contenedor **Docker** único (Node 22 + `dist/client` + `dist/server`) en **Fly.io** o **Railway** (o VPS Hetzner + Caddy si prefieres infraestructura propia).
- **Base de datos:** **SQLite con volumen persistente** + **Litestream** haciendo backup continuo a un bucket gratuito de Cloudflare R2 (o **Turso** si prefieres olvidarte del volumen y de backups manuales).
- **Persistencia adaptativa v1:**
  - Selector sencillo al crear el plan:
    - *Efímero* (por defecto: se borra 14 días tras la fecha confirmada o 30 días sin actividad).
    - *Temporal* (7 días).
    - *Mientras esté activo* (se borra tras 90 días sin cambios).
    - *Persistente* (sin borrado automático; borrable a mano por el organizador).
  - Limpieza automática cada hora + aviso visual cuando falten pocos días + botón **«Exportar copia (.json)»** y **«Borrar ahora»**.
- **Privacidad/Seguridad v1:** Quitar listado global público, slugs con más entropía, validar `X-Admin-Token`, `noindex` en `/e/*` y rate limiting en Hono.

### Fase 2 — Memoria entre dispositivos (cuando haya usuarios recurrentes)
- **Sincronización ligera sin registro** (enlace/QR para copiar tus quedadas recientes y tokens de organizador al móvil/PC).
- **Clonado de quedadas** (*«Repetir esta quedada con los mismos amigos»*).
- **Persistencia en cliente + publicación bajo demanda** (borrador offline).

### Fase 3 — Escalado multi-región (solo si el tráfico lo exige)
- Migrar `PlanRepository` a **Turso** o **PostgreSQL (Neon/Supabase)** y `PlanEventHub` a **Redis / Postgres `LISTEN/NOTIFY`**, o bien migrar la capa de borde a **Cloudflare Workers + Durable Objects** aprovechando que Hono ya es compatible con Workers.

---

## 7. Decisiones abiertas antes de pasar a código

Para implementar la primera versión en cuanto la rama `master` tenga los cambios integrados, conviene confirmar 3 decisiones:

1. **¿Dónde prefieres alojarlo inicialmente?**
   - PaaS sin mantenimiento (**Railway** / **Fly.io**), **VPS propio con Docker**, o directamente **Cloudflare Workers (D1/DO)**.
2. **¿Qué opción de base de datos prefieres para arrancar?**
   - **SQLite en volumen persistente (+ backup Litestream)** — mínimo cambio de código, 1 proceso.
   - **Turso (libSQL)** — SQLite gestionado sin discos que administrar, tier gratis generoso.
   - **PostgreSQL (Neon/Supabase)** — más estándar si prevés cuentas de usuario o analítica compleja más adelante.
3. **Política de persistencia por defecto y cuentas:**
   - ¿Te encaja que el valor por defecto sea **efímero** (p. ej. auto-borrado a los 14 días de la fecha confirmada / 30 días de inactividad) con selector para hacerlo **persistente**?
   - ¿Quieres mantener **cero cuentas** al 100 % en esta fase (solo enlaces/tokens + sincronización portátil) o contemplar ya un login opcional por *magic link*?
