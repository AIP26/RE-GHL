-- Paso 14: API pública v1 con autenticación por API key per-tenant.
-- key_hash es SHA-256 del key plain. El plain SOLO se devuelve al crear
-- (NUNCA se almacena en clear). prefix son los primeros 8 chars del key
-- para identificar visualmente sin exponer el secreto.
CREATE TABLE IF NOT EXISTS public.api_keys (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    nombre      text NOT NULL,
    key_hash    text NOT NULL UNIQUE,
    key_prefix  text NOT NULL,          -- visible (8 chars) para identificar la key
    activa      boolean NOT NULL DEFAULT true,
    last_used_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON public.api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON public.api_keys(key_hash) WHERE activa = true;

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
