# ☸️ ELIZA Foundation — Kubernetes Reference

Referencia rápida de los manifiestos en `k8s/` y cómo aplicarlos. Para el provisionamiento de la infraestructura subyacente, ver `DEPLOYMENT-OCI.md`. Para el flujo end-to-end desde cero, ver `GETTING-STARTED.md`.

---

## 📁 Estructura

```
k8s/
├── 01-namespace.yaml           # Namespace eliza + Pod Security Standards
├── 02-configmap.yaml           # Toda la config no-secreta
├── 03-external-secret.yaml     # Sincroniza secretos desde OCI Vault
├── 04-migration-job.yaml       # Corre prisma migrate deploy
├── 05-deployments.yaml         # Writers + Workers + Service
└── 06-ingress-hpa-netpol.yaml  # Ingress + HPA + NetworkPolicy
```

**Orden de aplicación** (numerado en el nombre para no equivocarse):

1. **namespace** — primero, todo lo demás vive dentro
2. **configmap** — antes de los Deployments (los leen como `envFrom`)
3. **external-secret** — antes de los Deployments (idem)
4. **migration-job** — antes de los Deployments (debe terminar exitoso)
5. **deployments** — la app misma
6. **ingress-hpa-netpol** — al final; expone tráfico

---

## ⚙️ Patrón writers + workers

Implementamos un patrón split que aprovecha la separación de responsabilidades del Sprint 4:

| Deployment | Réplicas | `OUTBOX_DISPATCHER_ENABLED` | Recibe HTTP | Despacha eventos |
|---|---|---|---|---|
| `eliza-foundation-writers` | 3 (min) - 20 (max) | `false` | ✅ | ❌ |
| `eliza-foundation-workers` | 2 (min) - 8 (max) | `true` | ❌ | ✅ |

El `Service` apunta SOLO a `role: writer` (los workers no reciben tráfico).

**¿Por qué split?**
- Los writers se escalan con CPU según QPS
- Los workers se escalan según pending en outbox (cuando agregues prometheus-adapter)
- Reinicios de writers (deploys frecuentes) no interrumpen el procesamiento de eventos
- Recursos isolated: si un worker se cuelga, los writers siguen respondiendo

---

## 🚀 Aplicar manifiestos — paso a paso

### Pre-requisito: imagen en OCIR

Los manifiestos referencian `iad.ocir.io/REPLACE_TENANCY/eliza-foundation:REPLACE_VERSION`. Reemplaza ANTES de aplicar:

```bash
TENANCY="my-tenancy-namespace"
VERSION="v0.1.0"

# In-place edit (Linux/Mac)
sed -i.bak "s|REPLACE_TENANCY|${TENANCY}|g" k8s/*.yaml
sed -i.bak "s|REPLACE_VERSION|${VERSION}|g" k8s/*.yaml
rm k8s/*.bak

# Verifica
grep -n "image:" k8s/04-migration-job.yaml k8s/05-deployments.yaml
```

> 💡 Si usas GitOps (ArgoCD/Flux), preferirás un overlay con Kustomize en lugar de `sed`. Está pendiente para iteración futura.

### Pre-requisito: External Secrets Operator

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace
kubectl wait --for=condition=Available deployment/external-secrets -n external-secrets --timeout=2m
```

### Pre-requisito: ImagePullSecret para OCIR

```bash
kubectl create secret docker-registry ocir-secret \
  -n eliza \
  --docker-server=iad.ocir.io \
  --docker-username="<tenancy-namespace>/<oci-user>" \
  --docker-password="<auth-token>" \
  --docker-email="<your-email>"
```

### Apply ordenado

```bash
# 1. Namespace
kubectl apply -f k8s/01-namespace.yaml

# 2. Config + Secrets (los Deployments los necesitan al iniciar)
kubectl apply -f k8s/02-configmap.yaml
kubectl apply -f k8s/03-external-secret.yaml

# Esperar a que External Secrets materialice el k8s Secret
kubectl wait --for=condition=Ready externalsecret/eliza-foundation-secrets \
  -n eliza --timeout=2m

# 3. Migración (Job de una sola ejecución)
kubectl delete job eliza-foundation-migrate -n eliza --ignore-not-found
kubectl apply -f k8s/04-migration-job.yaml
kubectl wait --for=condition=complete \
  job/eliza-foundation-migrate -n eliza --timeout=10m

# 4. Deployments + Service
kubectl apply -f k8s/05-deployments.yaml

# 5. Ingress + HPA + NetworkPolicy
kubectl apply -f k8s/06-ingress-hpa-netpol.yaml

# 6. Verificar
kubectl get all -n eliza
```

O **todo de un golpe** con el Makefile:

```bash
make k8s-apply
```

---

## 🔍 Verificación post-deploy

```bash
# Pods Running
kubectl get pods -n eliza
# Esperado: 3 writers Running + 2 workers Running

# Logs sin errores
kubectl logs -n eliza -l app=eliza-foundation --tail=50

# Service tiene endpoints
kubectl get endpoints eliza-foundation -n eliza
# Esperado: 3 IPs (las de los writers)

# Ingress tiene IP pública
kubectl get ingress -n eliza
# Esperado: ADDRESS con la IP del Load Balancer

# HPA está midiendo
kubectl get hpa -n eliza
# Esperado: TARGETS con %, no "<unknown>/<unknown>"

# Smoke test contra el LB público
curl https://api.eliza.app/health | jq
```

---

## 🔄 Operación día a día

### Ver logs

```bash
# Todos los pods de la app
kubectl logs -f -n eliza -l app=eliza-foundation --tail=100

# Solo writers
make k8s-logs-writers

# Solo workers
make k8s-logs-workers

# Un pod específico
kubectl logs -f <pod-name> -n eliza
```

### Reiniciar sin downtime

```bash
make k8s-restart
# equivalente a:
#   kubectl rollout restart deployment/eliza-foundation-writers -n eliza
#   kubectl rollout restart deployment/eliza-foundation-workers -n eliza
```

### Escalar manualmente

```bash
kubectl scale deployment/eliza-foundation-writers -n eliza --replicas=10
kubectl scale deployment/eliza-foundation-workers -n eliza --replicas=4
```

El HPA tomará el control de nuevo cuando los metrics se reporten.

### Rollback

```bash
# Ver historial
kubectl rollout history deployment/eliza-foundation-writers -n eliza

# Volver a la versión anterior
kubectl rollout undo deployment/eliza-foundation-writers -n eliza

# O a una revisión específica
kubectl rollout undo deployment/eliza-foundation-writers -n eliza --to-revision=3
```

### Inspeccionar configuración aplicada

```bash
# Ver el ConfigMap renderizado
kubectl get configmap eliza-foundation-config -n eliza -o yaml

# Ver qué env vars tiene un Pod (sin valores de Secret)
kubectl exec -n eliza deployment/eliza-foundation-writers -- env | sort

# Confirmar que los secretos están montados
kubectl get secret eliza-foundation-secrets -n eliza -o jsonpath='{.data}' | jq 'keys'
# Debe listar: DATABASE_URL, REDIS_PASSWORD, KEYCLOAK_CLIENT_SECRET, ...
```

### Rotar un secreto

```bash
# 1. Actualizar en OCI Vault
oci vault secret update --secret-id <secret-ocid> \
  --secret-content-content "$(echo -n 'new-password' | base64)"

# 2. Forzar refresh del External Secret (sin esperar el intervalo de 1h)
kubectl annotate externalsecret eliza-foundation-secrets \
  -n eliza force-sync=$(date +%s) --overwrite

# 3. Reiniciar los Pods para que tomen el nuevo Secret
make k8s-restart
```

### Migración nueva en producción

```bash
# Por seguridad, antes de aplicar el rollout del nuevo código:
# 1. Aplicar el Job de migración
kubectl delete job eliza-foundation-migrate -n eliza --ignore-not-found
kubectl apply -f k8s/04-migration-job.yaml
kubectl wait --for=condition=complete \
  job/eliza-foundation-migrate -n eliza --timeout=10m

# 2. Luego sí, actualizar la imagen de los Deployments
kubectl set image deployment/eliza-foundation-writers \
  app=iad.ocir.io/.../eliza-foundation:v0.2.0 -n eliza
kubectl set image deployment/eliza-foundation-workers \
  app=iad.ocir.io/.../eliza-foundation:v0.2.0 -n eliza
```

---

## 🚨 Troubleshooting

### Pods en `CrashLoopBackOff`

```bash
# Ver el último log antes del crash
kubectl logs <pod-name> -n eliza --previous

# Causas típicas:
# - DATABASE_URL inválida (URL-encoded password?)
# - KEYCLOAK_JWKS_URI inalcanzable desde el pod (NetworkPolicy?)
# - Migraciones no aplicadas (Job nunca terminó)
```

### Pods en `Pending` indefinidamente

```bash
kubectl describe pod <pod-name> -n eliza | tail -20

# Causas típicas:
# - Sin nodos con recursos suficientes → escalar el node pool
# - imagePullSecrets ausente → kubectl create secret docker-registry...
# - PVC pending (no aplica aquí, no usamos volúmenes persistentes)
```

### `ImagePullBackOff`

```bash
# Verifica que el ImagePullSecret existe
kubectl get secret ocir-secret -n eliza

# Verifica que la imagen existe en OCIR
oci artifacts container image list \
  --compartment-id $COMPARTMENT_OCID \
  --repository-name eliza-foundation \
  --query 'data.items[].version'
```

### ExternalSecret no materializa el k8s Secret

```bash
kubectl describe externalsecret eliza-foundation-secrets -n eliza

# Errores típicos:
# - Vault OCID incorrecto → editar k8s/03-external-secret.yaml
# - API key inválida → verificar el Secret "oci-auth"
# - Permisos OCI insuficientes → el usuario debe tener policy "manage secrets"
```

### HPA muestra `<unknown>/<target>`

```bash
# El metrics-server no está midiendo. Verifica:
kubectl get apiservice v1beta1.metrics.k8s.io
# Debe estar en estado True/Available

# Si no, instálalo (OKE lo trae por defecto, pero por si acaso):
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

### Eventos del outbox quedan `Pending`

```bash
# Logs del worker — debe aparecer "Dispatched batch" cada cierto tiempo
make k8s-logs-workers | grep -i dispatch

# Si no: verificar variable OUTBOX_DISPATCHER_ENABLED en los workers
kubectl exec -n eliza deployment/eliza-foundation-workers -- \
  printenv OUTBOX_DISPATCHER_ENABLED
# Debe imprimir: true
```

### "No host found" para Postgres / Redis

```bash
# Las URLs internas usan FQDN del cluster: <service>.<namespace>.svc.cluster.local
# Si Postgres está en una subnet de OCI (managed), debe ser su private IP o FQDN

# Test desde un pod:
kubectl run -it --rm debug --image=alpine -n eliza -- sh
# dentro del pod:
apk add curl postgresql-client
psql "$DATABASE_URL" -c "SELECT 1"
```

---

## 🔐 NetworkPolicies aplicadas

El archivo `06-ingress-hpa-netpol.yaml` define una NetworkPolicy con:

- **Ingress permitido**: solo desde el namespace `ingress-nginx` (Load Balancer) y el propio `eliza`
- **Egress permitido**:
  - `10.0.20.0/24:5432` (Postgres subnet)
  - `10.0.20.0/24:6379` (Redis subnet)
  - `namespace=keycloak:8080`
  - `kube-dns:53`
  - `0.0.0.0/0:443` excepto rangos privados (para llegar a JWKS de Keycloak si está en internet)

> **Cuidado**: el rango de IPs `10.0.20.0/24` es el default de Terraform. Si cambias el CIDR de la subnet en `variables.tf`, actualiza también el NetworkPolicy.

Para deshabilitar temporalmente NetPol durante debugging (NO en prod):

```bash
kubectl delete networkpolicy eliza-foundation-network-policy -n eliza
```

---

## 📊 Observabilidad

Los Deployments están listos para exportar:

- **Logs** → stdout (recogidos automáticamente por OCI Logging si el log forwarding está habilitado en OKE)
- **Métricas** → `/metrics` (Prometheus scrape; configurar prometheus-operator o OCI Monitoring scraper)
- **Traces** → `OTEL_EXPORTER_OTLP_ENDPOINT` apunta al collector. Configurar OCI APM domain y dirigir el collector a su endpoint OTLP.

Configurar las tres cosas escapa de este doc; ver `DEPLOYMENT-OCI.md` sección 4.

---

## 🔗 Referencias cruzadas

- `GETTING-STARTED.md` — guía completa desde cero
- `DEPLOYMENT-OCI.md` — provisionamiento de infraestructura OCI subyacente
- `ENVIRONMENT.md` — qué hace cada variable de entorno
- `API-REFERENCE.md` — endpoints expuestos
- `Makefile` — atajos para todos los comandos comunes
