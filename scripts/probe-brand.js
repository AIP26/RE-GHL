// Sanity Paso 11: /api/brand
import 'dotenv/config';
import axios from 'axios';
import { findTenantByLocationId } from '../src/lib/tenants.js';
import { signSession } from '../src/lib/jwt.js';
import { getSupabase } from '../src/lib/supabase.js';

const LOCATION_ID = process.env.DEBUG_LOCATION_ID || 'cNg6MFQcxv8bZnwCppoM';
const BASE = process.env.DEBUG_BASE || 'http://localhost:8001';

async function main() {
  const sb = getSupabase();
  const t = await findTenantByLocationId(LOCATION_ID);
  const { data: ag } = await sb.from('agentes').select('*').eq('tenant_id', t.id).eq('rol', 'admin').limit(1).single();
  const token = signSession({ tenantId: t.id, locationId: t.ghl_location_id, agentId: ag.id, ghlUserId: ag.ghl_user_id, rol: 'admin' });
  const cli = axios.create({ baseURL: BASE, headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true });

  console.log('=== GET initial ===');
  let r = await cli.get('/api/brand');
  console.log('status', r.status, '· marca:', r.data.marca);

  console.log('\n=== PUT marca completa ===');
  r = await cli.put('/api/brand', {
    logo_url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
    hero_foto_url: 'https://res.cloudinary.com/demo/image/upload/hero.jpg',
    color_principal: '#0f766e',
    color_secundario: '#134e4a',
    color_acento: '#fbbf24',
    nombre_agencia: 'The Brokers Cancún',
    telefono: '+52 998 100 1000',
    whatsapp: '+52 998 100 1000',
    email: 'info@thebrokers.mx',
    facebook: 'https://facebook.com/thebrokers',
    instagram: 'https://instagram.com/thebrokers',
    asociaciones: [
      { nombre: 'AMPI', logo_url: 'https://res.cloudinary.com/demo/image/upload/ampi.png' },
      { nombre: 'CANACO', logo_url: 'https://res.cloudinary.com/demo/image/upload/canaco.png' },
    ],
    ga4_tag: 'G-ABCD1234',
  });
  console.log('status', r.status, '· saved:', !!r.data.marca);

  console.log('\n=== PUT widget=whatsapp ===');
  r = await cli.put('/api/brand', { widget_tipo: 'whatsapp', widget_valor: '+5299810001000' });
  console.log('status', r.status, '· tipo:', r.data.marca?.widget_tipo, '· valor:', r.data.marca?.widget_valor);

  console.log('\n=== PUT color inválido (debería ignorarlo) ===');
  r = await cli.put('/api/brand', { color_principal: 'not-a-hex' });
  console.log('status', r.status, '· color_principal después:', r.data.marca?.color_principal);

  console.log('\n=== PUT widget_tipo inválido (debería ignorarlo) ===');
  r = await cli.put('/api/brand', { widget_tipo: 'bad', widget_valor: 'x' });
  console.log('status', r.status, '· tipo:', r.data.marca?.widget_tipo, '· valor:', r.data.marca?.widget_valor);

  console.log('\n=== Cleanup ===');
  await sb.from('configuracion_marca').delete().eq('tenant_id', t.id);
  console.log('done');
}
main().catch((e) => { console.error('FATAL', e?.response?.status, e?.response?.data || e.message); process.exit(1); });
