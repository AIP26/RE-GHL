// Auth API del menú lateral — Paso 3.
// El flow OAuth público vive en /auth (routes/oauth.js).
// Aquí queda el SSO consumido por el iframe + un endpoint /me protegido
// para que el front pueda validar sesión y leer el agente actual.
import { Router } from 'express';
import { findTenantByLocationId, upsertTenantFromOAuth, getTenantWithTokens } from '../lib/tenants.js';
import { findAgencyByCompanyId, getAgencyWithTokens, listActiveAgencies } from '../lib/agencies.js';
import { mintLocationToken } from '../lib/ghl.js';
import { upsertAgent } from '../lib/agentes.js';
import { signSession } from '../lib/jwt.js';
import { requireSession } from '../middleware/auth.js';
import { ensureCustomObjectForLocation } from '../lib/ensure-custom-object.js';

const r = Router();

/**
 * Intenta mintear un location token para `locationId` usando la agency dada
 * y persiste el tenant resultante. Devuelve el tenant, o null si el mint
 * falló (típico: la agency no tiene autorización sobre esa sub-cuenta).
 */
async function tryProvisionFromAgency(agencyRow, locationId) {
  try {
    const withTokens = await getAgencyWithTokens(agencyRow.id);
    const minted = await mintLocationToken(withTokens.access_token, agencyRow.ghl_company_id, locationId);
    const tenant = await upsertTenantFromOAuth({
      locationId,
      access_token: minted.access_token,
      refresh_token: minted.refresh_token,
    });
    console.log('[auth/sso] tenant provisionado agencyId=%s companyId=%s locationId=%s tenantId=%s',
      agencyRow.id, agencyRow.ghl_company_id, locationId, tenant.id);
    // Bloque P0 FIX 7 — Después de crear el tenant, aseguramos el Custom
    // Object en esa location. Es idempotente y sólo tarda cuando el schema
    // no existe (primer agente que abre el panel post-install).
    try {
      const t = await getTenantWithTokens(tenant.id);
      const r = await ensureCustomObjectForLocation(t.access_token, locationId);
      console.log('[auth/sso] Custom Object provisionado locationId=%s created=%s skipped=%s failed=%s',
        locationId, r.created, r.skipped, r.failed);
    } catch (e) {
      console.error('[auth/sso] ensureCustomObjectForLocation falló:', e?.response?.data || e.message);
    }
    return tenant;
  } catch (e) {
    // 401/403 = la agency no tiene esa location; 404 = locationId inválido.
    // Log breve para observabilidad pero seguimos con la siguiente agency.
    const status = e?.response?.status;
    const body = e?.response?.data;
    console.warn('[auth/sso] mint falló agencyId=%s companyId=%s locationId=%s status=%s body=%s',
      agencyRow.id, agencyRow.ghl_company_id, locationId, status, body ? JSON.stringify(body).slice(0, 200) : e.message);
    return null;
  }
}

/**
 * Provisiona un tenant on-demand desde alguna agency que tenga acceso.
 *
 * Estrategia:
 *  1. Si viene `companyId` en el request, probamos primero esa agency
 *     específica (fast path).
 *  2. Si no viene, o si esa falla, iteramos sobre TODAS las agencies activas
 *     — la primera que logre mintear el location token gana. Esto cubre el
 *     caso real (comprobado con logs de Railway) donde el Custom Menu Link
 *     de GHL entrega `companyId=` vacío pese al placeholder {{company.id}}.
 *  3. Si ninguna agency puede mintear → null (el caller devolverá 404).
 */
async function provisionTenantFromAgency(locationId, companyIdHint) {
  // Fast path: la agency exacta si la conocemos.
  if (companyIdHint) {
    const hint = await findAgencyByCompanyId(companyIdHint);
    if (hint && hint.status === 'active') {
      const t = await tryProvisionFromAgency(hint, locationId);
      if (t) return t;
    }
  }
  // Fallback: probar cada agency activa (típicamente una sola en instalaciones
  // reales de una app en el Marketplace de un solo cliente).
  const all = await listActiveAgencies();
  const candidates = companyIdHint
    ? all.filter((a) => a.ghl_company_id !== companyIdHint) // ya la probamos
    : all;
  for (const a of candidates) {
    const t = await tryProvisionFromAgency(a, locationId);
    if (t) return t;
  }
  return null;
}

/**
 * GET /api/auth/sso?locationId=xxx&userId=xxx[&companyId=xxx]
 *
 * Mecanismo real de GHL: el iframe recibe locationId y userId como query
 * params (NO un JWT). Aquí emitimos nuestro propio session token.
 *
 * Extensión Marketplace (BLOQUE 15): si el tenant no existe, provisionamos
 * on-demand mintando un location token desde una agency previamente
 * autorizada. Funciona incluso si `companyId` llega vacío del Custom Menu
 * Link — iteramos sobre todas las agencies activas.
 */
r.get('/sso', async (req, res) => {
  const locationId = String(req.query.locationId || '').trim();
  const userId = String(req.query.userId || '').trim();
  const companyId = String(req.query.companyId || '').trim();

  if (!locationId || !userId) {
    return res.status(400).json({ error: 'missing_params', need: ['locationId', 'userId'] });
  }

  let tenant = await findTenantByLocationId(locationId);
  if (!tenant) {
    try {
      tenant = await provisionTenantFromAgency(locationId, companyId || null);
    } catch (e) {
      console.error('[auth/sso] provisionTenantFromAgency crashed:', e?.response?.data || e.message);
    }
  }
  if (!tenant) return res.status(404).json({ error: 'tenant_not_found' });
  if (tenant.status === 'needs_reauth') return res.status(409).json({ error: 'needs_reauth' });
  if (tenant.status === 'inactive') return res.status(403).json({ error: 'tenant_inactive' });

  const agente = await upsertAgent({
    tenantId: tenant.id,
    ghlUserId: userId,
    // Sin sobreescribir nombre/email/rol si ya existe. Si es nuevo, rol = 'agente'.
  });

  const token = signSession({
    tenantId: tenant.id,
    locationId: tenant.ghl_location_id,
    agentId: agente.id,
    ghlUserId: agente.ghl_user_id,
    rol: agente.rol,
  });

  return res.json({
    token,
    agente: {
      id: agente.id,
      nombre: agente.nombre,
      rol: agente.rol,
      foto_url: agente.foto_url,
      email: agente.email,
    },
    tenant: {
      id: tenant.id,
      plan: tenant.plan,
      locationId: tenant.ghl_location_id,
    },
  });
});

/**
 * GET /api/auth/me
 *
 * Endpoint protegido. Devuelve el contexto actual del agente + tenant.
 * Útil para que el menú lateral valide el token al cargar y muestre
 * "Hola, Carlos" + el plan / límites.
 */
r.get('/me', requireSession, (req, res) => {
  res.json({
    agente: req.agente,
    tenant: req.tenant,
    session: {
      issuedAt: req.session.iat,
      expiresAt: req.session.exp,
    },
  });
});

export default r;
