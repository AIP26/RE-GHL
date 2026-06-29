// Debug: lista los custom objects y los fields del schema "propiedad" para
// inspeccionar la estructura exacta que devuelve GHL — necesitamos saber qué
// valor lleva `parentId` en el campo Título que se auto-creó.
import { findTenantByLocationId, getTenantWithTokens } from '../src/lib/tenants.js';
import { ghlClient } from '../src/lib/ghl.js';

const LOCATION_ID = 'cNg6MFQcxv8bZnwCppoM';

async function main() {
  const tenantRow = await findTenantByLocationId(LOCATION_ID);
  const tenant = await getTenantWithTokens(tenantRow.id);
  const cli = ghlClient(tenant.access_token);

  // 1) Lista todos los custom objects del location
  console.log('=== GET /objects/?locationId=... ===');
  try {
    const { data } = await cli.get('/objects/', { params: { locationId: LOCATION_ID } });
    console.log(JSON.stringify(data, null, 2).slice(0, 2000));
  } catch (e) {
    console.log('error:', e.response?.status, e.response?.data);
  }

  // 2) GET schema por key (varias variantes)
  for (const k of ['custom_objects.propiedad', 'propiedad']) {
    console.log(`\n=== GET /objects/${k}?locationId=... ===`);
    try {
      const { data } = await cli.get(`/objects/${encodeURIComponent(k)}`, { params: { locationId: LOCATION_ID } });
      console.log(JSON.stringify(data, null, 2).slice(0, 2000));
    } catch (e) {
      console.log('error:', e.response?.status, e.response?.data);
    }
  }

  // 3) Lista los custom fields del object (varios endpoints posibles)
  for (const path of [
    '/custom-fields/object-key/custom_objects.propiedad',
    '/custom-fields/object-key/custom_objects%2Epropiedad',
  ]) {
    console.log(`\n=== GET ${path}?locationId=... ===`);
    try {
      const { data } = await cli.get(path, { params: { locationId: LOCATION_ID } });
      console.log(JSON.stringify(data, null, 2).slice(0, 3000));
    } catch (e) {
      console.log('error:', e.response?.status, e.response?.data);
    }
  }
}

main().catch((e) => console.error('FATAL:', e?.response?.data || e.message));
