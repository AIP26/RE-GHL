// Integración: upsertTenantFromOAuth -> getTenantWithTokens -> cleanup
import { getSupabase } from '../src/lib/supabase.js';
import {
  upsertTenantFromOAuth,
  getTenantWithTokens,
  listActiveTenants,
} from '../src/lib/tenants.js';

const FAKE = {
  access_token: 'fake-access-token-' + Date.now(),
  refresh_token: 'fake-refresh-token-' + Date.now(),
  locationId: 'test-loc-' + Date.now(),
  expires_in: 86400,
  scope: 'objects/record.write',
};

async function main() {
  // 1) Upsert
  const tenant = await upsertTenantFromOAuth(FAKE);
  console.log('[upsert] id:', tenant.id, 'location:', tenant.ghl_location_id, 'status:', tenant.status, 'plan:', tenant.plan);

  // 2) Verifica que en la fila bruta los tokens NO están en claro
  const sb = getSupabase();
  const { data: raw } = await sb
    .from('tenants')
    .select('oauth_token, refresh_token')
    .eq('id', tenant.id)
    .single();
  const cipheredOK =
    raw.oauth_token !== FAKE.access_token && raw.refresh_token !== FAKE.refresh_token;
  console.log('[encrypt-at-rest] tokens en DB están cifrados:', cipheredOK);

  // 3) Get + decrypt
  const withTokens = await getTenantWithTokens(tenant.id);
  console.log(
    '[roundtrip] access_token decrypt ok:', withTokens.access_token === FAKE.access_token,
    '| refresh decrypt ok:', withTokens.refresh_token_plain === FAKE.refresh_token
  );

  // 4) Idempotencia: upsert otra vez con mismo locationId
  const tenant2 = await upsertTenantFromOAuth({ ...FAKE, access_token: 'rotated-access' });
  console.log('[idempotent] mismo id tras re-upsert:', tenant2.id === tenant.id);

  // 5) Lista
  const active = await listActiveTenants();
  console.log('[list] tenants activos:', active.length);

  // 6) Cleanup
  await sb.from('tenants').delete().eq('id', tenant.id);
  console.log('[cleanup] tenant de prueba borrado.');
}

main().catch((e) => {
  console.error('INTEGRATION FAILED:', e?.response?.data || e.message || e);
  process.exit(1);
});
