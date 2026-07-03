// Endpoints proxy hacia GHL para poblar los dropdowns de CTA nativos
// (formulario + calendario) en el panel. Requieren sesión del panel; el
// tenant del session token identifica qué location consultar.
//
// BLOQUE P2 FIX 3 — Diagnóstico: GHL devuelve
//   401 "The token is not authorized for this scope."
// cuando el app en Marketplace no declara los scopes `forms.readonly` y
// `calendars.readonly` (los tokens actuales sólo tienen scopes de custom
// objects, locations, contacts, associations, businesses, users, oauth).
// Detectamos ese error específico y devolvemos `scope_missing` para que
// el frontend muestre un mensaje claro al usuario en lugar de "no items".
import { Router } from 'express';
import axios from 'axios';
import { requireSession } from '../middleware/auth.js';
import { getTenantWithTokens } from '../lib/tenants.js';

const r = Router();
const BASE = 'https://services.leadconnectorhq.com';

async function ghl(req, path, extraParams = {}) {
  const t = await getTenantWithTokens(req.tenant.id);
  const { data } = await axios.get(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${t.access_token}`,
      Version: '2021-07-28',
      Accept: 'application/json',
    },
    params: { locationId: t.ghl_location_id, ...extraParams },
    timeout: 15_000,
  });
  return data;
}

/** Traduce un error de axios/GHL en el shape { status, code, detail } que
 *  espera el frontend. `scope_missing` gatilla un mensaje específico en el UI. */
function classifyGhlError(err) {
  const status = err?.response?.status;
  const body = err?.response?.data;
  const message = body?.message || body?.error_description || err.message || '';
  const lower = String(message).toLowerCase();
  if (status === 401 && (lower.includes('scope') || lower.includes('not authorized for'))) {
    return { status: 502, code: 'scope_missing', detail: message };
  }
  if (status === 401) {
    return { status: 401, code: 'token_invalid', detail: message };
  }
  return { status: 502, code: 'ghl_upstream', detail: message };
}

/** GET /api/ghl/forms → { items: [{id, name}] } */
r.get('/forms', requireSession, async (req, res) => {
  try {
    const data = await ghl(req, '/forms/');
    const items = (data?.forms || data || []).map((f) => ({ id: f.id, name: f.name }));
    res.json({ items });
  } catch (e) {
    const cls = classifyGhlError(e);
    console.error('[ghl/forms] error:', e?.response?.status, e?.response?.data || e.message, '-> cls=', cls.code);
    res.status(cls.status).json({ error: cls.code, detail: cls.detail });
  }
});

/** GET /api/ghl/calendars → { items: [{id, name}] } */
r.get('/calendars', requireSession, async (req, res) => {
  try {
    const data = await ghl(req, '/calendars/');
    const items = (data?.calendars || data || []).map((c) => ({ id: c.id, name: c.name }));
    res.json({ items });
  } catch (e) {
    const cls = classifyGhlError(e);
    console.error('[ghl/calendars] error:', e?.response?.status, e?.response?.data || e.message, '-> cls=', cls.code);
    res.status(cls.status).json({ error: cls.code, detail: cls.detail });
  }
});

export default r;
