-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "inventory";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "manufacturing";

-- CreateEnum
CREATE TYPE "manufacturing"."EstadoOrdenProduccion" AS ENUM ('Planificada', 'EnProceso', 'Completada', 'Cerrada', 'Cancelada');

-- CreateEnum
CREATE TYPE "manufacturing"."PrioridadProduccion" AS ENUM ('Alta', 'Media', 'Baja');

-- CreateTable
CREATE TABLE "manufacturing"."ordenes_produccion" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "codigo" VARCHAR(50) NOT NULL,
    "producto_terminado_id" UUID NOT NULL,
    "producto_terminado_code" VARCHAR(50) NOT NULL,
    "producto_terminado_name" VARCHAR(200) NOT NULL,
    "cantidad_objetivo" DECIMAL(18,6) NOT NULL,
    "estado" "manufacturing"."EstadoOrdenProduccion" NOT NULL DEFAULT 'Planificada',
    "prioridad" "manufacturing"."PrioridadProduccion" NOT NULL DEFAULT 'Media',
    "componentes" JSONB NOT NULL DEFAULT '[]',
    "materiales_reservados" BOOLEAN NOT NULL DEFAULT false,
    "notas" TEXT,
    "cancelado_motivo" TEXT,
    "cancelado_por" UUID,
    "cancelado_en" TIMESTAMPTZ,
    "fecha_programada" TIMESTAMPTZ,
    "iniciado_en" TIMESTAMPTZ,
    "completado_en" TIMESTAMPTZ,
    "cerrado_en" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ordenes_produccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing"."consumos_mp" (
    "id" UUID NOT NULL,
    "orden_produccion_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_code" VARCHAR(50) NOT NULL,
    "lote_id" UUID NOT NULL,
    "codigo_lote" VARCHAR(50) NOT NULL,
    "cantidad" DECIMAL(18,6) NOT NULL,
    "unidad_medida" VARCHAR(10) NOT NULL,
    "movimiento_id" UUID NOT NULL,
    "consumido_en" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "consumos_mp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing"."lotes_producidos" (
    "id" UUID NOT NULL,
    "orden_produccion_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lote_id" UUID NOT NULL,
    "codigo_lote" VARCHAR(50) NOT NULL,
    "product_id" UUID NOT NULL,
    "cantidad" DECIMAL(18,6) NOT NULL,
    "location_id" UUID NOT NULL,
    "movimiento_id" UUID NOT NULL,
    "producido_en" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "lotes_producidos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ordenes_produccion_tenant_id_idx" ON "manufacturing"."ordenes_produccion"("tenant_id");

-- CreateIndex
CREATE INDEX "ordenes_produccion_tenant_id_estado_idx" ON "manufacturing"."ordenes_produccion"("tenant_id", "estado");

-- CreateIndex
CREATE INDEX "ordenes_produccion_producto_terminado_id_idx" ON "manufacturing"."ordenes_produccion"("producto_terminado_id");

-- CreateIndex
CREATE INDEX "ordenes_produccion_fecha_programada_idx" ON "manufacturing"."ordenes_produccion"("fecha_programada");

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_produccion_tenant_id_codigo_key" ON "manufacturing"."ordenes_produccion"("tenant_id", "codigo");

-- CreateIndex
CREATE INDEX "consumos_mp_tenant_id_idx" ON "manufacturing"."consumos_mp"("tenant_id");

-- CreateIndex
CREATE INDEX "consumos_mp_orden_produccion_id_idx" ON "manufacturing"."consumos_mp"("orden_produccion_id");

-- CreateIndex
CREATE INDEX "consumos_mp_product_id_idx" ON "manufacturing"."consumos_mp"("product_id");

-- CreateIndex
CREATE INDEX "consumos_mp_lote_id_idx" ON "manufacturing"."consumos_mp"("lote_id");

-- CreateIndex
CREATE INDEX "lotes_producidos_tenant_id_idx" ON "manufacturing"."lotes_producidos"("tenant_id");

-- CreateIndex
CREATE INDEX "lotes_producidos_orden_produccion_id_idx" ON "manufacturing"."lotes_producidos"("orden_produccion_id");

-- CreateIndex
CREATE INDEX "lotes_producidos_lote_id_idx" ON "manufacturing"."lotes_producidos"("lote_id");

-- AddForeignKey
ALTER TABLE "manufacturing"."consumos_mp" ADD CONSTRAINT "consumos_mp_orden_produccion_id_fkey" FOREIGN KEY ("orden_produccion_id") REFERENCES "manufacturing"."ordenes_produccion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing"."lotes_producidos" ADD CONSTRAINT "lotes_producidos_orden_produccion_id_fkey" FOREIGN KEY ("orden_produccion_id") REFERENCES "manufacturing"."ordenes_produccion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
