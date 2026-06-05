# ☁️ ELIZA Foundation Platform — Despliegue en Oracle Cloud Infrastructure

Guía paso a paso para desplegar ELIZA Foundation en **OCI** usando los servicios nativos de Oracle.

> **Pre-requisitos**: cuenta OCI activa, OCI CLI instalado y configurado (`oci setup config`), permisos de administrador en el compartment, kubectl + helm instalados localmente.

---

## 🗺️ Arquitectura objetivo en OCI

| Componente ELIZA | Servicio OCI | Notas |
|---|---|---|
| Kubernetes orquestación | **Container Engine for Kubernetes (OKE)** | Cluster managed, 1.30+ |
| Container registry | **OCI Container Registry (OCIR)** | imágenes Docker |
| PostgreSQL | **OCI Database with PostgreSQL** | Servicio managed con HA |
| Redis | **OCI Cache with Redis** o Redis on OKE | El servicio managed simplifica ops |
| Identity Provider | **Keycloak on OKE** o **OCI Identity Cloud Service (IDCS)** | Aquí usamos Keycloak self-hosted |
| Secrets | **OCI Vault + KMS** | Cifrado en reposo |
| Load Balancer | **OCI Flexible Load Balancer** | L7 con TLS termination |
| DNS | **OCI DNS Zones** | `*.eliza.app` |
| Object Storage | **OCI Object Storage** | Para futuros uploads |
| Observabilidad | **OCI Logging + Monitoring + APM** | Recopila logs, métricas, traces |
| Secrets injection en Pods | **External Secrets Operator** + Vault | Sincroniza secretos del Vault a k8s Secrets |

---

## 🏗️ Arquitectura de red

```
                                Internet
                                    │
                                    ▼
                       ┌─────────────────────────┐
                       │   OCI Public LB (L7)    │  TLS termination + WAF
                       │  *.eliza.app            │
                       └────────────┬────────────┘
                                    │
                       ┌────────────▼─────────────────────────┐
                       │ VCN  10.0.0.0/16                     │
                       │                                       │
                       │  Subnet pública  10.0.0.0/24         │
                       │    (LB endpoints)                     │
                       │                                       │
                       │  Subnet privada apps  10.0.10.0/24   │
                       │    OKE worker nodes                   │
                       │                                       │
                       │  Subnet privada data  10.0.20.0/24   │
                       │    PostgreSQL  Redis  Vault           │
                       │                                       │
                       │  Subnet bastion  10.0.30.0/24        │
                       │    Bastion host SSH/jump              │
                       └───────────────────────────────────────┘
```

**Security Lists / NSGs**:
- LB pública → 80/443 desde 0.0.0.0/0
- LB → OKE worker (port 30000-32767 NodePort)
- OKE worker → Postgres 5432 (solo desde subnet apps)
- OKE worker → Redis 6379 (solo desde subnet apps)
- Bastion → resto SSH 22 (solo desde IPs corporativas)

---

## Fase 1 — Provisionamiento de infraestructura

### 1.1 Crear el compartment

```bash
oci iam compartment create \
  --compartment-id <tenancy-ocid> \
  --name "eliza-prod" \
  --description "ELIZA Foundation Platform — Production"

export COMPARTMENT_OCID="<resulting-ocid>"
```

### 1.2 Crear VCN y subnets

Usar **Terraform** o el wizard del Console. Para Terraform (recomendado):

```hcl
# terraform/oci-vcn.tf
resource "oci_core_vcn" "eliza" {
  compartment_id = var.compartment_ocid
  cidr_block     = "10.0.0.0/16"
  display_name   = "eliza-vcn"
  dns_label      = "eliza"
}

resource "oci_core_subnet" "apps_private" {
  compartment_id      = var.compartment_ocid
  vcn_id              = oci_core_vcn.eliza.id
  cidr_block          = "10.0.10.0/24"
  display_name        = "eliza-apps-private"
  prohibit_public_ip_on_vnic = true
  dns_label           = "apps"
}

resource "oci_core_subnet" "data_private" {
  compartment_id      = var.compartment_ocid
  vcn_id              = oci_core_vcn.eliza.id
  cidr_block          = "10.0.20.0/24"
  display_name        = "eliza-data-private"
  prohibit_public_ip_on_vnic = true
  dns_label           = "data"
}

# NAT Gateway para que apps salgan a internet (Keycloak, etc)
resource "oci_core_nat_gateway" "eliza_nat" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.eliza.id
  display_name   = "eliza-nat"
}
```

### 1.3 Crear el cluster OKE

Console o CLI:

```bash
oci ce cluster create \
  --compartment-id $COMPARTMENT_OCID \
  --name "eliza-oke" \
  --kubernetes-version "v1.30.1" \
  --vcn-id <vcn-ocid> \
  --options '{
    "kubernetesNetworkConfig": {
      "podsCidr": "10.244.0.0/16",
      "servicesCidr": "10.96.0.0/16"
    }
  }'
```

Crear node pool en la subnet privada apps:

```bash
oci ce node-pool create \
  --cluster-id <cluster-ocid> \
  --compartment-id $COMPARTMENT_OCID \
  --name "eliza-pool" \
  --node-shape "VM.Standard.E4.Flex" \
  --node-shape-config '{"ocpus": 2, "memoryInGBs": 16}' \
  --size 3 \
  --placement-configs '[{"availabilityDomain": "...", "subnetId": "<apps-subnet-ocid>"}]'
```

Configurar `kubectl`:

```bash
oci ce cluster create-kubeconfig --cluster-id <cluster-ocid> \
  --file ~/.kube/config --region us-ashburn-1 --token-version 2.0.0
kubectl get nodes
```

### 1.4 PostgreSQL gestionado

```bash
oci psql db-system create \
  --compartment-id $COMPARTMENT_OCID \
  --display-name "eliza-postgres-prod" \
  --db-version "16" \
  --shape "VM.Standard.E4.Flex" \
  --instance-count 3 \
  --instance-ocpu-count 2 \
  --instance-memory-size-in-gbs 16 \
  --network-details '{"subnetId": "<data-subnet-ocid>"}' \
  --storage-details '{"isRegionallyDurable": true, "iops": 10000}' \
  --credentials '{"username": "postgres", "passwordDetails": {"passwordType": "PLAIN_TEXT", "password": "<initial-pwd>"}}'
```

Después conectarse y crear:
- DB `eliza`
- Roles `app_user` y `migration_user`
- Schemas `tenant`, `iam`, `audit`, `platform`, `catalog`
- Función `platform.current_tenant_id()`

Lo mejor: ejecutar `prisma/init/01_bootstrap.sql` (adaptado, quitando `CREATE DATABASE keycloak` si Keycloak está en su propia DB).

> **Sprint 5 (Catalog)** añade un schema adicional. Tras `prisma migrate deploy` aplica también las policies RLS del catalog:
> ```bash
> psql "$DATABASE_URL_MIGRATION" -f prisma/init/02_catalog_rls.sql
> ```
> Estas policies habilitan RLS sobre `catalog.categories`, `catalog.products` y `catalog.bom_components`. La tabla `catalog.unit_of_measure` es cross-tenant (sin RLS) y solo `migration_user` puede escribirla.

### 1.5 Redis gestionado

```bash
oci redis redis-cluster create \
  --compartment-id $COMPARTMENT_OCID \
  --display-name "eliza-redis-prod" \
  --software-version "REDIS_7" \
  --node-memory-in-gbs 8 \
  --node-count 1 \
  --subnet-id "<data-subnet-ocid>"
```

Obtener endpoint + auth token desde la Console.

### 1.6 Vault y KMS

```bash
# Crear KMS vault
oci kms management vault create \
  --compartment-id $COMPARTMENT_OCID \
  --display-name "eliza-vault" \
  --vault-type "DEFAULT"

# Crear KMS key
oci kms management key create \
  --compartment-id $COMPARTMENT_OCID \
  --display-name "eliza-master-key" \
  --key-shape '{"algorithm":"AES","length":32}' \
  --management-endpoint <vault-management-endpoint>

# Crear secretos
oci vault secret create-base64 \
  --compartment-id $COMPARTMENT_OCID \
  --secret-name "eliza-database-url" \
  --vault-id <vault-ocid> \
  --key-id <key-ocid> \
  --secret-content-content "$(echo -n 'postgresql://app_user:PWD@host:5432/eliza?sslmode=require' | base64)"

# Repetir para: keycloak-client-secret, keycloak-admin-password, redis-password
```

### 1.7 Container Registry

```bash
# Login al OCIR
docker login <region-key>.ocir.io \
  -u "<tenancy-namespace>/<user>" \
  -p "<auth-token>"

# Build + push
docker build -t <region-key>.ocir.io/<tenancy-namespace>/eliza-foundation:v0.1.0 .
docker push <region-key>.ocir.io/<tenancy-namespace>/eliza-foundation:v0.1.0
```

---

## Fase 2 — Despliegue de la aplicación

### 2.1 External Secrets Operator (sincroniza Vault → k8s)

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace
```

Crear el `SecretStore` apuntando a OCI Vault:

```yaml
# k8s/secret-store.yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: oci-vault
  namespace: eliza
spec:
  provider:
    oracle:
      vault: ocid1.vault.oc1.iad...
      region: us-ashburn-1
      auth:
        secretRef:
          fingerprint:
            name: oci-secret
            key: fingerprint
          privatekey:
            name: oci-secret
            key: privateKey
          tenancy: ocid1.tenancy.oc1...
          user: ocid1.user.oc1...
```

Crear el `ExternalSecret` que materializa los secretos:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: eliza-foundation-secrets
  namespace: eliza
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: oci-vault
    kind: SecretStore
  target:
    name: eliza-foundation-secrets
  data:
    - secretKey: DATABASE_URL
      remoteRef:
        key: eliza-database-url
    - secretKey: KEYCLOAK_CLIENT_SECRET
      remoteRef:
        key: eliza-keycloak-client-secret
    - secretKey: KEYCLOAK_ADMIN_PASSWORD
      remoteRef:
        key: eliza-keycloak-admin-password
    - secretKey: REDIS_PASSWORD
      remoteRef:
        key: eliza-redis-password
```

### 2.2 ConfigMap (no-secretos)

```yaml
# k8s/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: eliza-foundation-config
  namespace: eliza
data:
  NODE_ENV: "production"
  APP_PORT: "3000"
  APP_GLOBAL_PREFIX: "api"
  APP_VERSION: "v1"
  LOG_LEVEL: "info"
  REDIS_HOST: "eliza-redis-prod.subnet1.eliza.oraclevcn.com"
  REDIS_PORT: "6379"
  REDIS_KEY_PREFIX: "eliza:prod:"
  KEYCLOAK_BASE_URL: "https://auth.eliza.app"
  KEYCLOAK_REALM: "eliza"
  KEYCLOAK_CLIENT_ID: "eliza-api"
  KEYCLOAK_JWKS_URI: "https://auth.eliza.app/realms/eliza/protocol/openid-connect/certs"
  KEYCLOAK_ISSUER: "https://auth.eliza.app/realms/eliza"
  KEYCLOAK_AUDIENCE: "eliza-api"
  KEYCLOAK_ADMIN_USERNAME: "eliza-service-account"
  JWT_ALGORITHM: "RS256"
  JWT_CACHE_MAX_AGE_MS: "600000"
  TENANT_RESOLUTION_STRATEGY: "jwt"
  TENANT_REQUIRE_ACTIVE: "true"
  HELMET_ENABLED: "true"
  CORS_ORIGINS: "https://app.eliza.app,https://admin.eliza.app"
  THROTTLE_TTL_SECONDS: "60"
  THROTTLE_LIMIT: "1000"
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector.observability.svc.cluster.local:4318"
  OTEL_SERVICE_NAME: "eliza-foundation"
  METRICS_ENABLED: "true"
  TRACING_ENABLED: "true"
  # Sprint 4 — Outbox + Event Bus
  EVENT_BUS_TYPE: "redis_streams"
  EVENT_BUS_STREAM_PREFIX: "eliza:prod:event:"
  EVENT_BUS_CONSUMER_GROUP: "eliza-foundation"
  OUTBOX_BATCH_SIZE: "100"
  OUTBOX_POLL_INTERVAL_MS: "500"
  OUTBOX_MAX_RETRIES: "5"
  OUTBOX_RETRY_BACKOFF_BASE_MS: "1000"
  OUTBOX_STUCK_LEASE_MS: "60000"
  OUTBOX_RECLAIM_INTERVAL_MS: "30000"
  # NO incluimos OUTBOX_DISPATCHER_ENABLED aquí; se setea por Deployment (ver abajo)
```

### 2.3 Deployments — patrón writers + workers (Sprint 4)

Separamos en dos Deployments para escalar independientemente la API web del worker que despacha eventos. Los "writers" reciben tráfico HTTP y escriben en outbox; los "workers" despachan eventos del outbox al bus.

```yaml
# k8s/deployment-writers.yaml — Pods que reciben tráfico HTTP, sin dispatcher
apiVersion: apps/v1
kind: Deployment
metadata:
  name: eliza-foundation-writers
  namespace: eliza
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: eliza-foundation
      role: writer
  template:
    metadata:
      labels:
        app: eliza-foundation
        role: writer
    spec:
      imagePullSecrets:
        - name: ocir-secret
      containers:
        - name: app
          image: iad.ocir.io/<tenancy-namespace>/eliza-foundation:v0.1.0
          ports:
            - containerPort: 3000
              name: http
          env:
            # Override del ConfigMap: este Deployment NO despacha
            - name: OUTBOX_DISPATCHER_ENABLED
              value: "false"
          envFrom:
            - configMapRef:
                name: eliza-foundation-config
            - secretRef:
                name: eliza-foundation-secrets
          livenessProbe:
            httpGet: { path: /health, port: 3000 }
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet: { path: /health/ready, port: 3000 }
            initialDelaySeconds: 10
            periodSeconds: 5
          resources:
            requests: { cpu: "500m", memory: "512Mi" }
            limits:   { cpu: "2000m", memory: "2Gi" }
          securityContext:
            runAsNonRoot: true
            runAsUser: 1000
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
---
# k8s/deployment-workers.yaml — Pods que despachan eventos, sin tráfico HTTP
apiVersion: apps/v1
kind: Deployment
metadata:
  name: eliza-foundation-workers
  namespace: eliza
spec:
  replicas: 2  # típicamente menos que writers; el bottleneck es la BD, no la CPU
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: eliza-foundation
      role: worker
  template:
    metadata:
      labels:
        app: eliza-foundation
        role: worker
    spec:
      imagePullSecrets:
        - name: ocir-secret
      containers:
        - name: app
          image: iad.ocir.io/<tenancy-namespace>/eliza-foundation:v0.1.0
          ports:
            - containerPort: 3000
              name: http
          env:
            - name: OUTBOX_DISPATCHER_ENABLED
              value: "true"
          envFrom:
            - configMapRef:
                name: eliza-foundation-config
            - secretRef:
                name: eliza-foundation-secrets
          livenessProbe:
            httpGet: { path: /health, port: 3000 }
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet: { path: /health/ready, port: 3000 }
            initialDelaySeconds: 10
            periodSeconds: 5
          resources:
            requests: { cpu: "500m", memory: "512Mi" }
            limits:   { cpu: "2000m", memory: "2Gi" }
          securityContext:
            runAsNonRoot: true
            runAsUser: 1000
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
---
# Service apunta SOLO a writers (los workers no reciben tráfico externo)
apiVersion: v1
kind: Service
metadata:
  name: eliza-foundation
  namespace: eliza
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: 3000
      name: http
  selector:
    app: eliza-foundation
    role: writer
```

**¿Por qué separar?**
- Los writers se escalan con HPA según CPU/QPS HTTP
- Los workers se escalan según `pending` en outbox (custom metric vía OCI Monitoring)
- Si los writers se reinician (deploy), el bus sigue procesando eventos sin interrupción
- Quita memoria de los writers (que serven mucho tráfico) hacia los workers

### 2.4 Job de migraciones (DB)

Ejecutado UNA vez antes del deployment. Usa `migration_user` (no `app_user`):

```yaml
# k8s/migration-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: eliza-foundation-migrate
  namespace: eliza
spec:
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: migrate
          image: iad.ocir.io/<tenancy-namespace>/eliza-foundation:v0.1.0
          command: ["sh", "-c"]
          args:
            - |
              set -e
              pnpm prisma migrate deploy
              # Aplicar policies RLS adicionales del catalog (Sprint 5)
              # Solo necesario la primera vez o cuando se modifiquen.
              # Idempotente con ON CONFLICT por si se re-ejecuta.
              if [ -f prisma/init/02_catalog_rls.sql ]; then
                psql "$DATABASE_URL" -f prisma/init/02_catalog_rls.sql || echo "RLS already applied"
              fi
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: eliza-foundation-secrets
                  key: DATABASE_MIGRATION_URL
```

### 2.5 Ingress + Load Balancer

```yaml
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: eliza-foundation
  namespace: eliza
  annotations:
    oci.oraclecloud.com/load-balancer-type: "lb"
    service.beta.kubernetes.io/oci-load-balancer-shape: "flexible"
    service.beta.kubernetes.io/oci-load-balancer-shape-flex-min: "10"
    service.beta.kubernetes.io/oci-load-balancer-shape-flex-max: "100"
    # TLS desde OCI Certificate Service
    service.beta.kubernetes.io/oci-load-balancer-ssl-ports: "443"
    service.beta.kubernetes.io/oci-load-balancer-tls-secret: "eliza-tls-cert"
spec:
  rules:
    - host: api.eliza.app
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: eliza-foundation
                port:
                  number: 80
```

### 2.6 HorizontalPodAutoscaler

```yaml
# k8s/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: eliza-foundation
  namespace: eliza
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: eliza-foundation
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

---

## Fase 3 — Aplicar despliegue

```bash
kubectl create namespace eliza

# 1. Secret store + secretos sincronizados desde Vault
kubectl apply -f k8s/secret-store.yaml
kubectl apply -f k8s/external-secret.yaml

# Esperar a que materialicen
kubectl wait --for=condition=Ready externalsecret/eliza-foundation-secrets -n eliza --timeout=60s

# 2. ConfigMap
kubectl apply -f k8s/configmap.yaml

# 3. Migración de la DB (job de una sola ejecución)
kubectl apply -f k8s/migration-job.yaml
kubectl wait --for=condition=complete job/eliza-foundation-migrate -n eliza --timeout=5m

# 4. Deployment + Service + Ingress + HPA
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/hpa.yaml

# 5. Verificar
kubectl get pods -n eliza -w
kubectl logs -f deployment/eliza-foundation -n eliza
```

---

## Fase 4 — Observabilidad

### 4.1 OCI Logging

OKE escribe automáticamente los logs de los Pods a OCI Logging si está habilitado:

```bash
oci logging log-group create \
  --compartment-id $COMPARTMENT_OCID \
  --display-name "eliza-foundation-logs"
```

En el OKE service → Logs → habilitar log forwarding al log group.

Para queries:
```bash
oci logging-search search-logs \
  --search-query "search \"eliza-foundation-logs\" | sort by datetime desc" \
  --time-start 2026-06-01T00:00:00Z \
  --time-end 2026-06-30T23:59:59Z
```

### 4.2 OCI APM (traces)

1. Crear APM domain en la Console
2. Obtener el endpoint OTLP del domain
3. Configurar `OTEL_EXPORTER_OTLP_ENDPOINT` apuntando al collector (o directamente al APM si soporta OTLP HTTP)

### 4.3 OCI Monitoring (métricas)

La app expone `/metrics` cuando `METRICS_ENABLED=true`. Configurar Prometheus en el cluster → Prometheus Adapter → OCI Monitoring scraper, o usar OCI Stack Monitoring para Postgres.

---

## Fase 5 — Hardening producción

### 5.1 Service Account Keycloak (en lugar de admin/admin)

En Keycloak Admin Console:
1. Clients → Create → `eliza-service-account` (Client Authentication ON, Service Accounts Roles ON)
2. Service Account Roles → asignar `realm-management/manage-users`, `realm-management/view-users`, `realm-management/view-clients`
3. Obtener client secret y guardarlo en Vault como `eliza-kc-service-account-secret`

En la app, cambiar la lógica de admin token de `password` grant a `client_credentials`:

```ts
// keycloak-admin.client.ts: actualizar el body de getAdminToken
const body = new URLSearchParams({
  grant_type: 'client_credentials',
  client_id: 'eliza-service-account',
  client_secret: serviceAccountSecret,
});
```

Y reemplazar las env vars:
```
KEYCLOAK_ADMIN_USERNAME → eliminada
KEYCLOAK_ADMIN_PASSWORD → reemplazada por KEYCLOAK_SA_CLIENT_SECRET
```

### 5.2 Network policies

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: eliza-foundation-network-policy
  namespace: eliza
spec:
  podSelector:
    matchLabels:
      app: eliza-foundation
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
      ports:
        - protocol: TCP
          port: 3000
  egress:
    # PostgreSQL
    - to:
        - ipBlock:
            cidr: 10.0.20.0/24
      ports:
        - port: 5432
    # Redis
        - port: 6379
    # Keycloak (vía DNS interno o público)
    - to:
        - namespaceSelector:
            matchLabels:
              name: keycloak
      ports:
        - port: 8080
    # DNS
    - to:
        - namespaceSelector: {}
      ports:
        - port: 53
          protocol: UDP
```

### 5.3 Pod Security Standards

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: eliza
  labels:
    pod-security.kubernetes.io/enforce: "restricted"
    pod-security.kubernetes.io/audit: "restricted"
```

### 5.4 Backups Postgres

OCI PostgreSQL hace backups automáticos diarios; verificar que están habilitados a 35 días retention. Para Disaster Recovery, configurar **cross-region replica** en otra región OCI.

### 5.5 Image scanning

```bash
oci artifacts container image-signature create \
  --image-id <image-ocid> \
  --signing-algorithm "SHA_256_RSA_PKCS_PSS"

# Vulnerability scanning
oci vulnerability-scanning host-scan-target create \
  --compartment-id $COMPARTMENT_OCID \
  --target-name "eliza-images"
```

---

## ✅ Checklist de Go-Live

Antes del switch DNS público hacia OCI:

- [ ] Todas las variables del ConfigMap y Secret están presentes
- [ ] `kubectl get pods -n eliza` muestra 3+ pods Running
- [ ] `kubectl logs deployment/eliza-foundation -n eliza` no muestra errores de bootstrap
- [ ] `curl https://api.eliza.app/health` responde 200
- [ ] `curl https://api.eliza.app/health/ready` responde 200 (Postgres alcanzable)
- [ ] Login flow end-to-end: `curl ... /token` → JWT → `/api/v1/me` → 200
- [ ] Crear un tenant de prueba vía `/api/v1/platform/tenants` y verlo en BD
- [ ] Audit chain válido: `curl /api/v1/audit/verify-chain` → `isValid: true`
- [ ] Cert TLS válido en Load Balancer
- [ ] HSTS y demás headers de seguridad presentes (`curl -I https://api.eliza.app/health`)
- [ ] Backups Postgres habilitados con 35 días retention
- [ ] Métricas llegando a OCI Monitoring
- [ ] Logs llegando a OCI Logging con retención configurada
- [ ] APM mostrando traces de requests
- [ ] HPA escalando correctamente (test con `hey` o `wrk`)
- [ ] Network Policies aplicadas y validadas
- [ ] Runbook de incidentes documentado en la wiki interna

---

## 📞 Operación día a día

### Ver logs recientes

```bash
kubectl logs -f deployment/eliza-foundation -n eliza --tail=200
```

### Rollback

```bash
kubectl rollout undo deployment/eliza-foundation -n eliza
kubectl rollout status deployment/eliza-foundation -n eliza
```

### Reiniciar la app sin downtime

```bash
kubectl rollout restart deployment/eliza-foundation -n eliza
```

### Escalar manualmente

```bash
kubectl scale deployment/eliza-foundation -n eliza --replicas=10
```

### Acceder a Postgres desde bastion

```bash
ssh -L 5432:db-host.subnet.oraclevcn.com:5432 opc@<bastion-ip>
# en otra terminal:
psql "postgresql://app_user:PWD@localhost:5432/eliza?sslmode=require"
```

### Rotar un secreto

```bash
# 1. Crear nueva versión del secreto en Vault
oci vault secret update --secret-id <secret-ocid> \
  --secret-content-content "$(echo -n 'new-value' | base64)"

# 2. External Secrets refresca automáticamente (interval 1h) o forzar:
kubectl annotate externalsecret eliza-foundation-secrets \
  -n eliza force-sync=$(date +%s) --overwrite

# 3. Reiniciar pods para que tomen el nuevo Secret
kubectl rollout restart deployment/eliza-foundation -n eliza
```
