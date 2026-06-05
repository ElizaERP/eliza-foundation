-- =====================================================================
-- ELIZA Catalog (Sprint 5) — RLS policies
-- =====================================================================
-- Se aplica DESPUÉS de `prisma migrate deploy` para activar Row Level
-- Security sobre las tablas multi-tenant del schema catalog.
--
-- Las tablas unit_of_measure son CROSS-TENANT (no llevan tenantId), así
-- que NO les aplica RLS — solo lectura para app_user, escritura solo
-- para migration_user (provisionado vía seed).
--
-- Ejecutar con: psql $DATABASE_URL -f prisma/init/02_catalog_rls.sql

-- ---------- Categories ----------
ALTER TABLE catalog.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.categories FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON catalog.categories
  FOR SELECT USING (tenant_id = platform.current_tenant_id());

CREATE POLICY tenant_isolation_modify ON catalog.categories
  FOR ALL USING (tenant_id = platform.current_tenant_id())
            WITH CHECK (tenant_id = platform.current_tenant_id());

-- ---------- Products ----------
ALTER TABLE catalog.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.products FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON catalog.products
  FOR SELECT USING (tenant_id = platform.current_tenant_id());

CREATE POLICY tenant_isolation_modify ON catalog.products
  FOR ALL USING (tenant_id = platform.current_tenant_id())
            WITH CHECK (tenant_id = platform.current_tenant_id());

-- ---------- BOM Components ----------
ALTER TABLE catalog.bom_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.bom_components FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON catalog.bom_components
  FOR SELECT USING (tenant_id = platform.current_tenant_id());

CREATE POLICY tenant_isolation_modify ON catalog.bom_components
  FOR ALL USING (tenant_id = platform.current_tenant_id())
            WITH CHECK (tenant_id = platform.current_tenant_id());

-- ---------- Grants ----------
GRANT USAGE ON SCHEMA catalog TO app_user, migration_user;

GRANT SELECT, INSERT, UPDATE, DELETE ON catalog.categories,
                                       catalog.products,
                                       catalog.bom_components
  TO app_user;

-- unit_of_measure es cross-tenant: app_user solo lee
GRANT SELECT ON catalog.unit_of_measure TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON catalog.unit_of_measure TO migration_user;
