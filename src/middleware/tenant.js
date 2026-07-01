// Resuelve el tenant a partir del header Host del request.
// Cada cliente apunta su CNAME a listings.mktscaled.com -> nosotros leemos
// req.headers.host y buscamos en la tabla `dominios`.
//
// Fallback para preview/testing en Railway Hobby (donde sólo hay un dominio
// activo): si Host no resuelve a un tenant en la tabla `dominios`, se acepta
// `?preview=<tenant_id>` (sólo en GET, sólo si está activo). Esto permite
// probar el portal de un tenant desde listings.mktscaled.com/?preview=...
// antes de que el CNAME real esté configurado.
//
// EXCEPCIÓN: `ficha.<APP_DOMAIN>` es un dominio compartido de la plataforma
// (no de un cliente). Las URLs orgánicas viven ahí: ficha.mktscaled.com/L4B9TP.
// El tenant se resuelve DENTRO del handler leyendo la tabla `fichas_url` por
// slug, así que el middleware NO debe hacer lookup en `dominios` (ese subdominio
// nunca estará ahí) ni bloquear con "Portal no encontrado". Marcamos con
// `req.isFichaHost = true` para que las rutas puedan branchear.
import { getSupabase } from '../lib/supabase.js';
import { env } from '../config/env.js';

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

  // 0) Excepción: subdominio compartido de fichas orgánicas.
  // ficha.<APP_DOMAIN> — nunca hay que buscarlo en `dominios`; el handler
  // resuelve tenant desde `fichas_url` por slug.
  const appDomain = (env.appDomain || '').toLowerCase();
  if (appDomain && host === `ficha.${appDomain}`) {
    req.isFichaHost = true;
    req.portalHost = host;
    return next();
  }

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
