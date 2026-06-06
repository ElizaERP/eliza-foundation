# Sprint 6 — Inventory Bounded Context

Contenido del tarball y pasos de integración para Windows / PowerShell.

## Contenido

```
eliza-foundation/
├── src/contexts/inventory/        ← código del BC (27 archivos TS)
│   ├── domain/                    Aggregates, VOs, events, ports
│   ├── application/               Use cases + view DTOs + handlers
│   ├── infrastructure/            Prisma repos + FEFO service
│   ├── interface/http/            4 controllers + DTOs
│   └── inventory.module.ts
├── prisma/
│   ├── SCHEMA_PATCH.prisma        ← parche para schema.prisma
│   ├── init/
│   │   ├── BOOTSTRAP_PATCH.sql    ← parche para 01_bootstrap.sql
│   │   └── 03_inventory_rls.sql   ← RLS nuevo
│   └── seed-inventory.ts          ← seed inicial
├── APP_MODULE_PATCH.md            ← parche para app.module.ts
└── TESTING-INVENTORY.md           ← guía E2E con 12 tests
```

## Pasos de integración (PowerShell, mismo patrón que Sprint 5)

```powershell
cd C:\Users\dados\OneDrive\Documentos\Development\ELIZA\eliza-foundation

# 1. Extraer respetando estructura (igual que en el Sprint 5)
tar -xzf $HOME\Downloads\eliza-foundation-sprint6.tar.gz --strip-components=1

# 2. Aplicar SCHEMA_PATCH.prisma a schema.prisma MANUALMENTE
#    Sigue las instrucciones en prisma/SCHEMA_PATCH.prisma:
#    - Agrega "inventory" al array `schemas` del datasource
#    - Pega todos los models y enums al final del archivo

code prisma/schema.prisma           # edita el schema
code prisma/SCHEMA_PATCH.prisma     # ten las instrucciones a la vista

# 3. Aplicar BOOTSTRAP_PATCH.sql a 01_bootstrap.sql MANUALMENTE
code prisma/init/01_bootstrap.sql
code prisma/init/BOOTSTRAP_PATCH.sql

# 4. Registrar InventoryContextModule en app.module.ts
code src/app.module.ts
code APP_MODULE_PATCH.md

# 5. Crear el schema 'inventory' en Postgres
docker exec -i eliza-postgres psql -U postgres -d eliza -c "CREATE SCHEMA IF NOT EXISTS inventory;"
docker exec -i eliza-postgres psql -U postgres -d eliza -c "GRANT USAGE ON SCHEMA inventory TO app_user;"
docker exec -i eliza-postgres psql -U postgres -d eliza -c "ALTER DEFAULT PRIVILEGES IN SCHEMA inventory GRANT ALL ON TABLES TO app_user;"
docker exec -i eliza-postgres psql -U postgres -d eliza -c "ALTER DEFAULT PRIVILEGES IN SCHEMA inventory GRANT USAGE, SELECT ON SEQUENCES TO app_user;"

# 6. Generar y aplicar la migración Prisma
# IMPORTANTE: temporalmente usa 'postgres' user en DATABASE_URL para que pueda crear shadow DB
# (igual que hicimos en Sprint 5)
pnpm exec prisma migrate dev --name add_inventory_schema

# Vuelve a poner 'app_user' en el DATABASE_URL después

# 7. Generar el cliente Prisma
pnpm exec prisma generate

# 8. Aplicar RLS al schema inventory
docker cp prisma/init/03_inventory_rls.sql eliza-postgres:/tmp/03_inventory_rls.sql
docker exec -i eliza-postgres psql -U postgres -d eliza -f /tmp/03_inventory_rls.sql

# 9. Correr el seed
pnpm exec ts-node prisma/seed-inventory.ts

# 10. Compilar para detectar errores TS
npx tsc --noEmit

# 11. Levantar la app
npx nest start --watch
```

## Verificación rápida

Una vez levantada la app:

1. Abre Swagger: `http://localhost:3000/docs`
2. Genera un JWT: `npx ts-node scripts/gen-test-jwt.ts` → copia → Authorize
3. Prueba: `GET /api/v1/inventory/warehouses` → debe devolver Planta Bucaramanga
4. Sigue la guía completa en `TESTING-INVENTORY.md`, especialmente el **Test 3** que valida FEFO multi-lote.

## Endpoints expuestos (16 en total)

**Lots (6):**
- `POST /inventory/lots` — registrar
- `GET /inventory/lots/expiring` — próximos a vencer
- `GET /inventory/lots/by-product/:productId` — listar por producto
- `GET /inventory/lots/:id`
- `POST /inventory/lots/:id/block` — bloquear (Quality)
- `POST /inventory/lots/:id/release` — liberar

**Stock (7):**
- `POST /inventory/stock/receive` — entrada
- `POST /inventory/stock/reserve` — reserva FEFO
- `DELETE /inventory/stock/reservations` — liberar
- `POST /inventory/stock/adjust/:existenciaId` — ajuste
- `POST /inventory/stock/transfer` — traslado
- `POST /inventory/stock/dispatch` — despacho
- `GET /inventory/stock/by-sku/:productId` — stock por SKU

**Movements (1):**
- `GET /inventory/movements` — kardex paginado

**Warehouses (4):**
- `POST /inventory/warehouses`
- `GET /inventory/warehouses`
- `POST /inventory/warehouses/:id/locations`
- `GET /inventory/warehouses/:id/locations`

## Eventos emitidos al outbox

`inventory.LotRegistered.v1`, `LotBlocked.v1`, `LotReleased.v1`, `LotExpired.v1`,
`LotNearExpiry.v1`, `InventoryReceived.v1`, `InventoryReserved.v1`,
`ReservationReleased.v1`, `InventoryAdjusted.v1`, `StockTransferred.v1`,
`InventoryDispatched.v1`, `StockBelowMinimum.v1`, `WarehouseCreated.v1`,
`LocationCreated.v1`.

## Eventos externos escuchados (stubs)

El BC se suscribe a estos eventos de otros BCs (handlers son no-op por ahora,
se activan en sprints futuros):

- `sales.OrderConfirmed.v1` → futuro: ReserveStock automático
- `manufacturing.ProductionCompleted.v1` → futuro: crear Lote + Existencia (PT)
- `procurement.GoodsReceived.v1` → futuro: crear Lote + Existencia (MP)
- `quality.LotReleased.v1` → futuro: invocar ReleaseLot
- `quality.LotBlocked.v1` → futuro: invocar BlockLot
- `catalog.ProductDiscontinued.v1` → futuro: bloquear reservas nuevas

## Si algo falla

Como en Sprint 5, los errores más probables son:
1. **Imports relativos vs absolutos** — todos los imports internos del Inventory BC usan `@eliza/contexts/inventory/...`. Si TypeScript no los resuelve, revisa el `paths` en `tsconfig.json`.
2. **Migración con permiso denegado** — usa temporalmente `postgres` user en DATABASE_URL para crear shadow DB.
3. **Tipos de Prisma desconocidos** — corre `pnpm exec prisma generate` después de aplicar el schema patch.
4. **RLS bloqueando queries** — confirma que `app.tenant_id` se está seteando vía `PrismaService.withTenant()`.

Si todo compila pero los endpoints devuelven 500, revisa los logs de la app y verifica el outbox con:
```powershell
docker exec -i eliza-postgres psql -U postgres -d eliza -c "SELECT event_type, status FROM platform.outbox_events ORDER BY occurred_at DESC LIMIT 10;"
```
