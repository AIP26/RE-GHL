// Resuelve el tenant a partir del header Host del request.
// Cada cliente apunta su CNAME a listings.mktscaled.com -> nosotros leemos
// req.headers.host y buscamos en la tabla `dominios`.
//
// Fallback para preview/testing en Railway Hobby (donde sólo hay un dominio
// activo): si Host no resuelve a un tenant en la tabla `dominios`, se acepta
// `?preview=<tenant_id>` (sólo en GET, sólo si está activo). Esto permite
// probar el portal de un tenant desde listings.mktscaled.com/?preview=...
// antes de que el CNAME real esté configurado.
import { getSupabase } from '../lib/supabase.js';

const HOSTS_LOCAL = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

function normalizeHost(h) {
  if (!h) return null;
  // strip port y casing
  const onlyHost = String(h).split(':')[0].toLowerCase().trim();
  return onlyHost || null;
}

export async function resolveTenantByHost(req, _res, next) {
  const sb = getSupabase();
  const host = normalizeHost(req.headers.host);

  // 1) Lookup por subdominio exacto en la tabla dominios.
  if (host && !HOSTS_LOCAL.has(host)) {
    const { data, error } = await sb
      .from('dominios')
      .select('tenant_id, subdominio, cname_verificado')
      .eq('subdominio', host)
      .maybeSingle();
    if (!error && data?.tenant_id) {
      req.portalTenantId = data.tenant_id;
      req.portalDomainVerified = !!data.cname_verificado;
      req.portalHost = host;
      return next();
    }
  }

  // 2) Fallback preview: ?preview=<tenant_id> (sólo GET).
  // Útil mientras no hay CNAMEs activos. Acepta cualquier tenant del sistema.
  if (req.method === 'GET' && req.query?.preview) {
    const tenantId = String(req.query.preview);
    const { data } = await sb
      .from('tenants')
      .select('id, status')
      .eq('id', tenantId)
      .maybeSingle();
    if (data && data.status === 'active') {
      req.portalTenantId = tenantId;
      req.portalDomainVerified = false;
      req.portalHost = host;
      req.portalPreview = true;
      return next();
    }
  }

  // No hay match — dejamos pasar sin tenant; el handler 404 lo manejará.
  next();
}
