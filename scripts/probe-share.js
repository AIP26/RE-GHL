// Sanity Paso 13: /api/share + /api/analytics/views + DELETE /api/property
import 'dotenv/config';
import axios from 'axios';
import { findTenantByLocationId } from '../src/lib/tenants.js';
import { signSession } from '../src/lib/jwt.js';
import { getSupabase } from '../src/lib/supabase.js';

const LOCATION_ID = 'cNg6MFQcxv8bZnwCppoM';
const BASE = 'http://localhost:8001';

async function main() {
  const sb = getSupabase();
  const t = await findTenantByLocationId(LOCATION_ID);
  const { data: ag } = await sb.from('agentes').select('*').eq('tenant_id', t.id).eq('rol', 'admin').limit(1).single();
  const token = signSession({ tenantId: t.id, locationId: t.ghl_location_id, agentId: ag.id, ghlUserId: ag.ghl_user_id, rol: 'admin' });
  const cli = axios.create({ baseURL: BASE, headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true });

  // Pick a real property id
  const propList = await cli.get('/api/property?limit=5');
  const propId = propList.data?.records?.[0]?.id;
  console.log('property id:', propId);
  if (!propId) { console.log('no property — abort'); return; }

  console.log('\n=== GET /api/share/:id initial ===');
  let r = await cli.get('/api/share/' + propId);
  console.log('status', r.status, '· ficha:', r.data.ficha, '· target:', r.data.cname_target);

  console.log('\n=== POST /api/share/:id (genera) ===');
  r = await cli.post('/api/share/' + propId, { expira_en: '2027-12-31' });
  console.log('status', r.status, '· ficha:', r.data.ficha);
  const fichaId = r.data.ficha?.id;

  console.log('\n=== POST /api/share/:id otra vez (no regenerate) → debe devolver la misma id, actualizar expira ===');
  r = await cli.post('/api/share/' + propId, { expira_en: '2028-01-01' });
  console.log('  same id?', r.data.ficha?.id === fichaId ? '✓' : '✗', '· new expira:', r.data.ficha?.expira_en);

  console.log('\n=== POST /api/share/:id { regenerate: true } → debe dar id NUEVO ===');
  r = await cli.post('/api/share/' + propId, { regenerate: true });
  const newId = r.data.ficha?.id;
  console.log('  new id?', newId !== fichaId ? '✓ ' + newId : '✗');

  console.log('\n=== PUT /api/share/by-id/:fichaId desactivar ===');
  r = await cli.put('/api/share/by-id/' + newId, { activa: false });
  console.log('  activa:', r.data.ficha?.activa);

  console.log('\n=== GET /api/analytics/views?ids=... ===');
  r = await cli.get('/api/analytics/views?ids=' + propId);
  console.log('  status', r.status, '· counts:', r.data.counts);

  console.log('\n=== GET /api/analytics/dashboard ===');
  r = await cli.get('/api/analytics/dashboard');
  console.log('  total_vistas:', r.data.total_vistas, '· top:', r.data.top);

  // Cleanup: delete the ficha we made (not the property)
  await sb.from('fichas_url').delete().eq('tenant_id', t.id).eq('property_id', propId);
  console.log('\ncleanup ok');
}

main().catch((e) => { console.error('FATAL', e?.response?.status, e?.response?.data || e.message); process.exit(1); });
