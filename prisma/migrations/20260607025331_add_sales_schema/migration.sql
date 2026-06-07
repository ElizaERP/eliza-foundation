-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "sales";

-- CreateEnum
CREATE TYPE "sales"."EstadoCliente" AS ENUM ('Activo', 'Inactivo', 'Suspendido');

-- CreateEnum
CREATE TYPE "sales"."CondicionesPago" AS ENUM ('Contado', 'Credito15', 'Credito30', 'Credito60', 'Credito90');

-- CreateEnum
CREATE TYPE "sales"."EstadoOrdenVenta" AS ENUM ('Borrador', 'Confirmada', 'Reservada', 'Despachada', 'Cerrada', 'Cancelada');

-- CreateTable
CREATE TABLE "sales"."clientes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "codigo" VARCHAR(50) NOT NULL,
    "nit" VARCHAR(15) NOT NULL,
    "razon_social" VARCHAR(200) NOT NULL,
    "nombre_comercial" VARCHAR(200),
    "estado" "sales"."EstadoCliente" NOT NULL DEFAULT 'Activo',
    "condiciones_pago" "sales"."CondicionesPago" NOT NULL DEFAULT 'Contado',
    "direccion_fiscal" JSONB NOT NULL,
    "direccion_entrega" JSONB,
    "contacto_nombre" VARCHAR(200),
    "contacto_telefono" VARCHAR(30),
    "contacto_email" VARCHAR(320),
    "notas" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales"."ordenes_venta" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "codigo" VARCHAR(50) NOT NULL,
    "cliente_id" UUID NOT NULL,
    "cliente_codigo" VARCHAR(50) NOT NULL,
    "cliente_razon_social" VARCHAR(200) NOT NULL,
    "estado" "sales"."EstadoOrdenVenta" NOT NULL DEFAULT 'Borrador',
    "condiciones_pago" "sales"."CondicionesPago" NOT NULL DEFAULT 'Contado',
    "direccion_entrega" JSONB NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "iva_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notas" TEXT,
    "cancelado_motivo" TEXT,
    "cancelado_por" UUID,
    "cancelado_en" TIMESTAMPTZ,
    "confirmado_en" TIMESTAMPTZ,
    "reservado_en" TIMESTAMPTZ,
    "despachado_en" TIMESTAMPTZ,
    "cerrado_en" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ordenes_venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales"."lineas_pedido" (
    "id" UUID NOT NULL,
    "orden_venta_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_code" VARCHAR(50) NOT NULL,
    "product_name" VARCHAR(200) NOT NULL,
    "cantidad" DECIMAL(18,6) NOT NULL,
    "precio_unitario" DECIMAL(18,2) NOT NULL,
    "tasa_iva" DECIMAL(5,2) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "iva" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "notas" TEXT,

    CONSTRAINT "lineas_pedido_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clientes_tenant_id_idx" ON "sales"."clientes"("tenant_id");

-- CreateIndex
CREATE INDEX "clientes_tenant_id_estado_idx" ON "sales"."clientes"("tenant_id", "estado");

-- CreateIndex
CREATE INDEX "clientes_razon_social_idx" ON "sales"."clientes"("razon_social");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_tenant_id_codigo_key" ON "sales"."clientes"("tenant_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_tenant_id_nit_key" ON "sales"."clientes"("tenant_id", "nit");

-- CreateIndex
CREATE INDEX "ordenes_venta_tenant_id_idx" ON "sales"."ordenes_venta"("tenant_id");

-- CreateIndex
CREATE INDEX "ordenes_venta_tenant_id_estado_idx" ON "sales"."ordenes_venta"("tenant_id", "estado");

-- CreateIndex
CREATE INDEX "ordenes_venta_cliente_id_idx" ON "sales"."ordenes_venta"("cliente_id");

-- CreateIndex
CREATE INDEX "ordenes_venta_created_at_idx" ON "sales"."ordenes_venta"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_venta_tenant_id_codigo_key" ON "sales"."ordenes_venta"("tenant_id", "codigo");

-- CreateIndex
CREATE INDEX "lineas_pedido_tenant_id_idx" ON "sales"."lineas_pedido"("tenant_id");

-- CreateIndex
CREATE INDEX "lineas_pedido_orden_venta_id_idx" ON "sales"."lineas_pedido"("orden_venta_id");

-- CreateIndex
CREATE INDEX "lineas_pedido_product_id_idx" ON "sales"."lineas_pedido"("product_id");

-- AddForeignKey
ALTER TABLE "sales"."ordenes_venta" ADD CONSTRAINT "ordenes_venta_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "sales"."clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales"."lineas_pedido" ADD CONSTRAINT "lineas_pedido_orden_venta_id_fkey" FOREIGN KEY ("orden_venta_id") REFERENCES "sales"."ordenes_venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
