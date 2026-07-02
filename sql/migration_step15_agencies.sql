-- Migración BLOQUE Marketplace — soporte de instalaciones desde cuenta de Agency.
--
-- Cuando la app se instala desde una cuenta de Agency (Company) en GHL, el
-- endpoint /oauth/token devuelve `companyId` pero NO `locationId` — porque
-- el admin autorizó a nivel agencia, no a una sub-cuenta específica.
--
-- Persistimos ese token en `agencies` y, cuando un agente abre después el
-- panel desde una sub-cuenta (Custom Menu Link con {{location.id}}),
-- minteamos el location token vía POST /oauth/locationToken usando el
-- agency token y creamos el `tenant` correspondiente en ese momento.

CREATE TABLE IF NOT EXISTS public.agencies (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    ghl_company_id   text        NOT NULL UNIQUE,
    oauth_token      text        NOT NULL,     -- AES-256 ciphertext
    refresh_token    text        NOT NULL,     -- AES-256 ciphertext
    status           text        NOT NULL DEFAULT 'active'
                     CONSTRAINT agencies_status_chk
                     CHECK (status IN ('active', 'inactive', 'needs_reauth')),
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agencies_status ON public.agencies(status);

COMMENT ON TABLE  public.agencies                     IS 'Instalación a nivel Agency (Company). Se usa para mintar location tokens on-demand.';
COMMENT ON COLUMN public.agencies.oauth_token         IS 'Access token de GHL cifrado AES-256 con scope Company.';
COMMENT ON COLUMN public.agencies.refresh_token       IS 'Refresh token de GHL cifrado AES-256.';
