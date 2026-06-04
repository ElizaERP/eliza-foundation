# 🚀 ELIZA Foundation Platform — Getting Started

> **Objetivo**: que pases de `git clone` a tener la app corriendo, probada y lista para extender en **15 minutos**.

Esta guía cubre tres modos de uso:

| Modo | Para qué | Cuándo |
|---|---|---|
| **A — Desarrollo nativo** | `pnpm start:dev` con la infra en Docker | Día a día de programar |
| **B — Todo en Docker** | App + infra en contenedores con `docker compose` | Validar antes de OCI |
| **C — Kubernetes / OCI** | Despliegue real en OKE de Oracle | Producción |

---

## 📋 Pre-requisitos

| Herramienta | Versión mínima | Cómo instalar |
|---|---|---|
| Node.js | 20.x | `nvm install 20 && nvm use 20` |
| pnpm | 9.x | `corepack enable && corepack prepare pnpm@9 --activate` |
| Docker + Docker Compose | 24.x / v2 | https://docs.docker.com/get-docker |
| jq | 1.6+ | `apt install jq` / `brew install jq` |
| Opcional: `make` | cualquiera | viene preinstalado en Mac/Linux |
| Opcional: `kubectl` | 1.28+ | https://kubernetes.io/docs/tasks/tools/ |
| Opcional: `terraform` | 1.5+ | https://developer.hashicorp.com/terraform/install |

Verifica:

```bash
node --version    # v20.x
pnpm --version    # 9.x
docker --version  # 24.x+
jq --version      # 1.6+
```

---

## 🅰️ Modo A — Desarrollo nativo (RECOMENDADO para empezar)

### Paso 1 — Instalar dependencias

```bash
git clone <repo-url> eliza-foundation
cd eliza-foundation

make install
# equivalente a: pnpm install
```

### Paso 2 — Configurar variables de entorno

```bash
cp .env.example .env
```

El `.env` ya viene con valores razonables para dev local. **No necesitas tocarlo** si vas a usar Postgres y Redis en Docker (paso siguiente). Más adelante, si quieres entender qué hace cada variable, lee `ENVIRONMENT.md`.

### Paso 3 — Levantar la infraestructura

```bash
make infra-up
# equivalente a: docker compose up -d
```

Esto arranca tres contenedores:

| Servicio | Puerto | Para qué |
|---|---|---|
| `eliza-postgres` | 5432 | Base de datos principal |
| `eliza-redis` | 6379 | Cache + bus de eventos (Sprint 4) |
| `eliza-keycloak` | 8080 | Identity Provider |

Verifica que están healthy:

```bash
docker compose ps
# Los 3 deben aparecer en estado "running" o "healthy"
```

> **Primera vez**: Keycloak tarda ~30s en bootear. La app reintenta automáticamente al iniciar.

### Paso 4 — Aplicar las migraciones

```bash
make db-migrate
# equivalente a: pnpm prisma migrate dev
```

Si es tu primera vez, Prisma te pedirá nombre para la migración inicial. Acepta o pon `init`.

### Paso 5 — Generar el JWKS local (sin Keycloak)

Para no depender de Keycloak para el primer arranque, ELIZA puede validar JWTs firmados localmente:

```bash
# Genera un par de llaves RSA y un JWT de Platform.Admin de muestra
make jwt
```

Verás en pantalla algo como:

```
=== ELIZA Test JWT (RS256, signed) ===
tenant_id: 7c9e6679-7425-40de-944b-e07fc1f90ae7
sub:       00000000-0000-0000-0000-000000000001
email:     santo@eliza.test
roles:     Platform.Admin
expires:   2026-06-04T11:30:00.000Z

--- Bearer token ---
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVC...
```

En otra terminal, arranca el servidor que sirve el JWKS local (esto reemplaza temporalmente al endpoint JWKS de Keycloak):

```bash
make jwks-server
# Sale: 🔑 Local JWKS server listening on http://localhost:9999
```

Y edita tu `.env` para que apunte al JWKS local:

```bash
# En .env, busca y reemplaza:
KEYCLOAK_JWKS_URI=http://localhost:9999/.well-known/jwks.json
```

> 💡 Más adelante, cuando quieras probar Keycloak real, vuelves a poner la URL de Keycloak (`http://localhost:8080/realms/eliza/protocol/openid-connect/certs`).

### Paso 6 — Arrancar la app

```bash
make dev
# equivalente a: pnpm start:dev
```

Deberías ver en los logs:

```
[Nest] LOG [NestApplication] Nest application successfully started
[OutboxDispatcher] Outbox dispatcher ENABLED node=tu-pc-12345 batch=50 poll=1000ms
[TenantSummaryProjector] TenantSummaryProjector subscribed to 10 event types
ELIZA Foundation listening on http://localhost:3000
Swagger:  http://localhost:3000/docs
```

🎉 La app está corriendo.

### Paso 7 — Verificar que TODO funciona (smoke test)

En una **tercera terminal**:

```bash
make smoke
```

El script `scripts/smoke-test.sh` ejecuta automáticamente:

- Health check → debe pasar
- Generación de JWT → debe funcionar
- Tenant lifecycle (create + activate + 409 conflict) → debe pasar
- IAM guards (401 sin token, 403 con rol incorrecto) → debe rechazar
- Audit chain integrity → debe ser válida
- Outbox publica eventos → debe haber `published > 0`
- TenantSummary read model → debe contener el tenant creado

Si todo pasa, **la Foundation está bien instalada** ✅. Si algo falla, ver sección [Troubleshooting](#troubleshooting) al final.

### Paso 8 — Explorar Swagger

Abre `http://localhost:3000/docs` en el navegador. Verás los 38 endpoints documentados, agrupados por dominio:

- **Health** — health/ready/db
- **Diagnostics** — diagnósticos del tenant context y RLS
- **Platform · Tenants** — administración multi-tenant
- **Tenant · Self** — endpoints de "mi tenant"
- **IAM · Me** — perfil del usuario autenticado
- **Platform · Users** / **Tenant · Users** — gestión de usuarios
- **Audit** — consulta forense + verify-chain
- **Platform · Outbox** — monitoreo del bus de eventos
- **Platform · Read Models** — vista materializada del tenant summary

Para autenticarte en Swagger:
1. Botón **Authorize** 🔓 arriba a la derecha
2. Pega el JWT que generó `make jwt` (sin el prefijo `Bearer`)
3. **Authorize** → **Close**
4. Ahora todos los endpoints "candado" se pueden ejecutar

---

## 🅱️ Modo B — Todo en Docker (validar antes de OCI)

Este modo levanta la app **dentro de contenedores**, igual que en producción, con el patrón writers + workers + nginx. Útil para detectar problemas que solo ocurren en contenedor (DNS interno, permisos, no-root user).

### Paso 1 — Construir la imagen

```bash
make docker-build
# equivalente a: docker build -t eliza-foundation:dev .
```

Primera vez: ~3 min. Sucesivas: <30s gracias al cache.

### Paso 2 — Levantar la pila completa

```bash
make docker-run
# levanta postgres + redis + keycloak + 2 writers + 1 worker + nginx
```

Verás 7 contenedores corriendo. Verifica con:

```bash
docker compose -f docker-compose.yml -f docker-compose.app.yml ps
```

### Paso 3 — Probar a través del nginx

```bash
# Mismo puerto que en modo A — nginx redirige a los writers
curl http://localhost:3000/health | jq

# Los headers de proxy llegan correctamente
curl -v http://localhost:3000/health 2>&1 | grep -i "x-correlation\|x-real-ip"
```

### Paso 4 — Validar el patrón writers/workers

En este modo, los writers NO despachan eventos (solo escriben en outbox); solo el worker lo hace. Para confirmarlo:

```bash
# Logs de los writers — NO debe aparecer "Outbox dispatcher ENABLED"
docker compose -f docker-compose.yml -f docker-compose.app.yml \
  logs eliza-writers | grep -i dispatcher
# (sin output)

# Logs del worker — SÍ debe aparecer
docker compose -f docker-compose.yml -f docker-compose.app.yml \
  logs eliza-worker | grep -i dispatcher
# → [OutboxDispatcher] Outbox dispatcher ENABLED node=...
```

### Paso 5 — Apagar

```bash
make docker-stop
```

---

## 🅲️ Modo C — Despliegue real en OCI

> Para esto necesitas: cuenta OCI activa, OCI CLI configurado, kubectl, terraform.

### Paso 1 — Provisionar infraestructura con Terraform

```bash
cd terraform

# Copiar la plantilla y rellenar con TUS OCIDs
cp staging.tfvars.example staging.tfvars
# Editar staging.tfvars con tus valores reales

terraform init
terraform plan -var-file=staging.tfvars
# Revisar el plan: ~30-40 recursos a crear

terraform apply -var-file=staging.tfvars
# Tarda 25-40 min (OKE y Postgres son los lentos)
```

Tras el `apply`, los `outputs` te dirán los OCIDs de cada recurso. Guárdalos.

### Paso 2 — Configurar kubectl

```bash
oci ce cluster create-kubeconfig \
  --cluster-id $(terraform output -raw oke_cluster_id) \
  --file ~/.kube/config \
  --region us-ashburn-1 \
  --token-version 2.0.0

kubectl get nodes
# Debe mostrar 3 nodos Ready
```

### Paso 3 — Bootstrap de Postgres

Conéctate al bastion y aplica el bootstrap:

```bash
# Crear el SSH tunnel al bastion
ssh -L 5432:db-endpoint:5432 opc@bastion-ip

# En otra terminal
psql "postgresql://postgres:PWD@localhost:5432/postgres"
\i prisma/init/01_bootstrap.sql
```

Esto crea:
- DB `eliza`
- Roles `app_user` y `migration_user`
- Schemas `tenant`, `iam`, `audit`, `platform`
- Función `platform.current_tenant_id()`

### Paso 4 — Subir los secretos a Vault

```bash
VAULT_ID=$(terraform output -raw vault_id)
KEY_ID=$(terraform output -raw kms_key_id)

oci vault secret create-base64 \
  --vault-id $VAULT_ID \
  --key-id $KEY_ID \
  --secret-name "eliza-database-url" \
  --secret-content-content "$(echo -n 'postgresql://app_user:PWD@host:5432/eliza?sslmode=require' | base64)"

# Repetir para: database-migration-url, redis-password, keycloak-client-secret, keycloak-admin-password
```

### Paso 5 — Push de la imagen a OCIR

```bash
# Login a OCIR (usa Auth Token, no password de usuario)
docker login iad.ocir.io \
  -u "<tenancy-namespace>/<user>" \
  -p "<auth-token>"

VERSION=v0.1.0
make docker-build VERSION=$VERSION
make docker-push-ocir VERSION=$VERSION OCIR_TENANCY=<tu-namespace>
```

### Paso 6 — Instalar External Secrets Operator

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace
```

### Paso 7 — Aplicar manifiestos

```bash
# Reemplazar placeholders en los manifiestos con tu tenancy + version
sed -i "s|REPLACE_TENANCY|<tu-tenancy-namespace>|g" k8s/*.yaml
sed -i "s|REPLACE_VERSION|v0.1.0|g" k8s/*.yaml

# Rellenar también los OCIDs en k8s/03-external-secret.yaml
# (vault OCID, tenancy OCID, user OCID)

make k8s-apply
# equivalente a:
#   kubectl apply -f k8s/01-namespace.yaml
#   kubectl apply -f k8s/02-configmap.yaml
#   kubectl apply -f k8s/03-external-secret.yaml
#   kubectl apply -f k8s/04-migration-job.yaml  (espera a complete)
#   kubectl apply -f k8s/05-deployments.yaml
#   kubectl apply -f k8s/06-ingress-hpa-netpol.yaml
```

### Paso 8 — Verificar

```bash
make k8s-status
# Debe haber 3 writers Ready y 2 workers Ready

# Logs
make k8s-logs-writers
make k8s-logs-workers

# Smoke test contra el LB público
API=https://api.eliza.app/api/v1 make smoke
```

### CI/CD automatizado

A partir de aquí, los siguientes deploys son automáticos. Configura los secrets del repo en GitHub (ver header de `.github/workflows/release.yml`) y cada `git tag vX.Y.Z` disparará:

1. Build de la imagen
2. Push a OCIR
3. Apply de las migraciones
4. Rollout sin downtime de writers y workers

---

## 🛠️ Comandos útiles del Makefile

```bash
make help              # ver todos los comandos
make infra-up          # levantar Postgres+Redis+Keycloak
make db-studio         # abrir UI de Prisma para inspeccionar la BD
make jwt               # generar un JWT de prueba al vuelo
make smoke             # ejecutar el smoke test end-to-end
make k8s-logs-writers  # logs en vivo de los writers en OKE
make tf-plan           # ver qué cambia Terraform antes de aplicar
make nuke              # CUIDADO: limpia todo (incluyendo BD)
```

---

## ❓ Troubleshooting

### "Cannot find module '@prisma/client'"

```bash
make db-generate
# equivalente a: pnpm prisma generate
```

### "ECONNREFUSED 127.0.0.1:5432"

Postgres no está arriba o aún no termina de iniciar:

```bash
docker compose ps  # ¿postgres está healthy?
docker compose logs postgres
```

### "Authentication failed: jwt issuer invalid"

El claim `iss` del token no coincide con `KEYCLOAK_ISSUER` en `.env`. Si usas el JWKS local:

```bash
# .env
KEYCLOAK_ISSUER=http://eliza.test/realms/eliza
KEYCLOAK_AUDIENCE=eliza-api
```

### "Unknown kid: eliza-dev-key-1"

El JWKS server no está corriendo. Abre otra terminal y ejecuta:

```bash
make jwks-server
```

### "Outbox events stay Pending forever"

El dispatcher no está activado o tiene un error. Verifica:

```bash
# 1. En .env
OUTBOX_DISPATCHER_ENABLED=true

# 2. En los logs de la app debe aparecer:
# [OutboxDispatcher] Outbox dispatcher ENABLED ...
```

### El smoke test falla en el último check (read model)

Es posible que el dispatcher aún no haya procesado el evento. El smoke test espera 3s; si tu máquina es lenta, sube ese sleep en `scripts/smoke-test.sh`. O verifica manualmente:

```bash
curl -s "http://localhost:3000/api/v1/platform/outbox/stats" \
  -H "Authorization: Bearer $(make jwt | tail -1)" | jq
```

### Más problemas

- Variables de entorno: `ENVIRONMENT.md` documenta cada una
- Detalles de endpoints: `API-REFERENCE.md`
- Testing por sprint: `TESTING.md`, `TESTING-SPRINT1.md` … `TESTING-SPRINT4.md`
- Despliegue completo OCI: `DEPLOYMENT-OCI.md`

---

## 🎯 Próximos pasos sugeridos

Una vez que tengas la Foundation corriendo:

1. **Probar Keycloak real** — Cambia `KEYCLOAK_JWKS_URI` al endpoint de Keycloak (puerto 8080), apaga el `jwks-server`, y prueba el flujo de login completo desde Postman.
2. **Personalizar el realm** — `keycloak/realm/eliza-realm.json` viene preconfigurado con 20 roles y el client `eliza-api`. Edítalo según tu organización.
3. **Construir el primer módulo de negocio** — La Foundation está completa. El siguiente Bounded Context (ej. Catalog, Manufacturing, Sales) sigue el mismo patrón: domain → application → infrastructure → interface → module.
4. **Documentar tu setup específico** — Anota en una wiki interna los OCIDs, regiones, equipo on-call, runbook de incidentes.
