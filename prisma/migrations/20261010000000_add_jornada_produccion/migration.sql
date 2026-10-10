-- =====================================================================
-- ELIZA — Jornadas de producción
-- =====================================================================
-- Una jornada agrupa varias órdenes de producción del mismo día de planta
-- (varios productos terminados). Cada orden sigue siendo la unidad de
-- reserva, consumo y lotes; la jornada solo las agrupa por su código
-- (JP-AAMMDD-HHMM-XXX). NULL = orden suelta (todas las anteriores).
--
-- Columna nueva y nula: no reescribe filas; las políticas RLS de
-- manufacturing.ordenes_produccion siguen aplicando igual.
-- =====================================================================

ALTER TABLE "manufacturing"."ordenes_produccion" ADD COLUMN IF NOT EXISTS "jornada" VARCHAR(40);

CREATE INDEX IF NOT EXISTS "ordenes_produccion_tenant_id_jornada_idx"
  ON "manufacturing"."ordenes_produccion"("tenant_id", "jornada");
