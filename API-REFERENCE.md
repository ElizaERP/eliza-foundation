# 📡 ELIZA Foundation Platform — API Reference

> Catálogo completo de TODOS los endpoints disponibles tras los Sprints 0, 1, 2 y 3.

**Base URL local**: `http://localhost:3000`
**Versionado**: por URI → `/api/v1/...`
**Swagger UI**: `http://localhost:3000/docs`
**OpenAPI JSON**: `http://localhost:3000/docs-json`

---

## 🔑 Convenciones globales

| Aspecto | Detalle |
|---|---|
| Autenticación | `Authorization: Bearer <JWT>` (JWT RS256 firmado por Keycloak) |
| Tenant scoping | Implícito vía claim `tenant_id` del JWT |
| Versionado | `/api/v1/`. Versiones nuevas convivirán como `/api/v2/` |
| Errores | RFC 7807 — `Content-Type: application/problem+json` |
| Correlación | Header `X-Correlation-Id` (request) / propagado en response |
| Rate limiting | 100 req/min por IP (configurable) |
| Optimistic concurrency | `expectedVersion` opcional en bodies de mutación |
| Paginación | Query params `page` (1-based) + `pageSize` (max 100/200) |

---

## 📑 Tabla maestra de endpoints

| # | Método | Path | Rol | Tag Swagger |
|---|--------|------|-----|-------------|
| **Health & Diag** ||||
| 1 | GET | `/health` | público | Health |
| 2 | GET | `/health/ready` | público | Health |
| 3 | GET | `/health/db` | público | Health |
| 4 | GET | `/api/v1/diagnostics/who-am-i` | autenticado | Diagnostics |
| 5 | GET | `/api/v1/diagnostics/rls-check` | autenticado | Diagnostics |
| 6 | GET | `/api/v1/diagnostics/errors/:type` | autenticado | Diagnostics |
| **Tenant — Platform** ||||
| 7 | POST | `/api/v1/platform/tenants` | Platform.Admin | Platform · Tenants |
| 8 | GET | `/api/v1/platform/tenants` | Platform.Admin | Platform · Tenants |
| 9 | GET | `/api/v1/platform/tenants/:id` | Platform.Admin | Platform · Tenants |
| 10 | GET | `/api/v1/platform/tenants/by-code/:code` | Platform.Admin | Platform · Tenants |
| 11 | PATCH | `/api/v1/platform/tenants/:id` | Platform.Admin | Platform · Tenants |
| 12 | POST | `/api/v1/platform/tenants/:id/activate` | Platform.Admin | Platform · Tenants |
| 13 | POST | `/api/v1/platform/tenants/:id/suspend` | Platform.Admin | Platform · Tenants |
| 14 | POST | `/api/v1/platform/tenants/:id/change-plan` | Platform.Admin | Platform · Tenants |
| 15 | DELETE | `/api/v1/platform/tenants/:id` | Platform.Admin | Platform · Tenants |
| **Tenant — Self** ||||
| 16 | GET | `/api/v1/tenants/me` | autenticado | Tenant · Self |
| **IAM — Me** ||||
| 17 | GET | `/api/v1/me` | autenticado | IAM · Me |
| 18 | GET | `/api/v1/me/claims` | autenticado | IAM · Me |
| **IAM — Platform Users** ||||
| 19 | POST | `/api/v1/platform/users` | Platform.Admin | Platform · Users |
| 20 | GET | `/api/v1/platform/users/:id` | Platform.Admin | Platform · Users |
| 21 | POST | `/api/v1/platform/users/:id/activate` | Platform.Admin | Platform · Users |
| 22 | POST | `/api/v1/platform/users/:id/suspend` | Platform.Admin | Platform · Users |
| 23 | DELETE | `/api/v1/platform/users/:id` | Platform.Admin | Platform · Users |
| 24 | POST | `/api/v1/platform/users/:id/memberships` | Platform.Admin | Platform · Users |
| 25 | DELETE | `/api/v1/platform/users/:id/memberships/:tenantId` | Platform.Admin | Platform · Users |
| 26 | POST | `/api/v1/platform/users/:id/roles` | Platform.Admin | Platform · Users |
| 27 | DELETE | `/api/v1/platform/users/:id/roles` | Platform.Admin | Platform · Users |
| **IAM — Tenant Users** ||||
| 28 | POST | `/api/v1/tenants/me/users` | Tenant.Admin | Tenant · Users |
| 29 | GET | `/api/v1/tenants/me/users` | Tenant.Admin | Tenant · Users |
| **Audit** ||||
| 30 | GET | `/api/v1/audit` | Tenant.Admin+ | Audit |
| 31 | GET | `/api/v1/audit/entity/:entityType/:entityId` | Tenant.Admin+ | Audit |
| 32 | GET | `/api/v1/audit/verify-chain` | Tenant.Admin+ | Audit |
| **Outbox & Read Models (Sprint 4)** ||||
| 33 | GET | `/api/v1/platform/outbox/stats` | Platform.Admin/SRE | Platform · Outbox |
| 34 | GET | `/api/v1/platform/outbox/events` | Platform.Admin/SRE | Platform · Outbox |
| 35 | POST | `/api/v1/platform/outbox/events/:id/replay` | Platform.Admin/SRE | Platform · Outbox |
| 36 | GET | `/api/v1/platform/outbox/dlq` | Platform.Admin/SRE | Platform · Outbox |
| 37 | POST | `/api/v1/platform/outbox/dlq/:id/retry` | Platform.Admin/SRE | Platform · Outbox |
| 38 | GET | `/api/v1/platform/read-models/tenant-summary` | Platform.Admin/Support/SRE | Platform · Read Models |

---

## 🔧 Configuración inicial del entorno

```bash
# 1. Levantar infra
pnpm infra:up

# 2. Generar JWKS local (para tokens firmados sin Keycloak)
pnpm ts-node scripts/gen-test-jwt.ts --roles Platform.Admin
pnpm ts-node scripts/jwks-server.ts &   # background

# 3. Migraciones + seed
pnpm prisma:migrate:dev --name all_sprints
pnpm db:seed

# 4. Arrancar la app
pnpm start:dev

# 5. Tokens (reusables durante 1h)
export PLATFORM_TOKEN="$(pnpm -s ts-node scripts/gen-test-jwt.ts \
  --user 00000000-0000-0000-0000-000000000001 \
  --roles Platform.Admin 2>/dev/null | grep -E '^eyJ' | head -1)"

export TENANT_TOKEN="$(pnpm -s ts-node scripts/gen-test-jwt.ts \
  --tenant 7c9e6679-7425-40de-944b-e07fc1f90ae7 \
  --user 550e8400-e29b-41d4-a716-446655440000 \
  --roles Tenant.Admin 2>/dev/null | grep -E '^eyJ' | head -1)"

# Para variables convenientes
export BASE_URL="http://localhost:3000"
export API="$BASE_URL/api/v1"
```

---

## 1️⃣ Health & Diagnostics

```bash
# 1. Liveness — el proceso responde
curl -i $BASE_URL/health

# 2. Readiness — Postgres responde
curl -sS $BASE_URL/health/ready | jq

# 3. DB ping específico
curl -sS $BASE_URL/health/db | jq

# 4. Eco del tenant context
curl -sS $API/diagnostics/who-am-i \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq

# 5. Verificar RLS activo en Postgres
curl -sS $API/diagnostics/rls-check \
  -H "Authorization: Bearer $TENANT_TOKEN" | jq

# 6. Disparar cualquier tipo de error (validation, not_found, conflict, ...)
curl -i $API/diagnostics/errors/conflict \
  -H "Authorization: Bearer $PLATFORM_TOKEN"
```

---

## 2️⃣ Tenant Management — Platform Admin

```bash
# 7. Crear tenant
curl -sS -X POST $API/platform/tenants \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "acme-foods",
    "name": "ACME Foods S.A.S.",
    "plan": "Professional"
  }' | jq

export NEW_TENANT_ID="<id-del-response>"

# 8. Listar tenants (con filtros)
curl -sS "$API/platform/tenants?status=Active,PendingActivation&page=1&pageSize=20" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq

# Búsqueda por texto
curl -sS "$API/platform/tenants?search=acme" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq

# 9. Detalle por ID
curl -sS "$API/platform/tenants/$NEW_TENANT_ID" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq

# 10. Resolución subdomain → tenant
curl -sS "$API/platform/tenants/by-code/acme-foods" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq

# 11. Renombrar
curl -sS -X PATCH "$API/platform/tenants/$NEW_TENANT_ID" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newName": "ACME Holdings S.A.S.", "expectedVersion": 1}' | jq

# 12. Activar (PendingActivation → Active)
curl -sS -X POST "$API/platform/tenants/$NEW_TENANT_ID/activate" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"expectedVersion": 2}' | jq

# 13. Suspender
curl -sS -X POST "$API/platform/tenants/$NEW_TENANT_ID/suspend" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Non-payment 30 days", "expectedVersion": 3}' | jq

# 14. Cambiar plan
curl -sS -X POST "$API/platform/tenants/$NEW_TENANT_ID/change-plan" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newPlan": "Enterprise", "expectedVersion": 4}' | jq

# 15. Eliminar (soft, terminal)
curl -sS -X DELETE "$API/platform/tenants/$NEW_TENANT_ID" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"expectedVersion": 5}' | jq
```

### Tenant — Self (cualquier usuario)

```bash
# 16. Mi tenant
curl -sS $API/tenants/me \
  -H "Authorization: Bearer $TENANT_TOKEN" | jq
```

---

## 3️⃣ IAM — Identity & Access Management

### IAM Me

```bash
# 17. Mi usuario en ELIZA
curl -sS $API/me \
  -H "Authorization: Bearer $TENANT_TOKEN" | jq

# 18. Claims debug
curl -sS $API/me/claims \
  -H "Authorization: Bearer $TENANT_TOKEN" | jq
```

### Platform Users (Platform Admin)

```bash
# 19. Crear usuario en cualquier tenant
curl -sS -X POST $API/platform/users \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "operator1@bcm-congelados.com",
    "fullName": "Operario Uno",
    "tenantId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "roles": ["Manufacturing.Operator"],
    "sendActivationEmail": false
  }' | jq

export USER_ID="<id-del-response>"

# 20. Detalle
curl -sS "$API/platform/users/$USER_ID" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq

# 21. Activar
curl -sS -X POST "$API/platform/users/$USER_ID/activate" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"expectedVersion": 1}' | jq

# 22. Suspender
curl -sS -X POST "$API/platform/users/$USER_ID/suspend" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Acceso comprometido", "expectedVersion": 2}' | jq

# 23. Eliminar
curl -sS -X DELETE "$API/platform/users/$USER_ID" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"expectedVersion": 3}' | jq

# 24. Otorgar membresía a un segundo tenant
curl -sS -X POST "$API/platform/users/$USER_ID/memberships" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "00000000-0000-0000-0000-000000000999",
    "roles": ["Sales.Manager"]
  }' | jq

# 25. Revocar membresía
curl -sS -X DELETE "$API/platform/users/$USER_ID/memberships/00000000-0000-0000-0000-000000000999" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"expectedVersion": 4}' | jq

# 26. Asignar un rol dentro de una membresía existente
curl -sS -X POST "$API/platform/users/$USER_ID/roles" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "role": "Quality.Inspector"
  }' | jq

# 27. Revocar rol
curl -sS -X DELETE "$API/platform/users/$USER_ID/roles" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "role": "Quality.Inspector"
  }' | jq
```

### Tenant Users (Tenant Admin self-service)

```bash
# 28. Invitar usuario al MI tenant
curl -sS -X POST $API/tenants/me/users \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "salesperson1@bcm-congelados.com",
    "fullName": "Vendedor Uno",
    "roles": ["Sales.Salesperson"]
  }' | jq

# 29. Listar usuarios del MI tenant
curl -sS "$API/tenants/me/users?page=1&pageSize=20&search=salesperson" \
  -H "Authorization: Bearer $TENANT_TOKEN" | jq
```

---

## 4️⃣ Audit Log — consulta forense

```bash
# 30. Búsqueda con filtros
curl -sS "$API/audit?action=Create,Update&page=1&pageSize=50" \
  -H "Authorization: Bearer $TENANT_TOKEN" | jq

# Por correlationId — sigue toda una operación cross-context
curl -sS "$API/audit?correlationId=01H...." \
  -H "Authorization: Bearer $TENANT_TOKEN" | jq

# Rango de fechas
curl -sS "$API/audit?from=2026-06-01T00:00:00Z&to=2026-06-30T23:59:59Z" \
  -H "Authorization: Bearer $TENANT_TOKEN" | jq

# 31. Historial completo de UNA entidad específica
curl -sS "$API/audit/entity/Tenant/7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  -H "Authorization: Bearer $TENANT_TOKEN" | jq

# 32. Verificar integridad criptográfica de la cadena
curl -sS "$API/audit/verify-chain" \
  -H "Authorization: Bearer $TENANT_TOKEN" | jq

# Verificar solo un rango (BigInt como string)
curl -sS "$API/audit/verify-chain?fromChainIndex=100&toChainIndex=500" \
  -H "Authorization: Bearer $TENANT_TOKEN" | jq
```

Respuesta `verify-chain` cuando todo está bien:
```json
{
  "tenantId": "7c9e...",
  "entriesChecked": 1247,
  "isValid": true,
  "firstBrokenChainIndex": null,
  "brokenReason": null
}
```

Cuando alguien tampered con la BD:
```json
{
  "tenantId": "7c9e...",
  "entriesChecked": 347,
  "isValid": false,
  "firstBrokenChainIndex": "346",
  "brokenReason": "hash_mismatch"
}
```

---

## 5️⃣ Outbox & Read Models — operación del bus de eventos

```bash
# 33. Stats operativas
curl -sS $API/platform/outbox/stats \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq

# 34. Listar eventos con filtros
curl -sS "$API/platform/outbox/events?status=Published,Failed&pageSize=20" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq

# Por tipo específico
curl -sS "$API/platform/outbox/events?eventType=tenant.TenantCreated.v1" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq

# Por agregado
curl -sS "$API/platform/outbox/events?aggregateType=Tenant&aggregateId=$NEW_TENANT_ID" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq

# 35. Replay de un evento específico
curl -sS -X POST "$API/platform/outbox/events/<eventId>/replay" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq

# 36. Lista de Dead Letter Queue
curl -sS "$API/platform/outbox/dlq?pageSize=50" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq

# 37. Sacar un evento de DLQ y reintentar
curl -sS -X POST "$API/platform/outbox/dlq/<eventId>/retry" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq

# 38. Read Model — TenantSummary
curl -sS "$API/platform/read-models/tenant-summary" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq
```

---

## 🧪 Test de fin a fin (smoke test completo)

```bash
#!/bin/bash
# Verifica el flujo completo: crear tenant → crear user → asignar rol → leer audit
set -e

# 1. Crear tenant
TENANT=$(curl -sS -X POST $API/platform/tenants \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code":"smoke-test","name":"Smoke Test","plan":"Basic"}')
TENANT_ID=$(echo $TENANT | jq -r .id)
echo "✓ Tenant created: $TENANT_ID"

# 2. Activar
curl -sS -X POST "$API/platform/tenants/$TENANT_ID/activate" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"expectedVersion": 1}' > /dev/null
echo "✓ Activated"

# 3. Crear usuario en ese tenant
USER=$(curl -sS -X POST $API/platform/users \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"smoke@test.com\",\"fullName\":\"Smoke User\",\"tenantId\":\"$TENANT_ID\",\"roles\":[\"Manufacturing.Operator\"]}")
USER_ID=$(echo $USER | jq -r .id)
echo "✓ User created: $USER_ID"

# 4. Consultar audit del tenant
sleep 1
AUDIT=$(curl -sS "$API/audit?entityType=Tenant&entityId=$TENANT_ID" \
  -H "Authorization: Bearer $PLATFORM_TOKEN")
ENTRIES=$(echo $AUDIT | jq '.items | length')
echo "✓ Audit entries: $ENTRIES"

# 5. Verificar la cadena
VERIFY=$(curl -sS "$API/audit/verify-chain" \
  -H "Authorization: Bearer $PLATFORM_TOKEN")
VALID=$(echo $VERIFY | jq -r .isValid)
echo "✓ Chain valid: $VALID"

echo ""
echo "Smoke test completed."
```

---

## 📊 Códigos HTTP y semántica

| Code | Cuándo | Code en body |
|---|---|---|
| 200 | Operación exitosa | — |
| 201 | Resource creado | — |
| 400 | Validación de input fallida | `*.validation` |
| 401 | Token ausente, inválido o expirado | `http.401` |
| 403 | Token válido pero sin el rol requerido | `http.403` |
| 404 | Resource no existe | `*.not_found` |
| 409 | Conflicto (ej. code duplicado) | `*.already_exists`, `*.same_plan` |
| 412 | Optimistic concurrency: `expectedVersion` mismatch | `*.version_mismatch` |
| 422 | Invariante de dominio violada | `*.invalid_status_transition` |
| 429 | Rate limit | `http.429` |
| 500 | Error inesperado | `internal.unhandled_exception` |
| 503 | Dependencia caída (Postgres, Keycloak) | `*.idp_create_failed`, `*.persist_failed` |
