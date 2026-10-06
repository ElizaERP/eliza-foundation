-- =====================================================================
-- ELIZA — Verificación de aislamiento multi-tenant (RLS)
-- =====================================================================
-- Uso:  make db-rls-check
--   o:  psql -U postgres -d eliza -f scripts/rls-check.sql
--
-- Corre como superusuario, crea 2 warehouses de prueba (tenants A y B),
-- se convierte en app_user y comprueba que la RLS aísla. Al final borra
-- los datos de prueba. Revisa que cada bloque muestre lo "esperado".
-- =====================================================================
\set ON_ERROR_STOP 0
\set QUIET 1

INSERT INTO inventory.warehouses (id, tenant_id, code, name, updated_at) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'RLSCHK-A', 'RLS check A', now()),
  ('bbbbbbbb-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'RLSCHK-B', 'RLS check B', now());

SET ROLE app_user;

\echo '1) app_user sin tenant — esperado: 0'
SELECT count(*) FROM inventory.warehouses WHERE code LIKE 'RLSCHK-%';

\echo '2) app_user como tenant A — esperado: solo RLSCHK-A'
BEGIN;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SELECT code FROM inventory.warehouses WHERE code LIKE 'RLSCHK-%';
\echo '3) tenant A inserta una fila de tenant B — esperado: ERROR row-level security'
INSERT INTO inventory.warehouses (id, tenant_id, code, name, updated_at)
  VALUES (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 'RLSCHK-HACK', 'x', now());
ROLLBACK;

\echo '4) catalog sin tenant — esperado: ERROR app.tenant_id is not set'
SELECT count(*) FROM catalog.products;

\echo '5) TRUNCATE — esperado: ERROR permission denied'
TRUNCATE inventory.warehouses;

\echo '6) UPDATE en audit (append-only) — esperado: ERROR permission denied'
UPDATE audit.audit_logs SET id = id;

\echo '7) INSERT en catalog.unit_of_measure — esperado: ERROR permission denied'
INSERT INTO catalog.unit_of_measure DEFAULT VALUES;

RESET ROLE;

DELETE FROM inventory.warehouses WHERE code LIKE 'RLSCHK-%';
\echo 'Listo — datos de prueba eliminados.'
