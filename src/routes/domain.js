// Verificación CNAME + activación de dominio del cliente — Paso 10.
// Endpoints:
//   GET  /          → estado actual del dominio del tenant (público dentro del panel)
//   POST /          → guarda/cambia el subdominio deseado (admin only)
//   POST /verify    → fuerza verificación DNS inmediata (admin only)
//
// La verificación periódica (cada 60s) corre en src/jobs/cname-verify.js.
import { Router } from 'express';
import { requireSession, requireAdmin } from '../middleware/auth.js';
import { getSupabase } from '../lib/supabase.js';
import { verifyCnameOne } from '../jobs/cname-verify.js';

const r = Router();

// Hostname al que tienen que apuntar los CNAMEs de los clientes.
// Se lee en runtime (no en boot) por si APP_DOMAIN cambia.
function listingsHostname() {
  // listings.{APP_DOMAIN}, ej. listings.mktscaled.com
  const root = (process.env.APP_DOMAIN || 'mktscaled.com').trim();
  return `listings.${root}`;
}

// Hostname básico válido (a.b.c, sin protocolos, sin paths).
const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
function isValidHostname(h) {
  return typeof h === 'string' && HOST_RE.test(h.trim());
}

// GET /api/domain
r.get('/', requireSession, async (req, res) => {
  const sb = getSupabase();
  const { data } = await sb
    .from('dominios')
    .select('subdominio, cname_verificado, ssl_activo, verificado_en, created_at')
    .eq('tenant_id', req.tenant.id)
    .maybeSingle();
  res.json({
    dominio: data || null,
    cname_target: listingsHostname(),
  });
});

// POST /api/domain { subdominio: "propiedades.thebrokers.mx" }
// Acepta hostname completo (subdominio.dominio.tld). Si el cliente ya tenía
// uno, lo actualizamos y reseteamos cname_verificado=false (vuelve a validar).
r.post('/', requireSession, requireAdmin, async (req, res) => {
  const sb = getSupabase();
  const host = String(req.body?.subdominio || '').trim().toLowerCase();
  if (!isValidHostname(host)) {
    return res.status(400).json({ error: 'invalid_hostname', message: 'Ingresa un hostname válido como propiedades.tudominio.com' });
  }

  // Evitar colisiones con OTROS tenants (UNIQUE en columna lo respalda).
  const { data: existing } = await sb
    .from('dominios')
    .select('tenant_id')
    .eq('subdominio', host)
    .maybeSingle();
  if (existing && existing.tenant_id !== req.tenant.id) {
    return res.status(409).json({ error: 'hostname_taken', message: 'Ese hostname ya está siendo usado por otro cliente.' });
  }

  // Upsert por tenant_id (UNIQUE en la columna también).
  const { data, error } = await sb
    .from('dominios')
    .upsert(
      {
        tenant_id: req.tenant.id,
        subdominio: host,
        cname_verificado: false,
        ssl_activo: false,
        verificado_en: null,
      },
      { onConflict: 'tenant_id' }
    )
    .select('subdominio, cname_verificado, ssl_activo, verificado_en, created_at')
    .single();
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });
  res.json({ dominio: data, cname_target: listingsHostname() });
});

// POST /api/domain/verify  → fuerza un check DNS inmediato (admin only)
r.post('/verify', requireSession, requireAdmin, async (req, res) => {
  const sb = getSupabase();
  const { data: dom } = await sb
    .from('dominios')
    .select('id, subdominio, cname_verificado, ssl_activo')
    .eq('tenant_id', req.tenant.id)
    .maybeSingle();
  if (!dom) return res.status(404).json({ error: 'no_domain_configured', message: 'Primero configura un subdominio.' });

  const result = await verifyCnameOne(dom.subdominio, listingsHostname());
  // result: { ok, resolvedTo, error }
  const update = result.ok ? { cname_verificado: true, verificado_en: new Date().toISOString() } : { cname_verificado: false };
  await sb.from('dominios').update(update).eq('id', dom.id);

  res.json({
    ok: result.ok,
    cname_target: listingsHostname(),
    resolved_to: result.resolvedTo || null,
    error: result.error || null,
    dominio: { ...dom, ...update },
  });
});

export default r;
