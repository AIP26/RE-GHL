// Sanity Paso 14: API pública v1 + CRUD /api/apikeys
// 1) Crea API key vía panel auth (admin JWT) -> recibe plain_once
// 2) Lista keys -> verifica que aparezca
// 3) Llama /api/v1/properties con la key -> 200 + data array
// 4) Llama /api/v1/collections con la key -> 200
// 5) Llama sin key -> 401
// 6) Llama con key bogus -> 401
// 7) Desactiva la key -> volver a llamar -> 401
// 8) Reactiva -> 200
// 9) Elimina la key (cleanup)
import 'dotenv/config';
import axios from 'axios';
import { findTenantByLocationId } from '../src/lib/tenants.js';
import { signSession } from '../src/lib/jwt.js';
import { getSupabase } from '../src/lib/supabase.js';

const LOCATION_ID = 'cNg6MFQcxv8bZnwCppoM';
const BASE = process.env.PROBE_BASE || 'http://localhost:3000';

function ok(cond, msg) { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) process.exitCode = 1; }

async function main() {
  const sb = getSupabase();
  const t = await findTenantByLocationId(LOCATION_ID);
  if (!t) throw new Error('tenant not found for location ' + LOCATION_ID);
  const { data: ag } = await sb.from('agentes').select('*').eq('tenant_id', t.id).eq('rol', 'admin').limit(1).single();
  const token = signSession({ tenantId: t.id, locationId: t.ghl_location_id, agentId: ag.id, ghlUserId: ag.ghl_user_id, rol: 'admin' });
  const admin = axios.create({ baseURL: BASE, headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true });
  const pub = axios.create({ baseURL: BASE, validateStatus: () => true });

  console.log('\n=== /api/v1/docs (sin auth) ===');
  let r = await pub.get('/api/v1/docs');
  ok(r.status === 200, 'docs HTTP 200');
  ok(typeof r.data === 'string' && r.data.includes('API pública v1'), 'docs contiene título');

  console.log('\n=== POST /api/apikeys (crear) ===');
  r = await admin.post('/api/apikeys', { nombre: 'probe-step14-' + Date.now() });
  ok(r.status === 200, 'create HTTP 200 (got ' + r.status + ')');
  const plain = r.data?.plain_once;
  const keyId = r.data?.api_key?.id;
  ok(!!plain && plain.startsWith('mks_'), 'plain_once empieza con mks_');
  ok(!!keyId, 'api_key.id presente');
  ok(r.data?.api_key?.key_prefix?.startsWith('mks_'), 'key_prefix empieza con mks_');
  console.log('  plain.length =', plain?.length, '· prefix =', r.data?.api_key?.key_prefix);

  console.log('\n=== GET /api/apikeys (list) ===');
  r = await admin.get('/api/apikeys');
  ok(r.status === 200, 'list HTTP 200');
  ok(Array.isArray(r.data?.api_keys) && r.data.api_keys.find((k) => k.id === keyId), 'la nueva key aparece en la lista');
  ok(r.data.api_keys.every((k) => !k.key_hash && !k.plain), 'lista NO expone key_hash ni plain');

  console.log('\n=== /api/v1/properties con X-API-Key ===');
  r = await pub.get('/api/v1/properties?limit=5', { headers: { 'X-API-Key': plain } });
  ok(r.status === 200, 'properties HTTP 200 (got ' + r.status + ')');
  ok(Array.isArray(r.data?.data), 'data es array');
  ok(typeof r.data?.count === 'number', 'count numérico');
  console.log('  count =', r.data?.count);

  console.log('\n=== /api/v1/properties con Authorization: Bearer ===');
  r = await pub.get('/api/v1/properties?limit=1', { headers: { Authorization: 'Bearer ' + plain } });
  ok(r.status === 200, 'properties (Bearer) HTTP 200');

  console.log('\n=== /api/v1/properties sin auth → 401 ===');
  r = await pub.get('/api/v1/properties');
  ok(r.status === 401, 'sin auth HTTP 401');
  ok(r.data?.error === 'api_key_required', 'error = api_key_required');

  console.log('\n=== /api/v1/properties con key inválida → 401 ===');
  r = await pub.get('/api/v1/properties', { headers: { 'X-API-Key': 'mks_no_existe_12345' } });
  ok(r.status === 401, 'invalid_api_key HTTP 401');
  ok(r.data?.error === 'invalid_api_key', 'error = invalid_api_key');

  console.log('\n=== /api/v1/collections ===');
  r = await pub.get('/api/v1/collections', { headers: { 'X-API-Key': plain } });
  ok(r.status === 200, 'collections HTTP 200');
  ok(Array.isArray(r.data?.data), 'collections data es array');

  console.log('\n=== PUT /api/apikeys/:id (desactivar) ===');
  r = await admin.put('/api/apikeys/' + keyId, { activa: false });
  ok(r.status === 200, 'PUT HTTP 200');
  ok(r.data?.api_key?.activa === false, 'activa = false');

  console.log('\n=== /api/v1/properties con key desactivada → 401 ===');
  r = await pub.get('/api/v1/properties', { headers: { 'X-API-Key': plain } });
  ok(r.status === 401, 'desactivada → 401');

  console.log('\n=== PUT /api/apikeys/:id (reactivar) ===');
  r = await admin.put('/api/apikeys/' + keyId, { activa: true });
  ok(r.data?.api_key?.activa === true, 'reactivada');

  console.log('\n=== /api/v1/properties tras reactivar → 200 ===');
  r = await pub.get('/api/v1/properties?limit=1', { headers: { 'X-API-Key': plain } });
  ok(r.status === 200, 'reactivada → 200');

  console.log('\n=== last_used_at se actualizó ===');
  r = await admin.get('/api/apikeys');
  const fresh = r.data.api_keys.find((k) => k.id === keyId);
  ok(!!fresh?.last_used_at, 'last_used_at presente: ' + fresh?.last_used_at);

  console.log('\n=== Tenant isolation: key de tenant A NO ve tenant B (smoke) ===');
  // Insertamos artificialmente una key con tenant_id distinto (uuid bogus) y la borramos
  const { data: otra, error: oerr } = await sb.from('api_keys').insert({
    tenant_id: '00000000-0000-0000-0000-000000000001',
    nombre: 'probe-fake-tenant',
    key_hash: 'a'.repeat(64),
    key_prefix: 'mks_fakefake',
  }).select('id').single();
  if (!oerr) {
    // No tenemos el plain, así que solo checamos que el GET admin no la lista (porque es otro tenant)
    r = await admin.get('/api/apikeys');
    ok(!r.data.api_keys.find((k) => k.id === otra.id), 'tenant aislado: no ve API key de otro tenant');
    await sb.from('api_keys').delete().eq('id', otra.id);
  }

  console.log('\n=== DELETE /api/apikeys/:id (cleanup) ===');
  r = await admin.delete('/api/apikeys/' + keyId);
  ok(r.status === 200, 'DELETE HTTP 200');

  console.log('\n=== /api/v1/properties con key eliminada → 401 ===');
  r = await pub.get('/api/v1/properties', { headers: { 'X-API-Key': plain } });
  ok(r.status === 401, 'eliminada → 401');

  console.log('\n=== resumen ===');
  console.log(process.exitCode ? 'FAIL ✗' : 'PASS ✓');
}

main().catch((e) => { console.error('FATAL', e?.response?.status, e?.response?.data || e.message, e.stack); process.exit(1); });
