# 🧪 Testing del Sprint 0 — ELIZA Foundation Platform

Guía completa para verificar que **toda la infraestructura del Sprint 0 funciona correctamente** antes de avanzar al Sprint 1.

---

## 📋 Tabla de contenidos

1. [Setup inicial paso a paso](#1-setup-inicial-paso-a-paso)
2. [Endpoints disponibles en Sprint 0](#2-endpoints-disponibles-en-sprint-0)
3. [Generación de JWT de prueba](#3-generación-de-jwt-de-prueba)
4. [Curls de prueba](#4-curls-de-prueba)
5. [Swagger / OpenAPI](#5-swagger--openapi)
6. [Verificación de RLS en Postgres](#6-verificación-de-rls-en-postgres)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Setup inicial paso a paso

### 1.1 Prerequisitos

```bash
node --version    # >= 20.0.0
pnpm --version    # >= 9.0.0  →  npm i -g pnpm  si no lo tienes
docker --version  # cualquier versión reciente
```

### 1.2 Clonar el `.env`

```bash
cp .env.example .env
```

El `.env.example` ya viene con valores que funcionan **directamente** contra el `docker-compose.yml` local. No necesitas cambiar nada para arrancar.

### 1.3 Levantar la infraestructura

```bash
pnpm infra:up
```

Esto levanta tres contenedores:

| Servicio  | Host       | Puerto | Credenciales       |
|-----------|------------|--------|---------------------|
| Postgres  | localhost  | 5432   | `postgres / postgres` (super) · `app_user / app_password` · `migration_user / migration_password` |
| Redis     | localhost  | 6379   | sin password en dev |
| Keycloak  | localhost  | 8080   | `admin / admin`     |

Verifica que están arriba:

```bash
docker compose ps
docker compose logs -f postgres   # ver que el bootstrap.sql se ejecutó
```

En los logs de Postgres debes ver el output del `01_bootstrap.sql`: creación de la base `keycloak`, schemas `tenant/iam/audit/platform`, roles `app_user` y `migration_user`, función `platform.current_tenant_id()`.

### 1.4 Instalar dependencias

```bash
pnpm install
```

### 1.5 Generar el Prisma Client y ejecutar migraciones

```bash
pnpm prisma:generate
pnpm prisma:migrate:dev --name init
```

> **Nota**: en Sprint 0 las migraciones aún no incluyen las policies de RLS (eso llega en Sprint 1 con la tabla `tenants`). Por ahora el `01_bootstrap.sql` ya creó los schemas y los roles. La función `platform.current_tenant_id()` ya existe.

### 1.6 Arrancar la app

```bash
pnpm start:dev
```

Deberías ver:

```
🚀 ELIZA Foundation Platform listening on http://localhost:3000/api/v1
📖 OpenAPI docs at http://localhost:3000/docs
```

---

## 2. Endpoints disponibles en Sprint 0

En Sprint 0 **no hay endpoints de negocio** (esos llegan en Sprints 1-3). Solo tenemos endpoints de infraestructura para validar el bootstrap:

| Endpoint | Método | Auth | Propósito |
|---|---|---|---|
| `/health` | GET | ❌ | Liveness — el proceso responde |
| `/health/ready` | GET | ❌ | Readiness — Postgres responde |
| `/health/db` | GET | ❌ | Ping específico a Postgres |
| `/docs` | GET | ❌ | Swagger UI |
| `/docs-json` | GET | ❌ | OpenAPI 3.1 JSON |
| `/api/v1/diagnostics/who-am-i` | GET | ✅ | Eco del tenant context resuelto |
| `/api/v1/diagnostics/rls-check` | GET | ✅ | Valida que RLS está activo |
| `/api/v1/diagnostics/errors/:type` | GET | ✅ | Dispara errores para ver Problem Details |

Los endpoints de `/api/v1/diagnostics/*` requieren el `TenantContextMiddleware` resuelto, así que necesitan un `X-Tenant-Id` o un `Authorization: Bearer <jwt>`.

---

## 3. Generación de JWT de prueba

En el Sprint 0 **no tenemos el AuthGuard** todavía (llega en Sprint 2 con la integración real de Keycloak). El `TenantContextMiddleware` solo decodifica el payload del JWT sin validar la firma, así que **cualquier JWT bien formado funciona para testing**.

### Opción A — Usar el script incluido (recomendado)

```bash
pnpm ts-node scripts/gen-test-jwt.ts
```

Output:

```
=== ELIZA Test JWT ===
tenant_id: 7c9e6679-7425-40de-944b-e07fc1f90ae7
user_id:   550e8400-e29b-41d4-a716-446655440000
email:     santo@eliza.test
roles:     Tenant.Admin
expires:   2026-06-03T...

--- Bearer token ---
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InRlc3Qta2V5In0...

--- For curl ---
export ELIZA_TOKEN="eyJhbGciOiJSUzI1NiIs..."
curl -H "Authorization: Bearer $ELIZA_TOKEN" http://localhost:3000/api/v1/diagnostics/who-am-i
```

Cópialo al portapapeles:

```bash
export ELIZA_TOKEN="$(pnpm -s ts-node scripts/gen-test-jwt.ts | grep -A0 'eyJ' | head -1)"
echo $ELIZA_TOKEN
```

### Opción B — Parámetros personalizados

```bash
pnpm ts-node scripts/gen-test-jwt.ts \
  --tenant "00000000-0000-0000-0000-000000000001" \
  --user   "11111111-1111-1111-1111-111111111111" \
  --email  "operador@acme.com" \
  --roles  "Manufacturing.Operator,Inventory.Operator" \
  --ttl    7200
```

### Opción C — Solo `X-Tenant-Id` (más simple, sin JWT)

Como el middleware soporta resolución por header (`TENANT_RESOLUTION_STRATEGY=jwt,header`), puedes saltarte el JWT:

```bash
curl -H "X-Tenant-Id: 7c9e6679-7425-40de-944b-e07fc1f90ae7" \
     http://localhost:3000/api/v1/diagnostics/who-am-i
```

Pero esto no te da `userId` ni `roles`. Para esos, necesitas el JWT.

---

## 4. Curls de prueba

### 4.1 Health checks (sin autenticación)

```bash
# Liveness
curl -i http://localhost:3000/health

# Readiness con check a Postgres
curl -i http://localhost:3000/health/ready

# Solo Postgres
curl -i http://localhost:3000/health/db
```

Respuesta esperada para `/health/ready`:

```json
{
  "status": "ok",
  "info":   { "postgres": { "status": "up", "latencyMs": 4 } },
  "error":  {},
  "details": { "postgres": { "status": "up", "latencyMs": 4 } }
}
```

### 4.2 Validar el TenantContextMiddleware

Genera un JWT y guárdalo en `$ELIZA_TOKEN`. Luego:

```bash
curl -i -H "Authorization: Bearer $ELIZA_TOKEN" \
     http://localhost:3000/api/v1/diagnostics/who-am-i
```

Respuesta esperada:

```json
{
  "tenantId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "userId":   "550e8400-e29b-41d4-a716-446655440000",
  "roles":    ["Tenant.Admin"],
  "correlationId": "01H...",
  "requestIp": "::1",
  "userAgent": "curl/8.x",
  "serverTime": "2026-06-03T..."
}
```

Verifica que el header `X-Correlation-Id` viaja en la respuesta:

```bash
curl -i -H "Authorization: Bearer $ELIZA_TOKEN" \
     http://localhost:3000/api/v1/diagnostics/who-am-i \
  | grep -i 'x-correlation'
```

Propaga tu propio correlation ID (útil para tracing):

```bash
curl -H "X-Correlation-Id: my-debug-trace-001" \
     -H "Authorization: Bearer $ELIZA_TOKEN" \
     http://localhost:3000/api/v1/diagnostics/who-am-i
```

### 4.3 Validar que RLS está activo

```bash
curl -H "Authorization: Bearer $ELIZA_TOKEN" \
     http://localhost:3000/api/v1/diagnostics/rls-check | jq
```

Respuesta esperada:

```json
{
  "rls": "active",
  "sessionSettings": {
    "tenant_id":      "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "user_id":        "550e8400-e29b-41d4-a716-446655440000",
    "correlation_id": "01H..."
  },
  "matchesContext": true
}
```

Si `matchesContext` es `true`, significa que:
1. El middleware extrajo correctamente el `tenant_id` del JWT
2. `PrismaService.withTenant()` ejecutó `SET LOCAL app.tenant_id = ...` correctamente
3. La función `platform.current_tenant_id()` lee la sesión

### 4.4 Verificar el filtro Problem Details (RFC 7807)

```bash
# Validation error (400)
curl -i -H "Authorization: Bearer $ELIZA_TOKEN" \
     http://localhost:3000/api/v1/diagnostics/errors/validation

# Not found (404)
curl -i -H "Authorization: Bearer $ELIZA_TOKEN" \
     http://localhost:3000/api/v1/diagnostics/errors/not_found

# Conflict (409)
curl -i -H "Authorization: Bearer $ELIZA_TOKEN" \
     http://localhost:3000/api/v1/diagnostics/errors/conflict

# Concurrency (412)
curl -i -H "Authorization: Bearer $ELIZA_TOKEN" \
     http://localhost:3000/api/v1/diagnostics/errors/concurrency

# Domain rule violated (422)
curl -i -H "Authorization: Bearer $ELIZA_TOKEN" \
     http://localhost:3000/api/v1/diagnostics/errors/domain

# Unhandled (500)
curl -i -H "Authorization: Bearer $ELIZA_TOKEN" \
     http://localhost:3000/api/v1/diagnostics/errors/unhandled
```

Cada respuesta debe tener:
- `Content-Type: application/problem+json`
- Body con campos `type, title, status, detail, instance, code, correlationId`

Ejemplo de respuesta:

```json
{
  "type":     "https://docs.eliza.app/errors/diagnostics.invalid_input",
  "title":    "Bad Request",
  "status":   400,
  "detail":   "The provided input did not pass validation",
  "instance": "/api/v1/diagnostics/errors/validation",
  "code":     "diagnostics.invalid_input",
  "correlationId": "01H...",
  "errors": { "field": "sample", "expected": "uuid" }
}
```

### 4.5 Verificar que SIN tenant context falla

```bash
# Sin ningún header de tenant — debe fallar porque getTenantId() lanza
curl -i http://localhost:3000/api/v1/diagnostics/rls-check
```

Respuesta esperada: `500` con `code: "internal.unhandled_exception"` (el middleware no resolvió tenant y `getTenantId()` lanzó). En logs verás:

```
TenantContext is not established. Did you forget to add TenantContextMiddleware to this route?
```

Esto es el comportamiento correcto: **fallar ruidosamente** antes que silenciar un acceso sin tenant.

### 4.6 Probar rate limiting

```bash
# 100 requests en 60s con la config por defecto → al 101 debe responder 429
for i in {1..105}; do
  curl -s -o /dev/null -w "%{http_code} " http://localhost:3000/health
done
echo
```

Cuando supere el límite verás `429 Too Many Requests`.

### 4.7 Validar CORS

```bash
# Preflight desde un origin permitido (configurado en CORS_ORIGINS)
curl -i -X OPTIONS \
     -H "Origin: http://localhost:5173" \
     -H "Access-Control-Request-Method: GET" \
     http://localhost:3000/api/v1/diagnostics/who-am-i
```

---

## 5. Swagger / OpenAPI

Abre en el navegador:

```
http://localhost:3000/docs
```

Verás Swagger UI con todos los endpoints documentados, organizados por tags (`Health`, `Diagnostics`).

Para autenticar en Swagger:
1. Genera un JWT con `pnpm ts-node scripts/gen-test-jwt.ts`
2. En Swagger UI haz clic en el botón **Authorize** (candado arriba a la derecha)
3. Pega el token (sin el prefijo `Bearer`)
4. Click **Authorize** → **Close**
5. Ahora cada **Try it out** envía el `Authorization: Bearer ...`

El JSON de OpenAPI 3.1 también está disponible en:

```
http://localhost:3000/docs-json
```

Útil para importar en Postman, Insomnia o Bruno.

---

## 6. Verificación de RLS en Postgres

Para inspeccionar la base directamente:

```bash
# Conexión con superusuario (acceso total — solo para debugging)
docker exec -it eliza-postgres psql -U postgres -d eliza

# Conexión con app_user (sujeto a RLS — el rol que usa la app)
docker exec -it eliza-postgres psql -U app_user -d eliza
```

Dentro de psql:

```sql
-- Listar schemas creados
\dn

-- Listar roles
\du

-- Ver la función helper
\df platform.current_tenant_id

-- Probar que sin SET LOCAL falla:
SELECT platform.current_tenant_id();
-- ERROR: app.tenant_id is not set

-- Probarla con SET LOCAL:
BEGIN;
SET LOCAL app.tenant_id = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
SELECT platform.current_tenant_id();
-- 7c9e6679-7425-40de-944b-e07fc1f90ae7
COMMIT;
```

Cuando lleguen las migraciones de Sprint 1 con la tabla `tenants` y sus policies de RLS, este mismo test demostrará que `app_user` NO puede ver filas de otros tenants aunque haga `SELECT *`.

---

## 7. Troubleshooting

### Postgres rechaza la conexión

```bash
docker compose logs postgres --tail 50
```

Verifica que el bootstrap se ejecutó (debe aparecer `CREATE ROLE`, `CREATE SCHEMA`). Si no, borra el volumen y reinicia:

```bash
docker compose down -v
pnpm infra:up
```

### Prisma error: P1010 - User app_user denied access

`app_user` no tiene DDL — solo DML. Verifica que ejecutas las migraciones con `DATABASE_MIGRATION_URL`:

```bash
DATABASE_URL=$DATABASE_MIGRATION_URL pnpm prisma:migrate:dev
```

O ajusta tu `.env` para que apunte temporalmente con `migration_user` durante la migración.

### El middleware no resuelve el tenant

Asegúrate de que envías **alguno** de:
- `Authorization: Bearer <jwt-con-claim-tenant_id>`, o
- `X-Tenant-Id: <uuid>`

Y que `TENANT_RESOLUTION_STRATEGY` incluye la estrategia que estás usando.

### Swagger UI no muestra los endpoints de Diagnostics

`DiagnosticsController` solo se registra cuando `NODE_ENV !== 'production'`. Verifica tu `.env`:

```bash
echo $NODE_ENV
# debe ser: development, test, o staging
```

### El JWT generado por el script no es aceptado

En Sprint 0 no validamos firma, así que cualquier JWT bien formado pasa. Si igual falla, decodifica el token en https://jwt.io y verifica que el payload tiene `sub` y `tenant_id`.
