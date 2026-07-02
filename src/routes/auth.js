// Auth API del menú lateral — Paso 3.
// El flow OAuth público vive en /auth (routes/oauth.js).
// Aquí queda el SSO consumido por el iframe + un endpoint /me protegido
// para que el front pueda validar sesión y leer el agente actual.
import { Router } from 'express';
import { findTenantByLocationId, upsertTenantFromOAuth } from '../lib/tenants.js';
import { findAgencyByCompanyId, getAgencyWithTokens } from '../lib/agencies.js';
import { mintLocationToken } from '../lib/ghl.js';
import { upsertAgent } from '../lib/agentes.js';
import { signSession } from '../lib/jwt.js';
import { requireSession } from '../middleware/auth.js';

const r = Router();

/**
 * Provisiona un tenant on-demand desde un token de agencia.
 * Se usa cuando el admin instaló la app desde el nivel Agency (Company) —
 * en ese momento no había locationId, así que sólo guardamos el token
 * agency. La primera vez que alguien abre el panel desde una sub-cuenta,
 * minteamos el location token y creamos el tenant aquí.
 * Devuelve el tenant creado, o null si companyId no está autorizada.
 */
async function provisionTenantFromAgency(locationId, companyId) {
  const agency = companyId ? await findAgencyByCompanyId(companyId) : null;
  if (!agency || agency.status !== 'active') return null;

  const withTokens = await getAgencyWithTokens(agency.id);
  const minted = await mintLocationToken(withTokens.access_token, companyId, locationId);
  // La respuesta de /oauth/locationToken NO trae locationId de vuelta pero
  // sí access_token y refresh_token per-location. Persistimos como tenant.
  const tenant = await upsertTenantFromOAuth({
    locationId,   // sabemos cuál es porque nosotros lo pedimos
    access_token: minted.access_token,
    refresh_token: minted.refresh_token,
  });
  console.log('[auth/sso] provisioned tenant on-demand from agency companyId=%s locationId=%s tenantId=%s', companyId, locationId, tenant.id);
  return tenant;
}

/**
 * GET /api/auth/sso?locationId=xxx&userId=xxx[&companyId=xxx]
 *
 * Mecanismo real de GHL: el iframe recibe locationId y userId como query
 * params (NO un JWT). Aquí emitimos nuestro propio session token.
 *
 * Extensión Marketplace (BLOQUE 15): si el tenant no existe pero conocemos
 * la agencia (companyId), provisionamos el tenant al vuelo mintando un
 * location token desde el agency access_token.
 */
r.get('/sso', async (req, res) => {
  const locationId = String(req.query.locationId || '').trim();
  const userId = String(req.query.userId || '').trim();
  const companyId = String(req.query.companyId || '').trim();

  if (!locationId || !userId) {
    return res.status(400).json({ error: 'missing_params', need: ['locationId', 'userId'] });
  }

  let tenant = await findTenantByLocationId(locationId);
  if (!tenant && companyId) {
    // Intentamos provisionar desde la agency que ya autorizó la app.
    try {
      tenant = await provisionTenantFromAgency(locationId, companyId);
    } catch (e) {
      console.error('[auth/sso] provision failed:', e?.response?.data || e.message);
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
