// URL orgánica (fichas_url) — Paso 13.
// Permite generar / regenerar / desactivar / expirar las URLs ficha.{APP_DOMAIN}/:id
import { Router } from 'express';
import { requireSession } from '../middleware/auth.js';
import { getSupabase } from '../lib/supabase.js';

const r = Router();

const ALPH = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function shortId(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPH[Math.floor(Math.random() * ALPH.length)];
  return s;
}

function fichaHostname() {
  return `ficha.${(process.env.APP_DOMAIN || 'mktscaled.com').trim()}`;
}

function publicShape(row) {
  if (!row) return null;
  return {
    id: row.id,
    property_id: row.property_id,
    activa: row.activa,
    expira_en: row.expira_en,
    vistas: row.vistas || 0,
    url: `https://${fichaHostname()}/${row.id}`,
    portal_path: `/ficha/${row.id}`,
  };
}

// GET /api/share/:propertyId — estado actual (la primera ficha activa o la última)
r.get('/:propertyId', requireSession, async (req, res) => {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('fichas_url')
    .select('id, property_id, activa, expira_en, vistas, created_at')
    .eq('tenant_id', req.tenant.id)
    .eq('property_id', req.params.propertyId)
    .order('activa', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });
  res.json({ ficha: publicShape(data), cname_target: fichaHostname() });
});

// POST /api/share/:propertyId — genera/regenera ficha
// Body opcional: { expira_en: ISO date, regenerate: true }
r.post('/:propertyId', requireSession, async (req, res) => {
  const sb = getSupabase();
  const { propertyId } = req.params;
  const expira = req.body?.expira_en || null;
  const regenerate = !!req.body?.regenerate;

  if (regenerate) {
    // Desactivar fichas anteriores → emitir una nueva
    await sb.from('fichas_url').update({ activa: false })
      .eq('tenant_id', req.tenant.id)
      .eq('property_id', propertyId);
  } else {
    // Si ya hay una activa y no se pide regenerar, simplemente actualizar expiración
    const { data: existing } = await sb
      .from('fichas_url')
      .select('id')
      .eq('tenant_id', req.tenant.id)
      .eq('property_id', propertyId)
      .eq('activa', true)
      .limit(1)
      .maybeSingle();
    if (existing) {
      const { data, error } = await sb.from('fichas_url')
        .update({ expira_en: expira })
        .eq('id', existing.id)
        .select().single();
      if (error) return res.status(500).json({ error: 'db_error', message: error.message });
      return res.json({ ficha: publicShape(data), cname_target: fichaHostname() });
    }
  }

  // Generar id único (retry hasta 5 veces en caso de colisión)
  let id = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    id = shortId(6);
    const { error } = await sb.from('fichas_url').insert({
      id, tenant_id: req.tenant.id, property_id: propertyId,
      activa: true, vistas: 0, expira_en: expira,
    });
    if (!error) break;
    if (error.code !== '23505') {
      return res.status(500).json({ error: 'db_error', message: error.message });
    }
  }
  const { data, error } = await sb.from('fichas_url').select().eq('id', id).maybeSingle();
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });
  res.json({ ficha: publicShape(data), cname_target: fichaHostname() });
});

// PUT /api/share/by-id/:fichaId — actualiza expiración / activa
r.put('/by-id/:fichaId', requireSession, async (req, res) => {
  const sb = getSupabase();
  const update = {};
  if ('activa' in (req.body || {})) update.activa = !!req.body.activa;
  if ('expira_en' in (req.body || {})) update.expira_en = req.body.expira_en || null;
  const { data, error } = await sb
    .from('fichas_url')
    .update(update)
    .eq('id', req.params.fichaId)
    .eq('tenant_id', req.tenant.id)
    .select().single();
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });
  res.json({ ficha: publicShape(data), cname_target: fichaHostname() });
});

export default r;
