# =====================================================================
# ELIZA Foundation Platform — Production Dockerfile (multi-arch)
# =====================================================================
# Build multi-stage:
#   1. deps      — instala dependencias (cache layer) y genera Prisma client
#   2. builder   — compila TS y poda devDependencies
#   3. runner    — imagen final mínima, non-root, sin código fuente
#
# Base: node:22-slim (Debian), NO Alpine.
#   - La VM de destino es OCI A1 Flex = ARM64. Prisma en Alpine/ARM64
#     falla con OpenSSL; en Debian slim el engine nativo funciona.
#   - El Prisma client se genera DENTRO de la imagen, así que el engine
#     corresponde siempre a la arquitectura del build (amd64 o arm64).
#
# Build para la VM (desde x86 con buildx + QEMU):
#   docker buildx build --platform linux/arm64 -t eliza-foundation .
# =====================================================================

# ---------- Stage 1: dependencies ----------
FROM node:22-slim AS deps

WORKDIR /app

# openssl: requerido por el engine de Prisma en generate y runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# pnpm vía corepack, versión fijada por "packageManager" en package.json
RUN corepack enable

# Copiar SOLO los manifiestos para aprovechar cache de Docker
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma/schema.prisma ./prisma/schema.prisma

# Instalar TODAS las deps (incluye devDeps para el build)
RUN pnpm install --frozen-lockfile

# Generar Prisma client para la arquitectura de esta imagen
RUN pnpm prisma generate


# ---------- Stage 2: builder ----------
FROM node:22-slim AS builder

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable

# Reusar el node_modules de la stage anterior (incluye el client generado)
COPY --from=deps /app/node_modules ./node_modules

# Copiar el resto del proyecto
COPY . .

# Compilar TS → JS en /app/dist
RUN pnpm build

# Podar devDependencies para la imagen final
RUN pnpm prune --prod


# ---------- Stage 3: runner ----------
FROM node:22-slim AS runner

WORKDIR /app

# openssl (Prisma engine), tini (PID 1 correcto), ca-certificates (TLS saliente)
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

# Usuario y grupo no-privilegiados con UID/GID fijos
RUN groupadd --gid 1001 eliza \
 && useradd --uid 1001 --gid eliza --shell /usr/sbin/nologin --no-create-home eliza

# Copiar SOLO lo necesario para correr
COPY --from=builder --chown=eliza:eliza /app/dist         ./dist
COPY --from=builder --chown=eliza:eliza /app/node_modules ./node_modules
COPY --from=builder --chown=eliza:eliza /app/package.json ./package.json
COPY --from=builder --chown=eliza:eliza /app/prisma       ./prisma

# Directorio writable para tmp si la app lo necesita
RUN mkdir -p /tmp/eliza && chown eliza:eliza /tmp/eliza

USER eliza

ENV NODE_ENV=production \
    APP_PORT=3000 \
    TZ=UTC \
    NODE_OPTIONS="--enable-source-maps"

EXPOSE 3000

# Healthcheck sin wget/curl (no vienen en slim): usa el fetch nativo de Node 22
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini como PID 1 — propaga SIGTERM para graceful shutdown, así el
# OutboxDispatcher puede terminar su batch antes de morir.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
