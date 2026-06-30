// Verificación de CNAME con DNS lookup real.
// Se ejecuta cada 60 segundos para todos los dominios con cname_verificado=false.
// Cuando el CNAME del cliente resuelve a listings.{APP_DOMAIN} marcamos
// cname_verificado=true en la tabla `dominios`.
//
// IMPORTANTE: En Railway Pro hay que ADEMÁS agregar manualmente el dominio
// custom en el dashboard de Railway (no hay API). Esto NO lo hacemos acá —
// el creador del SaaS lo hace una vez por tenant cuando ve el dominio
// como "Verificado" en la pantalla del agente.
import dns from 'node:dns/promises';
import { getSupabase } from '../lib/supabase.js';

/** Verifica un único hostname.
 *  @returns {{ok: boolean, resolvedTo?: string[], error?: string}} */
export async function verifyCnameOne(hostname, expectedTarget) {
  try {
    // Primera línea: cname directo
    const cnames = await dns.resolveCname(hostname).catch(() => null);
    if (cnames && cnames.length) {
      const normalized = cnames.map((c) => c.toLowerCase().replace(/\.$/, ''));
      const ok = normalized.some((c) => c === expectedTarget.toLowerCase() || c.endsWith('.' + expectedTarget.toLowerCase()));
      return ok
        ? { ok: true, resolvedTo: normalized }
        : { ok: false, resolvedTo: normalized, error: `CNAME apunta a ${normalized.join(', ')}, no a ${expectedTarget}.` };
    }

    // Fallback: ALIAS / ANAME (Cloudflare, algunas registrars) → resuelve A.
    // En ese caso comparamos las A de hostname vs A de expectedTarget.
    const [aHost, aTarget] = await Promise.all([
      dns.resolve4(hostname).catch(() => []),
      dns.resolve4(expectedTarget).catch(() => []),
    ]);
    if (aHost.length === 0) {
      return { ok: false, error: 'El hostname no resuelve (¿CNAME aún no propagado?).' };
    }
    const overlap = aHost.some((ip) => aTarget.includes(ip));
    if (overlap) return { ok: true, resolvedTo: aHost };
    return { ok: false, resolvedTo: aHost, error: `Las IPs ${aHost.join(', ')} no coinciden con las de ${expectedTarget}.` };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

/** Procesa todos los dominios con cname_verificado=false. */
export async function verifyPendingCnames() {
  const sb = getSupabase();
  const root = (process.env.APP_DOMAIN || 'mktscaled.com').trim();
  const target = `listings.${root}`;

  const { data: pending, error } = await sb
    .from('dominios')
    .select('id, tenant_id, subdominio')
    .eq('cname_verificado', false);
  if (error) {
    console.warn('[cname-verify] db error:', error.message);
    return { processed: 0 };
  }
  if (!pending?.length) return { processed: 0 };

  let ok = 0;
  for (const row of pending) {
    const res = await verifyCnameOne(row.subdominio, target);
    if (res.ok) {
      await sb.from('dominios').update({
        cname_verificado: true,
        verificado_en: new Date().toISOString(),
      }).eq('id', row.id);
      ok += 1;
      console.log(`[cname-verify] ✓ ${row.subdominio} → ${res.resolvedTo?.join(',')}`);
    }
  }
  return { processed: pending.length, verified: ok };
}
