// API pública v1 — Paso 14.
// Autenticación: header `X-API-Key` o `Authorization: Bearer <key>`.
// El key plain solo se devuelve al crearlo (CRUD admin via /api/apikeys);
// almacenamos sólo el SHA-256 hash.
//
// Endpoints expuestos:
//   GET /api/v1/properties
//   GET /api/v1/properties/:id
//   GET /api/v1/properties?collection=:slug
//   GET /api/v1/collections
//   GET /api/v1/docs
import { Router } from 'express';
import crypto from 'node:crypto';
import { getSupabase } from '../lib/supabase.js';
import {
  loadBrand, loadAgents, listProperties, getPropertyById, loadCollectionWithIds,
} from '../lib/public-data.js';
import { parsePhotos } from '../lib/render.js';

const r = Router();

// ---------------------------------------------------------------------
// Middleware: autenticación API key
// ---------------------------------------------------------------------
function hashKey(plain) {
  return crypto.createHash('sha256').update(plain).digest('hex');
}

async function requireApiKey(req, res, next) {
  let key = req.headers['x-api-key'];
  if (!key) {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) key = auth.slice(7);
  }
  if (!key) {
    return res.status(401).json({ error: 'api_key_required', hint: 'Send header X-API-Key: <your-key>' });
  }
  const sb = getSupabase();
  const { data, error } = await sb
    .from('api_keys')
    .select('id, tenant_id, activa')
    .eq('key_hash', hashKey(String(key)))
    .eq('activa', true)
    .maybeSingle();
  if (error || !data) {
    return res.status(401).json({ error: 'invalid_api_key' });
  }
  req.apiTenantId = data.tenant_id;
  req.apiKeyId = data.id;
  // best-effort update last_used_at
  sb.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => {});
  next();
}

// ---------------------------------------------------------------------
// Sanitización del shape público — no exponer raw GHL
// ---------------------------------------------------------------------
function shapeProperty(record) {
  const p = record?.properties || {};
  return {
    id: record.id,
    slug: p.slug_url || null,
    titulo: p.titulo || null,
    descripcion: p.descripcion || null,
    operacion: p.tipo_operacion || null,
    tipo: p.tipo_inmueble || null,
    estado: p.estado || null,
    etiqueta: p.etiqueta || null,
    precio_usd: p.precio_usd != null ? Number(p.precio_usd) : null,
    precio_mxn: p.precio_mxn != null ? Number(p.precio_mxn) : null,
    // Campos nuevos canónicos (USD/MXN/CAD). Si una propiedad usa CAD,
    // `precio_usd`/`precio_mxn` serán null y aquí estará el monto real.
    precio_principal: p.precio_principal != null ? Number(p.precio_principal) : null,
    moneda_principal: p.moneda_principal ? String(p.moneda_principal).toUpperCase() : null,
    precio_secundario: p.precio_secundario != null ? Number(p.precio_secundario) : null,
    moneda_secundaria: p.moneda_secundaria ? String(p.moneda_secundaria).toUpperCase() : null,
    precio_a_consultar: !!p.precio_a_consultar,
    ubicacion: {
      colonia: p.colonia || null,
      ciudad: p.ciudad || null,
      estado: p.estado_municipio || null,
      codigo_postal: p.codigo_postal || null,
      latitud: p.latitud != null ? Number(p.latitud) : null,
      longitud: p.longitud != null ? Number(p.longitud) : null,
    },
    medidas: {
      m2_construccion: p.m2_construccion != null ? Number(p.m2_construccion) : null,
      m2_terreno: p.m2_terreno != null ? Number(p.m2_terreno) : null,
      recamaras: p.recamaras != null ? Number(p.recamaras) : null,
      banos_completos: p.banos_completos != null ? Number(p.banos_completos) : null,
      medios_banos: p.medios_banos != null ? Number(p.medios_banos) : null,
      estacionamientos: p.estacionamientos != null ? Number(p.estacionamientos) : null,
    },
    amenidades: (p.amenidades || '').split(',').map((s) => s.trim()).filter(Boolean),
    fotos: parsePhotos(p.fotos_urls),
    video_url: p.video_url || null,
    tour_virtual_url: p.tour_virtual_url || null,
    agente_id: p.agente_responsable || null,
    fecha_publicacion: p.fecha_publicacion || null,
  };
}

// ---------------------------------------------------------------------
// Routes (todas requieren API key salvo /docs)
// ---------------------------------------------------------------------

// GET /api/v1/docs (sin auth — documentación pública)
r.get('/docs', (req, res) => {
  const host = req.headers.host;
  const baseUrl = `${req.protocol}://${host}`;
  res.type('text/markdown').send(`# API pública v1 — mktscaled

Base URL: \`${baseUrl}/api/v1\`

## Autenticación

Todas las peticiones (salvo \`/docs\`) requieren API key vía:

\`\`\`
X-API-Key: mks_abc123…
\`\`\`

o vía Authorization Bearer:

\`\`\`
Authorization: Bearer mks_abc123…
\`\`\`

Cada API key está vinculada a un tenant. Generá la tuya en el panel
GHL → Configuración → API.

## Endpoints

### GET /properties
Lista de propiedades disponibles del tenant.

Query params:
- \`limit\` (default 50, max 50)
- \`collection\` (slug) — filtra por colección
- \`operacion\` (Venta | Renta)
- \`tipo\` (Casa | Departamento | …)
- \`q\` (texto libre)

\`\`\`bash
curl -H "X-API-Key: $KEY" "${baseUrl}/api/v1/properties?limit=20&tipo=Casa"
\`\`\`

### GET /properties/:id
Detalle de una propiedad por GHL record ID.

\`\`\`bash
curl -H "X-API-Key: $KEY" "${baseUrl}/api/v1/properties/6a431a1df7d1f2b4480b5374"
\`\`\`

### GET /collections
Lista de colecciones del tenant.

\`\`\`bash
curl -H "X-API-Key: $KEY" "${baseUrl}/api/v1/collections"
\`\`\`

## Shape de respuesta

\`\`\`json
{
  "data": [
    {
      "id": "6a431a1df7d1f2b4480b5374",
      "slug": "casa-zona-hotelera",
      "titulo": "Casa Zona Hotelera 3 recámaras",
      "operacion": "venta",
      "tipo": "casa",
      "estado": "disponible",
      "precio_usd": 450000,
      "precio_mxn": null,
      "precio_a_consultar": false,
      "ubicacion": { "colonia": "...", "ciudad": "Cancún", "latitud": 21.16, "longitud": -86.85 },
      "medidas": { "recamaras": 3, "banos_completos": 3, "m2_construccion": 220, "estacionamientos": 2 },
      "amenidades": ["Alberca", "Vigilancia 24h"],
      "fotos": ["https://res.cloudinary.com/.../1.webp", "..."],
      "agente_id": "ghl_user_id_aqui"
    }
  ],
  "count": 1
}
\`\`\`

## Limits & errors

- \`401 api_key_required\` — falta el header
- \`401 invalid_api_key\` — key no existe o está desactivada
- \`404 not_found\` — id de propiedad / slug de colección no existe
- Rate limit: no hay en Fase 1 (se agregará en Fase 2 si se abusa)
`);
});

// Guard global a partir de acá
r.use(requireApiKey);

// GET /api/v1/properties
r.get('/properties', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 50);
    let records = await listProperties(req.apiTenantId, { limit, query: req.query.q || '' });

    if (req.query.collection) {
      const col = await loadCollectionWithIds(req.apiTenantId, String(req.query.collection));
      if (!col) return res.json({ data: [], count: 0 });
      records = records.filter((rec) => col.propiedadIds.includes(rec.id));
    }
    if (req.query.operacion) {
      const op = String(req.query.operacion).toLowerCase();
      records = records.filter((r) => String(r.properties?.tipo_operacion || '').toLowerCase() === op);
    }
    if (req.query.tipo) {
      const t = String(req.query.tipo).toLowerCase();
      records = records.filter((r) => String(r.properties?.tipo_inmueble || '').toLowerCase() === t);
    }

    res.json({ data: records.map(shapeProperty), count: records.length });
  } catch (err) { next(err); }
});

// GET /api/v1/properties/:id
r.get('/properties/:id', async (req, res, next) => {
  try {
    const record = await getPropertyById(req.apiTenantId, req.params.id);
    if (!record) return res.status(404).json({ error: 'not_found' });
    res.json({ data: shapeProperty(record) });
  } catch (err) {
    if (err.response?.status === 404) return res.status(404).json({ error: 'not_found' });
    next(err);
  }
});

// GET /api/v1/collections
r.get('/collections', async (req, res) => {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('colecciones')
    .select('id, nombre, slug, foto_url, created_at')
    .eq('tenant_id', req.apiTenantId)
    .order('nombre');
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });
  res.json({ data, count: (data || []).length });
});

export default r;
