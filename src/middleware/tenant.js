// Resuelve el tenant a partir del header Host del request.
// Cada cliente apunta su CNAME a listings.mktscaled.com -> nosotros leemos
// req.headers.host y buscamos en la tabla `dominios`.
// Implementación detallada en Paso 9.
export async function resolveTenantByHost(_req, _res, next) {
  // TODO Paso 9: lookup en supabase.dominios por subdominio = req.headers.host
  //              -> req.tenant = { id, locationId, ... }
  next();
}
