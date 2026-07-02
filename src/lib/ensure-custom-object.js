// Provisiona el Custom Object "Propiedad" en una location de GHL.
// Extraído de scripts/step-4-create-custom-object.js para poder invocarlo
// automáticamente desde el webhook de INSTALL y desde el SSO on-demand
// (Bloque P0 FIX 7).
//
// Idempotente: si el schema o algún campo ya existe, lo skipea.
// NO escribe /app/ghl-field-ids.json (ese es un dump de dev/CI, no aplica
// en runtime — el runtime lee los shortKeys y GHL los resuelve por locationId).
//
// Devuelve { objectKey, created, skipped, failed } con contadores.

import {
  createCustomObjectSchema,
  getCustomObjectByKey,
  listCustomFieldsForObject,
  createCustomField,
} from './ghl.js';

const OBJECT_KEY_RAW = 'propiedad';
const OBJECT_FULL_KEY = `custom_objects.${OBJECT_KEY_RAW}`;
const OBJECT_FULL_KEY_ALT = `custom_object.${OBJECT_KEY_RAW}`;

// Definición de campos — idéntica a step-4 pero sin `cuarto_servicio` ni
// `aire_acondicionado` (movidos a Amenidades en Bloque P0 FIX 1).
const FIELDS = [
  { fieldKey: 'titulo',              name: 'Título',                    dataType: 'TEXT' },
  { fieldKey: 'descripcion',         name: 'Descripción',               dataType: 'LARGE_TEXT' },
  { fieldKey: 'tipo_operacion',      name: 'Tipo de operación',         dataType: 'SINGLE_OPTIONS', options: ['Venta', 'Renta'] },
  { fieldKey: 'tipo_inmueble',       name: 'Tipo de inmueble',          dataType: 'SINGLE_OPTIONS', options: ['Casa','Departamento','Local','Terreno','Oficina','Bodega','Villa','Penthouse'] },
  { fieldKey: 'etiqueta',            name: 'Etiqueta',                  dataType: 'SINGLE_OPTIONS', options: ['Destacada','Nueva','Oportunidad','Preventa','Remate'] },
  { fieldKey: 'estado',              name: 'Estado',                    dataType: 'SINGLE_OPTIONS', options: ['Disponible','Reservado','Vendido','Pausado'] },
  { fieldKey: 'precio_principal',    name: 'Precio principal',          dataType: 'NUMERICAL' },
  { fieldKey: 'moneda_principal',    name: 'Moneda principal',          dataType: 'SINGLE_OPTIONS', options: ['USD','MXN','CAD'] },
  { fieldKey: 'precio_secundario',   name: 'Precio secundario',         dataType: 'NUMERICAL' },
  { fieldKey: 'moneda_secundaria',   name: 'Moneda secundaria',         dataType: 'SINGLE_OPTIONS', options: ['USD','MXN','CAD'] },
  { fieldKey: 'precio_usd',          name: 'Precio USD (legacy)',       dataType: 'NUMERICAL' },
  { fieldKey: 'precio_mxn',          name: 'Precio MXN (legacy)',       dataType: 'NUMERICAL' },
  { fieldKey: 'precio_a_consultar',  name: 'Precio a consultar',        dataType: 'CHECKBOX', options: ['Sí'] },
  { fieldKey: 'direccion',           name: 'Dirección',                 dataType: 'TEXT' },
  { fieldKey: 'colonia',             name: 'Colonia',                   dataType: 'TEXT' },
  { fieldKey: 'ciudad',              name: 'Ciudad',                    dataType: 'TEXT' },
  { fieldKey: 'estado_municipio',    name: 'Estado / Municipio',        dataType: 'TEXT' },
  { fieldKey: 'codigo_postal',       name: 'Código postal',             dataType: 'TEXT' },
  { fieldKey: 'latitud',             name: 'Latitud',                   dataType: 'NUMERICAL' },
  { fieldKey: 'longitud',            name: 'Longitud',                  dataType: 'NUMERICAL' },
  { fieldKey: 'ocultar_direccion_exacta', name: 'Ocultar dirección exacta', dataType: 'CHECKBOX', options: ['Sí'] },
  { fieldKey: 'area_construida',     name: 'Área construida (m²)',      dataType: 'NUMERICAL' },
  { fieldKey: 'area_terreno',        name: 'Área terreno (m²)',         dataType: 'NUMERICAL' },
  { fieldKey: 'recamaras',           name: 'Recámaras',                 dataType: 'NUMERICAL' },
  { fieldKey: 'banos_completos',     name: 'Baños completos',           dataType: 'NUMERICAL' },
  { fieldKey: 'medios_banos',        name: 'Medios baños',              dataType: 'NUMERICAL' },
  { fieldKey: 'estacionamientos',    name: 'Estacionamientos',          dataType: 'NUMERICAL' },
  { fieldKey: 'bodega_storage',      name: 'Bodega o storage',          dataType: 'CHECKBOX', options: ['Sí'] },
  { fieldKey: 'amenidades',          name: 'Amenidades',                dataType: 'LARGE_TEXT' },
  { fieldKey: 'vista_principal',     name: 'Vista principal',           dataType: 'SINGLE_OPTIONS', options: ['Calle','Mar','Jardín','Montaña','Ciudad','Laguna','Campo de golf'] },
  { fieldKey: 'vista_secundaria',    name: 'Vista secundaria',          dataType: 'TEXT' },
  { fieldKey: 'situacion_legal',     name: 'Situación legal',           dataType: 'SINGLE_OPTIONS', options: ['Libre de gravamen','Gravamen hipotecario','Gravamen Infonavit','Otro (consultar)'] },
  { fieldKey: 'estado_conservacion', name: 'Estado de conservación',    dataType: 'SINGLE_OPTIONS', options: ['Nuevo','Excelente','Bueno','Regular','Necesita remodelación'] },
  { fieldKey: 'normas',              name: 'Normas de la propiedad',    dataType: 'LARGE_TEXT' },
  { fieldKey: 'fotos_urls',          name: 'Fotos URLs',                dataType: 'LARGE_TEXT' },
  { fieldKey: 'video_url',           name: 'Video URL',                 dataType: 'TEXT' },
  { fieldKey: 'video_propio_url',    name: 'Video propio URL',          dataType: 'TEXT' },
  { fieldKey: 'tour_virtual_url',    name: 'Tour virtual URL',          dataType: 'TEXT' },
  { fieldKey: 'planos_url',          name: 'Planos URL',                dataType: 'TEXT' },
  { fieldKey: 'agente_responsable',  name: 'Agente responsable (userId GHL)', dataType: 'TEXT' },
  { fieldKey: 'slug_url',            name: 'Slug URL',                  dataType: 'TEXT' },
  { fieldKey: 'fecha_publicacion',   name: 'Fecha de publicación',      dataType: 'DATE' },
  { fieldKey: 'cta_tipo',            name: 'CTA tipo',                  dataType: 'SINGLE_OPTIONS', options: ['whatsapp','formulario','llamar','ninguno'] },
  { fieldKey: 'cta_valor',           name: 'CTA valor',                 dataType: 'LARGE_TEXT' },
  { fieldKey: 'ficha_url',           name: 'URL orgánica',              dataType: 'TEXT' },
];

async function ensureSchema(accessToken, locationId) {
  let schema = null;
  try {
    schema = await getCustomObjectByKey(accessToken, OBJECT_FULL_KEY, locationId);
  } catch { /* not found */ }
  if (!schema) {
    try {
      schema = await getCustomObjectByKey(accessToken, OBJECT_FULL_KEY_ALT, locationId);
    } catch { /* not found */ }
  }
  if (schema) return schema;
  // Crear el schema
  const created = await createCustomObjectSchema(accessToken, {
    locationId,
    key: OBJECT_KEY_RAW,
    labels: { singular: 'Propiedad', plural: 'Propiedades' },
    description: 'Listings inmobiliarios sincronizados por la app RE+GHL',
    primaryDisplayPropertyDetails: { key: 'titulo', name: 'Título', dataType: 'TEXT' },
  });
  return created;
}

function buildFieldPayload(schema, folder, def, position) {
  const base = {
    locationId: schema.locationId || undefined,
    objectKey: schema.key,
    parentId: folder.id,
    name: def.name,
    dataType: def.dataType,
    fieldKey: def.fieldKey,
    position,
  };
  if (def.options && def.options.length) {
    base.options = def.options.map((opt) => ({ key: opt.toLowerCase().replace(/\s+/g, '_'), label: opt, value: opt }));
  }
  return base;
}

export async function ensureCustomObjectForLocation(accessToken, locationId) {
  const schema = await ensureSchema(accessToken, locationId);
  const listResp = await listCustomFieldsForObject(accessToken, schema.key, locationId);
  const existing = listResp.fields || [];
  const folders = listResp.folders || [];
  if (!folders.length) throw new Error('No hay folders en el schema Propiedad');
  const folder = folders[0];

  const existingByKey = new Map();
  for (const f of existing) {
    const shortKey = (f.fieldKey || '').split('.').pop();
    if (shortKey) existingByKey.set(shortKey.toLowerCase(), f);
    if (f.name) existingByKey.set(f.name.toLowerCase(), f);
  }

  let created = 0, skipped = 0, failed = 0;
  let position = 1;
  for (const def of FIELDS) {
    if (existingByKey.get(def.fieldKey.toLowerCase()) || existingByKey.get(def.name.toLowerCase())) {
      skipped++;
      continue;
    }
    try {
      await createCustomField(accessToken, buildFieldPayload(schema, folder, def, position));
      created++;
      position++;
    } catch (e) {
      failed++;
      console.error('[ensureCustomObject] field failed', def.fieldKey, e?.response?.data || e.message);
    }
  }
  return { objectKey: schema.key, created, skipped, failed };
}
