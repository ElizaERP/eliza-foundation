-- =====================================================================
-- ELIZA — Precio de lista por producto (Sprint 10)
-- =====================================================================
-- Precio de venta base en COP, sin IVA. Lo fijan Tenant.Admin y
-- Sales.Manager (PUT /v1/catalog/products/:id/price). Los pedidos que arma
-- un vendedor (Sales.Salesperson) toman este precio; el vendedor no puede
-- enviar otro. NULL = el producto todavía no tiene precio.
--
-- Columna nueva y nula: no reescribe filas ni bloquea la tabla más allá del
-- ALTER, y las políticas RLS de catalog.products siguen aplicando igual.
-- =====================================================================

ALTER TABLE "catalog"."products" ADD COLUMN IF NOT EXISTS "sale_price" DECIMAL(18,2);
