// CRUD agentes del tenant — Paso 8 (lista usada por el formulario en Paso 5).
import { Router } from 'express';
import { requireSession, requireAdmin } from '../middleware/auth.js';
import { getSupabase } from '../lib/supabase.js';

const r = Router();

// GET /api/agent — lista los agentes activos del tenant actual
r.get('/', requireSession, async (req, res) => {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('agentes')
    .select('id, ghl_user_id, nombre, telefono, whatsapp, email, foto_url, rol, activo, created_at')
    .eq('tenant_id', req.tenant.id)
    .eq('activo', true)
    .order('rol', { ascending: false }) // admin primero
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });
  res.json({ agentes: data });
});

// PUT /api/agent/:id — actualizar datos del agente (admin only)
r.put('/:id', requireSession, requireAdmin, async (req, res) => {
  const sb = getSupabase();
  const allowed = ['nombre', 'telefono', 'whatsapp', 'email', 'foto_url', 'rol', 'activo'];
  const update = {};
  for (const k of allowed) if (k in req.body) update[k] = req.body[k];
  const { data, error } = await sb
    .from('agentes')
    .update(update)
    .eq('id', req.params.id)
    .eq('tenant_id', req.tenant.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });
  res.json({ agente: data });
});

export default r;
