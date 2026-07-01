// Elimina registros de prueba (TEST_*, QA_*, test-*) en el Custom Object
// de propiedades de un tenant. Uso:
//    node scripts/cleanup-test-records.js <locationId>
//
// Idempotente. Muestra dry-run primero; requiere ejecutar con --confirm
// para borrar de verdad en GHL.

import { findTenantByLocationId, getTenantWithTokens, updateTenantTokens } from '../src/lib/tenants.js';
import { listObjectRecords, deleteObjectRecord, refreshAccessToken } from '../src/lib/ghl.js';
import { getFieldIds, toGhlPropertyKey } from '../src/lib/field-ids.js';

const locationId = process.argv[2];
const confirm = process.argv.includes('--confirm');

if (!locationId) {
  console.error('uso: node scripts/cleanup-test-records.js <locationId> [--confirm]');
  process.exit(1);
}

const TEST_PATTERNS = [/^TEST[_-]/i, /^QA[_-]/i, /^test[-_]/, /_test$/i];

const stub = await findTenantByLocationId(locationId);
if (!stub) {
  console.error(`[error] tenant no encontrado para locationId=${locationId}`);
  process.exit(1);
}
// Reload con tokens descifrados (findTenantByLocationId sólo devuelve metadata).
const tenant = await getTenantWithTokens(stub.id);
console.log(`[tenant] id=${tenant.id} status=${tenant.status}`);
console.log('[auth] usando access_token vigente en Supabase');

const fieldIds = getFieldIds();
const objectKey = fieldIds.objectKey;
const tituloKey = toGhlPropertyKey('titulo');
console.log(`[schema] objectKey=${objectKey}  tituloKey=${tituloKey}`);

// Paginación completa
const records = [];
const PAGE = 50;
for (let offset = 0; ; offset += PAGE) {
  const data = await listObjectRecords(tenant.access_token, objectKey, {
    locationId,
    limit: PAGE,
    offset,
  });
  const batch = data?.records || [];
  records.push(...batch);
  if (batch.length < PAGE) break;
  if (offset > 5000) { console.error('[safety] > 5000 records, aborting'); break; }
}
console.log(`[list] ${records.length} records totales en el tenant`);

// Filtrar los que matchean patrones de test
const toDelete = records.filter((r) => {
  const titulo = r?.properties?.[tituloKey] || r?.properties?.titulo || '';
  return TEST_PATTERNS.some((rx) => rx.test(titulo));
});

console.log(`\n[dry-run] ${toDelete.length} records candidatos a eliminar:`);
for (const r of toDelete) {
  const t = r?.properties?.[tituloKey] || r?.properties?.titulo || '(sin titulo)';
  console.log(`   - ${r.id}  ·  "${t}"`);
}

if (!toDelete.length) {
  console.log('\n[done] nada que eliminar.');
  process.exit(0);
}

if (!confirm) {
  console.log('\n[safety] agrega --confirm para eliminar de verdad.');
  process.exit(0);
}

let ok = 0, failed = 0;
for (const r of toDelete) {
  try {
    await deleteObjectRecord(tenant.access_token, objectKey, r.id, locationId);
    console.log(`   ✓ deleted ${r.id}`);
    ok++;
  } catch (e) {
    console.error(`   ✗ failed ${r.id}:`, e?.response?.data || e.message);
    failed++;
  }
}
console.log(`\n[done] deleted=${ok} failed=${failed} of ${toDelete.length}`);
