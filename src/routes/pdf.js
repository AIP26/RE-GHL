// Ficha técnica PDF (PDFKit, bajo demanda) — Paso 12.
// 4 versiones: con/sin agente x 1/2 páginas. Stream directo, no se almacena.
//
// Endpoints:
//   GET /api/pdf/:propertyId?version=con-agente-1pag   (requiere sesión panel)
//   GET /api/pdf/ficha/:fichaId?pages=1|2              (público, sin auth)
//
// Versions: con-agente-1pag | con-agente-2pag | sin-agente-1pag | sin-agente-2pag
import { Router } from 'express';
import { requireSession } from '../middleware/auth.js';
import { getSupabase } from '../lib/supabase.js';
import { buildPropertyPDF } from '../lib/pdf.js';
import { loadBrand, loadAgents, getPropertyById } from '../lib/public-data.js';

const r = Router();

const VERSIONS = new Set(['con-agente-1pag', 'con-agente-2pag', 'sin-agente-1pag', 'sin-agente-2pag']);

function parseVersion(s) {
  const v = VERSIONS.has(s) ? s : 'con-agente-1pag';
  return {
    withAgent: v.startsWith('con-agente'),
    twoPages: v.endsWith('2pag'),
    version: v,
  };
}

function safeFileName(s, fallback = 'propiedad') {
  return (String(s || fallback).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '') || fallback).toLowerCase();
}

// ---------------------------------------------------------------------
// GET /api/pdf/:propertyId  (requiere sesión panel)
// ---------------------------------------------------------------------
r.get('/:propertyId', requireSession, async (req, res, next) => {
  try {
    const { propertyId } = req.params;
    const opts = parseVersion(req.query.version);

    const [record, brand, agents] = await Promise.all([
      getPropertyById(req.tenant.id, propertyId),
      loadBrand(req.tenant.id),
      loadAgents(req.tenant.id),
    ]);
    if (!record) return res.status(404).json({ error: 'property_not_found' });

    const agent = agents[record.properties?.agente_responsable] || null;
    // Para "con-agente" usamos el portal del agente; para "sin-agente"
    // generamos un fichaId al vuelo si no existe (opcional).
    let baseUrl = null;
    if (!opts.withAgent) {
      const fichaUrl = await ensureFichaForProperty(req.tenant.id, propertyId);
      baseUrl = fichaUrl
        ? `https://ficha.${process.env.APP_DOMAIN || 'mktscaled.com'}/${fichaUrl}`
        : null;
    }

    const doc = await buildPropertyPDF({
      record, brand, agent,
      withAgent: opts.withAgent, twoPages: opts.twoPages,
      baseUrl,
    });

    const filename = `${safeFileName(record.properties?.slug_url || record.properties?.titulo)}-${opts.version}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    doc.pipe(res);
    doc.end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// GET /api/pdf/ficha/:fichaId  (público, descarga desde URL orgánica)
// Siempre "sin-agente". `pages` opcional para 1 o 2 páginas.
// ---------------------------------------------------------------------
r.get('/ficha/:fichaId', async (req, res, next) => {
  try {
    const sb = getSupabase();
    const { data: ficha } = await sb
      .from('fichas_url')
      .select('property_id, tenant_id, activa, expira_en')
      .eq('id', req.params.fichaId)
      .maybeSingle();
    if (!ficha || !ficha.activa) return res.status(404).json({ error: 'ficha_not_found' });
    if (ficha.expira_en && new Date(ficha.expira_en).getTime() < Date.now()) {
      return res.status(410).json({ error: 'ficha_expired' });
    }
    const twoPages = req.query.pages === '2';
    const [record, brand] = await Promise.all([
      getPropertyById(ficha.tenant_id, ficha.property_id),
      loadBrand(ficha.tenant_id),
    ]);
    if (!record) return res.status(404).json({ error: 'property_not_found' });

    const baseUrl = `https://ficha.${process.env.APP_DOMAIN || 'mktscaled.com'}/${req.params.fichaId}`;
    const doc = await buildPropertyPDF({
      record, brand, agent: null,
      withAgent: false, twoPages,
      baseUrl,
    });

    const filename = `${safeFileName(record.properties?.slug_url || record.properties?.titulo)}-ficha.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    doc.pipe(res);
    doc.end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// Helper: si la propiedad no tiene ficha_url, generamos una "permanente"
// (sin expiración) — el agente puede listar/desactivar después en Paso 13.
// ---------------------------------------------------------------------
async function ensureFichaForProperty(tenantId, propertyId) {
  const sb = getSupabase();
  const { data: existing } = await sb
    .from('fichas_url')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('property_id', propertyId)
    .eq('activa', true)
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id;
  // Generamos un ID corto base62 (~6 chars, suficiente colision-free para Fase 1)
  const id = generateShortId(6);
  const { error } = await sb.from('fichas_url').insert({
    id, tenant_id: tenantId, property_id: propertyId, activa: true, vistas: 0,
  });
  return error ? null : id;
}

function generateShortId(len = 6) {
  const alph = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += alph[Math.floor(Math.random() * alph.length)];
  return s;
}

export default r;
