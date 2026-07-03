// Endpoints administrativos de emergencia — NO expuestos al panel.
// Protegidos por `x-admin-api-key` header contra la env var ADMIN_API_KEY.
// Uso típico: cuando un tenant queda huérfano y necesitas forzar un
// mintLocationToken sin esperar al cron de 23h.
//
// Ejemplo:
//   curl -X POST -H "x-admin-api-key: $ADMIN_API_KEY" \
//        https://panel.mktscaled.com/api/admin/reprovision/cNg6MFQcxv8bZnwCppoM
import { Router } from 'express';
import { mintLocationToken } from '../lib/ghl.js';
import {
  findTenantByLocationId,
  upsertTenantFromOAuth,
  linkTenantToAgency,
} from '../lib/tenants.js';
import {
  findAgencyByCompanyId,
  getAgencyWithTokens,
  listActiveAgencies,
} from '../lib/agencies.js';

const r = Router();

/** Middleware: exige `x-admin-api-key` == process.env.ADMIN_API_KEY.
 *  Si la env var no está configurada, devuelve 503 (fail-fast, seguro por
 *  default — no queremos que el endpoint quede abierto por accidente). */
function requireAdminKey(req, res, next) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected || expected.length < 16) {
    return res.status(503).json({
      error: 'admin_api_disabled',
      message: 'ADMIN_API_KEY no configurada (o < 16 chars) en el entorno.',
    });
  }
  const received = req.get('x-admin-api-key') || '';
  if (received !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

/**
 * POST /api/admin/reprovision/:locationId
 *
 * Fuerza un mintLocationToken sobre la sub-cuenta indicada usando alguna
 * agency activa. Sobrescribe los tokens del tenant y lo pone en `active`.
 *
 * Body (opcional):
 *   { "companyId": "..." }  ← fast path: intenta esa agency primero
 *
 * Respuesta:
 *   200 { ok: true, tenantId, agencyId, expiresIn }
 *   404 { error: 'no_agency_authorizes' }   — ninguna agency puede mintear
 *   400 { error: 'no_active_agencies' }
 */
r.post('/reprovision/:locationId', requireAdminKey, async (req, res) => {
  const locationId = String(req.params.locationId || '').trim();
  const companyIdHint = String(req.body?.companyId || '').trim();
  if (!locationId) return res.status(400).json({ error: 'missing_locationId' });

  const agencies = await listActiveAgencies();
  if (agencies.length === 0) {
    return res.status(400).json({ error: 'no_active_agencies' });
  }

  // Orden: agency hint primero (si viene), luego el resto.
  let ordered = agencies;
  if (companyIdHint) {
    const hint = await findAgencyByCompanyId(companyIdHint);
    if (hint && hint.status === 'active') {
      ordered = [hint, ...agencies.filter((a) => a.id !== hint.id)];
    }
  }

  const errors = [];
  for (const agency of ordered) {
    try {
      const withTokens = await getAgencyWithTokens(agency.id);
      const minted = await mintLocationToken(
        withTokens.access_token,
        agency.ghl_company_id,
        locationId,
      );
      const tenant = await upsertTenantFromOAuth({
        locationId,
        access_token: minted.access_token,
        refresh_token: minted.refresh_token,
      });
      // Best-effort: guardar link tenant→agency. Silencioso si columna no existe.
      try { await linkTenantToAgency(tenant.id, agency.id); }
      catch (e) { console.warn('[admin/reprovision] linkTenantToAgency:', e.message); }

      console.log('[admin/reprovision] OK locationId=%s agencyId=%s tenantId=%s',
        locationId, agency.id, tenant.id);
      return res.json({
        ok: true,
        tenantId: tenant.id,
        agencyId: agency.id,
        ghlCompanyId: agency.ghl_company_id,
        expiresIn: minted.expires_in,
      });
    } catch (err) {
      const status = err?.response?.status;
      const body = err?.response?.data;
      errors.push({ agencyId: agency.id, status, body });
      if (status === 404) {
        // location no existe → no vale la pena seguir probando
        return res.status(404).json({ error: 'location_not_found', tried: errors });
      }
      console.warn('[admin/reprovision] agency=%s falló status=%s', agency.id, status);
    }
  }

  return res.status(404).json({ error: 'no_agency_authorizes', tried: errors });
});

/** Ligero health-check para verificar que el key está bien configurado. */
r.get('/ping', requireAdminKey, (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

export default r;
