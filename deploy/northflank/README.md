# Despliegue gratuito en Northflank (Developer Sandbox — $0/mes)

## Por qué hemos elegido Northflank Developer Sandbox como PaaS gratuito

Entre las opciones gratuitas evaluadas para **Node.js 22 + SSE + PostgreSQL**, **Northflank Developer Sandbox** es la más equilibrada para empezar a **0 €/mes reales**:

- **Siempre encendido (sin *cold starts*):** al abrir un enlace desde WhatsApp la app responde al instante (a diferencia de Render Free ~60 s o Koyeb Free).
- **Sin tarjeta de crédito obligatoria** en el plan Sandbox.
- **Todo en un solo sitio:** incluye hasta **2 servicios + 1 base de datos PostgreSQL + 2 cron jobs**, y además soporta Dockerfiles estándar (`Dockerfile` en la raíz del repo).
- **Sin caducidad de 30 días** en la base de datos (a diferencia de Render Free Postgres).
- **Portabilidad total:** como todo depende únicamente de `Dockerfile` y `DATABASE_URL`, si algún día quieres moverlo a **Fly.io + Neon (~$2.50/mes)** o **Railway + Neon ($5/mes)** no hay que cambiar el código.

---

## Despliegue rápido (2 formas)

### Opción A — Desde el template JSON (recomendada)

1. Asegúrate de fusionar esta rama (`docs/deploy-and-persistence`) en `master` y hacer `git push origin master` a `https://github.com/murisevi/Shalendar.git`.
2. En **Northflank → Templates → Create new template → Code**, pega el contenido de [`template.json`](./template.json) (ya viene preconfigurado con `https://github.com/murisevi/Shalendar.git` y rama `master`).
3. Si el repositorio es privado, vincula tu cuenta de GitHub en Northflank antes de ejecutar el template y selecciona la autenticación GitHub.
4. Ejecuta el template: creará automáticamente:
   - El proyecto `shalendar` en `europe-west`.
   - El addon **PostgreSQL 16** (`shalendar-postgres`).
   - El servicio **Combined** (`shalendar-web`) compilando el `Dockerfile`, enlazando `DATABASE_URL` por secreto interno y verificando `/api/health`.

### Opción B — Manual en la UI de Northflank (5 minutos)

1. **Create Project:** nombre `shalendar`, región `europe-west`, plan **Developer Sandbox (Free)**.
2. **Create Addon → PostgreSQL 16:** nombre `shalendar-postgres` (tier gratuito Sandbox).
3. **Create Secret Group** (o enlazar desde el Addon): expón `POSTGRES_URI` / `CONNECTION_STRING` como variable `DATABASE_URL`.
4. **Create Service → Combined Service:**
   - **Repository:** tu repo en GitHub, rama `master`.
   - **Build options:** `Dockerfile`, ruta `/Dockerfile`.
   - **Ports:** `3001` (HTTP, público).
   - **Environment variables:**
     - `NODE_ENV=production`
     - `PORT=3001`
     - `DATABASE_URL` (enlazada al secreto de `shalendar-postgres`)
     - `DATABASE_SSL=auto`
     - `DEFAULT_RETENTION_POLICY=ephemeral_after_event`
     - `DEFAULT_RETENTION_DAYS=30`
     - `POST_EVENT_GRACE_DAYS=14`
     - `PURGE_INTERVAL_HOURS=12`
     - `ALLOW_PUBLIC_DEMO=true`
   - **Health checks:** HTTP `GET /api/health` en puerto `3001`.

---

## Variación opcional: usar Neon Free como PostgreSQL externo

Si prefieres separar la base de datos (por ejemplo para tener **1 GB gratis + branching de BD** en Neon `eu-central-1` Frankfurt):

1. No crees el Addon de Postgres en Northflank (ahorras cuota de Sandbox).
2. Crea un proyecto gratuito en [Neon](https://neon.tech) en `AWS Frankfurt (eu-central-1)` y copia el **pooled connection string**.
3. Configura en Northflank:
   - `DATABASE_URL=<tu-neon-pooled-url>`
   - `DATABASE_SSL=true`
   - `DATABASE_POOL_MAX=5`
   - `DATABASE_IDLE_TIMEOUT_MS=15000`
   - `PURGE_INTERVAL_HOURS=24` (para dejar que Neon escale a cero durante el día).
