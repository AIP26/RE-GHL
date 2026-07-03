-- BLOQUE P1 (post) — Diagnóstico "token refresh falla tras reinstalar".
--
-- Cuando un tenant es aprovisionado on-demand mintando un location token
-- desde una agency (POST /oauth/locationToken), el refresh_token entregado
-- por GHL es short-lived y **derivativo** del agency token. Refrescarlo
-- aisladamente vía POST /oauth/token es frágil (falla con "Invalid client
-- credentials" en escenarios reales donde el clientKey rota o el token es
-- de un "user_type" distinto).
--
-- La estrategia correcta es: cuando refresh directo falla, re-mintear
-- vía la agency asociada (mintLocationToken) usando el agency token
-- fresco. Para hacer eso el cron necesita saber a qué agency pertenece
-- cada tenant → añadimos FK opcional `tenants.agency_id`.
--
-- La FK es NULLABLE porque:
--   · Instalaciones directas por sub-cuenta (installType=Location) NO
--     tienen agency asociada — su refresh directo funciona sin re-mint.
--   · Tenants creados antes de esta migración quedan con agency_id=NULL
--     hasta que provisionTenantFromAgency los re-linkée en el próximo
--     open del panel.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS agency_id uuid
    REFERENCES public.agencies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_agency_id ON public.tenants(agency_id);

COMMENT ON COLUMN public.tenants.agency_id IS
  'FK a agencies. NULL para installs directos por sub-cuenta; poblado para instalaciones nivel Agency que minteran location token vía la agency.';
