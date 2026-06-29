// Carga ghl-field-ids.json generado por el Paso 4.
// Cachea en memoria — se invalida con clearFieldIdsCache() si hace falta.
import fs from 'node:fs';
import path from 'node:path';

let _cache = null;

export function getFieldIds() {
  if (_cache) return _cache;
  const filePath = path.resolve(process.cwd(), 'ghl-field-ids.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(
      'ghl-field-ids.json no existe. Ejecuta primero `node scripts/step-4-create-custom-object.js`.'
    );
  }
  _cache = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return _cache;
}

export function clearFieldIdsCache() {
  _cache = null;
}

/** Mapa shortKey -> { id, fieldKey, name, dataType }. */
export function fieldsByShortKey() {
  return getFieldIds().fields;
}

/** Resuelve un valor del form (clave corta) al fieldKey completo de GHL. */
export function toGhlFieldKey(shortKey) {
  const f = getFieldIds().fields[shortKey];
  return f?.fieldKey || null;
}
