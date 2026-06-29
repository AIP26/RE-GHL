// Smoke test: encryption roundtrip + Supabase connectivity.
// Ejecutar con: node scripts/smoke-step-2.js
import { encrypt, decrypt } from '../src/lib/encryption.js';
import { listActiveTenants } from '../src/lib/tenants.js';
import { getAuthorizeUrl } from '../src/lib/ghl.js';

async function main() {
  // 1) Encryption roundtrip
  const original = 'a-fake-ghl-access-token-12345';
  const cipher = encrypt(original);
  const back = decrypt(cipher);
  console.log('[encrypt] cipher length:', cipher.length, '| roundtrip ok:', back === original);

  // 2) Supabase: listar tenants activos (debería devolver [] tras schema fresco)
  const tenants = await listActiveTenants();
  console.log('[supabase] active tenants:', tenants.length);

  // 3) GHL authorize URL
  console.log('[ghl] authorize url:', getAuthorizeUrl('test-state').slice(0, 120) + '...');
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e.message);
  process.exit(1);
});
