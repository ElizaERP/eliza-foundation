-- =====================================================================
-- Row Level Security para schema `manufacturing`
-- =====================================================================

GRANT USAGE ON SCHEMA manufacturing TO app_user;

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

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA manufacturing TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA manufacturing TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA manufacturing
  GRANT ALL ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA manufacturing
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;