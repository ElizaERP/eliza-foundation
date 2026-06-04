# 🧪 Testing del Sprint 2 — IAM + Keycloak

Sprint 2 añade **autenticación criptográfica real** (RS256 + JWKS), creación de usuarios federada con Keycloak, y guards de RBAC. Esta guía cubre dos modos de testing:

- **Modo A — Local sin Keycloak**: usa el JWKS local generado por scripts. Más rápido para iterar.
- **Modo B — Con Keycloak real**: levanta el contenedor con el realm importado. Necesario para probar el `KeycloakIdentityProvider`.

---

## Modo A — Testing sin Keycloak (JWKS local)

### A.1 Generar keypair y JWKS local

```bash
pnpm ts-node scripts/gen-test-jwt.ts --roles Platform.Admin
```

Esto crea `.dev-keys/` con `private.pem`, `public.pem`, `jwks.json` la primera vez. En ejecuciones siguientes solo firma un nuevo token reusando las llaves.

### A.2 Arrancar el servidor JWKS local

En otra terminal:

```bash
pnpm ts-node scripts/jwks-server.ts
```

Sale:

```
🔑 Local JWKS server listening on http://localhost:9999
   Endpoint: http://localhost:9999/.well-known/jwks.json
```

### A.3 Configurar `.env` para que la app use el JWKS local

```bash
# Comenta las líneas de Keycloak originales y usa:
KEYCLOAK_JWKS_URI=http://localhost:9999/.well-known/jwks.json
KEYCLOAK_ISSUER=http://eliza.test/realms/eliza
KEYCLOAK_AUDIENCE=eliza-api
KEYCLOAK_BASE_URL=http://localhost:8080
KEYCLOAK_REALM=eliza
KEYCLOAK_CLIENT_ID=eliza-api
KEYCLOAK_CLIENT_SECRET=local-only
```

Reinicia la app:

```bash
pnpm start:dev
```

### A.4 Probar el JwtAuthGuard

```bash
# Generar token e inyectarlo en variable
pnpm ts-node scripts/gen-test-jwt.ts --roles Platform.Admin > /tmp/jwt.out
export ELIZA_TOKEN="$(grep -A0 '^eyJ' /tmp/jwt.out | head -1)"

# Endpoint público — sin auth
curl -i http://localhost:3000/health

# Endpoint protegido SIN token → 401
curl -i http://localhost:3000/api/v1/me

# Endpoint protegido CON token válido → 200 + claims
curl -sS http://localhost:3000/api/v1/me/claims \
  -H "Authorization: Bearer $ELIZA_TOKEN" | jq

# Token expirado o firma alterada → 401
curl -i http://localhost:3000/api/v1/me \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.tampered.signature"
```

Respuesta esperada de `/api/v1/me/claims`:

```json
{
  "keycloakSubject": "00000000-0000-0000-0000-000000000001",
  "email":           "santo@eliza.test",
  "tenantId":        "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "plantId":         "plant-001",
  "warehouseId":     "wh-001",
  "roles":           ["Platform.Admin"]
}
```

### A.5 Probar RolesGuard

```bash
# Generar tokens con distintos roles
pnpm ts-node scripts/gen-test-jwt.ts --roles Platform.Admin    # Platform Admin
pnpm ts-node scripts/gen-test-jwt.ts --roles Manufacturing.Operator  # No Platform.Admin

export ADMIN_TOKEN="<token con Platform.Admin>"
export OPERATOR_TOKEN="<token sin Platform.Admin>"

# Endpoint que requiere Platform.Admin con token CORRECTO → 200
curl -sS http://localhost:3000/api/v1/platform/tenants \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# Mismo endpoint con token sin el rol → 403
curl -i http://localhost:3000/api/v1/platform/tenants \
  -H "Authorization: Bearer $OPERATOR_TOKEN"
```

Respuesta 403:

```json
{
  "type":     "https://docs.eliza.app/errors/http-403",
  "title":    "Forbidden",
  "status":   403,
  "detail":   "This action requires one of the following roles: Platform.Admin",
  "code":     "http.403",
  "correlationId": "01H..."
}
```

---

## Modo B — Testing con Keycloak real

### B.1 Levantar la infraestructura

```bash
pnpm infra:up
```

El `docker-compose.yml` monta `./keycloak/realm/` que importa **automáticamente** el realm `eliza` con:
- Cliente `eliza-api` configurado
- 20 roles ELIZA preconfigurados
- Token mappers para `tenant_id`, `plant_id`, `warehouse_id` y `audience`
- Password policy (10 chars, mix)

Verifica:

```bash
# Realm importado
curl -s http://localhost:8080/realms/eliza/.well-known/openid-configuration | jq .issuer
# → "http://localhost:8080/realms/eliza"

# JWKS de Keycloak
curl -s http://localhost:8080/realms/eliza/protocol/openid-connect/certs | jq '.keys[0].kid'
```

### B.2 Crear usuario admin manualmente en Keycloak

Para el primer Platform Admin, créalo desde la UI:

1. http://localhost:8080 → Administration Console
2. Login: `admin / admin`
3. Select realm: `eliza`
4. Users → Add user → email `platform-admin@eliza.app`, set permanent password
5. Role mapping → Client roles → `eliza-api` → asigna `Platform.Admin`
6. Attributes → `tenant_id` = `00000000-0000-0000-0000-000000000000` (puede ser cualquier UUID, Platform Admin no pertenece a un tenant real)

### B.3 Obtener un token via password grant

```bash
TOKEN_RESPONSE=$(curl -sS -X POST \
  "http://localhost:8080/realms/eliza/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=eliza-api" \
  -d "client_secret=replace-me-in-production" \
  -d "username=platform-admin@eliza.app" \
  -d "password=YourSecret1!")

export ELIZA_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r .access_token)
echo $ELIZA_TOKEN | cut -c1-60; echo "..."
```

### B.4 Configurar `.env` con Keycloak real

```bash
KEYCLOAK_JWKS_URI=http://localhost:8080/realms/eliza/protocol/openid-connect/certs
KEYCLOAK_ISSUER=http://localhost:8080/realms/eliza
KEYCLOAK_AUDIENCE=eliza-api
KEYCLOAK_BASE_URL=http://localhost:8080
KEYCLOAK_REALM=eliza
KEYCLOAK_CLIENT_ID=eliza-api
KEYCLOAK_CLIENT_SECRET=replace-me-in-production
KEYCLOAK_ADMIN_USERNAME=admin
KEYCLOAK_ADMIN_PASSWORD=admin
```

Reinicia la app.

---

## 3. Endpoints del Sprint 2

### 3.1 `GET /api/v1/me` — Usuario autenticado

```bash
curl -sS http://localhost:3000/api/v1/me \
  -H "Authorization: Bearer $ELIZA_TOKEN" | jq
```

> **Importante**: este endpoint resuelve el User local que corresponde al JWT. Si el `sub` del JWT no tiene un User local en ELIZA, devuelve 404. Crea el usuario primero vía `POST /api/v1/platform/users`.

### 3.2 `GET /api/v1/me/claims` — Claims debug

```bash
curl -sS http://localhost:3000/api/v1/me/claims \
  -H "Authorization: Bearer $ELIZA_TOKEN" | jq
```

### 3.3 `POST /api/v1/platform/users` — Crear usuario (Platform Admin)

```bash
curl -sS -X POST http://localhost:3000/api/v1/platform/users \
  -H "Authorization: Bearer $ELIZA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "operator1@bcm-congelados.com",
    "fullName": "Operario Uno",
    "tenantId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "roles": ["Manufacturing.Operator"],
    "sendActivationEmail": false
  }' | jq
```

**Solo funciona con Keycloak real** (Modo B). El use case llama a la Admin API y persiste localmente. En logs verás:

```
[CreateUser] Keycloak user created for operator1@bcm-congelados.com: sub=abc-123
[PrismaUserRepository] Persisted 2 events for user xyz-456
```

Verifica en Keycloak:
```bash
curl -sS http://localhost:8080/admin/realms/eliza/users?email=operator1 \
  -H "Authorization: Bearer $(echo $TOKEN_RESPONSE | jq -r .access_token)"
```

### 3.4 `POST /api/v1/platform/users/:id/activate`

```bash
export USER_ID="abc-123-..."  # del response anterior

curl -sS -X POST "http://localhost:3000/api/v1/platform/users/$USER_ID/activate" \
  -H "Authorization: Bearer $ELIZA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"expectedVersion": 1}' | jq
```

Esto:
1. Cambia el User a `Active` en ELIZA
2. Habilita el usuario en Keycloak (`enabled: true`)
3. Emite `iam.UserActivated.v1` en la outbox

### 3.5 `POST /api/v1/platform/users/:id/memberships` — Otorgar membresía

```bash
curl -sS -X POST "http://localhost:3000/api/v1/platform/users/$USER_ID/memberships" \
  -H "Authorization: Bearer $ELIZA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "roles": ["Sales.Manager"]
  }' | jq
```

### 3.6 `POST /api/v1/platform/users/:id/roles` — Asignar un rol

```bash
curl -sS -X POST "http://localhost:3000/api/v1/platform/users/$USER_ID/roles" \
  -H "Authorization: Bearer $ELIZA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "role": "Quality.Inspector"
  }' | jq
```

### 3.7 `POST /api/v1/tenants/me/users` — Tenant Admin invita usuario

Generar token con `Tenant.Admin`:

```bash
pnpm ts-node scripts/gen-test-jwt.ts \
  --tenant 7c9e6679-7425-40de-944b-e07fc1f90ae7 \
  --roles Tenant.Admin > /tmp/tenant.out
export TENANT_TOKEN="$(grep -A0 '^eyJ' /tmp/tenant.out | head -1)"

curl -sS -X POST http://localhost:3000/api/v1/tenants/me/users \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "salesperson1@bcm-congelados.com",
    "fullName": "Vendedor Uno",
    "roles": ["Sales.Salesperson"]
  }' | jq
```

Nota: **el `tenantId` se toma del JWT**, no del body. El Tenant Admin solo puede invitar a su propio tenant.

### 3.8 `GET /api/v1/tenants/me/users` — Listar usuarios del tenant

```bash
curl -sS "http://localhost:3000/api/v1/tenants/me/users?page=1&pageSize=20" \
  -H "Authorization: Bearer $TENANT_TOKEN" | jq
```

---

## 4. Verificación de eventos en outbox

```bash
docker exec -it eliza-postgres psql -U postgres -d eliza -c "
  SELECT event_type, status, occurred_at, jsonb_extract_path_text(payload, 'email') AS email
  FROM platform.outbox_events
  WHERE event_type LIKE 'iam.%'
  ORDER BY occurred_at DESC LIMIT 10;
"
```

Verás `iam.UserCreated.v1`, `iam.MembershipGranted.v1`, `iam.UserActivated.v1`, `iam.RoleAssigned.v1`, etc.

---

## 5. Verificación de compensación (saga rollback)

Para probar que el rollback de Keycloak funciona si falla la persistencia local, podemos romper la BD intencionalmente:

```bash
# Apaga Postgres mientras la app sigue arriba
docker stop eliza-postgres

# Intenta crear un usuario
curl -i -X POST http://localhost:3000/api/v1/platform/users \
  -H "Authorization: Bearer $ELIZA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"rollback@test.com","fullName":"Rollback Test","tenantId":"7c9e6679-7425-40de-944b-e07fc1f90ae7"}'

# Respuesta: 503 con code iam.user_persist_failed

# En los logs verás:
#   [CreateUser] Keycloak user created for rollback@test.com: sub=xyz
#   [CreateUser] Compensating Keycloak user xyz: local persist failed: ...

# Verifica en Keycloak — el usuario NO debe existir
docker start eliza-postgres
# Espera unos segundos a que se recupere
curl -sS "http://localhost:8080/admin/realms/eliza/users?email=rollback@test.com" \
  -H "Authorization: Bearer $(echo $TOKEN_RESPONSE | jq -r .access_token)" | jq
# → []  (vacío, la compensación borró el orphan)
```

---

## 6. Swagger

Abre `http://localhost:3000/docs`. Verás cuatro nuevos grupos:
- **IAM · Me** — `/me`, `/me/claims`
- **Platform · Users** — CRUD completo
- **Tenant · Users** — self-service del tenant
- **Diagnostics** — sigue funcionando

Para autenticar en Swagger:
1. Botón **Authorize** (candado)
2. Pega el JWT (sin el prefijo `Bearer`)
3. Authorize → Close

---

## 7. Cobertura de pruebas

| Componente | Comando | Cobertura mínima |
|---|---|---|
| Domain User | `pnpm test src/contexts/iam/domain` | ≥ 90% |
| Use cases  | `pnpm test src/contexts/iam/application` | ≥ 80% |
| Auth guards | `pnpm test src/contexts/iam/infrastructure/auth` | ≥ 75% |

---

## 8. Troubleshooting

### `JWT.UnauthorizedException: Unknown kid`

El JwtAuthGuard no encontró la clave correspondiente al `kid` del token. Posibles causas:
1. El servidor JWKS no está arriba (`pnpm ts-node scripts/jwks-server.ts`)
2. `KEYCLOAK_JWKS_URI` apunta a Keycloak pero estás usando token local (o viceversa)
3. La caché de JWKS guardó una versión vieja — reinicia la app para limpiarla

### `Authentication failed: jwt issuer invalid`

El claim `iss` del token no coincide con `KEYCLOAK_ISSUER`. Asegúrate de que ambos digan exactamente lo mismo (incluyendo trailing slashes y http/https).

### `Authentication failed: jwt audience invalid`

El claim `aud` debe incluir `KEYCLOAK_AUDIENCE`. Si usas Keycloak real, asegúrate que el token mapper `audience-mapper` está configurado en el cliente `eliza-api`.

### `[CreateUser] Keycloak user creation failed: 409 Conflict`

El email ya existe en Keycloak (probablemente de un test anterior). Bórralo desde la UI o:

```bash
USER_KC_ID=$(curl -s "http://localhost:8080/admin/realms/eliza/users?email=test@example.com" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.[0].id')

curl -X DELETE "http://localhost:8080/admin/realms/eliza/users/$USER_KC_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```
