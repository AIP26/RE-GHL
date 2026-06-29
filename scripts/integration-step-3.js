// Integration test Paso 3:
//   1) Seed tenant via OAuth helper (fake tokens)
//   2) POST /api/webhook  type=LocationCreate -> debe crear admin
//   3) GET  /api/auth/sso -> debe firmar JWT y devolver agente
//   4) Verificar middleware requireSession contra un endpoint stub
//   5) POST /api/webhook  type=LocationDelete -> tenant -> inactive
//   6) Cleanup
import axios from 'axios';
import { getSupabase } from '../src/lib/supabase.js';
import { upsertTenantFromOAuth } from '../src/lib/tenants.js';
import { verifySession } from '../src/lib/jwt.js';

const BASE = 'http://localhost:8001';
const LOC = 'test-loc-' + Date.now();
const INSTALLER_USER = 'usr_installer_' + Date.now();
const NEW_AGENT_USER = 'usr_agent_' + Date.now();

async function main() {
  console.log('== Paso 3: integration ==');

  // 1) Seed tenant (simula que /auth/callback ya corrió)
  const tenant = await upsertTenantFromOAuth({
    access_token: 'fake-access',
    refresh_token: 'fake-refresh',
    locationId: LOC,
    expires_in: 86400,
  });
  console.log('[seed] tenant.id =', tenant.id, 'location =', LOC);

  // 2) Webhook: LocationCreate
  let resp = await axios.post(`${BASE}/api/webhook`, {
    type: 'LocationCreate',
    locationId: LOC,
    userId: INSTALLER_USER,
    firstName: 'Carlos',
    lastName: 'The Broker',
    email: 'carlos@thebrokers.mx',
    phone: '+529982223344',
  });
  console.log('[install] status:', resp.status, 'body:', resp.data);

  // Verifica en DB que el admin existe
  const sb = getSupabase();
  const { data: adminRow } = await sb
    .from('agentes')
    .select('id, nombre, email, rol, telefono, ghl_user_id')
    .eq('tenant_id', tenant.id)
    .eq('ghl_user_id', INSTALLER_USER)
    .single();
  console.log('[install] admin creado:', adminRow);
  if (!adminRow || adminRow.rol !== 'admin') throw new Error('admin no creado o rol incorrecto');

  // 3) SSO: el mismo admin -> debe devolver token y NO duplicar fila
  resp = await axios.get(`${BASE}/api/auth/sso`, {
    params: { locationId: LOC, userId: INSTALLER_USER },
  });
  console.log('[sso/admin] status:', resp.status, 'agente.rol:', resp.data.agente.rol);
  const adminToken = resp.data.token;
  const adminClaims = verifySession(adminToken);
  console.log('[sso/admin] JWT claims:', {
    tenantId: adminClaims.tenantId,
    rol: adminClaims.rol,
    exp_in_hours: Math.round((adminClaims.exp - adminClaims.iat) / 3600),
  });
  if (adminClaims.rol !== 'admin') throw new Error('JWT del admin no tiene rol=admin');
  if (Math.round((adminClaims.exp - adminClaims.iat) / 3600) !== 23) {
    throw new Error('JWT debe expirar en 23h');
  }

  // 4) SSO con un userId nuevo -> debe crear agente
  resp = await axios.get(`${BASE}/api/auth/sso`, {
    params: { locationId: LOC, userId: NEW_AGENT_USER },
  });
  console.log('[sso/nuevo] agente.rol:', resp.data.agente.rol);
  if (resp.data.agente.rol !== 'agente') throw new Error('agente nuevo no fue creado como agente');

  // 5) requireSession middleware end-to-end: usamos GET /api/auth/me que es
  // un endpoint protegido REAL. Probamos: sin token, token inválido, token OK.
  try {
    await axios.get(`${BASE}/api/auth/me`);
    throw new Error('debió fallar sin token');
  } catch (e) {
    if (e.response?.status !== 401) throw e;
    console.log('[middleware] sin token -> 401 ok');
  }
  try {
    await axios.get(`${BASE}/api/auth/me`, { headers: { Authorization: 'Bearer nope' } });
    throw new Error('debió fallar con token inválido');
  } catch (e) {
    if (e.response?.status !== 401) throw e;
    console.log('[middleware] token inválido -> 401 ok');
  }
  const meResp = await axios.get(`${BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log('[middleware] /me con token admin -> agente.rol:', meResp.data.agente.rol,
    '| plan:', meResp.data.tenant.plan);
  if (meResp.data.agente.rol !== 'admin') throw new Error('/me no devolvió admin');

  // 6) Webhook: LocationDelete -> tenant inactive
  resp = await axios.post(`${BASE}/api/webhook`, {
    type: 'LocationDelete',
    locationId: LOC,
  });
  console.log('[uninstall] status:', resp.status, 'body:', resp.data);
  const { data: tenantAfter } = await sb
    .from('tenants')
    .select('status')
    .eq('id', tenant.id)
    .single();
  console.log('[uninstall] tenant.status =', tenantAfter.status);
  if (tenantAfter.status !== 'inactive') throw new Error('tenant no quedó inactive');

  // 7) SSO tras uninstall -> 403
  try {
    await axios.get(`${BASE}/api/auth/sso`, {
      params: { locationId: LOC, userId: INSTALLER_USER },
    });
    throw new Error('SSO debió fallar tras uninstall');
  } catch (e) {
    console.log('[sso/post-uninstall] esperado:', e.response?.status, e.response?.data);
    if (e.response?.status !== 403) throw e;
  }

  // 8) Cleanup
  await sb.from('agentes').delete().eq('tenant_id', tenant.id);
  await sb.from('tenants').delete().eq('id', tenant.id);
  console.log('[cleanup] OK');
  console.log('== TODO VERDE ==');
}

main().catch((e) => {
  console.error('TEST FAILED:', e?.response?.data || e.stack || e);
  process.exit(1);
});
