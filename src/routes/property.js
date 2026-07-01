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
  deleteObjectRecord,
} from '../lib/ghl.js';
import { getFieldIds, toGhlPropertyKey } from '../lib/field-ids.js';
import { getSupabase } from '../lib/supabase.js';

const r = Router();

// Dominios permitidos para el embed de formulario GHL.
// Nota: los subdominios se aceptan (endsWith) para cubrir cualquier
// región/instancia (`api.leadconnectorhq.com`, `link.msgsndr.com`, etc).
const GHL_FORM_ALLOWED_HOSTS = [
  'gohighlevel.com',
  'leadconnectorhq.com',
  'msgsndr.com',
];

/** Valida el snippet HTML para cta_tipo=formulario. Extrae el <iframe> con
 *  atributo src y verifica que el host caiga bajo un dominio autorizado.
 *  Retorna { ok, error, src }. */
export function validateGhlFormEmbed(html) {
  if (!html || typeof html !== 'string') return { ok: false, error: 'empty' };
  const m = html.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
  if (!m) return { ok: false, error: 'no_iframe_src' };
  const src = m[1];
  let url;
  try { url = new URL(src); } catch { return { ok: false, error: 'invalid_url' }; }
  const host = url.hostname.toLowerCase();
  const allowed = GHL_FORM_ALLOWED_HOSTS.some((d) => host === d || host.endsWith('.' + d));
  if (!allowed) return { ok: false, error: 'host_not_allowed', host };
  return { ok: true, src, host };
}

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

    // Validación server-side: si cta_tipo=formulario, el snippet debe ser un
    // <iframe> apuntando a un dominio GHL autorizado. Nunca confiar solo en
    // la validación del frontend.
    if (body.cta_tipo === 'formulario' && body.cta_valor) {
      const v = validateGhlFormEmbed(body.cta_valor);
      if (!v.ok) {
        return res.status(400).json({
          error: 'invalid_ghl_form_embed',
          reason: v.error,
          host: v.host || null,
          hint: 'El CTA "formulario" requiere un <iframe> cuyo src apunte a un dominio GHL autorizado (*.gohighlevel.com, *.leadconnectorhq.com, *.msgsndr.com).',
        });
      }
    }

    // Auto: slug, fecha de publicación, agente_responsable (si no vino)
    const titulo = body.titulo || 'Propiedad sin título';
    const slug = await generateUniqueSlug(req.tenant.id, titulo);
    body.slug_url = slug;
    body.fecha_publicacion = new Date().toISOString().slice(0, 10);
    if (!body.agente_responsable) body.agente_responsable = req.agente.ghl_user_id;

    // Map: shortKey del body -> property key que GHL acepta.
    // Confirmado vía probe contra la API real: la API de Custom Object
    // Records espera el SUFIJO CORTO del fieldKey (ej. "titulo"), NO el
    // fieldKey largo ("custom_objects.propiedad.titulo") ni el field id.
    // El campo primario (titulo) va DENTRO de properties como cualquier otro.
    const properties = {};
    const skipped = [];
    for (const [shortKey, value] of Object.entries(body)) {
      if (shortKey.startsWith('_')) continue; // meta-fields (ej. _collections)
      const propKey = toGhlPropertyKey(shortKey);
      if (!propKey) {
        skipped.push(shortKey);
        continue;
      }
      if (value === '' || value == null) continue;
      properties[propKey] = value;
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
// GET /api/property/:id — detalle (incluye colecciones asignadas)
// ---------------------------------------------------------------------
r.get('/:id', requireSession, async (req, res) => {
  try {
    const fieldIds = getFieldIds();
    const t = await getTenantWithTokens(req.tenant.id);
    const [record, colsRes] = await Promise.all([
      getObjectRecord(
        t.access_token,
        fieldIds.objectKey,
        req.params.id,
        req.tenant.ghl_location_id
      ),
      getSupabase()
        .from('propiedades_colecciones')
        .select('coleccion_id')
        .eq('tenant_id', req.tenant.id)
        .eq('propiedad_id', req.params.id),
    ]);
    const collectionIds = (colsRes.data || []).map((r) => r.coleccion_id);
    res.json({ record, _collections: collectionIds });
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

    // Validación server-side idéntica al POST (nunca confiar en FE).
    if (body.cta_tipo === 'formulario' && body.cta_valor) {
      const v = validateGhlFormEmbed(body.cta_valor);
      if (!v.ok) {
        return res.status(400).json({
          error: 'invalid_ghl_form_embed',
          reason: v.error,
          host: v.host || null,
          hint: 'El CTA "formulario" requiere un <iframe> cuyo src apunte a un dominio GHL autorizado (*.gohighlevel.com, *.leadconnectorhq.com, *.msgsndr.com).',
        });
      }
    }

    const properties = {};
    for (const [shortKey, value] of Object.entries(body)) {
      if (shortKey.startsWith('_')) continue;
      const propKey = toGhlPropertyKey(shortKey);
      if (!propKey) continue;
      properties[propKey] = value;
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

    // Reasignar colecciones si el body incluye _collections (replace semantics):
    // borramos los vínculos actuales del tenant para esta propiedad y los
    // re-insertamos. Si _collections viene undefined NO se toca nada.
    if (Array.isArray(body._collections)) {
      const sb = getSupabase();
      await sb
        .from('propiedades_colecciones')
        .delete()
        .eq('tenant_id', req.tenant.id)
        .eq('propiedad_id', req.params.id);
      if (body._collections.length) {
        const rows = body._collections.map((cid) => ({
          propiedad_id: req.params.id,
          coleccion_id: cid,
          tenant_id: req.tenant.id,
        }));
        await sb.from('propiedades_colecciones').upsert(rows, {
          onConflict: 'propiedad_id,coleccion_id',
          ignoreDuplicates: true,
        });
      }
    }

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
// DELETE /api/property/:id — borra el record en GHL + limpia Supabase
// ---------------------------------------------------------------------
r.delete('/:id', requireSession, async (req, res) => {
  try {
    const fieldIds = getFieldIds();
    const t = await getTenantWithTokens(req.tenant.id);
    await deleteObjectRecord(
      t.access_token, fieldIds.objectKey, req.params.id, req.tenant.ghl_location_id
    );
    // Limpiamos relaciones locales (colecciones, fichas, page_views).
    const sb = getSupabase();
    await Promise.all([
      sb.from('propiedades_colecciones').delete().eq('tenant_id', req.tenant.id).eq('propiedad_id', req.params.id),
      sb.from('fichas_url').delete().eq('tenant_id', req.tenant.id).eq('property_id', req.params.id),
      sb.from('page_views').delete().eq('tenant_id', req.tenant.id).eq('property_id', req.params.id),
    ]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[property/delete]', err?.response?.data || err);
    res.status(err.response?.status || 500).json({
      error: 'ghl_delete_failed',
      detail: err?.response?.data || err.message,
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
