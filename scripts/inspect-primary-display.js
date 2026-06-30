// Inspecciona el schema "custom_objects.propiedad" en GHL y muestra
// primaryDisplayPropertyDetails para confirmar el field ID correcto del
// campo titulo (el que GHL marca como primary).
//
// Uso: node scripts/inspect-primary-display.js
//
// Requiere: variables de entorno del tenant en .env y registro en Supabase
// con tokens válidos para el LOCATION_ID configurado.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTenantByLocationId, getTenantWithTokens } from '../src/lib/tenants.js';
import { ghlClient } from '../src/lib/ghl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCATION_ID = process.env.DEBUG_LOCATION_ID || 'cNg6MFQcxv8bZnwCppoM';
const OBJECT_KEY = 'custom_objects.propiedad';

async function main() {
  const tenantRow = await findTenantByLocationId(LOCATION_ID);
  if (!tenantRow) {
    console.error(`No hay tenant para locationId=${LOCATION_ID}`);
    process.exit(1);
  }
  const tenant = await getTenantWithTokens(tenantRow.id);
  const cli = ghlClient(tenant.access_token);

  console.log(`\n=== GET /objects/${OBJECT_KEY}?locationId=${LOCATION_ID} ===`);
  const { data: schemaData } = await cli.get(
    `/objects/${encodeURIComponent(OBJECT_KEY)}`,
    { params: { locationId: LOCATION_ID } }
  );

  const obj = schemaData?.object || schemaData;
  console.log('--- object top-level keys ---');
  console.log(Object.keys(obj));

  console.log('\n--- primaryDisplayProperty (key string) ---');
  console.log(obj.primaryDisplayProperty);

  console.log('\n--- primaryDisplayPropertyDetails (full object) ---');
  console.log(JSON.stringify(obj.primaryDisplayPropertyDetails, null, 2));

  // Comparamos con lo que tenemos guardado
  const fieldIdsPath = path.resolve(__dirname, '..', 'ghl-field-ids.json');
  const local = JSON.parse(fs.readFileSync(fieldIdsPath, 'utf8'));
  const tituloLocal = local.fields?.titulo;

  console.log('\n--- ghl-field-ids.json: fields.titulo ---');
  console.log(JSON.stringify(tituloLocal, null, 2));

  const primaryId = obj.primaryDisplayPropertyDetails?.id
    || obj.primaryDisplayPropertyDetails?._id
    || obj.primaryDisplayPropertyDetails?.fieldId;

  console.log('\n=== VEREDICTO ===');
  console.log(`primary id en GHL      : ${primaryId}`);
  console.log(`titulo.id local (JSON) : ${tituloLocal?.id}`);
  console.log(`coincide?              : ${primaryId === tituloLocal?.id ? 'SI ✓' : 'NO ✗ — actualizar JSON'}`);
}

main().catch((e) => {
  console.error('FATAL:', e?.response?.status, e?.response?.data || e.message);
  process.exit(1);
});
