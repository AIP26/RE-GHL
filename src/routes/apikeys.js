// CRUD admin de API keys del tenant — usado por la pantalla "Configuración → API".
import { Router } from 'express';
import crypto from 'node:crypto';
import { requireSession, requireAdmin } from '../middleware/auth.js';
import { getSupabase } from '../lib/supabase.js';

const r = Router();

const KEY_PREFIX = 'mks_';
function generateKey() {
  // 32 bytes base64url = 43 chars + prefix = ~47 chars
  const raw = crypto.randomBytes(32).toString('base64').replace(/[+/=]/g, '').slice(0, 40);
  return KEY_PREFIX + raw;
}
function hashKey(plain) {
  return crypto.createHash('sha256').update(plain).digest('hex');
}

// GET /api/apikeys → lista (sin exponer key plain, sólo prefix)
r.get('/', requireSession, requireAdmin, async (req, res) => {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('api_keys')
    .select('id, nombre, key_prefix, activa, last_used_at, created_at')
    .eq('tenant_id', req.tenant.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });
  res.json({ api_keys: data });
});

// POST /api/apikeys { nombre } → genera + devuelve key PLAIN una sola vez
r.post('/', requireSession, requireAdmin, async (req, res) => {
  const nombre = String(req.body?.nombre || 'Sin nombre').trim().slice(0, 80);
  const sb = getSupabase();
  const plain = generateKey();
  const prefix = plain.slice(0, 12); // mks_xxxxxxxx
  const { data, error } = await sb.from('api_keys').insert({
    tenant_id: req.tenant.id,
    nombre,
    key_hash: hashKey(plain),
    key_prefix: prefix,
  }).select('id, nombre, key_prefix, activa, created_at').single();
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });
  // OJO: la única vez que devolvemos el plain
  res.json({ api_key: data, plain_once: plain });
});

// PUT /api/apikeys/:id { activa: false } → desactivar
r.put('/:id', requireSession, requireAdmin, async (req, res) => {
  const sb = getSupabase();
  const update = {};
  if ('activa' in (req.body || {})) update.activa = !!req.body.activa;
  if ('nombre' in (req.body || {})) update.nombre = String(req.body.nombre).slice(0, 80);
  const { data, error } = await sb
    .from('api_keys').update(update)
    .eq('id', req.params.id).eq('tenant_id', req.tenant.id)
    .select('id, nombre, key_prefix, activa, last_used_at, created_at').single();
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });
  res.json({ api_key: data });
});

// DELETE /api/apikeys/:id
r.delete('/:id', requireSession, requireAdmin, async (req, res) => {
  const sb = getSupabase();
  const { error } = await sb.from('api_keys').delete()
    .eq('id', req.params.id).eq('tenant_id', req.tenant.id);
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });
  res.json({ ok: true });
});

export default r;
