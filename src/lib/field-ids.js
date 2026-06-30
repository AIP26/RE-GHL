// Carga ghl-field-ids.json generado por el Paso 4.
// Cachea en memoria — se invalida con clearFieldIdsCache() si hace falta.
// Path resuelto relativo a este archivo (NO desde cwd) para que funcione
// idéntico en local, Railway/Nixpacks, supervisor, docker, etc.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIELD_IDS_PATH = path.resolve(__dirname, '..', '..', 'ghl-field-ids.json');

let _cache = null;

export function getFieldIds() {
  if (_cache) return _cache;
  if (!fs.existsSync(FIELD_IDS_PATH)) {
    throw new Error(
      `ghl-field-ids.json no existe en ${FIELD_IDS_PATH}. Ejecuta primero \`node scripts/step-4-create-custom-object.js\`.`
    );
  }
  _cache = JSON.parse(fs.readFileSync(FIELD_IDS_PATH, 'utf8'));
  return _cache;
}

export function clearFieldIdsCache() {
  _cache = null;
}

/** Mapa shortKey -> { id, fieldKey, name, dataType }. */
export function fieldsByShortKey() {
  return getFieldIds().fields;
}

/** Resuelve un valor del form (clave corta) al fieldKey completo de GHL.
 *  fieldKey = "custom_objects.propiedad.titulo" (formato largo). */
export function toGhlFieldKey(shortKey) {
  const f = getFieldIds().fields[shortKey];
  return f?.fieldKey || null;
}

/** Resuelve un valor del form (clave corta) al field ID interno de GHL.
 *  Útil si en el futuro algún endpoint lo pide explícitamente. */
export function toGhlFieldId(shortKey) {
  const f = getFieldIds().fields[shortKey];
  return f?.id || null;
}

/** Devuelve la "property key" que GHL espera dentro del objeto `properties`
 *  al crear o actualizar un Custom Object Record. Confirmado vía probe:
 *  GHL espera el SUFIJO CORTO del fieldKey (ej. "titulo", "precio_usd"),
 *  NO el fieldKey largo ni el id interno. Devuelve null si el shortKey
 *  no existe en ghl-field-ids.json. */
export function toGhlPropertyKey(shortKey) {
  const f = getFieldIds().fields[shortKey];
  return f ? shortKey : null;
}
