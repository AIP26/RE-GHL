// Sanity: usa exactamente la misma lógica de mapeo del server
// (toGhlPropertyKey + createObjectRecord) para confirmar que un POST
// de "publicar propiedad" funciona end-to-end contra GHL.
import 'dotenv/config';
import { findTenantByLocationId, getTenantWithTokens } from '../src/lib/tenants.js';
import { createObjectRecord } from '../src/lib/ghl.js';
import { getFieldIds, toGhlPropertyKey } from '../src/lib/field-ids.js';

const LOCATION_ID = process.env.DEBUG_LOCATION_ID || 'cNg6MFQcxv8bZnwCppoM';

const body = {
  titulo: `Casa probe server ${Date.now()}`,
  descripcion: 'Probe vía lib del server',
  tipo_operacion: 'venta',
  tipo_inmueble: 'casa',
  estado: 'disponible',
  agente_responsable: 'probe-user',
  precio_usd: 450000,
  direccion_completa: 'Av. Probe 100',
  colonia: 'Zona Hotelera',
  ciudad: 'Cancún',
  estado_municipio: 'Quintana Roo',
  m2_construccion: 220,
  recamaras: 3,
  banos_completos: 3,
  estacionamientos: 2,
  fotos_urls: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
  slug_url: `casa-probe-${Date.now()}`,
  // Campos que el form podría mandar pero no existen — deben skipearse
  campo_inventado_xyz: 'no debería romper',
};

async function main() {
  const tenantRow = await findTenantByLocationId(LOCATION_ID);
  const tenant = await getTenantWithTokens(tenantRow.id);
  const fieldIds = getFieldIds();

  const properties = {};
  const skipped = [];
  for (const [k, v] of Object.entries(body)) {
    const pk = toGhlPropertyKey(k);
    if (!pk) { skipped.push(k); continue; }
    if (v === '' || v == null) continue;
    properties[pk] = v;
  }

  console.log('skippedUnknownKeys:', skipped);
  console.log('propertiesCount   :', Object.keys(properties).length);

  const record = await createObjectRecord(tenant.access_token, fieldIds.objectKey, {
    locationId: LOCATION_ID,
    properties,
  });

  console.log('OK record.id:', record?.id || record?._id);
  console.log('record.properties.titulo:', record?.properties?.titulo);
}

main().catch((e) => {
  console.error('FATAL:', e?.response?.status, e?.response?.data || e.message);
  process.exit(1);
});
