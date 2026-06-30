// Sanity Paso 8: probar /api/agent flow completo.
import 'dotenv/config';
import axios from 'axios';
import { findTenantByLocationId } from '../src/lib/tenants.js';
import { signSession } from '../src/lib/jwt.js';
import { getSupabase } from '../src/lib/supabase.js';

const LOCATION_ID = process.env.DEBUG_LOCATION_ID || 'cNg6MFQcxv8bZnwCppoM';
const BASE = process.env.DEBUG_BASE || 'http://localhost:8001';

function client(token) {
  return axios.create({ baseURL: BASE, headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true });
}

async function main() {
  const sb = getSupabase();
  const t = await findTenantByLocationId(LOCATION_ID);

  const { data: ag } = await sb.from('agentes').select('*').eq('tenant_id', t.id).eq('activo', true).limit(2);
  const agent = ag[0];
  console.log('tenant.plan:', t.plan, '· total active agents:', ag.length);
  console.log('using agent.rol:', agent.rol, '(promoting tenant to test) ');

  // Forzamos admin a este agente para los tests si fuese 'agente'
  if (agent.rol !== 'admin') {
    await sb.from('agentes').update({ rol: 'admin' }).eq('id', agent.id);
    agent.rol = 'admin';
  }

  const tokenAdmin = signSession({ tenantId: t.id, locationId: t.ghl_location_id, agentId: agent.id, ghlUserId: agent.ghl_user_id, rol: 'admin' });
  const cli = client(tokenAdmin);

  console.log('\n=== GET /api/agent (dropdown mode) ===');
  let r = await cli.get('/api/agent');
  console.log('status', r.status, '· count:', r.data?.agentes?.length);

  console.log('\n=== GET /api/agent?team=1 ===');
  r = await cli.get('/api/agent?team=1');
  console.log('status', r.status, '· plan:', r.data?.plan, '· agents:', r.data?.agentes?.length);
  r.data?.agentes?.forEach((a) => console.log('  -', a.nombre, '·', a.rol, '·', a.activo ? 'active' : 'inactive', '·', a.propiedades_count, 'props', a.pending_ghl ? '· PENDING-GHL' : ''));

  // Forzamos plan starter para probar el límite
  console.log('\n=== Forzar plan=starter, intentar agregar 2do agente ===');
  await sb.from('tenants').update({ plan: 'starter' }).eq('id', t.id);
  r = await cli.post('/api/agent', { nombre: 'Bloqueado por límite' });
  console.log('status', r.status, '· body:', JSON.stringify(r.data));
  if (r.status === 403 && r.data.error === 'plan_limit_reached') console.log('  ✓ Límite plan funcionando');

  console.log('\n=== Probar plan=pro (debería permitir hasta 5) ===');
  await sb.from('tenants').update({ plan: 'pro' }).eq('id', t.id);
  r = await cli.post('/api/agent', { nombre: 'Agente Pro Test', email: 'test@x.com', telefono: '+52 998 1111' });
  console.log('status', r.status, '· created:', r.data.agente?.id, r.data.agente?.nombre, '· pending_ghl:', r.data.agente?.pending_ghl);
  const createdId = r.data.agente?.id;

  console.log('\n=== PUT desactivar el nuevo ===');
  r = await cli.put('/api/agent/' + createdId, { activo: false });
  console.log('status', r.status, '· activo ahora:', r.data.agente?.activo);

  console.log('\n=== GET team mode después ===');
  r = await cli.get('/api/agent?team=1');
  console.log('plan.activeCount:', r.data?.plan?.activeCount);
  r.data?.agentes?.forEach((a) => console.log('  -', a.nombre, '·', a.activo ? 'active' : 'inactive'));

  // Probar agente NO-admin no puede entrar en team mode
  console.log('\n=== Agente no-admin pidiendo ?team=1 ===');
  const tokenAgent = signSession({ tenantId: t.id, locationId: t.ghl_location_id, agentId: agent.id, ghlUserId: agent.ghl_user_id, rol: 'agente' });
  r = await client(tokenAgent).get('/api/agent?team=1');
  console.log('status', r.status, '· body:', JSON.stringify(r.data));
  if (r.status === 403) console.log('  ✓ admin_required correcto');

  // Cleanup
  console.log('\n=== Cleanup ===');
  await sb.from('agentes').delete().eq('id', createdId);
  await sb.from('tenants').update({ plan: t.plan }).eq('id', t.id);
  await sb.from('agentes').update({ rol: agent.rol === 'admin' ? 'admin' : ag[0].rol }).eq('id', agent.id);
  console.log('done');
}

main().catch((e) => { console.error('FATAL', e?.response?.status, e?.response?.data || e.message); process.exit(1); });
