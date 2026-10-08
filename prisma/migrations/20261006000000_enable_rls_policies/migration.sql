-- =====================================================================
-- ELIZA — Row Level Security como migración versionada (Fase 0)
-- =====================================================================
-- Reemplaza a prisma/init/02_catalog_rls.sql … 05_sales_rls.sql.
--
-- Por qué: esos scripts vivían en docker-entrypoint-initdb.d, que se
-- ejecuta ANTES de `prisma migrate deploy`. Con un volumen vacío las
-- tablas aún no existían y el init de Postgres fallaba; y en cualquier
-- despliegue que solo corre migraciones, la RLS nunca se aplicaba.
--
-- Esta migración es IDEMPOTENTE: puede correr sobre una base donde los
-- scripts manuales ya se aplicaron (DROP POLICY IF EXISTS + CREATE).
-- También funciona en una base sin roles de aplicación (CI): los GRANT
-- solo se ejecutan si app_user / migration_user existen.
--
-- Comportamiento de las políticas: se conserva exactamente el de los
-- scripts originales. Unificar estilos (catalog usa
-- platform.current_tenant_id(); el resto current_setting(..., true))
-- queda como decisión de la Fase 3 — Seguridad.
-- =====================================================================

-- ---------- Helper de tenant (antes solo existía en 01_bootstrap) ----------
CREATE SCHEMA IF NOT EXISTS platform;

CREATE OR REPLACE FUNCTION platform.current_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  tenant_uuid UUID;
BEGIN
  BEGIN
    tenant_uuid := current_setting('app.tenant_id', false)::UUID;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'app.tenant_id is not set; refusing to execute query without tenant context'
      USING ERRCODE = '42501';
  END;
  RETURN tenant_uuid;
END;
$$;

-- =====================================================================
-- CATALOG
-- =====================================================================
ALTER TABLE catalog.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON catalog.categories;
CREATE POLICY tenant_isolation_select ON catalog.categories
  FOR SELECT USING (tenant_id = platform.current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_modify ON catalog.categories;
CREATE POLICY tenant_isolation_modify ON catalog.categories
  FOR ALL USING (tenant_id = platform.current_tenant_id())
          WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE catalog.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.products FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON catalog.products;
CREATE POLICY tenant_isolation_select ON catalog.products
  FOR SELECT USING (tenant_id = platform.current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_modify ON catalog.products;
CREATE POLICY tenant_isolation_modify ON catalog.products
  FOR ALL USING (tenant_id = platform.current_tenant_id())
          WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE catalog.bom_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.bom_components FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON catalog.bom_components;
CREATE POLICY tenant_isolation_select ON catalog.bom_components
  FOR SELECT USING (tenant_id = platform.current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_modify ON catalog.bom_components;
CREATE POLICY tenant_isolation_modify ON catalog.bom_components
  FOR ALL USING (tenant_id = platform.current_tenant_id())
          WITH CHECK (tenant_id = platform.current_tenant_id());

-- =====================================================================
-- INVENTORY
-- =====================================================================
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

-- =====================================================================
-- MANUFACTURING
-- =====================================================================
ALTER TABLE manufacturing.ordenes_produccion ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturing.ordenes_produccion FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON manufacturing.ordenes_produccion;
CREATE POLICY tenant_isolation ON manufacturing.ordenes_produccion
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE manufacturing.consumos_mp ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturing.consumos_mp FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON manufacturing.consumos_mp;
CREATE POLICY tenant_isolation ON manufacturing.consumos_mp
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE manufacturing.lotes_producidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturing.lotes_producidos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON manufacturing.lotes_producidos;
CREATE POLICY tenant_isolation ON manufacturing.lotes_producidos
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- =====================================================================
-- SALES
-- =====================================================================
ALTER TABLE sales.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales.clientes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sales.clientes;
CREATE POLICY tenant_isolation ON sales.clientes
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE sales.ordenes_venta ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales.ordenes_venta FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sales.ordenes_venta;
CREATE POLICY tenant_isolation ON sales.ordenes_venta
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE sales.lineas_pedido ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales.lineas_pedido FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sales.lineas_pedido;
CREATE POLICY tenant_isolation ON sales.lineas_pedido
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- =====================================================================
-- GRANTS — solo si los roles existen (no existen en CI)
-- =====================================================================
-- Se otorga DML (SELECT/INSERT/UPDATE/DELETE), NO "ALL PRIVILEGES":
-- ALL incluye TRUNCATE, que se salta la RLS por completo.
-- audit es append-only: app_user solo SELECT + INSERT.
-- catalog.unit_of_measure es cross-tenant: app_user solo SELECT.
DO $$
DECLARE
  s TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    FOREACH s IN ARRAY ARRAY['tenant','iam','platform','catalog','inventory','manufacturing','sales'] LOOP
      EXECUTE format('GRANT USAGE ON SCHEMA %I TO app_user', s);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM app_user', s);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO app_user', s);
      EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO app_user', s);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user', s);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO app_user', s);
    END LOOP;

    GRANT USAGE ON SCHEMA audit TO app_user;
    REVOKE ALL ON ALL TABLES IN SCHEMA audit FROM app_user;
    GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA audit TO app_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA audit TO app_user;

    REVOKE INSERT, UPDATE, DELETE ON catalog.unit_of_measure FROM app_user;

    GRANT EXECUTE ON FUNCTION platform.current_tenant_id() TO app_user;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_user') THEN
    GRANT USAGE ON SCHEMA catalog TO migration_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON catalog.unit_of_measure TO migration_user;
    GRANT EXECUTE ON FUNCTION platform.current_tenant_id() TO migration_user;
  END IF;
END
$$;
