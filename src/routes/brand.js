// CRUD de configuración de marca + widget de contacto — Paso 11.
// La tabla `configuracion_marca` es 1:1 con tenant — usamos upsert.
import { Router } from 'express';
import { requireSession, requireAdmin } from '../middleware/auth.js';
import { getSupabase } from '../lib/supabase.js';

const r = Router();

// Campos editables desde el panel — listado explícito para evitar inyección
// de columnas no permitidas (tenant_id, id, created_at, etc.).
const ALLOWED = [
  'logo_url', 'hero_foto_url',
  'color_principal', 'color_secundario', 'color_acento',
  'nombre_agencia', 'telefono', 'whatsapp', 'email',
  'facebook', 'instagram', 'linkedin', 'youtube',
  'asociaciones', // jsonb [{nombre, logo_url}]
  'widget_tipo', 'widget_valor',
  'ga4_tag',
];

const HEX_RE = /^#([0-9a-fA-F]{3}){1,2}$/;

function sanitize(body) {
  const out = {};
  for (const k of ALLOWED) {
    if (!(k in body)) continue;
    let v = body[k];

    // Validaciones por campo
    if (['color_principal', 'color_secundario', 'color_acento'].includes(k)) {
      if (v && !HEX_RE.test(String(v))) continue; // ignora color inválido
    }
    if (k === 'widget_tipo') {
      if (v !== 'whatsapp' && v !== 'livechat' && v !== null) continue;
    }
    if (k === 'asociaciones') {
      if (v == null) v = [];
      if (!Array.isArray(v)) continue;
      v = v.filter((a) => a && typeof a === 'object' && a.nombre && a.logo_url)
           .map((a) => ({ nombre: String(a.nombre).slice(0, 80), logo_url: String(a.logo_url) }));
    }
    if (typeof v === 'string') v = v.trim();
    if (v === '') v = null;
    out[k] = v;
  }
  return out;
}

// GET /api/brand
r.get('/', requireSession, async (req, res) => {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('configuracion_marca')
    .select('*')
    .eq('tenant_id', req.tenant.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });
  res.json({ marca: data || null });
});

// PUT /api/brand — actualiza (upsert) la configuración (admin only)
r.put('/', requireSession, requireAdmin, async (req, res) => {
  const sb = getSupabase();
  const fields = sanitize(req.body || {});

  // Reglas: si widget_tipo=livechat → widget_valor debe traer el snippet.
  //         si widget_tipo=whatsapp → widget_valor debería ser un número.
  // Igualmente NO se mezclan: si se setea uno, no se toca el otro implícitamente.
  fields.updated_at = new Date().toISOString();

  const { data, error } = await sb
    .from('configuracion_marca')
    .upsert(
      { tenant_id: req.tenant.id, ...fields },
      { onConflict: 'tenant_id' }
    )
    .select('*')
    .single();
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });
  res.json({ marca: data });
});

export default r;
