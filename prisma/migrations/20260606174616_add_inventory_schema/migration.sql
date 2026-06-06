-- CreateEnum
CREATE TYPE "inventory"."EstadoLote" AS ENUM ('Disponible', 'Bloqueado', 'Cuarentena', 'Vencido');

-- CreateEnum
CREATE TYPE "inventory"."OrigenLote" AS ENUM ('Production', 'Purchase', 'Manual');

-- CreateEnum
CREATE TYPE "inventory"."EstadoReserva" AS ENUM ('Active', 'Released', 'Fulfilled');

-- CreateEnum
CREATE TYPE "inventory"."TipoMovimiento" AS ENUM ('Entrada', 'Salida', 'TransferenciaSalida', 'TransferenciaEntrada', 'Ajuste', 'Reserva', 'LiberacionReserva');

-- CreateEnum
CREATE TYPE "inventory"."TipoUbicacion" AS ENUM ('Camara', 'Estante', 'Recepcion', 'Despacho', 'Cuarentena', 'Devoluciones');

-- CreateTable
CREATE TABLE "inventory"."warehouses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."locations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "tipo_ubicacion" "inventory"."TipoUbicacion" NOT NULL,
    "temp_min_c" DOUBLE PRECISION,
    "temp_max_c" DOUBLE PRECISION,
    "capacidad_max" DOUBLE PRECISION,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."lotes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "codigo_lote" VARCHAR(50) NOT NULL,
    "product_id" UUID NOT NULL,
    "fecha_produccion" DATE NOT NULL,
    "fecha_vencimiento" DATE NOT NULL,
    "cantidad_inicial" DECIMAL(18,6) NOT NULL,
    "estado" "inventory"."EstadoLote" NOT NULL DEFAULT 'Disponible',
    "origen_tipo" "inventory"."OrigenLote" NOT NULL,
    "origen_ref" TEXT,
    "bloqueado_motivo" TEXT,
    "bloqueado_por" UUID,
    "bloqueado_en" TIMESTAMPTZ,
    "notas" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "lotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."existencias" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "lote_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "cantidad_disponible" DECIMAL(18,6) NOT NULL,
    "cantidad_reservada" DECIMAL(18,6) NOT NULL,
    "cantidad_bloqueada" DECIMAL(18,6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "existencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."reservas" (
    "id" UUID NOT NULL,
    "existencia_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "referencia_tipo" VARCHAR(30) NOT NULL,
    "referencia_id" VARCHAR(100) NOT NULL,
    "cantidad" DECIMAL(18,6) NOT NULL,
    "estado" "inventory"."EstadoReserva" NOT NULL DEFAULT 'Active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ,
    "released_reason" TEXT,

    CONSTRAINT "reservas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."movimientos_inventario" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tipo" "inventory"."TipoMovimiento" NOT NULL,
    "product_id" UUID NOT NULL,
    "lote_id" UUID,
    "location_id" UUID NOT NULL,
    "location_destino_id" UUID,
    "cantidad" DECIMAL(18,6) NOT NULL,
    "referencia_tipo" VARCHAR(30) NOT NULL,
    "referencia_id" VARCHAR(100) NOT NULL,
    "motivo" TEXT,
    "ocurrido_en" TIMESTAMPTZ NOT NULL,
    "registrado_por" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warehouses_tenant_id_idx" ON "inventory"."warehouses"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenant_id_code_key" ON "inventory"."warehouses"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "locations_tenant_id_idx" ON "inventory"."locations"("tenant_id");

-- CreateIndex
CREATE INDEX "locations_warehouse_id_idx" ON "inventory"."locations"("warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "locations_warehouse_id_code_key" ON "inventory"."locations"("warehouse_id", "code");

-- CreateIndex
CREATE INDEX "lotes_tenant_id_product_id_idx" ON "inventory"."lotes"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "lotes_fecha_vencimiento_idx" ON "inventory"."lotes"("fecha_vencimiento");

-- CreateIndex
CREATE INDEX "lotes_estado_idx" ON "inventory"."lotes"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "lotes_tenant_id_product_id_codigo_lote_key" ON "inventory"."lotes"("tenant_id", "product_id", "codigo_lote");

-- CreateIndex
CREATE INDEX "existencias_tenant_id_product_id_idx" ON "inventory"."existencias"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "existencias_lote_id_idx" ON "inventory"."existencias"("lote_id");

-- CreateIndex
CREATE INDEX "existencias_location_id_idx" ON "inventory"."existencias"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "existencias_tenant_id_product_id_lote_id_location_id_key" ON "inventory"."existencias"("tenant_id", "product_id", "lote_id", "location_id");

-- CreateIndex
CREATE INDEX "reservas_tenant_id_idx" ON "inventory"."reservas"("tenant_id");

-- CreateIndex
CREATE INDEX "reservas_existencia_id_idx" ON "inventory"."reservas"("existencia_id");

-- CreateIndex
CREATE INDEX "reservas_referencia_tipo_referencia_id_idx" ON "inventory"."reservas"("referencia_tipo", "referencia_id");

-- CreateIndex
CREATE INDEX "movimientos_inventario_tenant_id_product_id_ocurrido_en_idx" ON "inventory"."movimientos_inventario"("tenant_id", "product_id", "ocurrido_en");

-- CreateIndex
CREATE INDEX "movimientos_inventario_lote_id_idx" ON "inventory"."movimientos_inventario"("lote_id");

-- CreateIndex
CREATE INDEX "movimientos_inventario_location_id_idx" ON "inventory"."movimientos_inventario"("location_id");

-- CreateIndex
CREATE INDEX "movimientos_inventario_referencia_tipo_referencia_id_idx" ON "inventory"."movimientos_inventario"("referencia_tipo", "referencia_id");

-- AddForeignKey
ALTER TABLE "inventory"."locations" ADD CONSTRAINT "locations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "inventory"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."existencias" ADD CONSTRAINT "existencias_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "inventory"."lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."existencias" ADD CONSTRAINT "existencias_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory"."locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."reservas" ADD CONSTRAINT "reservas_existencia_id_fkey" FOREIGN KEY ("existencia_id") REFERENCES "inventory"."existencias"("id") ON DELETE CASCADE ON UPDATE CASCADE;
