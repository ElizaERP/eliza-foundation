-- =====================================================================
-- ELIZA Foundation Platform — PostgreSQL Bootstrap
-- =====================================================================
-- Este script se ejecuta UNA SOLA VEZ cuando docker-compose levanta el
-- contenedor de Postgres por primera vez (docker-entrypoint-initdb.d).
--
-- Establece:
--   1. Schemas por bounded context (tenant, iam, audit, platform)
--   2. Roles de aplicación y migración (separación de privilegios)
--   3. Base de datos para Keycloak (aislada)
--   4. Extensiones requeridas (uuid-ossp, pgcrypto)
--
-- Las políticas de RLS se aplican por tabla en las migraciones de Prisma,
-- después de que las tablas se crean. Ver prisma/migrations/.
-- =====================================================================

-- ---------- Base de datos para Keycloak ----------
CREATE DATABASE keycloak;

-- ---------- Extensiones en eliza ----------
\connect eliza

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Schemas por bounded context ----------
CREATE SCHEMA IF NOT EXISTS tenant;
CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS platform;

-- ---------- Roles ----------
-- migration_user: ejecuta migraciones de Prisma. Es OWNER de los schemas
-- y tiene DDL. Solo se usa en pipelines de migración.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_user') THEN
    CREATE ROLE migration_user WITH LOGIN PASSWORD 'migration_password';
  END IF;
END
$$;

-- app_user: ejecuta queries de la aplicación. No es owner, no es superuser.
-- RLS se aplica SOBRE este rol (que no puede saltarse las policies).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user WITH LOGIN PASSWORD 'app_password';
  END IF;
END
$$;

-- ---------- Permisos ----------
-- Conexión a la base
GRANT CONNECT ON DATABASE eliza TO app_user, migration_user;

-- Schemas: ownership a migration_user, USAGE a app_user
ALTER SCHEMA tenant   OWNER TO migration_user;
ALTER SCHEMA iam      OWNER TO migration_user;
ALTER SCHEMA audit    OWNER TO migration_user;
ALTER SCHEMA platform OWNER TO migration_user;

GRANT USAGE ON SCHEMA tenant, iam, audit, platform TO app_user;

-- Default privileges: cuando migration_user cree tablas/secuencias,
-- app_user obtendrá automáticamente DML (NO DDL).
ALTER DEFAULT PRIVILEGES FOR ROLE migration_user IN SCHEMA tenant, iam, platform
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

-- En audit, app_user solo puede INSERT y SELECT (append-only).
-- UPDATE/DELETE se bloquean a nivel de role + triggers (Sprint 3).
ALTER DEFAULT PRIVILEGES FOR ROLE migration_user IN SCHEMA audit
  GRANT SELECT, INSERT ON TABLES TO app_user;

ALTER DEFAULT PRIVILEGES FOR ROLE migration_user IN SCHEMA tenant, iam, audit, platform
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- ---------- Settings de aplicación ----------
-- Los GUC personalizados (app.tenant_id, app.user_id, app.correlation_id)
-- se establecen por conexión usando SET LOCAL dentro de cada transacción.
-- No se declaran globalmente; las funciones helper validan su presencia.

-- Helper function: obtiene el tenant_id actual de la sesión o lanza error.
-- Las policies de RLS usan esta función en lugar de current_setting() directo
-- para garantizar fallo explícito cuando el contexto no está establecido.
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
      USING ERRCODE = '42501'; -- insufficient_privilege
  END;
  RETURN tenant_uuid;
END;
$$;

GRANT EXECUTE ON FUNCTION platform.current_tenant_id() TO app_user, migration_user;

-- ---------- Conexión Keycloak ----------
\connect keycloak
GRANT ALL PRIVILEGES ON DATABASE keycloak TO postgres;
