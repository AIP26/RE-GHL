// CRUD colecciones — Paso 7 (lista usada por el formulario en Paso 5).
import { Router } from 'express';
import slugify from 'slugify';
import { requireSession } from '../middleware/auth.js';
import { getSupabase } from '../lib/supabase.js';

const r = Router();

// GET /api/collection — lista las colecciones del tenant
r.get('/', requireSession, async (req, res) => {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('colecciones')
    .select('id, nombre, slug, foto_url, created_at')
    .eq('tenant_id', req.tenant.id)
    .order('nombre', { ascending: true });
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });
  res.json({ colecciones: data });
});

// POST /api/collection — crea una colección
r.post('/', requireSession, async (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'nombre_required' });
  const slug = slugify(nombre, { lower: true, strict: true });
  const sb = getSupabase();
  const { data, error } = await sb
    .from('colecciones')
    .insert({ tenant_id: req.tenant.id, nombre, slug, foto_url: req.body?.foto_url || null })
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });
  res.json({ coleccion: data });
});

// PUT /api/collection/:id — renombrar / actualizar foto
r.put('/:id', requireSession, async (req, res) => {
  const sb = getSupabase();
  const update = {};
  if (req.body?.nombre) {
    update.nombre = req.body.nombre;
    update.slug = slugify(req.body.nombre, { lower: true, strict: true });
  }
  if ('foto_url' in (req.body || {})) update.foto_url = req.body.foto_url || null;
  const { data, error } = await sb
    .from('colecciones')
    .update(update)
    .eq('id', req.params.id)
    .eq('tenant_id', req.tenant.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });
  res.json({ coleccion: data });
});

// DELETE /api/collection/:id
r.delete('/:id', requireSession, async (req, res) => {
  const sb = getSupabase();
  const { error } = await sb
    .from('colecciones')
    .delete()
    .eq('id', req.params.id)
    .eq('tenant_id', req.tenant.id);
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });
  res.json({ ok: true });
});

export default r;
