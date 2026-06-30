// =====================================================================
// PASO 4 — Crear Custom Object "Propiedad" en GHL via API y persistir
// los field IDs en ghl-field-ids.json (lo consume el Paso 5).
//
// Ejecuta:  node scripts/step-4-create-custom-object.js
//
// Características:
//  - Idempotente: si el schema o algún campo ya existe, lo reutiliza.
//  - Tolerante a fallos por campo: continúa si uno falla y reporta al final.
//  - Persiste ghl-field-ids.json incluso con resultados parciales.
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import { findTenantByLocationId, getTenantWithTokens } from '../src/lib/tenants.js';
import {
  createCustomObjectSchema,
  getCustomObjectByKey,
  listCustomFieldsForObject,
  createCustomField,
} from '../src/lib/ghl.js';

const LOCATION_ID = 'cNg6MFQcxv8bZnwCppoM';
const OBJECT_KEY_RAW = 'propiedad';
const OBJECT_FULL_KEY = `custom_objects.${OBJECT_KEY_RAW}`;
const OBJECT_FULL_KEY_ALT = `custom_object.${OBJECT_KEY_RAW}`; // GHL ha alternado entre singular/plural
const OUTPUT_FILE = path.resolve(process.cwd(), 'ghl-field-ids.json');

// ---------------------------------------------------------------------
// Definición de campos — derivada del Master Context v2.6
// fieldKey: identificador interno corto (lo usamos en el código)
// name:     label que ve el agente en GHL
// dataType: TEXT | LARGE_TEXT | NUMERICAL | DATE | SINGLE_OPTIONS | CHECKBOX
// options:  array de strings para SINGLE_OPTIONS / CHECKBOX
// ---------------------------------------------------------------------
const FIELDS = [
  // Información general
  { fieldKey: 'titulo',              name: 'Título',                    dataType: 'TEXT' },
  { fieldKey: 'descripcion',         name: 'Descripción',               dataType: 'LARGE_TEXT' },
  { fieldKey: 'tipo_operacion',      name: 'Tipo de operación',         dataType: 'SINGLE_OPTIONS', options: ['Venta', 'Renta'] },
  { fieldKey: 'tipo_inmueble',       name: 'Tipo de inmueble',          dataType: 'SINGLE_OPTIONS', options: ['Casa','Departamento','Local','Terreno','Oficina','Bodega','Villa','Penthouse'] },
  { fieldKey: 'estado',              name: 'Estado de la propiedad',    dataType: 'SINGLE_OPTIONS', options: ['Disponible','Vendida','Rentada','Pausada'] },
  { fieldKey: 'etiqueta',            name: 'Etiqueta',                  dataType: 'SINGLE_OPTIONS', options: ['Destacada','Nueva','Oportunidad','Preventa','Remate'] },
  { fieldKey: 'preventa',            name: 'Preventa',                  dataType: 'CHECKBOX', options: ['Sí'] },
  { fieldKey: 'fecha_entrega',       name: 'Fecha estimada de entrega', dataType: 'DATE' },
  { fieldKey: 'agente_responsable',  name: 'Agente responsable',        dataType: 'TEXT' },
  { fieldKey: 'cta_tipo',            name: 'CTA tipo',                  dataType: 'SINGLE_OPTIONS', options: ['global','whatsapp','formulario','redirect'] },
  { fieldKey: 'cta_valor',           name: 'CTA valor',                 dataType: 'TEXT' },

  // Precio
  { fieldKey: 'precio_usd',          name: 'Precio USD',                dataType: 'NUMERICAL' },
  { fieldKey: 'precio_mxn',          name: 'Precio MXN',                dataType: 'NUMERICAL' },
  // Nuevos campos genéricos para soportar USD/MXN/CAD (sustituye visualmente
  // a precio_usd/precio_mxn pero los conservamos para retro-compatibilidad).
  { fieldKey: 'precio_principal',    name: 'Precio principal',          dataType: 'NUMERICAL' },
  { fieldKey: 'moneda_principal',    name: 'Moneda principal',          dataType: 'SINGLE_OPTIONS', options: ['USD', 'MXN', 'CAD'] },
  { fieldKey: 'precio_secundario',   name: 'Precio secundario',         dataType: 'NUMERICAL' },
  { fieldKey: 'moneda_secundaria',   name: 'Moneda secundaria',         dataType: 'SINGLE_OPTIONS', options: ['USD', 'MXN', 'CAD'] },
  { fieldKey: 'precio_a_consultar',  name: 'Precio a consultar',        dataType: 'CHECKBOX', options: ['Sí'] },
  { fieldKey: 'nota_precio',         name: 'Nota de precio',            dataType: 'TEXT' },
  { fieldKey: 'cuota_mantenimiento', name: 'Cuota de mantenimiento',    dataType: 'NUMERICAL' },

  // Ubicación
  { fieldKey: 'direccion_completa',  name: 'Dirección completa',        dataType: 'TEXT' },
  { fieldKey: 'colonia',             name: 'Colonia o zona',            dataType: 'TEXT' },
  { fieldKey: 'ciudad',              name: 'Ciudad',                    dataType: 'TEXT' },
  { fieldKey: 'estado_municipio',    name: 'Estado o municipio',        dataType: 'TEXT' },
  { fieldKey: 'codigo_postal',       name: 'Código postal',             dataType: 'TEXT' },
  { fieldKey: 'latitud',             name: 'Latitud',                   dataType: 'NUMERICAL' },
  { fieldKey: 'longitud',            name: 'Longitud',                  dataType: 'NUMERICAL' },
  { fieldKey: 'ocultar_direccion',   name: 'Ocultar dirección exacta',  dataType: 'CHECKBOX', options: ['Sí'] },
  { fieldKey: 'zona_federal',        name: 'Zona Federal',              dataType: 'CHECKBOX', options: ['Sí'] },

  // Dimensiones
  { fieldKey: 'm2_construccion',     name: 'm2 construcción',           dataType: 'NUMERICAL' },
  { fieldKey: 'm2_terreno',          name: 'm2 terreno',                dataType: 'NUMERICAL' },
  { fieldKey: 'nombre_condominio',   name: 'Nombre del condominio',     dataType: 'TEXT' },
  { fieldKey: 'niveles',             name: 'Niveles',                   dataType: 'NUMERICAL' },
  { fieldKey: 'piso_edificio',       name: 'Piso en edificio',          dataType: 'NUMERICAL' },
  { fieldKey: 'anio_construccion',   name: 'Año de construcción',       dataType: 'NUMERICAL' },

  // Habitaciones
  { fieldKey: 'recamaras',           name: 'Recámaras',                 dataType: 'NUMERICAL' },
  { fieldKey: 'banos_completos',     name: 'Baños completos',           dataType: 'NUMERICAL' },
  { fieldKey: 'medios_banos',        name: 'Medios baños',              dataType: 'NUMERICAL' },
  { fieldKey: 'estacionamientos',    name: 'Estacionamientos',          dataType: 'NUMERICAL' },
  { fieldKey: 'cuarto_servicio',     name: 'Cuarto de servicio',        dataType: 'CHECKBOX', options: ['Sí'] },
  { fieldKey: 'bodega_storage',      name: 'Bodega o storage',          dataType: 'CHECKBOX', options: ['Sí'] },

  // Amenidades
  { fieldKey: 'amenidades',          name: 'Amenidades',                dataType: 'LARGE_TEXT' },
  { fieldKey: 'vista_principal',     name: 'Vista principal',           dataType: 'SINGLE_OPTIONS', options: ['Calle','Mar','Jardín','Montaña','Ciudad','Laguna','Campo de golf'] },
  { fieldKey: 'vista_secundaria',    name: 'Vista secundaria',          dataType: 'TEXT' },
  { fieldKey: 'aire_acondicionado',  name: 'Aire acondicionado',        dataType: 'CHECKBOX', options: ['Sí'] },

  // Situación y conservación (nuevos campos QA bloque 3)
  { fieldKey: 'situacion_legal',     name: 'Situación legal',           dataType: 'SINGLE_OPTIONS', options: ['Libre de gravamen','Gravamen hipotecario','Gravamen Infonavit','Otro (consultar)'] },
  { fieldKey: 'estado_conservacion', name: 'Estado de conservación',    dataType: 'SINGLE_OPTIONS', options: ['Nuevo','Excelente','Bueno','Regular','Necesita remodelación'] },

  // Normas de la propiedad (CSV en LARGE_TEXT — igual patrón que `amenidades`)
  { fieldKey: 'normas',              name: 'Normas de la propiedad',    dataType: 'LARGE_TEXT' },

  // Fotos y media
  { fieldKey: 'fotos_urls',          name: 'URLs de fotos',             dataType: 'LARGE_TEXT' },
  { fieldKey: 'video_url',           name: 'Video URL',                 dataType: 'TEXT' },
  { fieldKey: 'tour_virtual_url',    name: 'Tour virtual URL',          dataType: 'TEXT' },
  { fieldKey: 'planos_url',          name: 'Planos URL',                dataType: 'TEXT' },

  // Generados automáticamente por la app (los escribimos vía API)
  { fieldKey: 'slug_url',            name: 'Slug URL',                  dataType: 'TEXT' },
  { fieldKey: 'url_organica',        name: 'URL orgánica',              dataType: 'TEXT' },
  { fieldKey: 'fecha_publicacion',   name: 'Fecha de publicación',      dataType: 'DATE' },
];

// ---------------------------------------------------------------------
async function main() {
  console.log('== Paso 4: Crear Custom Object "Propiedad" ==\n');

  // 1) Tenant + tokens
  const tenantRow = await findTenantByLocationId(LOCATION_ID);
  if (!tenantRow) {
    throw new Error(`Tenant no encontrado para location=${LOCATION_ID}. Instala la app primero.`);
  }
  console.log(`[tenant] id=${tenantRow.id} status=${tenantRow.status} plan=${tenantRow.plan}`);
  if (tenantRow.status !== 'active') {
    console.warn(`[tenant] WARN status=${tenantRow.status} (continuando)`);
  }
  const tenant = await getTenantWithTokens(tenantRow.id);
  const accessToken = tenant.access_token;

  // 2) Schema: intenta encontrar primero, si no lo crea.
  const schema = await findOrCreateSchema(accessToken);
  console.log(`[schema] key=${schema.key} id=${schema.id || 'n/a'}\n`);

  // 3) Lista campos + folders existentes. El parentId de cada nuevo field
  // debe ser el ID de una FOLDER (no del schema). GHL auto-crea una folder
  // "Propiedad Info" al crear el schema; la reusamos.
  let listResp = await listCustomFieldsForObject(accessToken, schema.key, LOCATION_ID);
  let existing = listResp.fields;
  const folders = listResp.folders;
  console.log(`[fields] existentes: ${existing.length} | folders: ${folders.length}`);

  if (!folders.length) {
    throw new Error('No hay folders en el schema. Revisa manualmente en GHL.');
  }
  const folder = folders[0];
  console.log(`[folder] usando "${folder.name}" (id=${folder.id})`);

  const existingByKey = new Map();
  for (const f of existing) {
    const shortKey = (f.fieldKey || '').split('.').pop();
    if (shortKey) existingByKey.set(shortKey.toLowerCase(), f);
    if (f.name) existingByKey.set(f.name.toLowerCase(), f);
  }

  // 4) Por cada campo del Master Context: crear si no existe
  const created = [];
  const skipped = [];
  const failed = [];

  let position = 1;
  for (const def of FIELDS) {
    const found =
      existingByKey.get(def.fieldKey.toLowerCase()) ||
      existingByKey.get(def.name.toLowerCase());
    if (found) {
      skipped.push({ def, field: found });
      console.log(`[skip] ${def.name}  (ya existe: ${found.id || found.fieldKey})`);
      continue;
    }
    try {
      const f = await buildAndCreateField(accessToken, schema, folder, def, position);
      created.push({ def, field: f });
      console.log(`[ok]   ${def.name}  ->  ${f.id || f.fieldKey || '?'}`);
      position += 1;
    } catch (err) {
      const detail = err?.response?.data || err.message;
      failed.push({ def, error: detail });
      console.error(`[FAIL] ${def.name}:`, JSON.stringify(detail));
    }
  }

  // 5) Re-listar para obtener IDs definitivos y persistir
  const finalList = await listCustomFieldsForObject(accessToken, schema.key, LOCATION_ID);
  const finalFields = finalList.fields;
  const out = {
    objectKey: schema.key,
    schemaId: schema.id || null,
    folderId: folder.id,
    folderName: folder.name,
    locationId: LOCATION_ID,
    generatedAt: new Date().toISOString(),
    summary: {
      defined: FIELDS.length,
      created: created.length,
      skipped: skipped.length,
      failed: failed.length,
    },
    fields: {},
  };

  // Indexamos por fieldKey corto -> { id, fieldKey, name, dataType }
  for (const f of finalFields) {
    const shortKey = (f.fieldKey || '').split('.').pop() || f.name;
    out.fields[shortKey] = {
      id: f.id,
      fieldKey: f.fieldKey,
      name: f.name,
      dataType: f.dataType,
    };
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out, null, 2));
  console.log(`\n[done] created=${created.length} skipped=${skipped.length} failed=${failed.length}`);
  console.log(`[done] escrito en ${OUTPUT_FILE}`);

  if (failed.length) {
    console.log('\nCampos fallidos (revisar y re-ejecutar el script tras corregir):');
    for (const { def, error } of failed) {
      console.log(`  - ${def.name} (${def.dataType}):`, JSON.stringify(error));
    }
    process.exit(2);
  }
}

// ---------------------------------------------------------------------
async function findOrCreateSchema(accessToken) {
  // 1) Si ya tenemos cache local del schemaId (corridas previas), úsalo.
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
      if (cached.schemaId && cached.objectKey) {
        console.log(`[schema] reusando desde ${path.basename(OUTPUT_FILE)}: ${cached.objectKey} (id=${cached.schemaId})`);
        return { key: cached.objectKey, id: cached.schemaId };
      }
    } catch { /* ignore */ }
  }

  // 2) Intenta GET — sirve si en una corrida previa NO se guardó la cache.
  for (const key of [OBJECT_FULL_KEY, OBJECT_FULL_KEY_ALT]) {
    try {
      const obj = await getCustomObjectByKey(accessToken, key, LOCATION_ID);
      if (obj && (obj.key || obj.id)) {
        return { key: obj.key || key, id: obj.id || null, labels: obj.labels };
      }
    } catch (err) {
      if (err.response?.status >= 500) {
        console.warn(`[schema] GET ${key} -> ${err.response?.status} ${JSON.stringify(err.response?.data || {})}`);
      }
    }
  }

  // 3) Crear
  const payload = {
    locationId: LOCATION_ID,
    key: OBJECT_KEY_RAW,
    labels: { singular: 'Propiedad', plural: 'Propiedades' },
    description: 'Listing inmobiliario gestionado por mktscaled-listings (Master Context v2.6).',
    primaryDisplayPropertyDetails: {
      key: 'titulo',
      name: 'Título',
      dataType: 'TEXT',
    },
  };
  console.log('[schema] no encontrado — creando con payload:\n', JSON.stringify(payload, null, 2));
  const obj = await createCustomObjectSchema(accessToken, payload);
  return {
    key: obj.key || OBJECT_FULL_KEY,
    id: obj.id || obj._id || null,
    labels: obj.labels,
  };
}

async function buildAndCreateField(accessToken, schema, folder, def, position) {
  if (!folder?.id) {
    throw new Error('folder.id requerido — GHL Custom Fields exige parentId = folder ID');
  }
  const payload = {
    locationId: LOCATION_ID,
    name: def.name,
    dataType: def.dataType,
    fieldKey: def.fieldKey,
    parentId: folder.id,    // ← El ID de la FOLDER, no del schema
    objectKey: schema.key,  // full key (custom_objects.propiedad) — la API requiere AMBOS
    position,
    showInForms: true,
  };
  if (def.options) {
    payload.options = def.options.map((opt) => ({
      key: opt.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      label: opt,
    }));
  }
  return await createCustomField(accessToken, payload);
}

main().catch((e) => {
  console.error('FATAL:', e?.response?.data || e.message || e);
  process.exit(1);
});
