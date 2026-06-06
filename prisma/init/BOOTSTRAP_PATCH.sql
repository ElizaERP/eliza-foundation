-- =====================================================================
-- BOOTSTRAP_PATCH.sql
-- =====================================================================
-- Cambios a aplicar en prisma/init/01_bootstrap.sql del proyecto existente.
--
-- INSTRUCCIONES:
--   1. Abre `prisma/init/01_bootstrap.sql` en tu repo.
--   2. Busca el bloque que crea schemas (debería tener tenant, iam, audit,
--      platform, catalog). Agrega `CREATE SCHEMA IF NOT EXISTS inventory;`
--   3. Busca el bloque de GRANT que da permisos a app_user en los schemas
--      existentes. Agrega las líneas correspondientes para inventory.
--   4. NO ejecutes este archivo directamente — solo úsalo como referencia.
--
-- A continuación, las líneas exactas que deben añadirse:
-- =====================================================================

-- Crear schema inventory (junto a tenant/iam/audit/platform/catalog):
CREATE SCHEMA IF NOT EXISTS inventory;

-- Otorgar uso del schema al rol de aplicación:
GRANT USAGE ON SCHEMA inventory TO app_user;

-- Privilegios por defecto: cualquier tabla nueva que se cree en inventory
-- automáticamente queda accesible para app_user (las migraciones de
-- Prisma corren como postgres):
ALTER DEFAULT PRIVILEGES IN SCHEMA inventory
  GRANT ALL ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA inventory
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- =====================================================================
-- FIN. Después de aplicar estos cambios al 01_bootstrap.sql, recrea el
-- contenedor de Postgres para que se reejecute el init:
--   docker compose down -v postgres
--   docker compose up -d postgres
-- (cuidado: -v borra el volumen y por ende los datos).
--
-- Alternativa sin perder datos: ejecutar manualmente estas líneas dentro
-- del contenedor:
--   docker exec -i eliza-postgres psql -U postgres -d eliza -c "CREATE SCHEMA IF NOT EXISTS inventory;"
--   docker exec -i eliza-postgres psql -U postgres -d eliza -c "GRANT USAGE ON SCHEMA inventory TO app_user;"
--   docker exec -i eliza-postgres psql -U postgres -d eliza -c "ALTER DEFAULT PRIVILEGES IN SCHEMA inventory GRANT ALL ON TABLES TO app_user;"
--   docker exec -i eliza-postgres psql -U postgres -d eliza -c "ALTER DEFAULT PRIVILEGES IN SCHEMA inventory GRANT USAGE, SELECT ON SEQUENCES TO app_user;"
