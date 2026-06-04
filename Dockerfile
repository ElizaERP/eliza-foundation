# =====================================================================
# ELIZA Foundation Platform — Production Dockerfile
# =====================================================================
# Build multi-stage:
#   1. deps      — instala solo dependencias de prod (cache layer)
#   2. builder   — compila TS y genera Prisma client
#   3. runner    — imagen final mínima, non-root, sin código fuente
#
# Tamaño final esperado: ~280MB con la base de node-alpine y Prisma client.
# =====================================================================

# ---------- Stage 1: dependencies ----------
FROM node:20-alpine AS deps

WORKDIR /app

# pnpm via corepack (sin instalar globalmente)
RUN corepack enable && corepack prepare pnpm@9 --activate

# Copiar SOLO los manifiestos para aprovechar cache de Docker
COPY package.json pnpm-lock.yaml ./
COPY prisma/schema.prisma ./prisma/schema.prisma

# Instalar TODAS las deps (incluye devDeps para el build)
RUN pnpm install --frozen-lockfile

# Generar Prisma client en esta capa para reusar
RUN pnpm prisma generate


# ---------- Stage 2: builder ----------
FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

# Reusar el node_modules de la stage anterior
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma

# Copiar el resto del proyecto
COPY . .

# Compilar TS → JS en /app/dist
RUN pnpm build

# Podar devDependencies para la imagen final
RUN pnpm prune --prod


# ---------- Stage 3: runner ----------
FROM node:20-alpine AS runner

WORKDIR /app

# Crear usuario y grupo no-privilegiados con UID/GID fijos
RUN addgroup -g 1001 eliza && \
    adduser -D -u 1001 -G eliza -s /sbin/nologin eliza

# Herramientas necesarias: openssl (Prisma engine), tini (PID 1 correcto)
RUN apk add --no-cache openssl tini

# Copiar SOLO lo necesario para correr
COPY --from=builder --chown=eliza:eliza /app/dist                ./dist
COPY --from=builder --chown=eliza:eliza /app/node_modules        ./node_modules
COPY --from=builder --chown=eliza:eliza /app/package.json        ./package.json
COPY --from=builder --chown=eliza:eliza /app/prisma              ./prisma

# Crear directorio writable para tmp si la app lo necesita
RUN mkdir -p /tmp/eliza && chown eliza:eliza /tmp/eliza

USER eliza

ENV NODE_ENV=production \
    APP_PORT=3000 \
    TZ=UTC \
    NODE_OPTIONS="--enable-source-maps"

EXPOSE 3000

# Healthcheck — la imagen sabe verificarse a sí misma
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q --spider http://localhost:3000/health || exit 1

# tini como PID 1 — propaga SIGTERM correctamente para graceful shutdown
# que el OutboxDispatcher pueda terminar su batch antes de morir.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
