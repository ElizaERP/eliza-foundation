# 🧪 Testing del Sprint 4 — Outbox Dispatcher + Read Models

Sprint 4 hace que los eventos del outbox **realmente se publiquen** y que las proyecciones se materialicen. Aquí cubrimos cómo verificar cada pieza.

---

## 0. Preparación

```bash
# 1. Aplicar la nueva migración (status DeadLetter, projection_checkpoints, tenant_summary)
pnpm prisma:migrate:dev --name sprint4_outbox_dispatcher

# 2. JWT del Platform Admin (rol Platform.Admin o Platform.SRE)
export PLATFORM_TOKEN="$(pnpm -s ts-node scripts/gen-test-jwt.ts \
  --user 00000000-0000-0000-0000-000000000001 \
  --roles Platform.Admin 2>/dev/null | grep -E '^eyJ' | head -1)"

export TENANT_TOKEN="$(pnpm -s ts-node scripts/gen-test-jwt.ts \
  --tenant 7c9e6679-7425-40de-944b-e07fc1f90ae7 \
  --user 550e8400-e29b-41d4-a716-446655440000 \
  --roles Tenant.Admin 2>/dev/null | grep -E '^eyJ' | head -1)"

export API="http://localhost:3000/api/v1"

# 3. Arrancar la app — verás el log del dispatcher
pnpm start:dev
```

Al arrancar verás en los logs:
```
[OutboxDispatcher] Outbox dispatcher ENABLED node=hostname-12345 batch=50 poll=1000ms maxRetries=5
[TenantSummaryProjector] TenantSummaryProjector subscribed to 10 event types
```

---

## 1. Probar el flujo completo en modo `in_memory`

Por defecto `EVENT_BUS_TYPE=in_memory`. Esto es perfecto para verificar el flujo sin Redis.

### 1.1 Stats inicial del outbox

```bash
curl -sS $API/platform/outbox/stats \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq
```

Respuesta esperada (asumiendo que ya hiciste operaciones en sprints anteriores):
```json
{
  "pending": 0,
  "processing": 0,
  "published": 47,
  "failed": 0,
  "deadLetter": 0,
  "total": 47,
  "counts": { "Pending": 0, "Processing": 0, "Published": 47, "Failed": 0, "DeadLetter": 0 }
}
```

Si arrancaste la app fresca con `Pending > 0`, el dispatcher los publicará en el siguiente ciclo (1s). Repite el GET:

```bash
sleep 2; curl -sS $API/platform/outbox/stats \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq
# → todos en "published" ahora
```

### 1.2 Disparar eventos nuevos y observar el flujo

```bash
# Crear un tenant (emite TenantCreated en outbox)
TENANT=$(curl -sS -X POST $API/platform/tenants \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code":"sprint4-test","name":"Sprint 4 Test","plan":"Professional"}')
NEW_TENANT_ID=$(echo $TENANT | jq -r .id)

# Inmediatamente, los stats muestran 1 Pending
curl -sS $API/platform/outbox/stats \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq '.pending, .published'

# Esperar 1.5s; el dispatcher debió publicarlo
sleep 1.5
curl -sS $API/platform/outbox/stats \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq '.pending, .published'
# → pending: 0, published incrementó en +1
```

### 1.3 Buscar el evento específico en el outbox

```bash
curl -sS "$API/platform/outbox/events?eventType=tenant.TenantCreated.v1&pageSize=5" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq '.items[0]'
```

Verás:
```json
{
  "id": "abc-123-...",
  "tenantId": "...",
  "eventType": "tenant.TenantCreated.v1",
  "status": "Published",
  "publishedAt": "2026-06-04T...",
  "retryCount": 0,
  "processingNode": "hostname-12345",
  "payload": { "code": "sprint4-test", "name": "Sprint 4 Test", ... }
}
```

### 1.4 Verificar el read model materializado

El `TenantSummaryProjector` se suscribió al evento. Tras el `publish`, debería existir una fila en `tenant_summary`:

```bash
curl -sS $API/platform/read-models/tenant-summary \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq
```

Buscarás:
```json
[
  {
    "tenantId": "...",
    "code": "sprint4-test",
    "name": "Sprint 4 Test",
    "status": "PendingActivation",
    "plan": "Professional",
    "userCount": 0,
    "activeUserCount": 0,
    "lastEventAt": "2026-06-04T...",
    "lastEventType": "tenant.TenantCreated.v1"
  }
]
```

### 1.5 Activar el tenant y ver el read model reaccionar

```bash
curl -sS -X POST "$API/platform/tenants/$NEW_TENANT_ID/activate" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"expectedVersion": 1}' > /dev/null

sleep 1.5

# El proyector procesó tenant.TenantActivated.v1
curl -sS $API/platform/read-models/tenant-summary \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  | jq ".[] | select(.tenantId == \"$NEW_TENANT_ID\")"
# → status: "Active", lastEventType: "tenant.TenantActivated.v1"
```

### 1.6 Crear un usuario y ver el contador subir

```bash
curl -sS -X POST $API/platform/users \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"smoke@sprint4.com\",\"fullName\":\"Smoke\",\"tenantId\":\"$NEW_TENANT_ID\",\"roles\":[\"Manufacturing.Operator\"]}" \
  > /dev/null
# (en modo dev sin Keycloak real, esto fallará — usa el smoke-test simulado:
#  inserta directamente un evento iam.MembershipGranted.v1 vía SQL si solo
#  estás probando el proyector)

sleep 1.5
curl -sS $API/platform/read-models/tenant-summary \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  | jq ".[] | select(.tenantId == \"$NEW_TENANT_ID\") | .userCount"
# → 1
```

---

## 2. Probar errores y retries — DLQ

El dispatcher reintenta con backoff exponencial. Para forzar un fallo, podemos romper un subscriber. La forma más simple es **detener Postgres mientras un evento está siendo proyectado**:

```bash
# 1. Crear un evento que el proyector va a procesar
curl -sS -X POST $API/platform/tenants \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code":"will-fail","name":"Fail","plan":"Basic"}' > /dev/null

# 2. INMEDIATAMENTE parar Postgres
docker pause eliza-postgres

# 3. El dispatcher intentará procesar el evento → bus.publish() llamará
# al proyector → el proyector hará un INSERT que falla → bus.publish lanza
# → dispatcher marca el evento como Failed con nextRetryAt = now + 1s

sleep 2

# 4. Restaurar Postgres
docker unpause eliza-postgres

# 5. Esperar varios ciclos
sleep 10

# 6. Ver que retryCount incrementó y eventualmente quedó Published
curl -sS "$API/platform/outbox/events?eventType=tenant.TenantCreated.v1&pageSize=20" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  | jq '.items[] | select(.retryCount > 0)'
```

### 2.1 Forzar DLQ (max retries excedido)

Para llegar a DLQ sin esperar todos los retries, baja temporalmente `OUTBOX_MAX_RETRIES=1` y `OUTBOX_RETRY_BACKOFF_BASE_MS=100` en `.env`, reinicia, y repite el escenario anterior:

```bash
# Tras los retries fallidos:
curl -sS $API/platform/outbox/dlq \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq
```

### 2.2 Rescatar un evento de DLQ

```bash
DLQ_EVENT_ID="<id-del-evento-en-dlq>"

curl -sS -X POST "$API/platform/outbox/dlq/$DLQ_EVENT_ID/retry" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq
# → status: "Pending", retryCount: 0
```

El dispatcher lo retomará en el próximo ciclo.

---

## 3. Multi-pod en producción — Redis Streams

Para probar el modo distribuido (lo que va a producción en OCI):

```bash
# 1. En .env cambia a Redis
EVENT_BUS_TYPE=redis_streams
# Asegúrate que REDIS_HOST/PORT/PASSWORD están configurados

# 2. Levantar 2 instancias en terminales distintas
# Terminal A:
APP_PORT=3000 HOSTNAME=pod-a pnpm start:dev

# Terminal B:
APP_PORT=3001 HOSTNAME=pod-b pnpm start:dev
```

Ambos pods van a leasear eventos del outbox con `FOR UPDATE SKIP LOCKED` — no se pisan. Cada evento publicado en Redis stream `eliza:event:<type>` se entrega al consumer group `eliza-foundation`. Si los pods son del mismo consumer group, **solo uno** procesa cada mensaje (load balancing).

Verificar:

```bash
# Stats desde cualquier pod
curl -sS http://localhost:3000/api/v1/platform/outbox/stats -H "Authorization: Bearer $PLATFORM_TOKEN"
curl -sS http://localhost:3001/api/v1/platform/outbox/stats -H "Authorization: Bearer $PLATFORM_TOKEN"

# Los eventos publicados verán processingNode alternando entre pod-a y pod-b
docker exec eliza-postgres psql -U postgres -d eliza -c \
  "SELECT processing_node, COUNT(*) FROM platform.outbox_events WHERE published_at > NOW() - INTERVAL '5 minutes' GROUP BY processing_node;"
```

---

## 4. Endpoints nuevos del Sprint 4

| Path | Rol | Descripción |
|---|---|---|
| `GET /api/v1/platform/outbox/stats` | Platform.Admin/SRE | Métricas operativas (counts por estado) |
| `GET /api/v1/platform/outbox/events` | Platform.Admin/SRE | Listar/filtrar eventos del outbox |
| `POST /api/v1/platform/outbox/events/:eventId/replay` | Platform.Admin/SRE | Re-encolar |
| `GET /api/v1/platform/outbox/dlq` | Platform.Admin/SRE | Lista DLQ |
| `POST /api/v1/platform/outbox/dlq/:eventId/retry` | Platform.Admin/SRE | Sacar de DLQ |
| `GET /api/v1/platform/read-models/tenant-summary` | Platform.Admin/Support/SRE | Read model agregado |

---

## 5. Variables de entorno nuevas

| Variable | Default | Producción | Descripción |
|---|---|---|---|
| `OUTBOX_DISPATCHER_ENABLED` | `true` | depende del Deployment | Activa el worker. `false` en pods "writer-only" |
| `OUTBOX_BATCH_SIZE` | `50` | `100` | Eventos por lease |
| `OUTBOX_POLL_INTERVAL_MS` | `1000` | `500` | Frecuencia del polling |
| `OUTBOX_MAX_RETRIES` | `5` | `5` | Retries antes de DLQ |
| `OUTBOX_RETRY_BACKOFF_BASE_MS` | `1000` | `1000` | Base del backoff exponencial |
| `OUTBOX_STUCK_LEASE_MS` | `60000` | `60000` | Cuánto esperar antes de reclamar Processing huérfanos |
| `OUTBOX_RECLAIM_INTERVAL_MS` | `30000` | `30000` | Cada cuánto correr el reclaim loop |
| `EVENT_BUS_TYPE` | `in_memory` | `redis_streams` | Implementación del bus |
| `EVENT_BUS_STREAM_PREFIX` | `eliza:event:` | `eliza:event:` | Prefijo de keys en Redis |
| `EVENT_BUS_CONSUMER_GROUP` | `eliza-foundation` | `eliza-foundation` | Consumer group de Redis Streams |

---

## 6. Troubleshooting

### Los stats muestran `Pending > 0` y no bajan

El dispatcher no está corriendo. Verifica:
1. `OUTBOX_DISPATCHER_ENABLED=true` en el `.env`
2. Logs muestran `Outbox dispatcher ENABLED`
3. Si usas Redis Streams, que Redis está alcanzable

### El read model `tenant_summary` no se actualiza

El proyector no está corriendo. Verifica:
1. Logs muestran `TenantSummaryProjector subscribed to 10 event types`
2. El bus está propagando los eventos: marca temporalmente `LOG_LEVEL=debug` y mira si el dispatcher loguea publish exitoso
3. La tabla `platform.tenant_summary` existe — `pnpm prisma:migrate:dev`

### Eventos Processing huérfanos

Si un pod crashea mid-batch, los eventos quedan en `Processing` con `processingNode=<pod-muerto>`. El `ReclaimStuckEvents` los recupera automáticamente cada 30s. Para forzar el reclaim manualmente:

```sql
UPDATE platform.outbox_events
SET status = 'Pending', processing_started_at = NULL, processing_node = NULL, next_retry_at = NOW()
WHERE status = 'Processing' AND processing_started_at < NOW() - INTERVAL '1 minute';
```

### Mismo evento procesado dos veces por el proyector

Verifica que existe un checkpoint:
```sql
SELECT * FROM platform.projection_checkpoints;
```
Si no existe, créalo manualmente o resetea el proyector reiniciando la app — al recibir el primer evento creará la fila.

### Redis Streams: "BUSYGROUP Consumer Group name already exists"

Es benigno; lo logueamos como warning. Significa que el consumer group ya estaba creado de un arranque anterior — operación idempotente.
