// Auth API del menú lateral — Paso 3.
// El flow OAuth público vive en /auth (routes/oauth.js).
// Aquí queda el SSO consumido por el iframe + un endpoint /me protegido
// para que el front pueda validar sesión y leer el agente actual.
import { Router } from 'express';
import { findTenantByLocationId } from '../lib/tenants.js';
import { upsertAgent } from '../lib/agentes.js';
import { signSession } from '../lib/jwt.js';
import { requireSession } from '../middleware/auth.js';

const r = Router();

/**
 * GET /api/auth/sso?locationId=xxx&userId=xxx
 *
 * Mecanismo real de GHL: el iframe recibe locationId y userId como query
 * params (NO un JWT). Aquí emitimos nuestro propio session token.
 */
r.get('/sso', async (req, res) => {
  const locationId = String(req.query.locationId || '').trim();
  const userId = String(req.query.userId || '').trim();

  if (!locationId || !userId) {
    return res.status(400).json({ error: 'missing_params', need: ['locationId', 'userId'] });
  }

  const tenant = await findTenantByLocationId(locationId);
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
