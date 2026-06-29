// Webhook del Marketplace de GoHighLevel — Paso 3.
//
// URL configurada en GHL: https://listings.mktscaled.com/api/webhook
//
// Eventos soportados (el user spec usa LocationCreate/LocationDelete;
// también aceptamos los aliases INSTALL/UNINSTALL por compatibilidad):
//   LocationCreate | INSTALL    -> setup del tenant + primer admin
//   LocationDelete | UNINSTALL  -> marcar tenant inactive (NO borra)
//
// Firma: verificamos X-GHL-Signature (Ed25519) si tenemos la clave pública.
import { Router } from 'express';
import { findTenantByLocationId, getTenantWithTokens, markInactive } from '../lib/tenants.js';
import { ensureFirstAdmin } from '../lib/agentes.js';
import { getUserById } from '../lib/ghl.js';
import { verifyWebhookSignature } from '../lib/webhook-verify.js';

const r = Router();

// Eventos -> handler
const INSTALL_EVENTS = new Set(['LocationCreate', 'INSTALL', 'AppInstall']);
const UNINSTALL_EVENTS = new Set(['LocationDelete', 'UNINSTALL', 'AppUninstall']);

r.post('/', async (req, res) => {
  // 1. Verificación de firma — req.rawBody lo provee el express.json verify hook
  const signature = req.header('x-ghl-signature') || req.header('X-GHL-Signature');
  const check = verifyWebhookSignature(req.rawBody || Buffer.from(JSON.stringify(req.body)), signature);
  if (!check.ok) {
    // eslint-disable-next-line no-console
    console.warn('[webhook] firma inválida:', check.reason);
    return res.status(401).json({ error: 'invalid_signature', reason: check.reason });
  }

  // 2. Parsing
  const payload = req.body || {};
  const eventType = payload.type || payload.event || payload.eventType;
  const locationId = payload.locationId || payload.location_id;
  const userId = payload.userId || payload.user_id;

  // eslint-disable-next-line no-console
  console.log(`[webhook] ${eventType} location=${locationId} user=${userId}`);

  try {
    if (INSTALL_EVENTS.has(eventType)) {
      await handleInstall({ locationId, userId, payload });
    } else if (UNINSTALL_EVENTS.has(eventType)) {
      await handleUninstall({ locationId });
    } else {
      // eslint-disable-next-line no-console
      console.log(`[webhook] evento ignorado: ${eventType}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[webhook] handler error:', err?.response?.data || err.message);
    // Devolvemos 200 igual para que GHL no reintente indefinidamente — el
    // dato persiste en logs. Si quieres reintentos, cambia a 5xx.
    return res.status(200).json({ ok: false, error: err.message });
  }

  return res.status(200).json({ ok: true });
});

// ---------------------------------------------------------------------
async function handleInstall({ locationId, userId, payload }) {
  if (!locationId) throw new Error('install_missing_locationId');

  // El tenant debe haberse creado en /auth/callback (Paso 2). Si por orden
  // de ejecución todavía no existe, devolvemos 200 sin crear admin — GHL
  // suele reintentar el webhook, o el siguiente SSO disparará el alta.
  const tenant = await findTenantByLocationId(locationId);
  if (!tenant) {
    // eslint-disable-next-line no-console
    console.warn(`[webhook] tenant no existe aún para location=${locationId} (esperando /auth/callback)`);
    return;
  }

  // Llamamos GHL Users API para los datos del instalador.
  let userInfo = {};
  if (userId) {
    try {
      const t = await getTenantWithTokens(tenant.id);
      userInfo = await getUserById(t.access_token, userId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[webhook] no se pudo leer GHL Users API:', err?.response?.data || err.message);
      // Continuamos: creamos el admin con los datos mínimos del payload.
    }
  }

  // Algunos payloads incluyen también firstName/lastName/email directamente.
  const nombre =
    userInfo.name ||
    [userInfo.firstName, userInfo.lastName].filter(Boolean).join(' ').trim() ||
    [payload.firstName, payload.lastName].filter(Boolean).join(' ').trim() ||
    payload.name ||
    'Admin';

  const email = userInfo.email || payload.email || null;
  const telefono = userInfo.phone || payload.phone || null;

  await ensureFirstAdmin({
    tenantId: tenant.id,
    ghlUserId: userId || `unknown-${Date.now()}`,
    nombre,
    email,
    telefono,
  });
}

async function handleUninstall({ locationId }) {
  if (!locationId) throw new Error('uninstall_missing_locationId');
  const tenant = await findTenantByLocationId(locationId);
  if (!tenant) {
    // eslint-disable-next-line no-console
    console.warn(`[webhook] uninstall sin tenant: ${locationId}`);
    return;
  }
  await markInactive(tenant.id);
}

export default r;
