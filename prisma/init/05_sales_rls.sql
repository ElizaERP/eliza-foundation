-- =====================================================================
-- Row Level Security para schema `sales`
-- =====================================================================

GRANT USAGE ON SCHEMA sales TO app_user;

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

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA sales TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA sales TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA sales
  GRANT ALL ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA sales
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;