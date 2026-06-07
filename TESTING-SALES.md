# TESTING-SALES.md — Pruebas E2E del Sales BC

Esta guía valida el ciclo completo de ventas: creación de clientes,
pedidos con líneas, reserva FEFO, despacho e integración con Inventory.

## Preparación

1. JWT de prueba:
```powershell
   pnpm exec ts-node scripts/gen-test-jwt.ts
```
   Cópialo → Swagger (`http://localhost:3000/docs`) → **Authorize** → pegar.

2. Verificar datos previos:
```powershell
   # Productos terminados disponibles para vender
   docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT id, code, name, tax_rate FROM catalog.products WHERE type = 'FinishedGood';"

   # Stock disponible
   docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT p.code, e.cantidad_disponible, l.codigo_lote FROM inventory.existencias e JOIN inventory.lotes l ON l.id = e.lote_id JOIN catalog.products p ON p.id = e.product_id;"
```

   Debes ver:
   - 3 productos terminados (ARP-MINI-12U, ARP-TRAD-6U, FLT-SAN-5U)
   - Stock disponible (al menos 500 de ARP-MINI-12U del seed)

3. Obtener IDs necesarios:
```powershell
   docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT id, code FROM catalog.products WHERE code IN ('ARP-MINI-12U', 'ARP-TRAD-6U');"
```

   Guarda estos IDs — los usarás para agregar líneas a los pedidos.

---

## PARTE 1 — Clientes

### Test 1 — Crear cliente

```http
POST /api/v1/sales/customers
{
  "codigo": "CLI-DIST-BGA-001",
  "nit": "900123456-7",
  "razonSocial": "Distribuidora La Nevera S.A.S.",
  "nombreComercial": "La Nevera",
  "condicionesPago": "Credito30",
  "direccionFiscal": {
    "direccion": "Carrera 27 #36-65",
    "ciudad": "Bucaramanga",
    "departamento": "Santander",
    "telefono": "+57 316 123 4567"
  },
  "direccionEntrega": {
    "direccion": "Calle 45 #23-10 Bodega 3",
    "ciudad": "Bucaramanga",
    "departamento": "Santander",
    "telefono": "+57 316 765 4321",
    "notas": "Preguntar por Don José en bodega"
  },
  "contactoNombre": "María García",
  "contactoTelefono": "+57 316 123 4567",
  "contactoEmail": "ventas@lanevera.com",
  "notas": "Cliente preferencial — entregas martes y viernes"
}
```

**Esperado (201):**
```json
{
  "id": "...",
  "codigo": "CLI-DIST-BGA-001",
  "nit": "900123456-7",
  "razonSocial": "Distribuidora La Nevera S.A.S.",
  "estado": "Activo",
  "condicionesPago": "Credito30",
  "direccionFiscal": { "ciudad": "Bucaramanga", ... },
  "direccionEntrega": { "ciudad": "Bucaramanga", "notas": "Preguntar por Don José en bodega", ... }
}
```

Anota el `id` del cliente.

---

### Test 2 — Código duplicado (409)

```http
POST /api/v1/sales/customers
{
  "codigo": "CLI-DIST-BGA-001",
  "nit": "800999888-1",
  "razonSocial": "Otra Empresa",
  "direccionFiscal": { "direccion": "Calle 1 #2-3", "ciudad": "Bogotá", "departamento": "Cundinamarca" }
}
```

**Esperado:** `409 Conflict` con `code: "sales.customer_code_exists"`.

---

### Test 3 — NIT duplicado (409)

```http
POST /api/v1/sales/customers
{
  "codigo": "CLI-OTRO-001",
  "nit": "900123456-7",
  "razonSocial": "Empresa Con Mismo NIT",
  "direccionFiscal": { "direccion": "Calle 1 #2-3", "ciudad": "Bogotá", "departamento": "Cundinamarca" }
}
```

**Esperado:** `409 Conflict` con `code: "sales.customer_nit_exists"`.

---

### Test 4 — Crear segundo cliente (para tests posteriores)

```http
POST /api/v1/sales/customers
{
  "codigo": "CLI-SUPER-FLO-001",
  "nit": "800555666-3",
  "razonSocial": "Supermercado Floresta",
  "condicionesPago": "Contado",
  "direccionFiscal": {
    "direccion": "Avenida 33 #15-20",
    "ciudad": "Floridablanca",
    "departamento": "Santander"
  },
  "contactoNombre": "Carlos Pérez",
  "contactoEmail": "compras@superfloresta.com"
}
```

---

### Test 5 — Actualizar cliente (PATCH)

```http
PATCH /api/v1/sales/customers/<clienteId>
{
  "nombreComercial": "La Nevera Congelados",
  "condicionesPago": "Credito60"
}
```

**Esperado:** solo cambian los campos enviados. `nombreComercial` y
`condicionesPago` actualizados, el resto intacto.

---

### Test 6 — Suspender y reactivar

```http
POST /api/v1/sales/customers/<clienteId>/suspend
```

**Esperado:** estado cambia a `"Suspendido"`.

Intentar crear pedido para este cliente (lo probaremos en Test 9).

```http
POST /api/v1/sales/customers/<clienteId>/activate
```

**Esperado:** estado vuelve a `"Activo"`.

---

### Test 7 — Listar con búsqueda

```http
GET /api/v1/sales/customers?search=nevera
GET /api/v1/sales/customers?estado=Activo&limit=10
GET /api/v1/sales/customers?search=900123
```

**Esperado:** búsqueda funciona por razón social, NIT, nombre comercial y
código. La búsqueda por NIT parcial (`900123`) debe encontrar el cliente.

---

## PARTE 2 — Pedidos de Venta

### Test 8 — Crear pedido en Borrador

```http
POST /api/v1/sales/orders
{
  "codigo": "PV-2026-06-001",
  "clienteId": "<clienteId del Test 1>",
  "notas": "Pedido semanal — entrega martes"
}
```

**Esperado (201):**
```json
{
  "id": "...",
  "codigo": "PV-2026-06-001",
  "cliente": {
    "codigo": "CLI-DIST-BGA-001",
    "razonSocial": "Distribuidora La Nevera S.A.S."
  },
  "estado": "Borrador",
  "condicionesPago": "Credito60",
  "direccionEntrega": { "notas": "Preguntar por Don José en bodega", ... },
  "lineas": [],
  "subtotal": 0,
  "ivaTotal": 0,
  "total": 0
}
```

**Validaciones automáticas:**
- `condicionesPago` se heredó del cliente (Credito60, del Test 5)
- `direccionEntrega` se heredó de la dirección de entrega del cliente

Anota el `id` de la orden.

---

### Test 9 — Pedido a cliente suspendido (debe fallar)

Suspende el cliente primero, luego intenta crear un pedido:

```http
POST /api/v1/sales/customers/<clienteId>/suspend
POST /api/v1/sales/orders
{
  "codigo": "PV-FAIL-SUSP",
  "clienteId": "<clienteId>"
}
```

**Esperado:** `400 Bad Request` con `code: "sales.customer_suspended"`.

Reactiva el cliente después:
```http
POST /api/v1/sales/customers/<clienteId>/activate
```

---

### Test 10 — Agregar líneas al pedido

```http
POST /api/v1/sales/orders/<ordenId>/lines
{
  "productId": "<ARP-MINI-12U id>",
  "cantidad": 100,
  "precioUnitario": 15000,
  "notas": "Paquetes de 12 unidades"
}
```

**Esperado:** la orden ahora muestra 1 línea con:
- `subtotal`: 1500000 (100 × 15000)
- `iva`: calculado con la `tasaIva` del producto (ej: 0% si es exento, 19% si aplica)
- `total`: subtotal + iva

Agregar segunda línea:
```http
POST /api/v1/sales/orders/<ordenId>/lines
{
  "productId": "<ARP-TRAD-6U id>",
  "cantidad": 50,
  "precioUnitario": 12000
}
```

**Esperado:** la orden muestra 2 líneas, los totales se recalcularon
sumando ambas.

---

### Test 11 — Producto duplicado en líneas (debe fallar)

```http
POST /api/v1/sales/orders/<ordenId>/lines
{
  "productId": "<ARP-MINI-12U id>",
  "cantidad": 20,
  "precioUnitario": 15000
}
```

**Esperado:** `400 Bad Request` con `code: "orden.product_already_in_order"`.

---

### Test 12 — Quitar línea

Obtén el `id` de la segunda línea (ARP-TRAD-6U) del response del Test 10.

```http
DELETE /api/v1/sales/orders/<ordenId>/lines/<lineaId>
```

**Esperado:** la orden vuelve a tener 1 línea, totales recalculados.

Re-agrega la línea para los tests siguientes:
```http
POST /api/v1/sales/orders/<ordenId>/lines
{
  "productId": "<ARP-TRAD-6U id>",
  "cantidad": 50,
  "precioUnitario": 12000
}
```

---

### Test 13 — Confirmar pedido

```http
POST /api/v1/sales/orders/<ordenId>/confirm
```

**Esperado:** estado cambia a `"Confirmada"`, `confirmadoEn` tiene fecha.
Las líneas ya no se pueden modificar.

Intentar agregar línea después de confirmar:
```http
POST /api/v1/sales/orders/<ordenId>/lines
{
  "productId": "<algún productId>",
  "cantidad": 10,
  "precioUnitario": 5000
}
```

**Esperado:** `400 Bad Request` con `code: "orden.not_borrador"`.

---

### Test 14 — Confirmar pedido sin líneas (debe fallar)

```http
POST /api/v1/sales/orders
{ "codigo": "PV-EMPTY-TEST", "clienteId": "<clienteId>" }

POST /api/v1/sales/orders/<nuevaOrdenId>/confirm
```

**Esperado:** `400 Bad Request` con `code: "orden.no_lines"`.

---

### Test 15 — CRÍTICO: Reservar stock (FEFO cross-BC)

```http
POST /api/v1/sales/orders/<ordenId>/reserve
```

**Esperado (200):**
```json
{
  "ordenId": "...",
  "lineasReservadas": 2,
  "detalle": [
    {
      "productCode": "ARP-MINI-12U",
      "cantidadReservada": 100,
      "reservaIds": ["..."]
    },
    {
      "productCode": "ARP-TRAD-6U",
      "cantidadReservada": 50,
      "reservaIds": ["..."]
    }
  ]
}
```

**Verificación cross-BC:**
```powershell
docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT r.referencia_tipo, r.referencia_id, r.cantidad, r.estado FROM inventory.reservas r WHERE referencia_tipo = 'SalesOrder';"
```

Debe mostrar reservas con `estado = 'Active'` y `referencia_tipo = 'SalesOrder'`.

```powershell
# Verificar que la orden pasó a Reservada
docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT codigo, estado, reservado_en FROM sales.ordenes_venta;"
```

---

### Test 16 — Stock insuficiente (409)

Crea un pedido con cantidad imposible:
```http
POST /api/v1/sales/orders
{ "codigo": "PV-IMPOSIBLE", "clienteId": "<clienteId>" }

POST /api/v1/sales/orders/<id>/lines
{ "productId": "<ARP-MINI-12U id>", "cantidad": 999999, "precioUnitario": 15000 }

POST /api/v1/sales/orders/<id>/confirm
POST /api/v1/sales/orders/<id>/reserve
```

**Esperado:** `409 Conflict` con `code: "sales.reserve_failed"`.

---

### Test 17 — CRÍTICO: Despachar pedido

```http
POST /api/v1/sales/orders/<ordenId>/dispatch
```

**Esperado:** estado cambia a `"Despachada"`, `despachadoEn` tiene fecha.

**Verificación cross-BC — lo MÁS importante:**

```powershell
# 1. Reservas deben pasar a Fulfilled
docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT referencia_id, cantidad, estado FROM inventory.reservas WHERE referencia_tipo = 'SalesOrder';"
```

Las reservas deben estar en `Fulfilled`.

```powershell
# 2. Existencias deben haber bajado
docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT p.code, e.cantidad_disponible, e.cantidad_reservada FROM inventory.existencias e JOIN catalog.products p ON p.id = e.product_id;"
```

`cantidad_disponible` de ARP-MINI-12U debe haber bajado 100,
y ARP-TRAD-6U debe haber bajado 50.

```powershell
# 3. Movimientos de salida en kardex
docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT tipo, cantidad, referencia_tipo FROM inventory.movimientos_inventario WHERE referencia_tipo = 'SalesOrder' ORDER BY ocurrido_en DESC;"
```

Debe mostrar movimientos tipo `Salida` con `referencia_tipo = 'SalesOrder'`.

**Si estos tres checks pasan, el ciclo Sales → Inventory está funcionando end-to-end.**

---

### Test 18 — Cerrar pedido

```http
POST /api/v1/sales/orders/<ordenId>/close
```

**Esperado:** estado cambia a `"Cerrada"`, `cerradoEn` tiene fecha.
Estado terminal — no se puede modificar más.

---

### Test 19 — Cancelar pedido con reservas (libera stock)

Crea un nuevo pedido completo hasta Reservada:
```http
POST /api/v1/sales/orders
{ "codigo": "PV-CANCEL-TEST", "clienteId": "<clienteId>" }

POST /api/v1/sales/orders/<nuevaId>/lines
{ "productId": "<ARP-MINI-12U id>", "cantidad": 10, "precioUnitario": 15000 }

POST /api/v1/sales/orders/<nuevaId>/confirm
POST /api/v1/sales/orders/<nuevaId>/reserve
```

Verifica stock reservado, luego cancela:
```http
POST /api/v1/sales/orders/<nuevaId>/cancel
{
  "motivo": "Cliente cambió de idea — verificar que se libere el stock"
}
```

**Esperado:** estado `"Cancelada"`, `canceladoMotivo` y `canceladoPor` rellenos.

**Verificación:**
```powershell
docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT referencia_id, estado, released_reason FROM inventory.reservas WHERE referencia_id LIKE '%<nuevaId>%';"
```

Las reservas deben estar en `Released` con el motivo de cancelación.

```powershell
# El stock debe haber vuelto a disponible
docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT p.code, e.cantidad_disponible FROM inventory.existencias e JOIN catalog.products p ON p.id = e.product_id WHERE p.code = 'ARP-MINI-12U';"
```

---

### Test 20 — Listar pedidos con filtros

```http
GET /api/v1/sales/orders?estado=Cerrada
GET /api/v1/sales/orders?clienteId=<clienteId>&limit=10
GET /api/v1/sales/orders?estado=Cancelada
```

**Esperado:** lista paginada con `items`, `total`, `limit`, `offset`.
Vista de lista muestra `lineasCount` y `total` sin los arrays completos.

---

### Test 21 — Eventos en outbox

```powershell
docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT event_type, status FROM platform.outbox_events WHERE event_type LIKE 'sales.%' ORDER BY occurred_at DESC LIMIT 15;"
```

Deberías ver:
- `sales.CustomerCreated.v1`
- `sales.CustomerUpdated.v1`
- `sales.OrderDrafted.v1`
- `sales.OrderConfirmed.v1`
- `sales.OrderReserved.v1`
- `sales.OrderDispatched.v1`
- `sales.OrderCancelled.v1`

---

## Resumen de cobertura

| # | Test | Cubre |
|---|------|-------|
| 1 | Crear cliente | NIT, dirección fiscal/entrega, contacto |
| 2 | Código duplicado | Unicidad código |
| 3 | NIT duplicado | Unicidad NIT |
| 4 | Segundo cliente | Setup para tests de órdenes |
| 5 | Actualizar cliente | PATCH parcial + tracking de cambios |
| 6 | Suspender/activar | Máquina de estados del cliente |
| 7 | Listar con búsqueda | Búsqueda multi-campo |
| 8 | Crear pedido | Herencia de condiciones/dirección del cliente |
| 9 | Pedido a suspendido | Invariante cliente activo |
| 10 | Agregar líneas | Cálculo IVA automático desde catálogo |
| 11 | Producto duplicado | Invariante no repetir producto |
| 12 | Quitar línea | Recálculo de totales |
| 13 | Confirmar pedido | Cierre de líneas |
| 14 | Confirmar sin líneas | Invariante min 1 línea |
| 15 | **Reservar stock** | **FEFO cross-BC con Inventory** |
| 16 | Stock insuficiente | 409 en cascada |
| 17 | **Despachar pedido** | **Materializa reservas en Inventory** |
| 18 | Cerrar pedido | Estado terminal |
| 19 | **Cancelar con reservas** | **Libera stock en Inventory** |
| 20 | Listar con filtros | Query paginada |
| 21 | Eventos outbox | Verificar publicación |

Los tests **15, 17 y 19** son los más críticos — validan que Sales e
Inventory están integrados end-to-end:
- Test 15: FEFO reserva stock para el pedido
- Test 17: despacho materializa las reservas (stock sale del inventario)
- Test 19: cancelación libera las reservas (stock vuelve a disponible)

Si los 21 tests pasan, el Sales BC está operativo y el ciclo completo
Cliente → Pedido → Reserva FEFO → Despacho → Cierre funciona.