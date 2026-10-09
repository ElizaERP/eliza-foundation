# 🔧 ELIZA Foundation Platform — Manual de Variables de Entorno

Catálogo completo y autoritativo de **todas** las variables que la aplicación consume, organizado por dominio. Para cada una se documenta:

- **Tipo y formato**
- **Valor default** (si lo hay)
- **Obligatoriedad** por entorno
- **Sensibilidad** (¿va en `.env` o en Vault?)
- **Dónde se valida** (la validación Joi está en `src/config/env.validation.ts`)

> Para el despliegue específico en Oracle Cloud Infrastructure (OCI), ver `DEPLOYMENT-OCI.md`.

---

## 🗂️ Clasificación de sensibilidad

| Nivel | Dónde almacenar | Ejemplos |
|---|---|---|
| **🟢 Pública** | `.env`, ConfigMap | `APP_PORT`, `LOG_LEVEL`, `NODE_ENV` |
| **🟡 Configuración** | ConfigMap (k8s) o variables de entorno | `DATABASE_URL` (host/puerto), `KEYCLOAK_BASE_URL` |
| **🔴 Secreto** | **Vault / Secret Manager / k8s Secret** | `DATABASE_URL` (password), `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_ADMIN_PASSWORD` |

**Regla**: cualquier variable que contenga una credencial, llave privada, o token NUNCA va en `.env.example` ni en un ConfigMap; va siempre en un Secret.

---

## 📋 Catálogo completo

### 1. Application core (🟢 pública)

| Variable | Tipo | Default | Producción | Descripción |
|---|---|---|---|---|
| `NODE_ENV` | enum | `development` | `production` | `development \| test \| staging \| production`. Activa lógicas específicas (sin Swagger en prod, sin diagnostics, etc) |
| `APP_NAME` | string | `eliza-foundation` | `eliza-foundation` | Nombre del servicio. Usado en logs y headers |
| `APP_PORT` | int | `3000` | `3000` | Puerto del HTTP server |
| `APP_GLOBAL_PREFIX` | string | `api` | `api` | Prefijo de todas las rutas (excepto `/health` y `/docs`) |
| `APP_VERSION` | string | `v1` | `v1` | Versión por defecto del API (URI versioning) |
| `LOG_LEVEL` | enum | `debug` | `info` | `fatal \| error \| warn \| info \| debug \| trace` |

### 2. PostgreSQL (🟡 + 🔴)

| Variable | Tipo | Default | Producción | Descripción |
|---|---|---|---|---|
| `DATABASE_URL` | URL **🔴** | — | obligatoria | Connection string completa con usuario `app_user`. Formato: `postgresql://app_user:<PASSWORD>@<host>:5432/eliza?schema=public&sslmode=require` |
| `DATABASE_MIGRATION_URL` | URL **🔴** | — | obligatoria | Connection string con `migration_user` (tiene DDL). SOLO se usa al ejecutar `prisma migrate deploy` durante pipelines |
| `DATABASE_POOL_MIN` | int | `2` | `5` | Conexiones mínimas en el pool |
| `DATABASE_POOL_MAX` | int | `10` | `20` | Conexiones máximas. Ajustar según cores × workers |
| `DATABASE_STATEMENT_TIMEOUT_MS` | int | `30000` | `30000` | Statement timeout en ms; protege contra queries colgadas |

**Ejemplo producción** (en Vault):
```
DATABASE_URL=postgresql://app_user:M1n%21S3cr3t@db-prod.subnet.oraclevcn.com:5432/eliza?sslmode=require
```

> **Importante**: si el password contiene caracteres especiales (`@`, `:`, `/`), URL-encode obligatorio (ej. `@` → `%40`).

### 3. Redis (🟡 + 🔴)

| Variable | Tipo | Default | Producción | Descripción |
|---|---|---|---|---|
| `REDIS_HOST` | string | `localhost` | obligatoria | Host o DNS del Redis |
| `REDIS_PORT` | int | `6379` | `6379` | Puerto |
| `REDIS_PASSWORD` | string **🔴** | `` | obligatoria | Password en producción; vacía solo en dev local |
| `REDIS_DB` | int | `0` | `0` | Database index (0-15) |
| `REDIS_KEY_PREFIX` | string | `eliza:` | `eliza:<env>:` | Prefijo de keys. En staging usar `eliza:staging:` |

### 4. Keycloak — JWT validation (🟡)

Variables que la app usa para validar JWTs entrantes.

| Variable | Tipo | Default | Producción | Descripción |
|---|---|---|---|---|
| `KEYCLOAK_JWKS_URI` | URL | obligatoria | obligatoria | Endpoint público del JWKS. Ej: `https://auth.eliza.app/realms/eliza/protocol/openid-connect/certs` |
| `KEYCLOAK_ISSUER` | URL | obligatoria | obligatoria | Claim `iss` esperado. Debe coincidir EXACTAMENTE con el del token |
| `KEYCLOAK_AUDIENCE` | string | obligatoria | `eliza-api` | Claim `aud` esperado |
| `JWT_ALGORITHM` | enum | `RS256` | `RS256` | `RS256 \| RS384 \| RS512` |
| `JWT_CACHE_MAX_AGE_MS` | int | `600000` | `600000` | Caché de claves públicas en ms (10 min) |

### 5. Keycloak — Admin API (🟡 + 🔴)

Variables que la app usa para hablar con la Admin API de Keycloak (provisión de usuarios).

| Variable | Tipo | Default | Producción | Descripción |
|---|---|---|---|---|
| `KEYCLOAK_BASE_URL` | URL | obligatoria | obligatoria | URL base de Keycloak. Ej: `https://auth.eliza.app` |
| `KEYCLOAK_REALM` | string | obligatoria | `eliza` | Nombre del realm |
| `KEYCLOAK_CLIENT_ID` | string | obligatoria | `eliza-api` | Client ID del backend |
| `KEYCLOAK_CLIENT_SECRET` | string **🔴** | obligatoria | obligatoria | Client secret. Generado en Keycloak Admin Console |
| `KEYCLOAK_ADMIN_USERNAME` | string | `admin` | obligatoria | Service account o admin user con permisos en el realm |
| `KEYCLOAK_ADMIN_PASSWORD` | string **🔴** | `admin` | obligatoria | Password del admin user. En producción USAR un service account con privilegios MÍNIMOS, no el root admin |

**Login de la app a través de la API** (`POST /api/v1/auth/login`, `/refresh`, `/logout`). Opcionales: si faltan, esas rutas responden 503 y el resto de la API funciona igual.

| Variable | Tipo | Default | Producción | Descripción |
|---|---|---|---|---|
| `KEYCLOAK_LOGIN_CLIENT_ID` | string | vacío | `eliza-app-login` | Cliente confidencial con solo *direct access grants* y los mappers de `eliza-mobile` (tenant_id, plant_id, warehouse_id, audiencia `eliza-api`) |
| `KEYCLOAK_LOGIN_CLIENT_SECRET` | string **🔴** | vacío | obligatoria si se usa el login de la app | Secreto de ese cliente. En DEV lo escribe `crear-cliente-app-login.sh` en `api.env` |

> **Hardening en producción**: en lugar de password grant del realm master, usar un service-account client con grant `client_credentials` y el rol `manage-users` solo sobre el realm `eliza`. Esto se documenta en `DEPLOYMENT-OCI.md`.

### 6. Tenant resolution (🟢)

| Variable | Tipo | Default | Producción | Descripción |
|---|---|---|---|---|
| `TENANT_RESOLUTION_STRATEGY` | csv | `jwt,header` | `jwt` | Estrategias en orden de prioridad: `jwt`, `header`, `subdomain` |
| `TENANT_HEADER_NAME` | string | `X-Tenant-Id` | `X-Tenant-Id` | Header alterno si está habilitada la estrategia `header` |
| `TENANT_REQUIRE_ACTIVE` | bool | `true` | `true` | Rechazar requests si el tenant del JWT no está Active |

> **Producción**: usar SOLO `jwt`. La estrategia `header` es para testing y herramientas internas; nunca debe estar habilitada con tráfico público.

### 7. Observabilidad (🟢)

| Variable | Tipo | Default | Producción | Descripción |
|---|---|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | URL | `http://localhost:4318` | obligatoria | Endpoint OTLP HTTP del collector. Ej OCI: `http://otel-collector.observability.svc.cluster.local:4318` |
| `OTEL_SERVICE_NAME` | string | `eliza-foundation` | `eliza-foundation` | Nombre del servicio en traces |
| `METRICS_ENABLED` | bool | `true` | `true` | Expone `/metrics` para Prometheus |
| `TRACING_ENABLED` | bool | `true` | `true` | Activa OTEL tracing |

### 8. Seguridad (🟢 + 🟡)

| Variable | Tipo | Default | Producción | Descripción |
|---|---|---|---|---|
| `HELMET_ENABLED` | bool | `true` | `true` | Headers de seguridad (HSTS, X-Frame-Options, etc.) |
| `TRUST_PROXY` | string | `loopback, linklocal, uniquelocal` | según la red | Proxies confiables para `X-Forwarded-For` (sintaxis de Express). Define `req.ip`: límite de intentos del login e IP de auditoría |
| `CORS_ORIGINS` | csv | `` | obligatoria | Lista de origenes permitidos. Ej: `https://app.eliza.com,https://admin.eliza.com`. Vacío = bloqueado |
| `THROTTLE_TTL_SECONDS` | int | `60` | `60` | Ventana de rate limiting |
| `THROTTLE_LIMIT` | int | `100` | `1000` | Requests por ventana por IP. Subir en prod tras load balancer con IP real |

### 9. Outbox Dispatcher (🟢) — Sprint 4

Variables que controlan el worker que publica eventos del outbox al bus.

| Variable | Tipo | Default | Producción | Descripción |
|---|---|---|---|---|
| `OUTBOX_DISPATCHER_ENABLED` | bool | `true` | depende del Deployment | Activa el worker. En k8s se puede tener un Deployment "writers" con esto en `false` (solo escribe en outbox) y otro "workers" en `true` (despacha) |
| `OUTBOX_BATCH_SIZE` | int | `50` | `100` | Eventos por lease. Más grande = más throughput pero más memoria y mayor lag para retry |
| `OUTBOX_POLL_INTERVAL_MS` | int | `1000` | `500` | Frecuencia del polling. En prod típicamente 500ms |
| `OUTBOX_MAX_RETRIES` | int | `5` | `5` | Tras N intentos fallidos el evento va a DLQ |
| `OUTBOX_RETRY_BACKOFF_BASE_MS` | int | `1000` | `1000` | Backoff exponencial: retry N espera `base × 2^N` ms (máx 60s) |
| `OUTBOX_STUCK_LEASE_MS` | int | `60000` | `60000` | Tiempo en `Processing` tras el cual se considera huérfano y se re-encola |
| `OUTBOX_RECLAIM_INTERVAL_MS` | int | `30000` | `30000` | Frecuencia del job que recupera huérfanos |

### 10. Event Bus (🟢 + 🟡) — Sprint 4

| Variable | Tipo | Default | Producción | Descripción |
|---|---|---|---|---|
| `EVENT_BUS_TYPE` | enum | `in_memory` | `redis_streams` | `in_memory` solo en dev y single-pod; `redis_streams` para multi-pod (producción) |
| `EVENT_BUS_STREAM_PREFIX` | string | `eliza:event:` | `eliza:event:` | Prefijo de keys en Redis. Por ambiente usar `eliza:prod:event:` para aislar |
| `EVENT_BUS_CONSUMER_GROUP` | string | `eliza-foundation` | `eliza-foundation` | Consumer group de Redis Streams. Pods del mismo grupo se reparten carga |

---

## 🌍 Variables por entorno — vista comparativa

### Local dev (`.env`)

```bash
NODE_ENV=development
APP_PORT=3000
LOG_LEVEL=debug
DATABASE_URL=postgresql://app_user:app_password@localhost:5432/eliza
DATABASE_MIGRATION_URL=postgresql://migration_user:migration_password@localhost:5432/eliza
REDIS_HOST=localhost
REDIS_PASSWORD=
KEYCLOAK_BASE_URL=http://localhost:8080
KEYCLOAK_REALM=eliza
KEYCLOAK_CLIENT_ID=eliza-api
KEYCLOAK_CLIENT_SECRET=replace-me-in-production
KEYCLOAK_JWKS_URI=http://localhost:9999/.well-known/jwks.json  # JWKS local de testing
KEYCLOAK_ISSUER=http://eliza.test/realms/eliza
KEYCLOAK_AUDIENCE=eliza-api
KEYCLOAK_ADMIN_USERNAME=admin
KEYCLOAK_ADMIN_PASSWORD=admin
TENANT_RESOLUTION_STRATEGY=jwt,header
CORS_ORIGINS=http://localhost:5173,http://localhost:3001
```

### Staging (k8s ConfigMap + Secret)

**ConfigMap** (lo que NO es secreto):
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: eliza-foundation-config
data:
  NODE_ENV: "staging"
  APP_PORT: "3000"
  LOG_LEVEL: "info"
  REDIS_HOST: "redis.eliza-staging.svc.cluster.local"
  REDIS_KEY_PREFIX: "eliza:staging:"
  KEYCLOAK_BASE_URL: "https://auth-staging.eliza.app"
  KEYCLOAK_REALM: "eliza"
  KEYCLOAK_CLIENT_ID: "eliza-api"
  KEYCLOAK_JWKS_URI: "https://auth-staging.eliza.app/realms/eliza/protocol/openid-connect/certs"
  KEYCLOAK_ISSUER: "https://auth-staging.eliza.app/realms/eliza"
  KEYCLOAK_AUDIENCE: "eliza-api"
  TENANT_RESOLUTION_STRATEGY: "jwt"
  CORS_ORIGINS: "https://app-staging.eliza.app"
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector.observability.svc.cluster.local:4318"
  THROTTLE_LIMIT: "500"
```

**Secret** (lo que sí es secreto):
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: eliza-foundation-secrets
type: Opaque
stringData:
  DATABASE_URL: "postgresql://app_user:STAGING_PWD@db-staging.subnet.oraclevcn.com:5432/eliza?sslmode=require"
  REDIS_PASSWORD: "STAGING_REDIS_PWD"
  KEYCLOAK_CLIENT_SECRET: "STAGING_CLIENT_SECRET"
  KEYCLOAK_ADMIN_PASSWORD: "STAGING_ADMIN_PWD"
```

### Production

Idéntico a staging pero:
- Todos los secrets vienen del **OCI Vault** (no de k8s Secret en plain text)
- `LOG_LEVEL=info` (nunca `debug` en prod)
- `NODE_ENV=production` (deshabilita Swagger UI y `/api/v1/diagnostics/*`)
- `THROTTLE_LIMIT` ajustado al volumen real
- TLS/HTTPS obligatorio en todos los endpoints externos

---

## ✅ Checklist de validación al desplegar

Antes de promover a un entorno nuevo, verifica:

- [ ] **DATABASE_URL** apunta al cluster correcto y `sslmode=require`
- [ ] **DATABASE_MIGRATION_URL** SOLO existe en el job de migraciones, no en el deployment principal
- [ ] **KEYCLOAK_JWKS_URI** es accesible desde el namespace de la app (DNS interno o public si es SaaS)
- [ ] **KEYCLOAK_ISSUER** **coincide exactamente** con el claim `iss` que emiten los tokens (probar con `jwt.io`)
- [ ] **KEYCLOAK_AUDIENCE** coincide con el claim `aud`
- [ ] **CORS_ORIGINS** lista únicamente los dominios productivos (no localhost)
- [ ] **NODE_ENV=production** y por tanto `/docs` y `/diagnostics` están deshabilitados
- [ ] **Logs no exponen secrets** — verificar con grep buscando "client_secret", "password" en últimas 100 líneas
- [ ] **Las migraciones se aplicaron** — `prisma migrate status` retorna verde
- [ ] **El JWKS se cachea correctamente** — el primer request hace fetch a Keycloak, el segundo no

---

## 🚨 Errores comunes y diagnóstico

### `KEYCLOAK_JWKS_URI is required`
Falta la variable. Verifica que el Secret/ConfigMap están montados como env vars en el Pod.

### Login OK pero `Authentication failed: jwt issuer invalid`
El claim `iss` del token no coincide con `KEYCLOAK_ISSUER`. Causas comunes:
- Trailing slash inconsistente: `https://auth.eliza.app/realms/eliza/` vs sin `/`
- HTTP vs HTTPS
- Hostname interno vs externo

### `DATABASE_URL: invalid URL`
URL malformada. Verifica URL-encoding del password si contiene `@`, `:`, `/`, `%`.

### `prisma migrate deploy: insufficient_privilege`
`DATABASE_URL` está apuntando con `app_user` (sin DDL). Para migrations usar `DATABASE_MIGRATION_URL` con `migration_user`.

### App arranca pero `/api/v1/me` devuelve 503
`KEYCLOAK_BASE_URL` o credenciales admin incorrectas; la app no puede llamar a la Admin API. Test:
```bash
curl -X POST $KEYCLOAK_BASE_URL/realms/master/protocol/openid-connect/token \
  -d "grant_type=password&client_id=admin-cli&username=$KEYCLOAK_ADMIN_USERNAME&password=$KEYCLOAK_ADMIN_PASSWORD"
```

---

## 📝 Generación de un `.env` para un entorno nuevo

Plantilla `scripts/render-env.sh`:

```bash
#!/bin/bash
# Genera un .env partiendo de OCI Vault. Requiere OCI CLI configurado.
ENVIRONMENT=$1   # staging | production
VAULT_OCID=$2    # OCID del vault

oci secrets secret-bundle get --secret-id "$VAULT_OCID/database-url" \
  --query "data.\"secret-bundle-content\".content" --raw-output \
  | base64 -d > .env

# Variables no-secretas se concatenan
cat <<EOF >> .env
NODE_ENV=$ENVIRONMENT
APP_PORT=3000
LOG_LEVEL=info
# ... resto desde el ConfigMap correspondiente
EOF
```
