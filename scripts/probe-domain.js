// Sanity Paso 10: /api/domain GET / POST / verify
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

  console.log('=== GET /api/domain initial ===');
  let r = await cli.get('/api/domain');
  console.log('status', r.status, '· dominio:', r.data.dominio, '· cname_target:', r.data.cname_target);

  console.log('\n=== POST hostname inválido ===');
  r = await cli.post('/api/domain', { subdominio: 'not a host' });
  console.log('status', r.status, '· body:', JSON.stringify(r.data));

  console.log('\n=== POST hostname válido ===');
  r = await cli.post('/api/domain', { subdominio: 'propiedades.probe-tenant.example' });
  console.log('status', r.status, '· dominio:', r.data.dominio);

  console.log('\n=== POST verify (no debería resolver — dominio fake) ===');
  r = await cli.post('/api/domain/verify');
  console.log('status', r.status, '· ok:', r.data.ok, '· error:', r.data.error);

  console.log('\n=== POST verify CON dominio real github (debería ok contra target=github.com) ===');
  // Temporal: cambiamos APP_DOMAIN para test
  await sb.from('dominios').update({ subdominio: 'www.github.com' }).eq('tenant_id', t.id);
  process.env.APP_DOMAIN_BAK = process.env.APP_DOMAIN || 'mktscaled.com';
  // El test del backend usa APP_DOMAIN del proceso del server, no del script
  // → re-probemos a mano la función
  const cnameMod = await import('../src/jobs/cname-verify.js');
  const result = await cnameMod.verifyCnameOne('www.github.com', 'github.com');
  console.log('manual verify:', result.ok ? '✓' : '✗', JSON.stringify(result));

  console.log('\n=== cleanup ===');
  await sb.from('dominios').delete().eq('tenant_id', t.id);
  console.log('deleted');
}

main().catch((e) => { console.error('FATAL', e?.response?.status, e?.response?.data || e.message); process.exit(1); });
