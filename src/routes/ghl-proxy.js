// Endpoints proxy hacia GHL para poblar los dropdowns de CTA nativos
// (formulario + calendario) en el panel. Requieren sesión del panel; el
// tenant del session token identifica qué location consultar.
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

/** GET /api/ghl/forms → [{id, name}] */
r.get('/forms', requireSession, async (req, res) => {
  try {
    const data = await ghl(req, '/forms/');
    const items = (data?.forms || data || []).map((f) => ({ id: f.id, name: f.name }));
    res.json({ items });
  } catch (e) {
    console.error('[ghl/forms] error:', e?.response?.status, e?.response?.data || e.message);
    res.status(502).json({ error: 'ghl_upstream', detail: e?.response?.data?.message || e.message });
  }
});

/** GET /api/ghl/calendars → [{id, name}] */
r.get('/calendars', requireSession, async (req, res) => {
  try {
    const data = await ghl(req, '/calendars/');
    const items = (data?.calendars || data || []).map((c) => ({ id: c.id, name: c.name }));
    res.json({ items });
  } catch (e) {
    console.error('[ghl/calendars] error:', e?.response?.status, e?.response?.data || e.message);
    res.status(502).json({ error: 'ghl_upstream', detail: e?.response?.data?.message || e.message });
  }
});

export default r;
