-- =====================================================================
-- Row Level Security para schema `inventory`
-- =====================================================================
-- Aísla por tenant_id usando la GUC `app.tenant_id` que setea
-- PrismaService.withTenant() en cada query.
-- =====================================================================

-- Asegurar permisos del schema
GRANT USAGE ON SCHEMA inventory TO app_user;

-- Habilitar RLS en cada tabla
ALTER TABLE inventory.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.warehouses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inventory.warehouses;
CREATE POLICY tenant_isolation ON inventory.warehouses
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE inventory.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inventory.locations;
CREATE POLICY tenant_isolation ON inventory.locations
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE inventory.lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.lotes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inventory.lotes;
CREATE POLICY tenant_isolation ON inventory.lotes
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE inventory.existencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.existencias FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inventory.existencias;
CREATE POLICY tenant_isolation ON inventory.existencias
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE inventory.reservas ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.reservas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inventory.reservas;
CREATE POLICY tenant_isolation ON inventory.reservas
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE inventory.movimientos_inventario ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.movimientos_inventario FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inventory.movimientos_inventario;
CREATE POLICY tenant_isolation ON inventory.movimientos_inventario
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Permisos para el rol de aplicación
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA inventory TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA inventory TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA inventory
  GRANT ALL ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA inventory
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
