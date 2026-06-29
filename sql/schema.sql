-- =====================================================================
-- Real Estate SaaS para GHL — Master Context v2.6
-- PASO 1: Schema completo de Supabase (PostgreSQL)
-- 8 tablas: tenants, agentes, configuracion_marca, dominios,
--          colecciones, propiedades_colecciones, fichas_url, page_views
-- =====================================================================
-- Ejecutar en el SQL Editor de Supabase de una sola corrida.
-- Idempotente: usa IF NOT EXISTS / DROP IF EXISTS donde aplica.
-- =====================================================================

-- Extensiones requeridas -----------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- uuid_generate_v4() (fallback)

-- =====================================================================
-- 1. TENANTS (instalaciones de la app por location de GHL)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.tenants (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ghl_location_id  text        NOT NULL UNIQUE,
    oauth_token      text        NOT NULL,   -- AES-256 ciphertext
    refresh_token    text        NOT NULL,   -- AES-256 ciphertext
    plan             text        NOT NULL DEFAULT 'starter'
                     CONSTRAINT tenants_plan_chk
                     CHECK (plan IN ('starter', 'pro', 'agency')),
    status           text        NOT NULL DEFAULT 'active'
                     CONSTRAINT tenants_status_chk
                     CHECK (status IN ('active', 'inactive', 'needs_reauth')),
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenants_status        ON public.tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_plan          ON public.tenants(plan);

COMMENT ON TABLE  public.tenants                       IS 'Una fila por instalación de la app GHL (location).';
COMMENT ON COLUMN public.tenants.oauth_token           IS 'Access token de GHL cifrado AES-256.';
COMMENT ON COLUMN public.tenants.refresh_token         IS 'Refresh token de GHL cifrado AES-256.';

-- =====================================================================
-- 2. AGENTES (usuarios de GHL que operan la app dentro del tenant)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.agentes (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    ghl_user_id   text        NOT NULL,
    nombre        text        NOT NULL,
    telefono      text,
    whatsapp      text,
    email         text,
    foto_url      text,
    rol           text        NOT NULL DEFAULT 'agente'
                  CONSTRAINT agentes_rol_chk
                  CHECK (rol IN ('admin', 'agente')),
    activo        boolean     NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT agentes_tenant_ghluser_uk UNIQUE (tenant_id, ghl_user_id)
);

CREATE INDEX IF NOT EXISTS idx_agentes_tenant         ON public.agentes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agentes_tenant_activo  ON public.agentes(tenant_id, activo);
CREATE INDEX IF NOT EXISTS idx_agentes_ghl_user       ON public.agentes(ghl_user_id);

COMMENT ON TABLE  public.agentes               IS 'Agentes operadores del tenant. Primer admin se crea automáticamente en webhook de instalación.';
COMMENT ON COLUMN public.agentes.ghl_user_id   IS 'userId de GHL (viene en query params del iframe SSO).';

-- =====================================================================
-- 3. CONFIGURACION_MARCA (branding del portal público por tenant)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.configuracion_marca (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid        NOT NULL UNIQUE
                        REFERENCES public.tenants(id) ON DELETE CASCADE,

    -- Identidad visual
    logo_url            text,
    hero_foto_url       text,
    color_principal     text,                         -- hex #RRGGBB
    color_secundario    text,
    color_acento        text,

    -- Datos de contacto / marca
    nombre_agencia      text,
    telefono            text,
    whatsapp            text,
    email               text,

    -- Redes sociales
    facebook            text,
    instagram           text,
    linkedin            text,
    youtube             text,

    -- Asociaciones (AMPI, CANACO, etc.) -> [{ "nombre": "...", "logo_url": "..." }]
    asociaciones        jsonb       NOT NULL DEFAULT '[]'::jsonb,

    -- Widget de contacto: whatsapp O livechat (nunca ambos)
    widget_tipo         text
                        CONSTRAINT brand_widget_tipo_chk
                        CHECK (widget_tipo IS NULL OR widget_tipo IN ('whatsapp', 'livechat')),
    widget_valor        text,         -- número WA con +52 o snippet HTML de GHL Live Chat

    -- Analytics
    ga4_tag             text,         -- G-XXXXXXXX

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_config_marca_tenant ON public.configuracion_marca(tenant_id);

COMMENT ON TABLE public.configuracion_marca IS 'Branding del portal público y widget global de contacto por tenant.';

-- =====================================================================
-- 4. DOMINIOS (CNAME del cliente -> listings.mktscaled.com)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.dominios (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid        NOT NULL UNIQUE
                      REFERENCES public.tenants(id) ON DELETE CASCADE,
    subdominio        text        NOT NULL UNIQUE,    -- ej. 'propiedades.thebrokers.mx'
    cname_verificado  boolean     NOT NULL DEFAULT false,
    ssl_activo        boolean     NOT NULL DEFAULT false,
    verificado_en     timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dominios_subdominio       ON public.dominios(subdominio);
CREATE INDEX IF NOT EXISTS idx_dominios_pendientes
       ON public.dominios(cname_verificado)
       WHERE cname_verificado = false;

COMMENT ON TABLE  public.dominios            IS 'Dominio custom del cliente. El servidor resuelve tenant por header Host.';
COMMENT ON COLUMN public.dominios.subdominio IS 'Hostname completo, ej. propiedades.thebrokers.mx';

-- =====================================================================
-- 5. COLECCIONES (agrupaciones libres de propiedades por tenant)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.colecciones (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    nombre      text        NOT NULL,
    slug        text        NOT NULL,
    foto_url    text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT colecciones_tenant_slug_uk UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_colecciones_tenant       ON public.colecciones(tenant_id);
CREATE INDEX IF NOT EXISTS idx_colecciones_tenant_slug  ON public.colecciones(tenant_id, slug);

COMMENT ON TABLE public.colecciones IS 'Colecciones de propiedades (zonas, campañas, etc.). URL: /coleccion/:slug.';

-- =====================================================================
-- 6. PROPIEDADES_COLECCIONES (relación N:N — propiedad GHL <-> colección)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.propiedades_colecciones (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    propiedad_id  text        NOT NULL,                                   -- GHL Custom Object record ID
    coleccion_id  uuid        NOT NULL REFERENCES public.colecciones(id) ON DELETE CASCADE,
    tenant_id     uuid        NOT NULL REFERENCES public.tenants(id)     ON DELETE CASCADE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT propcol_unique UNIQUE (propiedad_id, coleccion_id)
);

CREATE INDEX IF NOT EXISTS idx_propcol_tenant       ON public.propiedades_colecciones(tenant_id);
CREATE INDEX IF NOT EXISTS idx_propcol_coleccion    ON public.propiedades_colecciones(coleccion_id);
CREATE INDEX IF NOT EXISTS idx_propcol_propiedad    ON public.propiedades_colecciones(propiedad_id);

COMMENT ON TABLE public.propiedades_colecciones IS 'Pivote N:N. propiedad_id apunta al record ID del Custom Object "Propiedad" en GHL.';

-- =====================================================================
-- 7. FICHAS_URL (URLs orgánicas neutrales: ficha.mktscaled.com/x7k9m)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.fichas_url (
    id           text        PRIMARY KEY,         -- slug corto ej. 'x7k9m'
    property_id  text        NOT NULL,            -- GHL Custom Object record ID
    tenant_id    uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    expira_en    timestamptz,                     -- NULL = no expira
    activa       boolean     NOT NULL DEFAULT true,
    vistas       integer     NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fichas_url_property  ON public.fichas_url(property_id);
CREATE INDEX IF NOT EXISTS idx_fichas_url_tenant    ON public.fichas_url(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fichas_url_activa    ON public.fichas_url(activa)
       WHERE activa = true;

COMMENT ON TABLE  public.fichas_url           IS 'URL orgánica sin branding. El ID corto es el token de acceso (no requiere auth).';
COMMENT ON COLUMN public.fichas_url.id        IS 'Slug corto generado, ej. x7k9m. Usado en ficha.mktscaled.com/:id';

-- =====================================================================
-- 8. PAGE_VIEWS (analytics ligero — fuera de GHL Custom Object)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.page_views (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id  text        NOT NULL,                               -- GHL Custom Object record ID
    tenant_id    uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    "timestamp"  timestamptz NOT NULL DEFAULT now(),
    source       text        NOT NULL DEFAULT 'portal'
                 CONSTRAINT page_views_source_chk
                 CHECK (source IN ('portal', 'busqueda', 'organica'))
);

-- Índices REQUERIDOS por el Master Context (dashboard top 5, sin full scan)
CREATE INDEX IF NOT EXISTS idx_page_views_property_tenant
       ON public.page_views(property_id, tenant_id);

CREATE INDEX IF NOT EXISTS idx_page_views_tenant_timestamp
       ON public.page_views(tenant_id, "timestamp" DESC);

COMMENT ON TABLE public.page_views IS 'Una fila por visita pública. Alimenta el dashboard de métricas.';

-- =====================================================================
-- TRIGGER: mantener configuracion_marca.updated_at sincronizado
-- =====================================================================
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_config_marca_updated_at ON public.configuracion_marca;
CREATE TRIGGER trg_config_marca_updated_at
    BEFORE UPDATE ON public.configuracion_marca
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =====================================================================
-- ROW LEVEL SECURITY
-- Activamos RLS en todas las tablas. El backend usa la SERVICE_ROLE_KEY
-- (que bypassa RLS), así que NO añadimos policies abiertas: solo el
-- service role tendrá acceso. Esto previene lecturas indebidas desde el
-- anon key si alguna vez se expone.
-- =====================================================================
ALTER TABLE public.tenants                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agentes                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracion_marca      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dominios                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.colecciones              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.propiedades_colecciones  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fichas_url               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_views               ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- FIN DEL SCHEMA — Master Context v2.6 — Paso 1
-- =====================================================================
