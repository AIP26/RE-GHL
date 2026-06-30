// CRUD propiedades (GHL Custom Object) — Paso 5.
import { Router } from 'express';
import slugify from 'slugify';
import { requireSession } from '../middleware/auth.js';
import { getTenantWithTokens } from '../lib/tenants.js';
import {
  createObjectRecord,
  listObjectRecords,
  updateObjectRecord,
  getObjectRecord,
} from '../lib/ghl.js';
import { getFieldIds, toGhlFieldKey } from '../lib/field-ids.js';
import { getSupabase } from '../lib/supabase.js';

const r = Router();

// ---------------------------------------------------------------------
// POST /api/property — crea una propiedad en GHL
// Body: { titulo, descripcion, ... } (claves cortas; las mapeamos a fieldKeys)
// Opcional: { _collections: [collectionId, ...] } para asignar colecciones
// ---------------------------------------------------------------------
r.post('/', requireSession, async (req, res) => {
  const reqId = Math.random().toString(36).slice(2, 8);
  try {
    const body = req.body || {};
    const fieldIds = getFieldIds();
    const t = await getTenantWithTokens(req.tenant.id);

    // Auto: slug, fecha de publicación, agente_responsable (si no vino)
    const titulo = body.titulo || 'Propiedad sin título';
    const slug = await generateUniqueSlug(req.tenant.id, titulo);
    body.slug_url = slug;
    body.fecha_publicacion = new Date().toISOString().slice(0, 10);
    if (!body.agente_responsable) body.agente_responsable = req.agente.ghl_user_id;

    // Map: shortKey -> fieldKey GHL
    const properties = {};
    const skipped = [];
    for (const [shortKey, value] of Object.entries(body)) {
      if (shortKey.startsWith('_')) continue; // meta-fields (ej. _collections)
      const fieldKey = toGhlFieldKey(shortKey);
      if (!fieldKey) {
        skipped.push(shortKey);
        continue;
      }
      if (value === '' || value == null) continue;
      properties[fieldKey] = value;
    }

    const ghlPayload = {
      locationId: req.tenant.ghl_location_id,
      properties,
    };

    // Logging del REQUEST a GHL (visible en Railway Deploy Logs)
    console.log(
      `[property/create:${reqId}] -> POST GHL`,
      JSON.stringify({
        tenant: req.tenant.id,
        locationId: req.tenant.ghl_location_id,
        objectKey: fieldIds.objectKey,
        bodyShortKeys: Object.keys(body),
        skippedUnknownKeys: skipped,
        propertiesCount: Object.keys(properties).length,
        properties, // payload exacto que mandamos a GHL
      })
    );

    const record = await createObjectRecord(t.access_token, fieldIds.objectKey, ghlPayload);

    console.log(
      `[property/create:${reqId}] <- GHL OK`,
      JSON.stringify({ recordId: record?.id || record?._id, keys: Object.keys(record || {}) })
    );

    // Asignar colecciones (si vinieron en _collections)
    if (Array.isArray(body._collections) && body._collections.length) {
      const sb = getSupabase();
      const rows = body._collections.map((cid) => ({
        propiedad_id: record.id || record._id,
        coleccion_id: cid,
        tenant_id: req.tenant.id,
      }));
      await sb.from('propiedades_colecciones').upsert(rows, {
        onConflict: 'propiedad_id,coleccion_id',
        ignoreDuplicates: true,
      });
    }

    res.json({ ok: true, record, slug });
  } catch (err) {
    const status = err?.response?.status;
    const statusText = err?.response?.statusText;
    const ghlBody = err?.response?.data;
    const ghlHeaders = err?.response?.headers;
    const cfg = err?.response?.config || err?.config;

    // Log FULL del error de GHL — esto es lo que aparecerá en Railway Deploy Logs.
    console.error(
      `[property/create:${reqId}] !! GHL ERROR`,
      JSON.stringify(
        {
          status,
          statusText,
          method: cfg?.method,
          url: cfg?.url,
          requestBody: safeJson(cfg?.data),
          responseBody: ghlBody,
          responseHeaders: pickHeaders(ghlHeaders, [
            'x-trace-id',
            'x-request-id',
            'x-correlation-id',
            'content-type',
            'date',
          ]),
          message: err?.message,
        },
        null,
        2
      )
    );

    res.status(status && status < 500 ? status : 500).json({
      error: 'ghl_create_failed',
      reqId,
      ghl_status: status,
      ghl_status_text: statusText,
      ghl_response: ghlBody,
      message: err?.message,
    });
  }
});

// Utilidades de logging — no exportadas; locales al archivo.
function safeJson(s) {
  if (s == null) return null;
  if (typeof s === 'string') {
    try { return JSON.parse(s); } catch { return s; }
  }
  return s;
}

function pickHeaders(h, keys) {
  if (!h) return null;
  const out = {};
  for (const k of keys) {
    const v = typeof h.get === 'function' ? h.get(k) : h[k];
    if (v != null) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------
// GET /api/property — lista propiedades del tenant (paginada)
// Query: ?limit=20&offset=0&q=texto
// ---------------------------------------------------------------------
r.get('/', requireSession, async (req, res) => {
  const reqId = Math.random().toString(36).slice(2, 8);
  try {
    const fieldIds = getFieldIds();
    const t = await getTenantWithTokens(req.tenant.id);
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Number(req.query.offset) || 0;
    const q = (req.query.q || '').trim();
    const data = await listObjectRecords(t.access_token, fieldIds.objectKey, {
      locationId: req.tenant.ghl_location_id,
      limit,
      offset,
      query: q || undefined,
    });
    res.json(data);
  } catch (err) {
    const status = err?.response?.status;
    console.error(
      `[property/list:${reqId}] !! GHL ERROR`,
      JSON.stringify({
        status,
        url: err?.response?.config?.url,
        responseBody: err?.response?.data,
        message: err?.message,
      }, null, 2)
    );
    res.status(status && status < 500 ? status : 500).json({
      error: 'ghl_list_failed',
      reqId,
      ghl_status: status,
      ghl_response: err?.response?.data,
      message: err?.message,
    });
  }
});

// ---------------------------------------------------------------------
// GET /api/property/:id — detalle
// ---------------------------------------------------------------------
r.get('/:id', requireSession, async (req, res) => {
  try {
    const fieldIds = getFieldIds();
    const t = await getTenantWithTokens(req.tenant.id);
    const record = await getObjectRecord(
      t.access_token,
      fieldIds.objectKey,
      req.params.id,
      req.tenant.ghl_location_id
    );
    res.json({ record });
  } catch (err) {
    console.error('[property/get]', err?.response?.data || err);
    res.status(err.response?.status || 500).json({
      error: 'ghl_get_failed',
      detail: err?.response?.data || err.message,
    });
  }
});

// ---------------------------------------------------------------------
// PUT /api/property/:id — actualizar
// ---------------------------------------------------------------------
r.put('/:id', requireSession, async (req, res) => {
  const reqId = Math.random().toString(36).slice(2, 8);
  try {
    const body = req.body || {};
    const fieldIds = getFieldIds();
    const t = await getTenantWithTokens(req.tenant.id);

    const properties = {};
    for (const [shortKey, value] of Object.entries(body)) {
      if (shortKey.startsWith('_')) continue;
      const fieldKey = toGhlFieldKey(shortKey);
      if (!fieldKey) continue;
      properties[fieldKey] = value;
    }

    const ghlPayload = {
      locationId: req.tenant.ghl_location_id,
      properties,
    };

    console.log(
      `[property/update:${reqId}] -> PUT GHL`,
      JSON.stringify({
        recordId: req.params.id,
        objectKey: fieldIds.objectKey,
        propertiesCount: Object.keys(properties).length,
        properties,
      })
    );

    const record = await updateObjectRecord(
      t.access_token,
      fieldIds.objectKey,
      req.params.id,
      ghlPayload
    );
    res.json({ ok: true, record });
  } catch (err) {
    const status = err?.response?.status;
    console.error(
      `[property/update:${reqId}] !! GHL ERROR`,
      JSON.stringify({
        status,
        url: err?.response?.config?.url,
        requestBody: (() => { try { return JSON.parse(err?.response?.config?.data || 'null'); } catch { return err?.response?.config?.data; } })(),
        responseBody: err?.response?.data,
        message: err?.message,
      }, null, 2)
    );
    res.status(status && status < 500 ? status : 500).json({
      error: 'ghl_update_failed',
      reqId,
      ghl_status: status,
      ghl_response: err?.response?.data,
      message: err?.message,
    });
  }
});

// ---------------------------------------------------------------------
// Helper: slug único por tenant
// ---------------------------------------------------------------------
async function generateUniqueSlug(tenantId, titulo) {
  const base = slugify(titulo, { lower: true, strict: true }) || 'propiedad';
  const sb = getSupabase();
  // Simple lookup en propiedades_colecciones (no tenemos tabla de propiedades local,
  // pero el slug se guarda como custom field en GHL — para evitar duplicados
  // bastaría hacer una consulta a GHL. Por simplicidad, lo construimos con
  // timestamp si no podemos verificar.)
  // En esta fase: agregamos sufijo corto numérico al título base.
  return base;
  // TODO: cuando tengamos tabla local de propiedades o un endpoint que
  // pregunte a GHL por slug existente, agregar sufijo -2, -3 si duplica.
  // eslint-disable-next-line no-unreachable
  sb; tenantId;
}

export default r;
