# TESTING-MANUFACTURING.md — Pruebas E2E del Manufacturing BC

Esta guía valida el ciclo completo de una orden de producción: desde la
planificación hasta la creación de Lotes de producto terminado en Inventory.

## Preparación

1. JWT de prueba:
```powershell
   pnpm exec ts-node scripts/gen-test-jwt.ts
```
   Cópialo → Swagger (`http://localhost:3000/docs`) → **Authorize** → pegar.

2. Verificar seeds previos:
```powershell
   docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT code, name FROM catalog.products WHERE type = 'FinishedGood';"
   docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT p.code, b.quantity, c.code as component_code FROM catalog.bom_components b JOIN catalog.products p ON p.id = b.product_id JOIN catalog.products c ON c.id = b.component_id;"
   docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT codigo_lote, cantidad_inicial, estado FROM inventory.lotes;"
   docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT code, name FROM inventory.warehouses;"
   docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT code, tipo_ubicacion, temp_min_c, temp_max_c FROM inventory.locations;"
```

   Debes ver:
   - 3 productos terminados (ARP-MINI-12U, ARP-TRAD-6U, FLT-SAN-5U)
   - 13 componentes BOM
   - 3 lotes con stock en Inventory
   - 1 warehouse PB con 4 locations

3. Obtener IDs necesarios:
```powershell
   # ID del producto ARP-MINI-12U
   docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT id FROM catalog.products WHERE code = 'ARP-MINI-12U';"
   
   # ID de la location PB-CAM-FZ (cámara congelación, destino del PT)
   docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT id FROM inventory.locations WHERE code = 'PB-CAM-FZ';"
```

   Guarda estos IDs — los usarás en todos los tests.

---

## Test 1 — Crear orden de producción (captura BOM)

```http
POST /api/v1/manufacturing/orders
{
  "codigo": "OP-ARP-MINI-2026-06-001",
  "productoTerminadoId": "<ARP-MINI-12U id>",
  "cantidadObjetivo": 100,
  "prioridad": "Alta",
  "fechaProgramada": "2026-06-20T06:00:00.000Z",
  "notas": "Producción semanal de arepas mini"
}
```

**Esperado (201):**
```json
{
  "id": "...",
  "codigo": "OP-ARP-MINI-2026-06-001",
  "productoTerminado": {
    "code": "ARP-MINI-12U",
    "name": "Arepa de Queso Mini 12 Unidades"
  },
  "cantidadObjetivo": 100,
  "estado": "Planificada",
  "prioridad": "Alta",
  "componentes": [
    {
      "productCode": "RM-QUESO-FRESCO",
      "cantidadPorUnidad": 0.15,
      "cantidadTotalRequerida": 15,
      "unidadMedida": "kg"
    },
    {
      "productCode": "RM-HARINA-MAIZ",
      "cantidadPorUnidad": 0.06,
      "cantidadTotalRequerida": 6,
      "unidadMedida": "kg"
    }
  ],
  "materialesReservados": false,
  "consumos": [],
  "lotesProducidos": []
}
```

**Validación clave:** los `componentes` se calcularon automáticamente desde
el BOM del catálogo × `cantidadObjetivo`. Si ARP-MINI-12U tiene 0.15 kg de
queso por unidad y pedimos 100 unidades, `cantidadTotalRequerida` = 15 kg.

Anota el `id` de la orden — lo necesitas en todos los tests siguientes.

---

## Test 2 — Código duplicado (debe fallar 409)

```http
POST /api/v1/manufacturing/orders
{
  "codigo": "OP-ARP-MINI-2026-06-001",
  "productoTerminadoId": "<ARP-MINI-12U id>",
  "cantidadObjetivo": 50
}
```

**Esperado:** `409 Conflict` con `code: "manufacturing.codigo_exists"`.

---

## Test 3 — Producto sin BOM (debe fallar 400)

Busca un producto de tipo RawMaterial (no tiene BOM):
```powershell
docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT id, code FROM catalog.products WHERE type = 'RawMaterial' LIMIT 1;"
```

```http
POST /api/v1/manufacturing/orders
{
  "codigo": "OP-QUESO-FAIL-001",
  "productoTerminadoId": "<id de la materia prima>",
  "cantidadObjetivo": 50
}
```

**Esperado:** `400 Bad Request` con `code: "manufacturing.no_bom"`.

---

## Test 4 — Intentar arrancar sin reservar (debe fallar)

```http
POST /api/v1/manufacturing/orders/<ordenId>/start
```

**Esperado:** `400 Bad Request` con `code: "orden.materials_not_reserved"`.

---

## Test 5 — CRÍTICO: Reservar materiales (FEFO cross-BC)

```http
POST /api/v1/manufacturing/orders/<ordenId>/reserve-materials
```

**Esperado (200):**
```json
{
  "ordenId": "...",
  "componentesReservados": 2,
  "detalle": [
    {
      "productCode": "RM-QUESO-FRESCO",
      "cantidadReservada": 15,
      "reservaIds": ["..."]
    },
    {
      "productCode": "RM-HARINA-MAIZ",
      "cantidadReservada": 6,
      "reservaIds": ["..."]
    }
  ]
}
```

**Verificación cross-BC:** confirma que Inventory ahora tiene reservas:
```powershell
docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT r.referencia_tipo, r.referencia_id, r.cantidad, r.estado FROM inventory.reservas r;"
```

Debe mostrar reservas con `referencia_tipo = 'ProductionOrder'` y
`estado = 'Active'`.

---

## Test 6 — Stock insuficiente (debe fallar 409)

Crea otra orden con cantidad imposible:
```http
POST /api/v1/manufacturing/orders
{
  "codigo": "OP-ARP-MINI-IMPOSIBLE",
  "productoTerminadoId": "<ARP-MINI-12U id>",
  "cantidadObjetivo": 999999
}
```

Intenta reservar:
```http
POST /api/v1/manufacturing/orders/<nueva ordenId>/reserve-materials
```

**Esperado:** `409 Conflict` con `code: "manufacturing.reserve_failed"` y
mensaje indicando qué componente no tuvo stock suficiente.

---

## Test 7 — Arrancar producción

```http
POST /api/v1/manufacturing/orders/<ordenId>/start
```

**Esperado:** estado cambia a `"EnProceso"`, `iniciadoEn` tiene la fecha
actual. Ahora se pueden registrar consumos y producción.

---

## Test 8 — Registrar consumo de materia prima

Para este test necesitas datos del despacho real. Consulta los lotes
disponibles:
```powershell
docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT id, codigo_lote, product_id FROM inventory.lotes WHERE estado = 'Disponible';"
```

```http
POST /api/v1/manufacturing/orders/<ordenId>/consumption
{
  "productId": "<id del queso>",
  "productCode": "RM-QUESO-FRESCO",
  "loteId": "<id del lote de queso>",
  "codigoLote": "BCM-RM-QUESO-2026-06-01-001",
  "cantidad": 15,
  "unidadMedida": "kg",
  "movimientoId": "00000000-0000-0000-0000-000000000001"
}
```

**Esperado:** la orden ahora muestra 1 consumo en el array `consumos`,
con trazabilidad completa del lote consumido.

Repetir para harina:
```http
POST /api/v1/manufacturing/orders/<ordenId>/consumption
{
  "productId": "<id de la harina>",
  "productCode": "RM-HARINA-MAIZ",
  "loteId": "<id del lote de harina>",
  "codigoLote": "BCM-RM-HARINA-2026-05-01-001",
  "cantidad": 6,
  "unidadMedida": "kg",
  "movimientoId": "00000000-0000-0000-0000-000000000002"
}
```

---

## Test 9 — CRÍTICO: Registrar producción (crea Lote PT en Inventory)

```http
POST /api/v1/manufacturing/orders/<ordenId>/production
{
  "codigoLote": "BCM-ARP-MINI-2026-06-20-001",
  "cantidad": 100,
  "fechaVencimiento": "2026-12-20T00:00:00.000Z",
  "locationId": "<PB-CAM-FZ id>",
  "notas": "Turno mañana — producción completa"
}
```

**Esperado (201):** la orden muestra 1 lote producido en el array
`lotesProducidos`.

**Verificación cross-BC — esto es lo MÁS importante:**

```powershell
# 1. Nuevo Lote PT creado en Inventory
docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT codigo_lote, cantidad_inicial, origen_tipo, origen_ref FROM inventory.lotes WHERE codigo_lote = 'BCM-ARP-MINI-2026-06-20-001';"
```

Debe mostrar:
- `origen_tipo = 'Production'`
- `origen_ref = <ordenId>` ← trazabilidad hacia la orden

```powershell
# 2. Existencia creada con stock disponible
docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT cantidad_disponible, cantidad_reservada FROM inventory.existencias WHERE lote_id = (SELECT id FROM inventory.lotes WHERE codigo_lote = 'BCM-ARP-MINI-2026-06-20-001');"
```

Debe mostrar `cantidad_disponible = 100`.

```powershell
# 3. Movimiento de entrada en kardex
docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT tipo, cantidad, referencia_tipo, referencia_id FROM inventory.movimientos_inventario WHERE referencia_tipo = 'ProductionOrder' ORDER BY ocurrido_en DESC LIMIT 5;"
```

Debe mostrar un movimiento `Entrada` con `referencia_tipo = 'ProductionOrder'`.

Si estos tres checks pasan, **el ciclo Manufacturing → Inventory está funcionando end-to-end.**

---

## Test 10 — Completar orden

```http
POST /api/v1/manufacturing/orders/<ordenId>/complete
```

**Esperado:** estado cambia a `"Completada"`, `completadoEn` tiene fecha.
`cantidadRealProducida` = 100.

**Verificar evento en outbox:**
```powershell
docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT event_type, status FROM platform.outbox_events WHERE event_type LIKE 'manufacturing.%' ORDER BY occurred_at DESC LIMIT 10;"
```

Debe mostrar `manufacturing.ProductionCompleted.v1` — este es el evento
que el handler stub de Inventory recibirá cuando activemos la integración.

---

## Test 11 — Completar sin lotes producidos (debe fallar)

Crea una orden nueva, reserva materiales, arráncala, y luego intenta
completar SIN registrar producción:

```http
POST /api/v1/manufacturing/orders
{ "codigo": "OP-TEST-EMPTY", "productoTerminadoId": "<...>", "cantidadObjetivo": 10 }

POST /api/v1/manufacturing/orders/<nuevaId>/reserve-materials
POST /api/v1/manufacturing/orders/<nuevaId>/start
POST /api/v1/manufacturing/orders/<nuevaId>/complete
```

**Esperado:** `400 Bad Request` con `code: "orden.no_lots_produced"`.

---

## Test 12 — Cancelar orden (libera reservas)

Cancela la orden del test anterior (que tiene materiales reservados):

```http
POST /api/v1/manufacturing/orders/<nuevaId>/cancel
{
  "motivo": "Test de cancelación — verificar liberación de reservas"
}
```

**Esperado:** estado cambia a `"Cancelada"`, `canceladoMotivo` y
`canceladoPor` rellenos.

**Verificación:** las reservas en Inventory deben haberse liberado:
```powershell
docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT referencia_id, estado FROM inventory.reservas WHERE referencia_id LIKE '%<nuevaId>%';"
```

Las reservas deben estar en estado `Released`.

---

## Test 13 — Listar órdenes con filtros

```http
GET /api/v1/manufacturing/orders?estado=Completada&limit=10
GET /api/v1/manufacturing/orders?prioridad=Alta
GET /api/v1/manufacturing/orders?productoTerminadoId=<ARP-MINI id>
```

**Esperado:** lista paginada con `items`, `total`, `limit`, `offset`.
La vista de lista muestra counts (`consumosCount`, `lotesProducidosCount`)
en lugar de arrays completos.

---

## Test 14 — Detalle de orden

```http
GET /api/v1/manufacturing/orders/<ordenId>
```

**Esperado:** detalle completo con BOM snapshot, consumos con trazabilidad
de lote, y lotes producidos con referencia al Inventory.

---

## Resumen de cobertura

| # | Test | Cubre |
|---|------|-------|
| 1 | Crear orden | BOM snapshot desde Catalog |
| 2 | Código duplicado | Unicidad de código |
| 3 | Producto sin BOM | Validación de PT |
| 4 | Start sin reservar | Invariante materialesReservados |
| 5 | **Reservar materiales** | **FEFO cross-BC con Inventory** |
| 6 | Stock insuficiente | 409 en cascada |
| 7 | Arrancar producción | Máquina de estados |
| 8 | Registrar consumo | Trazabilidad MP por lote |
| 9 | **Registrar producción** | **Crea Lote PT en Inventory** |
| 10 | Completar orden | Emite ProductionCompleted |
| 11 | Completar sin lotes | Invariante min 1 lote |
| 12 | Cancelar orden | Libera reservas en Inventory |
| 13 | Listar con filtros | Query paginada |
| 14 | Detalle completo | Vista completa |

Los tests **5 y 9** son los más críticos — validan que Manufacturing y
Inventory están integrados correctamente a nivel de dominio:
- Test 5: FEFO reserva MP para la orden de producción
- Test 9: crea un Lote PT real en Inventory con trazabilidad al origen

Si los 14 tests pasan, el Manufacturing BC está operativo y el ciclo
BOM → Reserva MP → Producción → Lote PT está funcionando end-to-end.