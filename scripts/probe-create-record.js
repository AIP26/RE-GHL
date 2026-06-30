// Prueba sondas contra GHL para encontrar el formato correcto de
// `properties` al crear un record en custom_objects.propiedad.
//
// Probamos 4 variantes:
//  A) key = fieldKey largo ("custom_objects.propiedad.titulo")
//  B) key = field id corto ("El1XJcQfrScrUc80VfhG")
//  C) key = sufijo corto ("titulo")
//  D) key = fieldKey largo con todos los required fields
import 'dotenv/config';
import { findTenantByLocationId, getTenantWithTokens } from '../src/lib/tenants.js';
import { ghlClient } from '../src/lib/ghl.js';

const LOCATION_ID = process.env.DEBUG_LOCATION_ID || 'cNg6MFQcxv8bZnwCppoM';
const OBJECT_KEY = 'custom_objects.propiedad';
const URL_RECORDS = `/objects/${encodeURIComponent(OBJECT_KEY)}/records`;

async function main() {
  const tenantRow = await findTenantByLocationId(LOCATION_ID);
  const tenant = await getTenantWithTokens(tenantRow.id);
  const cli = ghlClient(tenant.access_token);

  // 0) Detalle del schema: requiredProperties y owner del primary
  console.log('=== Schema details ===');
  const { data: sch } = await cli.get(
    `/objects/${encodeURIComponent(OBJECT_KEY)}`,
    { params: { locationId: LOCATION_ID } }
  );
  const obj = sch?.object || sch;
  console.log('id                  :', obj.id);
  console.log('key                 :', obj.key);
  console.log('primaryDisplayProp  :', obj.primaryDisplayProperty);
  console.log('requiredProperties  :', JSON.stringify(obj.requiredProperties));
  console.log('searchableProperties:', JSON.stringify(obj.searchableProperties));
  console.log('uniqueProperties    :', JSON.stringify(obj.uniqueProperties));

  // Probas
  const tituloVal = `probe-${Date.now()}`;

  const probes = [
    { label: 'A) fieldKey largo',
      body: { locationId: LOCATION_ID, properties: { 'custom_objects.propiedad.titulo': tituloVal } } },
    { label: 'B) field id corto',
      body: { locationId: LOCATION_ID, properties: { 'El1XJcQfrScrUc80VfhG': tituloVal } } },
    { label: 'C) sufijo corto',
      body: { locationId: LOCATION_ID, properties: { 'titulo': tituloVal } } },
    { label: 'D) fieldKey largo + estado required',
      body: { locationId: LOCATION_ID, properties: {
        'custom_objects.propiedad.titulo': tituloVal,
        'custom_objects.propiedad.descripcion': 'desc probe',
        'custom_objects.propiedad.tipo_operacion': 'venta',
        'custom_objects.propiedad.tipo_inmueble': 'casa',
        'custom_objects.propiedad.estado': 'disponible',
        'custom_objects.propiedad.agente_responsable': 'probe-user',
        'custom_objects.propiedad.precio_usd': 100000,
        'custom_objects.propiedad.direccion_completa': 'probe addr',
        'custom_objects.propiedad.colonia': 'probe',
        'custom_objects.propiedad.ciudad': 'probe',
        'custom_objects.propiedad.estado_municipio': 'probe',
        'custom_objects.propiedad.m2_construccion': 100,
        'custom_objects.propiedad.recamaras': 2,
        'custom_objects.propiedad.banos_completos': 2,
        'custom_objects.propiedad.estacionamientos': 1,
        'custom_objects.propiedad.fotos_urls': 'https://example.com/x.jpg',
      } } },
  ];

  for (const p of probes) {
    console.log(`\n=== ${p.label} ===`);
    console.log('POST', URL_RECORDS);
    console.log('body:', JSON.stringify(p.body));
    try {
      const { data, status } = await cli.post(URL_RECORDS, p.body);
      console.log('OK', status, JSON.stringify(data).slice(0, 600));
    } catch (e) {
      console.log('ERR', e?.response?.status, JSON.stringify(e?.response?.data));
    }
  }
}

main().catch((e) => {
  console.error('FATAL:', e?.response?.data || e.message);
  process.exit(1);
});
