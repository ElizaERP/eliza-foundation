#!/bin/bash
# =====================================================================
# ELIZA Foundation Platform — Smoke Test End-to-End
# =====================================================================
# Verifica que la app local responde correctamente atravesando los
# 4 sprints. Si todo pasa, la Foundation está bien instalada.
#
# Requisitos:
#   - App corriendo en localhost:3000 (make dev)
#   - JWKS server activo en localhost:9999 (make jwks-server)
#   - jq instalado

set -euo pipefail

API="${API:-http://localhost:3000/api/v1}"
BASE_URL="${BASE_URL:-http://localhost:3000}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

assert() {
  local description="$1"
  local condition="$2"
  if eval "$condition" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} $description"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}✗${NC} $description"
    echo -e "  ${YELLOW}condition: $condition${NC}"
    FAIL=$((FAIL + 1))
  fi
}

echo "==============================================="
echo "  ELIZA Foundation Platform — Smoke Test"
echo "==============================================="
echo ""

# ---------- Sprint 0: bootstrap ----------
echo "--- Sprint 0: Health & bootstrap ---"
HEALTH=$(curl -sS "$BASE_URL/health")
assert "Health endpoint responde 200" "echo '$HEALTH' | jq -e '.status == \"ok\"'"

READY=$(curl -sS "$BASE_URL/health/ready")
assert "Postgres está alcanzable (health/ready)" "echo '$READY' | jq -e '.status == \"ok\"'"

echo ""

# ---------- Generar JWT Platform.Admin ----------
echo "--- Generando JWT Platform.Admin ---"
PLATFORM_TOKEN=$(pnpm -s ts-node scripts/gen-test-jwt.ts \
  --user 00000000-0000-0000-0000-000000000001 \
  --roles Platform.Admin 2>/dev/null | grep -E '^eyJ' | head -1)

if [[ -z "$PLATFORM_TOKEN" ]]; then
  echo -e "${RED}✗ No pude generar JWT. ¿Está jwks-server corriendo?${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} JWT generado (Platform.Admin)"
echo ""

# ---------- Sprint 0: diagnostics ----------
echo "--- Sprint 0: TenantContext middleware ---"
WHO=$(curl -sS "$API/diagnostics/who-am-i" -H "Authorization: Bearer $PLATFORM_TOKEN")
assert "Diagnostics who-am-i devuelve tenantId" "echo '$WHO' | jq -e '.tenantId | type == \"string\"'"
assert "Diagnostics who-am-i devuelve Platform.Admin en roles" "echo '$WHO' | jq -e '.roles | contains([\"Platform.Admin\"])'"

RLS=$(curl -sS "$API/diagnostics/rls-check" -H "Authorization: Bearer $PLATFORM_TOKEN")
assert "RLS está activo en Postgres" "echo '$RLS' | jq -e '.rls == \"active\" and .matchesContext == true'"

PROBLEM=$(curl -sS -i "$API/diagnostics/errors/not_found" -H "Authorization: Bearer $PLATFORM_TOKEN")
assert "Filtro Problem Details devuelve application/problem+json" "echo '$PROBLEM' | grep -i 'content-type.*problem+json' > /dev/null"

echo ""

# ---------- Sprint 1: Tenant ----------
echo "--- Sprint 1: Tenant lifecycle ---"
TIMESTAMP=$(date +%s)
TENANT_CODE="smoke-${TIMESTAMP}"

CREATE_RESP=$(curl -sS -X POST "$API/platform/tenants" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"$TENANT_CODE\",\"name\":\"Smoke $TIMESTAMP\",\"plan\":\"Basic\"}")
TENANT_ID=$(echo "$CREATE_RESP" | jq -r .id)
assert "Crear tenant devuelve UUID" "[[ \"$TENANT_ID\" =~ ^[0-9a-f]{8}- ]]"

GET_RESP=$(curl -sS "$API/platform/tenants/$TENANT_ID" -H "Authorization: Bearer $PLATFORM_TOKEN")
assert "Recuperar tenant por ID funciona" "echo '$GET_RESP' | jq -e '.code == \"$TENANT_CODE\"'"

ACTIVATE_RESP=$(curl -sS -X POST "$API/platform/tenants/$TENANT_ID/activate" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"expectedVersion": 1}')
assert "Activar tenant devuelve status Active" "echo '$ACTIVATE_RESP' | jq -e '.status == \"Active\"'"

# Conflict — debe rechazar code duplicado
CONFLICT=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$API/platform/tenants" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"$TENANT_CODE\",\"name\":\"Duplicado\"}")
assert "Crear tenant con code duplicado devuelve 409" "[[ \"$CONFLICT\" == \"409\" ]]"

echo ""

# ---------- Sprint 2: IAM ----------
echo "--- Sprint 2: IAM guards ---"

# Token sin Platform.Admin
TENANT_TOKEN=$(pnpm -s ts-node scripts/gen-test-jwt.ts \
  --tenant 7c9e6679-7425-40de-944b-e07fc1f90ae7 \
  --user 550e8400-e29b-41d4-a716-446655440000 \
  --roles Tenant.Admin 2>/dev/null | grep -E '^eyJ' | head -1)

FORBIDDEN=$(curl -sS -o /dev/null -w "%{http_code}" "$API/platform/tenants" \
  -H "Authorization: Bearer $TENANT_TOKEN")
assert "RolesGuard rechaza Tenant.Admin en endpoint Platform.Admin (403)" "[[ \"$FORBIDDEN\" == \"403\" ]]"

UNAUTH=$(curl -sS -o /dev/null -w "%{http_code}" "$API/me")
assert "JwtAuthGuard rechaza sin token (401)" "[[ \"$UNAUTH\" == \"401\" ]]"

CLAIMS=$(curl -sS "$API/me/claims" -H "Authorization: Bearer $TENANT_TOKEN")
assert "Endpoint /me/claims devuelve roles del JWT validado" "echo '$CLAIMS' | jq -e '.roles | contains([\"Tenant.Admin\"])'"

echo ""

# ---------- Sprint 3: Audit ----------
echo "--- Sprint 3: Audit chain ---"

# Esperar un momento para que la operación de Activate quede en el audit log
sleep 1
VERIFY=$(curl -sS "$API/audit/verify-chain" -H "Authorization: Bearer $PLATFORM_TOKEN")
assert "Audit chain está íntegra" "echo '$VERIFY' | jq -e '.isValid == true'"

ENTITY_HISTORY=$(curl -sS "$API/audit/entity/Tenant/$TENANT_ID" -H "Authorization: Bearer $PLATFORM_TOKEN")
assert "Historia de auditoría del tenant existe" "echo '$ENTITY_HISTORY' | jq -e 'length >= 1'"

echo ""

# ---------- Sprint 4: Outbox + Read Model ----------
echo "--- Sprint 4: Outbox dispatcher + projection ---"

# Esperar a que el dispatcher procese
sleep 3

STATS=$(curl -sS "$API/platform/outbox/stats" -H "Authorization: Bearer $PLATFORM_TOKEN")
assert "Outbox tiene eventos Published" "echo '$STATS' | jq -e '.published > 0'"
assert "Outbox NO debería tener pending tras smoke" "echo '$STATS' | jq -e '.pending == 0'"

SUMMARY=$(curl -sS "$API/platform/read-models/tenant-summary" -H "Authorization: Bearer $PLATFORM_TOKEN")
assert "Read model tenant-summary contiene el tenant creado" "echo '$SUMMARY' | jq -e \"map(select(.tenantId == \\\"$TENANT_ID\\\")) | length == 1\""
assert "Read model refleja status Active tras la projection" "echo '$SUMMARY' | jq -e \"map(select(.tenantId == \\\"$TENANT_ID\\\" and .status == \\\"Active\\\")) | length == 1\""

echo ""

# ---------- Cleanup ----------
echo "--- Cleanup ---"
curl -sS -X DELETE "$API/platform/tenants/$TENANT_ID" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"expectedVersion": 2}' > /dev/null
echo -e "${GREEN}✓${NC} Tenant de prueba eliminado"

echo ""
echo "==============================================="
if [[ $FAIL -eq 0 ]]; then
  echo -e "${GREEN}  ✓ Todos los $PASS checks pasaron${NC}"
  echo "==============================================="
  exit 0
else
  echo -e "${RED}  ✗ $FAIL checks fallaron de $((PASS + FAIL))${NC}"
  echo "==============================================="
  exit 1
fi
