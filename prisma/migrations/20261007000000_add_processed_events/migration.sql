-- =====================================================================
-- ELIZA — Idempotencia de proyecciones (Fase 10)
-- =====================================================================
-- Un registro por (proyección, evento) procesado. El proyector lo inserta
-- en la MISMA transacción en que actualiza su read model; si ya existe
-- (ON CONFLICT DO NOTHING), ignora el evento. Así una reentrega fuera de
-- orden (reclaimStuck, reintentos) no duplica efectos.
--
-- Hallazgo que lo motiva (DEV, 2026-10-06): con solo el checkpoint del
-- "último evento", reentregar un evento antiguo sumaba dos veces
-- (tenant_summary.user_count 1 -> 2).
-- =====================================================================

CREATE TABLE IF NOT EXISTS "platform"."processed_events" (
    "projection_name" VARCHAR(100) NOT NULL,
    "event_id"        UUID         NOT NULL,
    "processed_at"    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("projection_name", "event_id")
);

-- app_user (worker) inserta y consulta; no actualiza ni borra el historial.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    REVOKE ALL ON "platform"."processed_events" FROM app_user;
    GRANT SELECT, INSERT ON "platform"."processed_events" TO app_user;
  END IF;
END
$$;
