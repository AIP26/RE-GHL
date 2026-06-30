// Sanity backend Paso 7: crear/listar/editar/eliminar colecciones
// vía el server (a través de un session token real generado por /api/auth/sso).
import 'dotenv/config';
import axios from 'axios';
import { findTenantByLocationId } from '../src/lib/tenants.js';
import { signSession } from '../src/lib/jwt.js';

const LOCATION_ID = process.env.DEBUG_LOCATION_ID || 'cNg6MFQcxv8bZnwCppoM';
const BASE = process.env.DEBUG_BASE || 'http://localhost:8001';

async function main() {
  const t = await findTenantByLocationId(LOCATION_ID);
  // Necesitamos un agente real ACTIVO del tenant para que requireSession no
  // rechace con `agente_inactivo`. Buscamos uno via supabase.
  const sbMod = await import('../src/lib/supabase.js');
  const sb = sbMod.getSupabase();
  const { data: ag } = await sb
    .from('agentes')
    .select('id, ghl_user_id, rol, activo')
    .eq('tenant_id', t.id)
    .eq('activo', true)
    .limit(1)
    .single();
  if (!ag) throw new Error('No hay agentes activos para el tenant ' + t.id);

  const token = signSession({
    tenantId: t.id,
    locationId: t.ghl_location_id,
    agentId: ag.id,
    ghlUserId: ag.ghl_user_id,
    rol: ag.rol,
  });
  const cli = axios.create({ baseURL: BASE, headers: { Authorization: `Bearer ${token}` } });

  console.log('=== GET initial ===');
  let { data } = await cli.get('/api/collection');
  console.log('count:', data.colecciones.length, 'portal:', data.portal);

  console.log('\n=== POST: Zona Hotelera ===');
  ({ data } = await cli.post('/api/collection', { nombre: 'Zona Hotelera Probe' }));
  console.log('created:', data.coleccion);
  const id1 = data.coleccion.id;

  console.log('\n=== POST duplicado mismo nombre (debe generar slug-2) ===');
  ({ data } = await cli.post('/api/collection', { nombre: 'Zona Hotelera Probe' }));
  console.log('created:', data.coleccion);
  const id2 = data.coleccion.id;
  if (data.coleccion.slug === 'zona-hotelera-probe-2') console.log('  ✓ slug suffix -2 ok');
  else console.log('  ✗ slug suffix esperado -2, vino:', data.coleccion.slug);

  console.log('\n=== PUT id1: renombrar + foto ===');
  ({ data } = await cli.put('/api/collection/' + id1, { nombre: 'Zona Hotelera Norte', foto_url: 'https://example.com/x.jpg' }));
  console.log('updated:', data.coleccion);

  console.log('\n=== GET con propiedades_count ===');
  ({ data } = await cli.get('/api/collection'));
  for (const c of data.colecciones) {
    console.log(`  ${c.nombre}  slug=${c.slug}  count=${c.propiedades_count}  foto=${c.foto_url ? 'yes' : 'no'}`);
  }

  console.log('\n=== DELETE ambos ===');
  await cli.delete('/api/collection/' + id1);
  await cli.delete('/api/collection/' + id2);
  ({ data } = await cli.get('/api/collection'));
  console.log('final count:', data.colecciones.length);
}

main().catch((e) => {
  console.error('FATAL', e?.response?.status, e?.response?.data || e.message);
  process.exit(1);
});
