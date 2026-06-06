# TESTING-INVENTORY.md — Pruebas E2E del Inventory BC

Esta guía cubre las pruebas críticas del Inventory Bounded Context. La pieza más importante a validar es **FEFO** (First-Expired-First-Out): cuando reservas stock de un SKU que está en múltiples lotes, el sistema DEBE consumir primero el lote que vence antes.

## Preparación

1. Asegúrate de tener el JWT de prueba a mano:
   ```powershell
   pnpm exec ts-node scripts/gen-test-jwt.ts
   ```
   Cópialo. En Swagger UI (`http://localhost:3000/docs`), pulsa **Authorize** y pégalo.

2. Verifica el seed:
   ```powershell
   docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT code, name FROM inventory.warehouses;"
   docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT code, tipo_ubicacion, temp_min_c, temp_max_c FROM inventory.locations;"
   docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT codigo_lote, fecha_vencimiento, cantidad_inicial FROM inventory.lotes;"
   ```

   Debes ver:
   - 1 warehouse `PB`
   - 4 locations (PB-RECEP, PB-CAM-FZ -22°/-15°, PB-CAM-RF 0°/6°, PB-EST-SECO)
   - 3 lotes con sus fechas de vencimiento

---

## Test 1 — Listar warehouses y locations (smoke test)

```http
GET /api/v1/inventory/warehouses
GET /api/v1/inventory/warehouses/{warehouseId}/locations
```

**Esperado:** la warehouse PB y sus 4 locations.

---

## Test 2 — Get stock by SKU (estado inicial)

Primero obtén el `productId` de `ARP-MINI-12U`:
```powershell
docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT id FROM catalog.products WHERE code = 'ARP-MINI-12U';"
```

```http
GET /api/v1/inventory/stock/by-sku/{productId}
```

**Esperado:**
```json
{
  "productId": "...",
  "totalDisponible": 500,
  "totalReservado": 0,
  "totalBloqueado": 0,
  "totalFisico": 500,
  "porLote": [
    {
      "codigoLote": "BCM-ARP-MINI-2026-04-15-001",
      "fechaVencimiento": "2026-10-15T00:00:00.000Z",
      "estado": "Disponible",
      "cantidadDisponible": 500,
      ...
    }
  ]
}
```

---

## Test 3 — CRÍTICO: FEFO con 2 lotes

Aquí validamos la política central. Vamos a registrar un segundo lote del MISMO producto con fecha de vencimiento **posterior** y luego reservar — el sistema DEBE consumir primero el lote que vence antes (el del seed, que vence 2026-10-15).

### 3.1. Registrar un segundo lote con vencimiento posterior

```http
POST /api/v1/inventory/lots
{
  "codigoLote": "BCM-ARP-MINI-2026-06-15-002",
  "productId": "<ARP-MINI productId>",
  "fechaProduccion": "2026-06-15T00:00:00.000Z",
  "fechaVencimiento": "2026-12-15T00:00:00.000Z",
  "cantidadInicial": 300,
  "origenTipo": "Manual",
  "notas": "Lote nuevo, vence DESPUÉS del lote del seed"
}
```

Anota el `id` del lote nuevo (lo necesitas en el siguiente paso).

### 3.2. Recibir stock del nuevo lote

Obtén `locationId` de `PB-CAM-FZ`:
```powershell
docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT id FROM inventory.locations WHERE code = 'PB-CAM-FZ';"
```

```http
POST /api/v1/inventory/stock/receive
{
  "productId": "<ARP-MINI productId>",
  "loteId": "<nuevo lote id>",
  "locationId": "<PB-CAM-FZ id>",
  "cantidad": 300,
  "referenciaTipo": "Manual",
  "referenciaId": "test-lot2-receive"
}
```

Verifica con un nuevo GET by-sku: ahora `totalDisponible` debe ser `800` y verás dos entradas en `porLote` ordenadas por fechaVencimiento ASC.

### 3.3. Reservar 600 unidades (más que el lote viejo, menos que el total)

```http
POST /api/v1/inventory/stock/reserve
{
  "productId": "<ARP-MINI productId>",
  "cantidad": 600,
  "referenciaTipo": "SalesOrder",
  "referenciaId": "test-order-fefo-001"
}
```

**Esperado — esto es la PRUEBA FEFO:**
```json
{
  "totalAsignado": 600,
  "asignaciones": [
    {
      "codigoLote": "BCM-ARP-MINI-2026-04-15-001",
      "fechaVencimiento": "2026-10-15T00:00:00.000Z",
      "cantidadAsignada": 500       ← consumió TODO el lote viejo primero
    },
    {
      "codigoLote": "BCM-ARP-MINI-2026-06-15-002",
      "fechaVencimiento": "2026-12-15T00:00:00.000Z",
      "cantidadAsignada": 100       ← luego tomó 100 del lote nuevo
    }
  ],
  "reservaIds": [...]
}
```

Si ves esto, **FEFO funciona correctamente**. Si las cantidades están al revés (100 del viejo, 500 del nuevo), hay un bug.

---

## Test 4 — Idempotencia de reservas

Reintenta la misma reserva con la MISMA referencia:

```http
POST /api/v1/inventory/stock/reserve
{
  "productId": "<ARP-MINI productId>",
  "cantidad": 600,
  "referenciaTipo": "SalesOrder",
  "referenciaId": "test-order-fefo-001"     ← misma referencia que en Test 3.3
}
```

**Esperado:** la operación debe tener éxito (status 201) y devolver los `reservaIds` ya existentes, **sin crear reservas duplicadas**. Verifica con:

```http
GET /api/v1/inventory/stock/by-sku/{productId}
```

`totalReservado` debe seguir siendo 600 (no 1200).

---

## Test 5 — Insufficient stock (debe devolver 409)

Intenta reservar más de lo disponible:

```http
POST /api/v1/inventory/stock/reserve
{
  "productId": "<ARP-MINI productId>",
  "cantidad": 999999,
  "referenciaTipo": "SalesOrder",
  "referenciaId": "test-impossible-reserve"
}
```

**Esperado:** `409 Conflict` con `code: "fefo.insufficient_stock"`.

---

## Test 6 — Bloquear lote impide reservar de él

### 6.1. Liberar todas las reservas previas

```http
DELETE /api/v1/inventory/stock/reservations
{
  "productId": "<ARP-MINI productId>",
  "referenciaTipo": "SalesOrder",
  "referenciaId": "test-order-fefo-001",
  "reason": "Cleanup for next test"
}
```

### 6.2. Bloquear el lote viejo (el que vence primero)

```http
POST /api/v1/inventory/lots/{loteViejoId}/block
{
  "reason": "Defecto detectado en muestra de control"
}
```

### 6.3. Reservar 300 unidades

```http
POST /api/v1/inventory/stock/reserve
{
  "productId": "<ARP-MINI productId>",
  "cantidad": 300,
  "referenciaTipo": "SalesOrder",
  "referenciaId": "test-order-after-block"
}
```

**Esperado:** la reserva debe tomar las 300 del lote NUEVO (el lote viejo está bloqueado y no es elegible para FEFO), aunque venza más tarde.

### 6.4. Liberar el lote viejo

```http
POST /api/v1/inventory/lots/{loteViejoId}/release
```

Verifica que su estado vuelve a `Disponible`.

---

## Test 7 — Ajuste de stock

Obtén un `existenciaId`:
```powershell
docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT id, cantidad_disponible FROM inventory.existencias WHERE product_id = '<ARP-MINI productId>' LIMIT 1;"
```

```http
POST /api/v1/inventory/stock/adjust/{existenciaId}
{
  "delta": -5,
  "motivo": "Conteo cíclico — diferencia detectada"
}
```

**Esperado:** la cantidad disponible baja 5 unidades, se crea un Movimiento tipo `Ajuste`.

Intenta ajuste negativo más grande que disponible:
```http
POST /api/v1/inventory/stock/adjust/{existenciaId}
{
  "delta": -999999,
  "motivo": "Test de validación"
}
```

**Esperado:** `400 Bad Request` con `code: "existencia.adjustment_would_negative"`.

---

## Test 8 — Transferencia entre locations

```http
POST /api/v1/inventory/stock/transfer
{
  "productId": "<ARP-MINI productId>",
  "loteId": "<lote nuevo id>",
  "origenLocationId": "<PB-CAM-FZ id>",
  "destinoLocationId": "<otro location id, p.ej. PB-EST-SECO id>",
  "cantidad": 50
}
```

**Esperado:** se crean 2 movimientos (TransferenciaSalida + TransferenciaEntrada), la existencia de origen baja 50, se crea/actualiza la existencia de destino con 50 unidades.

---

## Test 9 — Despacho (materializa reserva)

Primero crea una reserva fresca:
```http
POST /api/v1/inventory/stock/reserve
{
  "productId": "<ARP-MINI productId>",
  "cantidad": 100,
  "referenciaTipo": "SalesOrder",
  "referenciaId": "test-dispatch-001"
}
```

Luego despachalo:
```http
POST /api/v1/inventory/stock/dispatch
{
  "productId": "<ARP-MINI productId>",
  "referenciaTipo": "SalesOrder",
  "referenciaId": "test-dispatch-001"
}
```

**Esperado:** `totalReservado` baja en 100, `totalFisico` también baja en 100 (sale del inventario físico). Las reservas afectadas pasan a estado `Fulfilled`.

---

## Test 10 — Kardex (historial de movimientos)

```http
GET /api/v1/inventory/movements?productId=<ARP-MINI productId>&limit=20
```

**Esperado:** lista paginada ordenada por `ocurridoEn DESC`. Deberías ver todos los movimientos que generaste: Entrada (seed + receive del Test 3.2), Salida (dispatch), TransferenciaSalida/Entrada, Ajuste, etc.

Filtrado por tipo:
```http
GET /api/v1/inventory/movements?productId=<...>&tipo=Ajuste
```

---

## Test 11 — Lotes próximos a vencer

```http
GET /api/v1/inventory/lots/expiring?withinDays=180&limit=10
```

**Esperado:** lista lotes con fecha de vencimiento dentro de los próximos 180 días. El lote del queso (vence 2026-07-01) debería aparecer si estamos cerca de esa fecha.

---

## Test 12 — Crear nuevo warehouse + location de cuarentena

```http
POST /api/v1/inventory/warehouses
{
  "code": "BG",
  "name": "Bodega Norte (Bogotá)",
  "address": "Calle 100 #45-67"
}
```

```http
POST /api/v1/inventory/warehouses/{warehouseId}/locations
{
  "code": "BG-CUAR-01",
  "name": "Zona de Cuarentena",
  "tipoUbicacion": "Cuarentena"
}
```

Y la validación de cámara sin temperatura (debe fallar):
```http
POST /api/v1/inventory/warehouses/{warehouseId}/locations
{
  "code": "BG-CAM-MAL",
  "name": "Cámara sin temperatura",
  "tipoUbicacion": "Camara"
}
```

**Esperado:** `400` con `code: "location.camara_requires_temp"`.

---

## Verificación del outbox

Tras cada operación que emite eventos, verifica que se hayan grabado:

```powershell
docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT event_type, status, occurred_at FROM platform.outbox_events WHERE event_type LIKE 'inventory.%' ORDER BY occurred_at DESC LIMIT 20;"
```

Deberías ver eventos como `inventory.LotRegistered.v1`, `inventory.InventoryReceived.v1`, `inventory.InventoryReserved.v1`, `inventory.ReservationReleased.v1`, `inventory.InventoryDispatched.v1`, etc.

El dispatcher del outbox los va consumiendo cada pocos segundos; verás que el `status` pasa de `pending` a `dispatched`.

---

## Resumen de cobertura

| # | Test | Cubre |
|---|------|-------|
| 1 | List warehouses/locations | Smoke test de lectura |
| 2 | Get stock initial | Read model agregado por SKU |
| 3 | **FEFO multi-lote** | **Invariante crítica del negocio** |
| 4 | Idempotencia | Reserva con misma referencia |
| 5 | Insufficient stock | 409 conflict |
| 6 | Bloqueo de lote | Excluye lote de FEFO |
| 7 | Adjust stock | Conteos cíclicos |
| 8 | Transfer | Movimientos pareados |
| 9 | Dispatch | Materializa reserva |
| 10 | Kardex | Append-only historial |
| 11 | Expiring lots | Alerta de vencimiento |
| 12 | Location coldchain | Validación de cámara |

Si los 12 tests pasan, el Inventory BC está funcionando según la especificación y los tres invariantes principales (FEFO, integridad de cadena de frío, trazabilidad por lote) están operativos.
