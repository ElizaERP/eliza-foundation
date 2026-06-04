# 🧪 Testing del Sprint 1 — Tenant Management

Curls listos para copiar/pegar. Asumiendo que ya seguiste el [TESTING.md de Sprint 0](./TESTING.md) y tienes la infraestructura local arriba.

---

## 0. Preparación

```bash
# 1. Aplicar migraciones (incluye nuevas tablas del Sprint 1)
pnpm prisma:migrate:dev --name sprint1_tenant_context

# 2. Cargar seed (1 tenant de prueba + Platform Admin + Tenant Admin)
pnpm db:seed

# 3. Levantar la app
pnpm start:dev
```

### JWTs para los dos roles

```bash
# JWT del Platform Admin (puede operar sobre cualquier tenant)
export PLATFORM_TOKEN="$(pnpm -s ts-node scripts/gen-test-jwt.ts \
  --tenant 00000000-0000-0000-0000-000000000000 \
  --user   00000000-0000-0000-0000-000000000001 \
  --email  platform-admin@eliza.app \
  --roles  Platform.Admin \
  | grep -E '^eyJ' | head -1)"

# JWT de un Tenant Admin (solo opera sobre SU tenant)
export TENANT_TOKEN="$(pnpm -s ts-node scripts/gen-test-jwt.ts \
  --tenant 7c9e6679-7425-40de-944b-e07fc1f90ae7 \
  --user   550e8400-e29b-41d4-a716-446655440000 \
  --email  admin@bcm-congelados.com \
  --roles  Tenant.Admin \
  | grep -E '^eyJ' | head -1)"

echo "Platform: $PLATFORM_TOKEN" | head -c 60; echo "..."
echo "Tenant:   $TENANT_TOKEN"   | head -c 60; echo "..."
```

---

## 1. Endpoints de Platform Admin

Base path: `POST/GET/PATCH/DELETE  /api/v1/platform/tenants`

### 1.1 Crear un tenant

```bash
curl -sS -X POST http://localhost:3000/api/v1/platform/tenants \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "acme-foods",
    "name": "ACME Foods S.A.S.",
    "plan": "Professional"
  }' | jq
```

Respuesta esperada (201):

```json
{
  "id":     "abc12345-...",
  "code":   "acme-foods",
  "name":   "ACME Foods S.A.S.",
  "status": "PendingActivation",
  "plan":   "Professional"
}
```

Guarda el `id`:

```bash
export NEW_TENANT_ID="abc12345-..."
```

### 1.2 Validar errores de creación

```bash
# Code inválido (mayúsculas)
curl -i -X POST http://localhost:3000/api/v1/platform/tenants \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code":"ACME","name":"Test"}'
# → 400 Bad Request (validation pipe)

# Code que ya existe (re-crear el mismo)
curl -i -X POST http://localhost:3000/api/v1/platform/tenants \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code":"bcm-congelados","name":"Duplicado"}'
# → 409 Conflict · code: tenant.code.already_exists
```

### 1.3 Listar tenants

```bash
# Todos
curl -sS "http://localhost:3000/api/v1/platform/tenants" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq

# Solo Active y Suspended
curl -sS "http://localhost:3000/api/v1/platform/tenants?status=Active,Suspended" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq

# Búsqueda por nombre/code
curl -sS "http://localhost:3000/api/v1/platform/tenants?search=acme" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq

# Paginación
curl -sS "http://localhost:3000/api/v1/platform/tenants?page=1&pageSize=5" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq
```

### 1.4 Detalle por ID y por code

```bash
curl -sS "http://localhost:3000/api/v1/platform/tenants/$NEW_TENANT_ID" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq

curl -sS "http://localhost:3000/api/v1/platform/tenants/by-code/acme-foods" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq
```

### 1.5 Activar tenant

```bash
curl -sS -X POST "http://localhost:3000/api/v1/platform/tenants/$NEW_TENANT_ID/activate" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"expectedVersion": 1}' | jq
```

Respuesta:

```json
{ "id": "abc...", "status": "Active", "version": 2 }
```

### 1.6 Cambiar plan

```bash
curl -sS -X POST "http://localhost:3000/api/v1/platform/tenants/$NEW_TENANT_ID/change-plan" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newPlan": "Enterprise", "expectedVersion": 2}' | jq
```

### 1.7 Suspender

```bash
curl -sS -X POST "http://localhost:3000/api/v1/platform/tenants/$NEW_TENANT_ID/suspend" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Cuenta vencida - non-payment 30 days", "expectedVersion": 3}' | jq
```

### 1.8 Renombrar

```bash
curl -sS -X PATCH "http://localhost:3000/api/v1/platform/tenants/$NEW_TENANT_ID" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newName": "ACME Foods Holdings S.A.S.", "expectedVersion": 4}' | jq
```

### 1.9 Eliminar (soft)

```bash
curl -sS -X DELETE "http://localhost:3000/api/v1/platform/tenants/$NEW_TENANT_ID" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"expectedVersion": 5}' | jq
```

---

## 2. Endpoint Tenant Admin (self-service)

### 2.1 Obtener mi propio tenant

```bash
curl -sS "http://localhost:3000/api/v1/tenants/me" \
  -H "Authorization: Bearer $TENANT_TOKEN" | jq
```

Devuelve el tenant correspondiente al claim `tenant_id` del JWT, sin necesidad de pasarlo en la URL.

---

## 3. Validaciones de invariantes (deben fallar)

### 3.1 Optimistic concurrency

```bash
# Intentar activar con version equivocada
curl -i -X POST "http://localhost:3000/api/v1/platform/tenants/$NEW_TENANT_ID/activate" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"expectedVersion": 999}'
# → 412 Precondition Failed · code: tenant.version_mismatch
```

### 3.2 Transición de estado inválida

```bash
# Crear, activar, intentar activar de nuevo
curl -sS -X POST http://localhost:3000/api/v1/platform/tenants \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code":"test-flow","name":"Test"}' | jq

# Toma su id, actívalo, luego intenta de nuevo:
# → 422 · code: tenant.already_active
```

### 3.3 Cambiar plan sin activar

```bash
# Crear tenant nuevo, intentar cambiar plan inmediatamente
# → 403 · code: tenant.cannot_change_plan
```

### 3.4 Mismo plan

```bash
# Cambiar al mismo plan que ya tiene
# → 409 · code: tenant.same_plan
```

---

## 4. Verificación de eventos en la outbox

Después de cualquier mutación, los eventos deberían estar en la outbox:

```bash
docker exec -it eliza-postgres psql -U postgres -d eliza -c "
  SELECT event_type, status, occurred_at
  FROM platform.outbox_events
  ORDER BY occurred_at DESC
  LIMIT 10;
"
```

Verás `tenant.TenantCreated.v1`, `tenant.TenantActivated.v1`, etc. en estado `Pending`. En Sprint 4 implementaremos el Outbox Dispatcher que los publica.

---

## 5. Swagger

Abrir http://localhost:3000/docs. Bajo los tags **Platform · Tenants** y **Tenant · Self** verás todos los endpoints documentados con sus DTOs, ejemplos y responses.

---

## 6. Ejecutar tests unitarios

```bash
# Solo dominio Tenant
pnpm test src/contexts/tenant

# Con cobertura
pnpm test:cov src/contexts/tenant
```

Cobertura esperada del dominio Tenant: **≥ 95%** (todas las invariantes + transiciones).
