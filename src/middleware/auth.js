// Middleware de autenticación del menú lateral.
// Valida el JWT emitido por /api/auth/sso y carga tenant + agente desde DB,
// poniéndolos en req.session, req.tenant y req.agente.
import { verifySession } from '../lib/jwt.js';
import { findTenantByLocationId } from '../lib/tenants.js';
import { findAgentByGhlUser } from '../lib/agentes.js';

/**
 * Express middleware. Para rutas protegidas detrás del iframe SSO.
 * Adjunta:
 *   req.session = { tenantId, locationId, agentId, ghlUserId, rol, iat, exp }
 *   req.tenant  = { id, ghl_location_id, status, plan }
 *   req.agente  = { id, nombre, rol, ... }
 */
export async function requireSession(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing_session' });

  let payload;
  try {
    payload = verifySession(token);
  } catch {
    return res.status(401).json({ error: 'invalid_session' });
  }
  req.session = payload;

  try {
    const [tenant, agente] = await Promise.all([
      findTenantByLocationId(payload.locationId),
      // findAgentByGhlUser requiere tenantId; lo tenemos en payload.
      findAgentByGhlUser(payload.tenantId, payload.ghlUserId),
    ]);
    if (!tenant) return res.status(404).json({ error: 'tenant_not_found' });
    if (tenant.status !== 'active') return res.status(403).json({ error: `tenant_${tenant.status}` });
    if (!agente || !agente.activo) return res.status(403).json({ error: 'agente_inactivo' });
    req.tenant = tenant;
    req.agente = agente;
    return next();
  } catch (err) {
    return res.status(500).json({ error: 'session_load_failed', message: err.message });
  }
}

/** Variante para endpoints admin-only. */
export function requireAdmin(req, res, next) {
  if (req.agente?.rol !== 'admin') return res.status(403).json({ error: 'admin_required' });
  return next();
}
