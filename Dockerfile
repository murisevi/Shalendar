# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# 1. Install all dependencies (including devDependencies for Vite + tsc build)
FROM base AS deps
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci

# 2. Build frontend (dist/client) and backend (dist/server)
FROM deps AS build
COPY . .
RUN npm run build

# 3. Install production-only dependencies
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 4. Minimal production runtime image
FROM base AS runner
ENV PORT=3001
ENV HOST=0.0.0.0

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server/persistence/migrations ./server/persistence/migrations

# Pre-create writable data directory for non-root user (SQLite fallback or mounted volume)
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--no-warnings", "dist/server/server/index.js"]
