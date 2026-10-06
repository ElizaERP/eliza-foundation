#!/usr/bin/env bash
# =====================================================================
# ELIZA — Fase 0: validación del PR fase-0/baseline con evidencia
# =====================================================================
# Ejecutar en TU MÁQUINA, en la raíz del repo, con la rama fase-0/baseline:
#   bash scripts/fase0/pr-validation.sh            # todo
#   bash scripts/fase0/pr-validation.sh --no-arm64 # sin el build ARM64 (lento con QEMU)
#
# Requiere: Node 22, corepack, Docker con buildx. En Windows: Git Bash o WSL.
#
# Seguridad de tus datos: usa un proyecto de Compose aparte ("eliza-fase0")
# con volúmenes NUEVOS, y al final los borra. Tu volumen de desarrollo no se
# toca, pero tu stack local debe estar detenido (docker compose down, SIN -v)
# porque los contenedores usan los mismos nombres y puertos.
#
# Resultado: fase0-pr-validation-<fecha>.log con PASS/FAIL por paso.
# =====================================================================
set -u

ARM64=1
[ "${1:-}" = "--no-arm64" ] && ARM64=0

LOG="fase0-pr-validation-$(date +%Y%m%d-%H%M%S).log"
PROJECT=eliza-fase0
MIGRATION_URL="postgresql://postgres:postgres@localhost:5432/eliza?schema=public"
PASS=0; FAIL=0; RESULTS=()

log() { echo "$*" | tee -a "$LOG"; }
step() {
  local name="$1"; shift
  log ""; log "▶ $name"
  if ( "$@" ) >>"$LOG" 2>&1; then
    log "  PASS"; PASS=$((PASS+1)); RESULTS+=("PASS  $name")
  else
    log "  FAIL (ver detalle en $LOG)"; FAIL=$((FAIL+1)); RESULTS+=("FAIL  $name")
  fi
}
teardown() { docker compose -p "$PROJECT" down -v >>"$LOG" 2>&1 || true; }

log "ELIZA — validación PR fase-0/baseline — $(date)"
log "Commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
log "Node: $(node -v 2>/dev/null) | Docker: $(docker version --format '{{.Server.Version}}' 2>/dev/null)"

if docker ps --format '{{.Names}}' | grep -qE '^eliza-(postgres|redis|keycloak)$'; then
  log "ABORTADO: tu stack local está corriendo. Ejecuta 'docker compose down' (SIN -v) y vuelve a intentar."
  exit 2
fi

# ---------- Build y calidad ----------
step "1. pnpm install --frozen-lockfile (pnpm 10 vía corepack)" bash -c 'corepack enable && pnpm install --frozen-lockfile'
step "2. prisma generate" pnpm prisma generate
step "3. lint (0 errores)" pnpm lint
step "4. tests unitarios" pnpm test
step "5. build genera dist/main.js" bash -c 'pnpm build && test -f dist/main.js'

if [ "$ARM64" = 1 ]; then
  step "6. docker build linux/arm64" docker buildx build --platform linux/arm64 -t eliza-foundation:fase0-arm64 --load .
  step "7. imagen arm64: node arm64, engine Prisma arm64 y dist/main.js" docker run --rm --platform linux/arm64 --entrypoint sh eliza-foundation:fase0-arm64 -c \
    "node -p process.arch | grep -qx arm64 && ls node_modules/.prisma/client/ | grep -q 'linux-arm64' && test -f dist/main.js && echo 'arm64 OK'"
else
  log ""; log "▶ 6-7. build ARM64 omitido (--no-arm64): se valida en el CI al abrir el PR"
fi

# ---------- Base de datos desde cero ----------
teardown
step "8. compose con volumen nuevo: Postgres inicia sin errores" bash -c "
  docker compose -p $PROJECT up -d postgres &&
  for i in \$(seq 1 40); do
    [ \"\$(docker inspect -f '{{.State.Health.Status}}' eliza-postgres 2>/dev/null)\" = healthy ] && break; sleep 2;
  done &&
  [ \"\$(docker inspect -f '{{.State.Health.Status}}' eliza-postgres)\" = healthy ] &&
  ! docker logs eliza-postgres 2>&1 | grep -E 'ERROR|FATAL' | grep -v 'does not exist, skipping'"
step "9. migraciones desde cero (incluye RLS)" bash -c "DATABASE_URL='$MIGRATION_URL' pnpm prisma migrate deploy"
step "10. 15 tablas con RLS + FORCE" bash -c "
  n=\$(docker exec eliza-postgres psql -U postgres -d eliza -Atc \"SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('catalog','inventory','manufacturing','sales') AND c.relrowsecurity AND c.relforcerowsecurity\");
  echo \"tablas con RLS+FORCE: \$n\"; [ \"\$n\" = 15 ]"
step "11. app_user sin bypass (no superuser, no BYPASSRLS, sin TRUNCATE)" bash -c "
  r=\$(docker exec eliza-postgres psql -U postgres -d eliza -Atc \"SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname='app_user'\");
  t=\$(docker exec eliza-postgres psql -U postgres -d eliza -Atc \"SELECT count(*) FROM information_schema.role_table_grants WHERE grantee='app_user' AND privilege_type='TRUNCATE'\");
  echo \"bypass=\$r truncate=\$t\"; [ \"\$r\" = f ] && [ \"\$t\" = 0 ]"
step "12. make db-rls-check: aislamiento entre tenants" bash -c "
  out=\$(docker exec -i eliza-postgres psql -U postgres -d eliza < scripts/rls-check.sql 2>&1); echo \"\$out\";
  echo \"\$out\" | grep -qx ' RLSCHK-A' &&
  ! echo \"\$out\" | grep -qx ' RLSCHK-B' &&
  [ \"\$(echo \"\$out\" | grep -c 'ERROR')\" -ge 5 ]"
step "13. re-ejecutar migraciones es idempotente" bash -c "DATABASE_URL='$MIGRATION_URL' pnpm prisma migrate deploy"
teardown

# ---------- Resumen ----------
log ""; log "================ RESUMEN ================"
for r in "${RESULTS[@]}"; do log "$r"; done
log "PASS: $PASS  FAIL: $FAIL"
log ""
log "Manual (no automatizable aquí): flujos de TESTING-*.md con DATABASE_URL=app_user."
[ "$FAIL" = 0 ] && exit 0 || exit 1
