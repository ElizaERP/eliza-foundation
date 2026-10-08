#!/usr/bin/env bash
# =====================================================================
# ELIZA — Fase 0: prueba de restore AISLADA (no toca producción)
# =====================================================================
# Ejecutar EN LA VM:
#   bash restore-test.sh /ruta/al/backup.sql.gz
#
# Levanta un PostgreSQL 16 temporal (contenedor "eliza-restore-test", sin
# puertos publicados), restaura el backup, cuenta filas clave, mide el
# tiempo y BORRA el contenedor. Formatos: .sql.gz / .sql (pg_dumpall o
# pg_dump en texto) y .dump (pg_dump -Fc).
# =====================================================================
set -euo pipefail

BACKUP="${1:?Uso: bash restore-test.sh /ruta/al/backup}"
NAME=eliza-restore-test
LOG="$HOME/fase0-restore-$(date +%Y%m%d-%H%M%S).log"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

{
  echo "Restore test — $(date -Is)"
  echo "Backup: $BACKUP ($(du -h "$BACKUP" | cut -f1), $(date -r "$BACKUP" -Is))"
  START=$(date +%s)

  cleanup
  docker run -d --name "$NAME" -e POSTGRES_PASSWORD=restore-test postgres:16-alpine >/dev/null
  for _ in $(seq 1 30); do
    docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done

  case "$BACKUP" in
    *.sql.gz) gunzip -c "$BACKUP" | docker exec -i "$NAME" psql -U postgres -q -v ON_ERROR_STOP=0 -d postgres > /dev/null ;;
    *.sql)    docker exec -i "$NAME" psql -U postgres -q -v ON_ERROR_STOP=0 -d postgres < "$BACKUP" > /dev/null ;;
    *.dump)   docker exec "$NAME" createdb -U postgres eliza
              docker exec -i "$NAME" pg_restore -U postgres -d eliza --no-owner < "$BACKUP" ;;
    *) echo "Formato no reconocido: $BACKUP"; exit 1 ;;
  esac

  END=$(date +%s)
  echo "Tiempo de restore: $((END - START)) s"
  echo "Bases restauradas:"
  docker exec "$NAME" psql -U postgres -Atc "SELECT datname FROM pg_database WHERE NOT datistemplate"
  echo "Conteos en eliza:"
  docker exec "$NAME" psql -U postgres -d eliza -At -F ' | ' -c "
    SELECT 'tenants', count(*) FROM tenant.tenants
    UNION ALL SELECT 'users', count(*) FROM iam.users
    UNION ALL SELECT 'products', count(*) FROM catalog.products
    UNION ALL SELECT 'lotes', count(*) FROM inventory.lotes
    UNION ALL SELECT 'ordenes_venta', count(*) FROM sales.ordenes_venta
    UNION ALL SELECT 'audit_logs', count(*) FROM audit.audit_logs;" || echo "(no se pudo contar en eliza)"
  echo "Usuarios en keycloak:"
  docker exec "$NAME" psql -U postgres -d keycloak -Atc "SELECT count(*) FROM user_entity" 2>/dev/null \
    || echo "(la base keycloak no está en este backup)"
  echo "RESULTADO: restore completado. Compara los conteos con la sección 10 de vm-evidence."
} 2>&1 | tee "$LOG"

echo "Log: $LOG"
