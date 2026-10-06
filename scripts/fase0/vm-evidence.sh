#!/usr/bin/env bash
# =====================================================================
# ELIZA — Fase 0: evidencia del estado real de la VM (SOLO LECTURA)
# =====================================================================
# Ejecutar EN LA VM, como el usuario que despliega (opc):
#   bash vm-evidence.sh [DIRECTORIO_DE_DESPLIEGUE]
# Por defecto: ~/eliza-deploy
#
# No modifica nada. Genera:
#   ~/fase0-evidence-<fecha>/report.txt      → informe completo
#   ~/fase0-evidence-<fecha>/artifacts.tgz   → cloud-init, Caddyfile, compose,
#                                              scripts… SIN .env ni backups
# Luego cópialo a tu máquina:
#   scp -r opc@<IP>:~/fase0-evidence-<fecha> .
# =====================================================================
set -u

DEPLOY_DIR="${1:-$HOME/eliza-deploy}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$HOME/fase0-evidence-$STAMP"
REPORT="$OUT/report.txt"
mkdir -p "$OUT"

section() { printf '\n===== %s =====\n' "$1"; }
run() { echo "\$ $*"; "$@" 2>&1 || echo "(falló: código $?)"; }

{
  echo "ELIZA — Evidencia Fase 0 — $(date -Is)"
  echo "Directorio de despliegue: $DEPLOY_DIR"

  section "1. Host y arquitectura"
  run hostnamectl
  run uname -m
  run uptime

  section "2. Recursos (comparar con el límite Always Free)"
  run nproc
  run free -h
  run df -h /

  section "3. Metadatos OCI: shape, OCPU, RAM, región"
  curl -s -m 5 -H "Authorization: Bearer Oracle" http://169.254.169.254/opc/v2/instance/ \
    | grep -E '"(shape|region|canonicalRegionName|availabilityDomain|ocpus|memoryInGBs|displayName)"' \
    || echo "(metadatos no disponibles)"

  section "4. Docker y servicios"
  run docker version --format 'Docker {{.Server.Version}} ({{.Server.Arch}})'
  run docker compose ls
  run docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
  run docker images --format 'table {{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}'

  section "5. Commit que corre hoy"
  if [ -d "$DEPLOY_DIR/.git" ]; then
    run git -C "$DEPLOY_DIR" log -3 --format='%h %ad %s' --date=short
    run git -C "$DEPLOY_DIR" status --short
  else
    echo "$DEPLOY_DIR no es un repositorio git."
  fi
  for c in $(docker ps --format '{{.Names}}'); do
    rev=$(docker inspect "$c" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null)
    img=$(docker inspect "$c" --format '{{.Config.Image}}' 2>/dev/null)
    echo "$c → imagen: $img  revision: ${rev:-(sin label)}"
  done
  echo "Repos con código de ELIZA en el home:"
  for d in "$HOME"/*/; do
    [ -d "$d/.git" ] && echo "  $d → $(git -C "$d" log -1 --format='%h %s' 2>/dev/null)"
  done

  section "6. Puertos escuchando en el host"
  run sudo ss -tlnp

  section "7. Firewall efectivo (firewalld + iptables + reglas de Docker)"
  run sudo firewall-cmd --state
  run sudo firewall-cmd --list-all
  run sudo iptables -S INPUT
  run sudo iptables -S DOCKER-USER
  run sudo iptables -t nat -S DOCKER

  section "8. SSH"
  run sudo sshd -T | grep -Ei '^(passwordauthentication|permitrootlogin|pubkeyauthentication|port) '

  section "9. Backups"
  run cat /etc/cron.d/eliza-backup
  run crontab -l
  echo "Backups encontrados (últimos 30 días):"
  find "$DEPLOY_DIR" "$HOME" -maxdepth 3 -type f \( -name '*.sql.gz' -o -name '*.dump' -o -name '*.sql' \) -mtime -30 \
    -printf '%TY-%Tm-%Td %TH:%TM  %10s  %p\n' 2>/dev/null | sort | tail -20
  run sudo tail -20 /var/log/eliza-backup.log

  section "10. ¿Hay datos reales? (conteos globales)"
  PG=$(docker ps --format '{{.Names}}' | grep -iE 'postgres|db' | head -1)
  if [ -n "$PG" ]; then
    echo "Contenedor PostgreSQL: $PG"
    docker exec "$PG" sh -c 'psql -U "${POSTGRES_USER:-postgres}" -d postgres -Atc "SELECT datname FROM pg_database WHERE NOT datistemplate"' 2>&1
    for db in eliza; do
      docker exec "$PG" sh -c "psql -U \"\${POSTGRES_USER:-postgres}\" -d $db -At -F ' | ' -c \"
        SELECT 'tenants', count(*) FROM tenant.tenants
        UNION ALL SELECT 'users', count(*) FROM iam.users
        UNION ALL SELECT 'products', count(*) FROM catalog.products
        UNION ALL SELECT 'lotes', count(*) FROM inventory.lotes
        UNION ALL SELECT 'ordenes_produccion', count(*) FROM manufacturing.ordenes_produccion
        UNION ALL SELECT 'ordenes_venta', count(*) FROM sales.ordenes_venta
        UNION ALL SELECT 'audit_logs', count(*) FROM audit.audit_logs;\"" 2>&1
      docker exec "$PG" sh -c "psql -U \"\${POSTGRES_USER:-postgres}\" -d $db -At -c \"SELECT migration_name FROM _prisma_migrations ORDER BY finished_at\"" 2>&1
      echo "Tablas con RLS activa:"
      docker exec "$PG" sh -c "psql -U \"\${POSTGRES_USER:-postgres}\" -d $db -At -c \"SELECT count(*) FROM pg_class WHERE relrowsecurity\"" 2>&1
    done
  else
    echo "No se encontró un contenedor de PostgreSQL en ejecución."
  fi

  section "11. Salud de la API"
  run curl -s -m 5 -o /dev/null -w 'GET /health → %{http_code}\n' http://localhost:3000/health
  run curl -s -m 5 http://localhost:3000/health/ready
} > "$REPORT" 2>&1

# Artefactos de despliegue, SIN secretos ni backups
if [ -d "$DEPLOY_DIR" ]; then
  tar -czf "$OUT/artifacts.tgz" -C "$(dirname "$DEPLOY_DIR")" \
    --exclude='.env' --exclude='*.env' --exclude='.git' --exclude='backups' \
    --exclude='*.sql.gz' --exclude='*.dump' --exclude='*.pem' --exclude='*.key' \
    "$(basename "$DEPLOY_DIR")" 2>>"$REPORT"
fi
[ -f /etc/cloud/cloud.cfg.d/99_eliza.cfg ] && cp /etc/cloud/cloud.cfg.d/99_eliza.cfg "$OUT/" 2>/dev/null
sudo cat /var/lib/cloud/instance/user-data.txt > "$OUT/cloud-init-user-data.txt" 2>/dev/null \
  || echo "(no se pudo leer el user-data de cloud-init)" >> "$REPORT"

echo "Listo: $OUT"
ls -la "$OUT"
