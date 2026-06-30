// Helpers de fetching para el portal público (Paso 9).
// Centraliza llamadas a GHL Custom Object Records + Supabase para que los
// handlers de public.js queden cortos.
import { getSupabase } from './supabase.js';
import { getTenantWithTokens } from './tenants.js';
import { listObjectRecords, getObjectRecord } from './ghl.js';
import { getFieldIds } from './field-ids.js';

const PAGE_LIMIT = 50; // tope por llamada a GHL search

/** Carga marca + datos de contacto + dominios del tenant. Devuelve null si no existe. */
export async function loadBrand(tenantId) {
  const sb = getSupabase();
  const [{ data: brand }, { data: dom }] = await Promise.all([
    sb.from('configuracion_marca').select('*').eq('tenant_id', tenantId).maybeSingle(),
    sb.from('dominios').select('subdominio').eq('tenant_id', tenantId).maybeSingle(),
  ]);
  return {
    ...(brand || {}),
    tenant_id: tenantId,
    subdominio: dom?.subdominio || null,
    asociaciones: brand?.asociaciones || [],
  };
}

/** Carga los agentes activos del tenant indexados por ghl_user_id. */
export async function loadAgents(tenantId) {
  const sb = getSupabase();
  const { data } = await sb
    .from('agentes')
    .select('ghl_user_id, nombre, telefono, whatsapp, email, foto_url, rol')
    .eq('tenant_id', tenantId)
    .eq('activo', true);
  const byUserId = {};
  for (const a of data || []) byUserId[a.ghl_user_id] = a;
  return byUserId;
}

/** Lista propiedades del tenant desde GHL (multi-página simple, hasta 200). */
export async function listProperties(tenantId, { limit = 50, query = '' } = {}) {
  const t = await getTenantWithTokens(tenantId);
  const fieldIds = getFieldIds();
  const { records } = await listObjectRecords(t.access_token, fieldIds.objectKey, {
    locationId: t.ghl_location_id,
    limit: Math.min(limit, PAGE_LIMIT),
    offset: 0,
    query,
  }).then((d) => ({ records: d?.records || d?.data || [] }));
  // Sólo propiedades disponibles, recientes primero (created_at descendente).
  const visible = records.filter((r) => {
    const estado = r?.properties?.estado || 'Disponible';
    return estado === 'Disponible' || estado === 'disponible';
  });
  return visible;
}

/** Obtiene una propiedad por GHL record ID (para URL orgánica). */
export async function getPropertyById(tenantId, propertyId) {
  const t = await getTenantWithTokens(tenantId);
  const fieldIds = getFieldIds();
  return getObjectRecord(t.access_token, fieldIds.objectKey, propertyId, t.ghl_location_id);
}

/** Encuentra una propiedad por slug. Busca con `query=slug` en GHL y filtra
 *  client-side por coincidencia exacta del campo slug_url. */
export async function findPropertyBySlug(tenantId, slug) {
  const t = await getTenantWithTokens(tenantId);
  const fieldIds = getFieldIds();
  // Primero intento con query=slug (más rápido si GHL lo indexa). Si no
  // matchea exacto, hago un listado más amplio y filtro.
  const tryQuery = async (q) => {
    const d = await listObjectRecords(t.access_token, fieldIds.objectKey, {
      locationId: t.ghl_location_id,
      limit: 50,
      offset: 0,
      query: q,
    });
    return d?.records || d?.data || [];
  };
  let candidates = await tryQuery(slug);
  let match = candidates.find((r) => r?.properties?.slug_url === slug);
  if (!match) {
    candidates = await tryQuery('');
    match = candidates.find((r) => r?.properties?.slug_url === slug);
  }
  return match || null;
}

/** Obtiene los propiedad_ids de una colección por slug. */
export async function loadCollectionWithIds(tenantId, slug) {
  const sb = getSupabase();
  const { data: col } = await sb
    .from('colecciones')
    .select('id, nombre, slug, foto_url')
    .eq('tenant_id', tenantId)
    .eq('slug', slug)
    .maybeSingle();
  if (!col) return null;
  const { data: rels } = await sb
    .from('propiedades_colecciones')
    .select('propiedad_id')
    .eq('tenant_id', tenantId)
    .eq('coleccion_id', col.id);
  return { ...col, propiedadIds: (rels || []).map((r) => r.propiedad_id) };
}

/** Filtros + paginación in-memory (cantidad de propiedades en Fase 1 es chica) */
export function applyFilters(records, filters = {}) {
  const {
    operacion, tipo, q, precio_min, precio_max, recamaras,
    onlyIds, // array de IDs si viene de colección
  } = filters;

  return records.filter((r) => {
    const p = r?.properties || {};
    if (onlyIds && !onlyIds.includes(r.id)) return false;
    if (operacion && (p.tipo_operacion || '').toLowerCase() !== operacion.toLowerCase()) return false;
    if (tipo && (p.tipo_inmueble || '').toLowerCase() !== tipo.toLowerCase()) return false;
    if (recamaras && Number(p.recamaras || 0) < Number(recamaras)) return false;
    if (precio_min && Number(p.precio_usd || 0) < Number(precio_min)) return false;
    if (precio_max && Number(p.precio_usd || 0) > Number(precio_max)) return false;
    if (q) {
      const text = [p.titulo, p.descripcion, p.colonia, p.ciudad, p.tipo_inmueble, p.tipo_operacion].join(' ').toLowerCase();
      if (!text.includes(q.toLowerCase())) return false;
    }
    return true;
  });
}

/** Ordena destacadas primero, luego recientes (created_at descendente). */
export function sortFeaturedFirst(records) {
  return [...records].sort((a, b) => {
    const aFav = (a?.properties?.etiqueta === 'Destacada') ? 1 : 0;
    const bFav = (b?.properties?.etiqueta === 'Destacada') ? 1 : 0;
    if (aFav !== bFav) return bFav - aFav;
    // por dateAdded / createdAt si están disponibles
    const aD = new Date(a?.dateAdded || a?.createdAt || 0).getTime();
    const bD = new Date(b?.dateAdded || b?.createdAt || 0).getTime();
    return bD - aD;
  });
}

/** Inserta un page_view (best-effort, no bloquea el response). */
export function recordPageView(tenantId, propertyId, source = 'portal') {
  const sb = getSupabase();
  // Fire-and-forget
  sb.from('page_views').insert({ tenant_id: tenantId, property_id: propertyId, source })
    .then(({ error }) => {
      if (error) console.warn('[page_view]', error.message);
    });
}
