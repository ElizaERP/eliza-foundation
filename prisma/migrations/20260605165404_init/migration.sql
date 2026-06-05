-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "audit";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "catalog";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "iam";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "platform";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "tenant";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateEnum
CREATE TYPE "tenant"."TenantStatus" AS ENUM ('PendingActivation', 'Active', 'Suspended', 'Deleted');

-- CreateEnum
CREATE TYPE "tenant"."TenantPlan" AS ENUM ('Basic', 'Professional', 'Enterprise');

-- CreateEnum
CREATE TYPE "iam"."UserStatus" AS ENUM ('Pending', 'Active', 'Suspended', 'Deleted');

-- CreateEnum
CREATE TYPE "platform"."OutboxStatus" AS ENUM ('Pending', 'Processing', 'Published', 'Failed', 'DeadLetter');

-- CreateEnum
CREATE TYPE "catalog"."ProductType" AS ENUM ('RawMaterial', 'SemiFinished', 'FinishedGood', 'Service');

-- CreateEnum
CREATE TYPE "catalog"."ProductStatus" AS ENUM ('Draft', 'Active', 'Discontinued');

-- CreateEnum
CREATE TYPE "catalog"."UomDimension" AS ENUM ('Mass', 'Volume', 'Length', 'Count', 'Time', 'Temperature');

-- CreateTable
CREATE TABLE "tenant"."tenants" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "tenant"."TenantStatus" NOT NULL DEFAULT 'PendingActivation',
    "plan" "tenant"."TenantPlan" NOT NULL DEFAULT 'Basic',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam"."users" (
    "id" UUID NOT NULL,
    "keycloak_subject" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "status" "iam"."UserStatus" NOT NULL DEFAULT 'Pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam"."user_tenant_memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "roles_json" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "user_tenant_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "chain_index" BIGINT NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "ip_address" INET,
    "user_agent" VARCHAR(500),
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" UUID,
    "old_values" JSONB,
    "new_values" JSONB,
    "correlation_id" UUID,
    "causation_id" UUID,
    "previous_hash" CHAR(64),
    "hash" CHAR(64) NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."outbox_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "aggregate_type" VARCHAR(100) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" VARCHAR(150) NOT NULL,
    "event_version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "metadata" JSONB NOT NULL,
    "status" "platform"."OutboxStatus" NOT NULL DEFAULT 'Pending',
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "next_retry_at" TIMESTAMPTZ,
    "processing_started_at" TIMESTAMPTZ,
    "processing_node" VARCHAR(100),
    "published_at" TIMESTAMPTZ,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."tenant_summary" (
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" VARCHAR(50) NOT NULL,
    "plan" VARCHAR(50) NOT NULL,
    "user_count" INTEGER NOT NULL DEFAULT 0,
    "active_user_count" INTEGER NOT NULL DEFAULT 0,
    "last_event_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_event_type" VARCHAR(150) NOT NULL DEFAULT '',
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tenant_summary_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "platform"."projection_checkpoints" (
    "projection_name" VARCHAR(100) NOT NULL,
    "last_processed_event_id" UUID,
    "last_processed_at" TIMESTAMPTZ,
    "events_processed" BIGINT NOT NULL DEFAULT 0,
    "last_error_at" TIMESTAMPTZ,
    "last_error" TEXT,

    CONSTRAINT "projection_checkpoints_pkey" PRIMARY KEY ("projection_name")
);

-- CreateTable
CREATE TABLE "catalog"."unit_of_measure" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "symbol" VARCHAR(10) NOT NULL,
    "dimension" "catalog"."UomDimension" NOT NULL,
    "to_base_factor" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "unit_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "parent_id" UUID,
    "path" VARCHAR(500) NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "sku" VARCHAR(50) NOT NULL,
    "barcode" VARCHAR(50),
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "type" "catalog"."ProductType" NOT NULL,
    "status" "catalog"."ProductStatus" NOT NULL DEFAULT 'Draft',
    "category_id" UUID NOT NULL,
    "unit_of_sale_id" UUID NOT NULL,
    "pack_size" INTEGER,
    "net_weight_grams" DECIMAL(12,3),
    "gross_weight_grams" DECIMAL(12,3),
    "expiry_days" INTEGER,
    "storage_temp_min_c" DECIMAL(5,2),
    "storage_temp_max_c" DECIMAL(5,2),
    "image_url" VARCHAR(500),
    "tax_rate" DECIMAL(5,2),
    "is_controlled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."bom_components" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "component_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "uom_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bom_components_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_code_key" ON "tenant"."tenants"("code");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenant"."tenants"("status");

-- CreateIndex
CREATE INDEX "tenants_code_idx" ON "tenant"."tenants"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_keycloak_subject_key" ON "iam"."users"("keycloak_subject");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "iam"."users"("email");

-- CreateIndex
CREATE INDEX "user_tenant_memberships_tenant_id_idx" ON "iam"."user_tenant_memberships"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_tenant_memberships_user_id_tenant_id_key" ON "iam"."user_tenant_memberships"("user_id", "tenant_id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_occurred_at_idx" ON "audit"."audit_logs"("tenant_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_entity_type_entity_id_idx" ON "audit"."audit_logs"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_user_id_occurred_at_idx" ON "audit"."audit_logs"("tenant_id", "user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_correlation_id_idx" ON "audit"."audit_logs"("tenant_id", "correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_audit_chain" ON "audit"."audit_logs"("tenant_id", "chain_index");

-- CreateIndex
CREATE INDEX "outbox_events_status_next_retry_at_idx" ON "platform"."outbox_events"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "outbox_events_status_occurred_at_idx" ON "platform"."outbox_events"("status", "occurred_at");

-- CreateIndex
CREATE INDEX "outbox_events_tenant_id_aggregate_type_aggregate_id_idx" ON "platform"."outbox_events"("tenant_id", "aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "tenant_summary_status_idx" ON "platform"."tenant_summary"("status");

-- CreateIndex
CREATE UNIQUE INDEX "unit_of_measure_code_key" ON "catalog"."unit_of_measure"("code");

-- CreateIndex
CREATE INDEX "unit_of_measure_dimension_is_active_idx" ON "catalog"."unit_of_measure"("dimension", "is_active");

-- CreateIndex
CREATE INDEX "categories_tenant_id_parent_id_idx" ON "catalog"."categories"("tenant_id", "parent_id");

-- CreateIndex
CREATE INDEX "categories_tenant_id_path_idx" ON "catalog"."categories"("tenant_id", "path");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_category_code_per_tenant" ON "catalog"."categories"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "products_tenant_id_status_type_idx" ON "catalog"."products"("tenant_id", "status", "type");

-- CreateIndex
CREATE INDEX "products_tenant_id_category_id_idx" ON "catalog"."products"("tenant_id", "category_id");

-- CreateIndex
CREATE INDEX "products_tenant_id_barcode_idx" ON "catalog"."products"("tenant_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_product_code_per_tenant" ON "catalog"."products"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_product_sku_per_tenant" ON "catalog"."products"("tenant_id", "sku");

-- CreateIndex
CREATE INDEX "bom_components_tenant_id_component_id_idx" ON "catalog"."bom_components"("tenant_id", "component_id");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_bom_component" ON "catalog"."bom_components"("tenant_id", "product_id", "component_id");

-- AddForeignKey
ALTER TABLE "iam"."user_tenant_memberships" ADD CONSTRAINT "user_tenant_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "catalog"."categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "catalog"."categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."bom_components" ADD CONSTRAINT "bom_components_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."bom_components" ADD CONSTRAINT "bom_components_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "catalog"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
