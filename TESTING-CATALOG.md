# 🧪 Testing — Sprint 5 (Catalog Bounded Context)

Esta guía cubre el flujo completo del **Catalog**: categorías, unidades de medida, productos (raw materials + finished goods) y BOMs. Todos los ejemplos asumen que ya tienes la app corriendo según `GETTING-STARTED.md`.

> 💡 Esta guía es **secuencial**: cada paso depende del anterior. Si te saltas uno, los IDs no van a coincidir.

---

## 📦 Pre-requisitos

```bash
# 1. App corriendo en :3000 (modo A o B)
curl -fs http://localhost:3000/health | jq

# 2. JWKS server activo o Keycloak listo
curl -fs http://localhost:9999/.well-known/jwks.json | jq '.keys[0].kid'

# 3. Variables de entorno locales
export API=http://localhost:3000/api/v1
export TOKEN=$(make jwt 2>/dev/null | grep -A1 'Bearer' | tail -1)
echo "Token: ${TOKEN:0:40}..."

# 4. Schema catalog aplicado
make db-migrate
# Aplicar también las policies RLS del catalog
psql "$DATABASE_URL" -f prisma/init/02_catalog_rls.sql

# 5. Datos semilla
make seed           # tenant + admins (si no se hizo antes)
make seed-catalog   # UoMs + categorías + productos arepa/flauta
```

Después de `make seed-catalog` deberías ver:

```
🎉 Catalog seed completo:
   Tenant:     7c9e6679-7425-40de-944b-e07fc1f90ae7
   UoMs:       14 (platform-wide)
   Categories:  8 (2 raíces + 6 hijas)
   Products:    8 (5 raw materials + 3 finished goods)
   BOMs:        3 productos con un total de 13 componentes
```

---

## ✅ Test 1 — Catálogo cross-tenant de UoMs

Las unidades de medida son **platform-wide** (cross-tenant). Cualquier usuario autenticado puede leerlas:

```bash
curl -s "$API/catalog/units-of-measure" \
  -H "Authorization: Bearer $TOKEN" | jq 'length'
# → 14
```

Filtrar por dimensión:

```bash
curl -s "$API/catalog/units-of-measure?dimension=Mass" \
  -H "Authorization: Bearer $TOKEN" | jq '.[] | {code, name, toBaseFactor}'
```

Debe devolver `g`, `kg`, `mg` con factores 1, 1000, 0.001 respectivamente.

```bash
# Guardamos los IDs de las UoMs que más usaremos
export UOM_G=$(curl -s "$API/catalog/units-of-measure?dimension=Mass" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[] | select(.code=="g") | .id')
export UOM_ML=$(curl -s "$API/catalog/units-of-measure?dimension=Volume" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[] | select(.code=="ml") | .id')
export UOM_PACK=$(curl -s "$API/catalog/units-of-measure?dimension=Count" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[] | select(.code=="pack") | .id')
echo "g=$UOM_G ml=$UOM_ML pack=$UOM_PACK"
```

---

## ✅ Test 2 — Árbol de categorías

```bash
curl -s "$API/catalog/categories" \
  -H "Authorization: Bearer $TOKEN" | jq 'map({code, path, children: (.children | length)})'
```

Salida esperada:

```json
[
  { "code": "congelados",       "path": "/congelados",      "children": 2 },
  { "code": "materias-primas",  "path": "/materias-primas", "children": 2 }
]
```

Ver el sub-árbol completo:

```bash
curl -s "$API/catalog/categories" -H "Authorization: Bearer $TOKEN" \
  | jq '..|objects | select(.code=="arepas") | .children | map(.code)'
# → ["arepas-mini","arepas-tradicional"]
```

Guarda IDs útiles:

```bash
export CAT_MINI=$(curl -s "$API/catalog/categories" -H "Authorization: Bearer $TOKEN" \
  | jq -r '..|objects | select(.code=="arepas-mini") | .id')
export CAT_FLAUTAS=$(curl -s "$API/catalog/categories" -H "Authorization: Bearer $TOKEN" \
  | jq -r '..|objects | select(.code=="flautas") | .id')
echo "mini=$CAT_MINI flautas=$CAT_FLAUTAS"
```

---

## ✅ Test 3 — Listar productos terminados

```bash
curl -s "$API/catalog/products?type=FinishedGood&status=Active" \
  -H "Authorization: Bearer $TOKEN" | jq '{total, items: (.items | map({code, name, packSize, netWeightGrams}))}'
```

Salida esperada (los 3 productos del seed):

```json
{
  "total": 3,
  "items": [
    { "code": "ARP-MINI-12U", "name": "Arepa de Queso Mini x12 unidades",        "packSize": 12, "netWeightGrams": 360 },
    { "code": "ARP-TRAD-6U",  "name": "Arepa de Queso Tradicional x6 unidades",  "packSize":  6, "netWeightGrams": 540 },
    { "code": "FLT-SAN-5U",   "name": "Flauta Santandereana Paquete x5 unidades","packSize":  5, "netWeightGrams": 425 }
  ]
}
```

Verifica la cadena fría: todos deben tener `storageTempMinC: -18, storageTempMaxC: -15`:

```bash
curl -s "$API/catalog/products?type=FinishedGood" -H "Authorization: Bearer $TOKEN" \
  | jq '.items | map({code, storageTempMinC, storageTempMaxC, isControlled})'
```

---

## ✅ Test 4 — Crear un producto nuevo (queda en Draft)

```bash
curl -sf -X POST "$API/catalog/products" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"code\": \"ARP-DULCE-6U\",
    \"sku\": \"ARP-DULCE-6U\",
    \"name\": \"Arepa Dulce con Panela x6 unidades\",
    \"type\": \"FinishedGood\",
    \"categoryId\": \"$CAT_MINI\",
    \"unitOfSaleId\": \"$UOM_PACK\",
    \"packSize\": 6,
    \"netWeightGrams\": 480,
    \"grossWeightGrams\": 510,
    \"expiryDays\": 180,
    \"storageTempMinC\": -18,
    \"storageTempMaxC\": -15,
    \"taxRate\": 19,
    \"isControlled\": true
  }" | jq '{id, code, status, version}'
```

Salida esperada — observa que el producto nace en **`Draft`**:

```json
{ "id": "...", "code": "ARP-DULCE-6U", "status": "Draft", "version": 1 }
```

Guarda el ID:

```bash
export NEW_PROD=$(curl -s "$API/catalog/products/by-code/ARP-DULCE-6U" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.id')
echo "Nuevo producto: $NEW_PROD"
```

---

## ✅ Test 5 — Validaciones del dominio (deben fallar)

### 5.1 Code duplicado

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST "$API/catalog/products" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{
    \"code\": \"ARP-MINI-12U\",
    \"sku\": \"ARP-MINI-DUP\",
    \"name\": \"Duplicado\",
    \"type\": \"FinishedGood\",
    \"categoryId\": \"$CAT_MINI\",
    \"unitOfSaleId\": \"$UOM_PACK\"
  }"
# → HTTP 409  (product.code_already_exists)
```

### 5.2 Servicio con atributos físicos (rechazo)

```bash
curl -s -X POST "$API/catalog/products" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{
    \"code\": \"SVC-INVALID\",
    \"sku\": \"SVC-INVALID\",
    \"name\": \"Transporte refrigerado\",
    \"type\": \"Service\",
    \"categoryId\": \"$CAT_MINI\",
    \"unitOfSaleId\": \"$UOM_PACK\",
    \"netWeightGrams\": 1000
  }" | jq '{type, title, detail}'
# → product.service_no_physical_attrs
```

### 5.3 Producto controlado sin metadata de cadena fría

```bash
curl -s -X POST "$API/catalog/products" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{
    \"code\": \"FG-INVALID\",
    \"sku\": \"FG-INVALID\",
    \"name\": \"Producto controlado mal definido\",
    \"type\": \"FinishedGood\",
    \"categoryId\": \"$CAT_MINI\",
    \"unitOfSaleId\": \"$UOM_PACK\",
    \"isControlled\": true
  }" | jq '.detail'
# → "Controlled products require expiryDays and storage temperature range"
```

---

## ✅ Test 6 — Máquina de estados

### 6.1 Activar (Draft → Active)

```bash
curl -sf -X POST "$API/catalog/products/$NEW_PROD/activate" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"expectedVersion": 1}' | jq '{status, version}'
# → { "status": "Active", "version": 2 }
```

### 6.2 Optimistic concurrency: activar con versión equivocada

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -X POST "$API/catalog/products/$NEW_PROD/activate" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"expectedVersion": 1}'
# → HTTP 412 Precondition Failed
```

### 6.3 Renombrar producto Active

```bash
curl -sf -X PATCH "$API/catalog/products/$NEW_PROD/rename" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"newName": "Arepa Dulce de Panela - 6 unidades", "expectedVersion": 2}' \
  | jq '{name, version}'
# → version: 3
```

### 6.4 Descontinuar (Active → Discontinued)

```bash
curl -sf -X POST "$API/catalog/products/$NEW_PROD/discontinue" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"reason": "Producto piloto, no se va a producir en serie", "expectedVersion": 3}' \
  | jq '{status, version}'
# → { "status": "Discontinued", "version": 4 }
```

### 6.5 Transición inválida: intentar reactivar Discontinued

```bash
curl -s -X POST "$API/catalog/products/$NEW_PROD/activate" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"expectedVersion": 4}' | jq '{title, detail}'
# → product.invalid_status_transition
# → "Cannot transition from Discontinued to Active"
```

### 6.6 Tampoco se puede modificar Discontinued

```bash
curl -s -X PATCH "$API/catalog/products/$NEW_PROD/rename" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"newName": "Otro nombre"}' | jq '.detail'
# → "Cannot modify discontinued product"
```

---

## ✅ Test 7 — BOM management

Revisa el BOM existente de la Arepa Mini 12u:

```bash
export AREPA_MINI=$(curl -s "$API/catalog/products/by-code/ARP-MINI-12U" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.id')

curl -s "$API/catalog/products/$AREPA_MINI" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.components | map({componentProductId, quantity, uomId: .uomId[0:8]})'
```

Debe mostrar 4 componentes (harina, queso, sal, agua) en posición ordenada.

### 7.1 Validación: no auto-referencia

```bash
curl -s -X PUT "$API/catalog/products/$AREPA_MINI/bom" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{
    \"components\": [
      { \"componentProductId\": \"$AREPA_MINI\", \"quantity\": 1, \"uomId\": \"$UOM_PACK\" }
    ]
  }" | jq '.detail'
# → "A product cannot be its own component"
```

### 7.2 Validación: componente inexistente

```bash
curl -s -X PUT "$API/catalog/products/$AREPA_MINI/bom" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{
    \"components\": [
      { \"componentProductId\": \"00000000-0000-0000-0000-000000000099\", \"quantity\": 100, \"uomId\": \"$UOM_G\" }
    ]
  }" | jq '{title, detail}'
# → product.bom_components_not_found
```

### 7.3 Reemplazar BOM completo (PUT)

> ⚠️ PUT **reemplaza** el BOM completo. Para agregar un solo componente, hay que enviar TODOS los actuales + el nuevo.

```bash
# Primero obtenemos los IDs de las materias primas
export RM_HARINA=$(curl -s "$API/catalog/products/by-code/RM-HARINA-MAIZ" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.id')
export RM_QUESO=$(curl -s "$API/catalog/products/by-code/RM-QUESO-FRESCO" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.id')

# Reemplazar BOM con solo 2 ingredientes (versión simplificada)
curl -sf -X PUT "$API/catalog/products/$AREPA_MINI/bom" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{
    \"components\": [
      { \"componentProductId\": \"$RM_HARINA\", \"quantity\": 200, \"uomId\": \"$UOM_G\", \"position\": 1 },
      { \"componentProductId\": \"$RM_QUESO\",  \"quantity\": 130, \"uomId\": \"$UOM_G\", \"position\": 2 }
    ]
  }" | jq '{code, version, componentCount: (.components | length)}'
# → version aumenta, componentCount: 2
```

### 7.4 Duplicado en BOM

```bash
curl -s -X PUT "$API/catalog/products/$AREPA_MINI/bom" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{
    \"components\": [
      { \"componentProductId\": \"$RM_HARINA\", \"quantity\": 100, \"uomId\": \"$UOM_G\" },
      { \"componentProductId\": \"$RM_HARINA\", \"quantity\": 50,  \"uomId\": \"$UOM_G\" }
    ]
  }" | jq '.detail'
# → "Component ... appears more than once in BOM"
```

---

## ✅ Test 8 — Búsqueda y filtros

### 8.1 Búsqueda full-text

```bash
curl -s "$API/catalog/products/search?q=arepa" \
  -H "Authorization: Bearer $TOKEN" | jq 'map(.code)'
# → ["ARP-MINI-12U", "ARP-TRAD-6U", ...]
```

```bash
# Búsqueda por código de barras
curl -s "$API/catalog/products/search?q=7702345" \
  -H "Authorization: Bearer $TOKEN" | jq 'map({code, barcode})'
```

### 8.2 Filtro por path de categoría (sub-árbol completo)

Listar TODOS los productos dentro de `/congelados` (incluye subcategorías):

```bash
curl -s "$API/catalog/products?categoryPath=/congelados" \
  -H "Authorization: Bearer $TOKEN" | jq '{total, items: (.items | map(.code))}'
# → debe incluir los 3 productos terminados (arepas + flauta)
```

```bash
# Solo materias primas controladas (cadena fría)
curl -s "$API/catalog/products?type=RawMaterial&isControlled=true" \
  -H "Authorization: Bearer $TOKEN" | jq '.items | map({code, expiryDays, storageTempMinC})'
# → queso y mantequilla
```

---

## ✅ Test 9 — Validaciones RBAC

### 9.1 Lectura: roles permitidos amplios

Un usuario `Sales.Salesperson` debe poder leer:

```bash
TOKEN_SALES=$(make jwt ROLES=Sales.Salesperson 2>/dev/null | grep -A1 'Bearer' | tail -1)
curl -s -o /dev/null -w "HTTP %{http_code}\n" "$API/catalog/products" \
  -H "Authorization: Bearer $TOKEN_SALES"
# → HTTP 200
```

### 9.2 Escritura: solo Tenant.Admin, Manufacturing.Manager, Inventory.Manager

Un `Sales.Salesperson` NO puede crear productos:

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST "$API/catalog/products" \
  -H "Authorization: Bearer $TOKEN_SALES" -H "Content-Type: application/json" \
  -d '{...}'
# → HTTP 403 Forbidden
```

---

## ✅ Test 10 — Eventos del Outbox

Las operaciones del catalog publican eventos al outbox. Verifica que se están emitiendo:

```bash
# Cuántos eventos hay por tipo
curl -s "$API/platform/outbox/stats" \
  -H "Authorization: Bearer $TOKEN" | jq '.byEventType | with_entries(select(.key | startswith("catalog.")))'
```

Salida esperada (con `OUTBOX_DISPATCHER_ENABLED=true`):

```json
{
  "catalog.ProductCreated.v1":      { "published": 9, "pending": 0, "failed": 0 },
  "catalog.ProductActivated.v1":    { "published": 4, "pending": 0, "failed": 0 },
  "catalog.ProductDiscontinued.v1": { "published": 1, "pending": 0, "failed": 0 },
  "catalog.ProductUpdated.v1":      { "published": 1, "pending": 0, "failed": 0 },
  "catalog.BOMUpdated.v1":          { "published": 4, "pending": 0, "failed": 0 },
  "catalog.CategoryCreated.v1":     { "published": 8, "pending": 0, "failed": 0 }
}
```

> Si tu dispatcher no está corriendo, los contadores quedarán en `pending`. Confirma que tu app arrancó con `OUTBOX_DISPATCHER_ENABLED=true`.

---

## ✅ Test 11 — Integridad por tenant

Esta es la prueba **crítica** de aislamiento multi-tenant. Crea un segundo tenant y verifica que NO puede ver los productos del primero:

```bash
# Crear segundo tenant como Platform.Admin
export TENANT_2=$(curl -sf -X POST "$API/platform/tenants" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"code": "otra-empresa", "name": "Otra Empresa", "plan": "Basic"}' \
  | jq -r '.id')

# JWT impersonando al segundo tenant
TOKEN_T2=$(make jwt TENANT_ID=$TENANT_2 ROLES=Tenant.Admin 2>/dev/null | grep -A1 'Bearer' | tail -1)

# Listar productos desde el segundo tenant → debe estar VACÍO
curl -s "$API/catalog/products" -H "Authorization: Bearer $TOKEN_T2" | jq '{total, items: (.items | length)}'
# → { "total": 0, "items": 0 }

# Intentar acceder directamente al producto del tenant BCM → 404
curl -s -o /dev/null -w "HTTP %{http_code}\n" "$API/catalog/products/$AREPA_MINI" \
  -H "Authorization: Bearer $TOKEN_T2"
# → HTTP 404 (RLS lo oculta — no es 403, simplemente "no existe" para este tenant)
```

> ✅ Si todos los anteriores pasaron, el aislamiento multi-tenant funciona correctamente.

---

## 🔍 Auditoría

Todas las operaciones de escritura quedaron registradas en `audit.audit_logs` (Sprint 3):

```bash
curl -s "$API/audit/logs?entityType=Product&page=1&pageSize=20" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.items | map({occurredAt, action, entityId, userId})'
```

Y la hash chain del tenant debe seguir siendo válida:

```bash
curl -s "$API/audit/verify-chain" -H "Authorization: Bearer $TOKEN" | jq
# → { "tenantId": "...", "entriesChecked": N, "isValid": true }
```

---

## ❓ Troubleshooting

### "must be member of role app_user"

Falta aplicar el bootstrap SQL para que el rol pueda usar el schema catalog:

```bash
psql "$DATABASE_URL_MIGRATION" -f prisma/init/02_catalog_rls.sql
```

### `product.code_already_exists` cuando intento crear en segundo tenant

Las constraint únicas tienen `tenantId` incluido (`uniq_product_code_per_tenant`), así que ese error NO debería aparecer cross-tenant. Si lo ves, es probable que el `tenantId` no se esté tomando del JWT — verifica con `/diagnostics/tenant-context`.

### Los componentes del BOM no se persisten

Causa típica: el `tenantId` del `componentProductId` no coincide con el del producto padre (las queries no encuentran un componente que vive en otro tenant). Verifica que ambos son del mismo tenant.

### `relation "catalog.products" does not exist`

Migra de nuevo y aplica RLS:

```bash
make db-migrate
psql "$DATABASE_URL_MIGRATION" -f prisma/init/02_catalog_rls.sql
```
