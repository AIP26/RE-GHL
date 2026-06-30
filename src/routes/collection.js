// CRUD colecciones — Paso 7 (lista usada por el formulario en Paso 5).
import { Router } from 'express';
import slugify from 'slugify';
import { requireSession } from '../middleware/auth.js';
import { getSupabase } from '../lib/supabase.js';

const r = Router();

// GET /api/collection — lista las colecciones del tenant
// Devuelve también el `portal_base_url` (subdominio del cliente) para que
// el SPA pueda construir links "Copiar URL" sin tener que pegar más calls.
r.get('/', requireSession, async (req, res) => {
  const sb = getSupabase();
  const [colsRes, domRes] = await Promise.all([
    sb.from('colecciones')
      .select('id, nombre, slug, foto_url, created_at')
      .eq('tenant_id', req.tenant.id)
      .order('nombre', { ascending: true }),
    sb.from('dominios')
      .select('subdominio, cname_verificado')
      .eq('tenant_id', req.tenant.id)
      .maybeSingle(),
  ]);
  if (colsRes.error) return res.status(500).json({ error: 'db_error', message: colsRes.error.message });

  // Conteo de propiedades por colección, en un solo query.
  let countsByColeccion = {};
  if ((colsRes.data || []).length) {
    const ids = colsRes.data.map((c) => c.id);
    const { data: rels, error: relErr } = await sb
      .from('propiedades_colecciones')
      .select('coleccion_id')
      .eq('tenant_id', req.tenant.id)
      .in('coleccion_id', ids);
    if (relErr) return res.status(500).json({ error: 'db_error', message: relErr.message });
    countsByColeccion = (rels || []).reduce((acc, r) => {
      acc[r.coleccion_id] = (acc[r.coleccion_id] || 0) + 1;
      return acc;
    }, {});
  }

  const colecciones = (colsRes.data || []).map((c) => ({
    ...c,
    propiedades_count: countsByColeccion[c.id] || 0,
  }));

  res.json({
    colecciones,
    portal: {
      subdominio: domRes?.data?.subdominio || null,
      activo: !!domRes?.data?.cname_verificado,
    },
  });
});

// POST /api/collection — crea una colección
r.post('/', requireSession, async (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'nombre_required' });
  const sb = getSupabase();
  const slug = await uniqueSlug(sb, req.tenant.id, nombre);
  const { data, error } = await sb
    .from('colecciones')
    .insert({ tenant_id: req.tenant.id, nombre, slug, foto_url: req.body?.foto_url || null })
    .select('id, nombre, slug, foto_url, created_at')
    .single();
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });
  res.json({ coleccion: { ...data, propiedades_count: 0 } });
});

// PUT /api/collection/:id — renombrar / actualizar foto
r.put('/:id', requireSession, async (req, res) => {
  const sb = getSupabase();
  const update = {};
  if (req.body?.nombre) {
    update.nombre = String(req.body.nombre).trim();
    update.slug = await uniqueSlug(sb, req.tenant.id, update.nombre, req.params.id);
  }
  if ('foto_url' in (req.body || {})) update.foto_url = req.body.foto_url || null;
  const { data, error } = await sb
    .from('colecciones')
    .update(update)
    .eq('id', req.params.id)
    .eq('tenant_id', req.tenant.id)
    .select('id, nombre, slug, foto_url, created_at')
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

// Helper: genera un slug único por tenant. Si "zona-hotelera" ya existe,
// devuelve "zona-hotelera-2", "-3", etc. `ignoreId` permite saltar el
// propio registro al editar (para que mantenga su slug si el nombre no
// cambia "fonéticamente").
async function uniqueSlug(sb, tenantId, nombre, ignoreId) {
  const base = slugify(nombre, { lower: true, strict: true }) || 'coleccion';
  let candidate = base;
  let n = 2;
  // Buscamos slugs que matcheen base o base-N para no romper si la
  // colección crece a 100 nombres similares.
  while (true) {
    let q = sb.from('colecciones').select('id').eq('tenant_id', tenantId).eq('slug', candidate);
    if (ignoreId) q = q.neq('id', ignoreId);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    if (!data) return candidate;
    candidate = `${base}-${n++}`;
    if (n > 200) return `${base}-${Date.now()}`; // safety
  }
}
