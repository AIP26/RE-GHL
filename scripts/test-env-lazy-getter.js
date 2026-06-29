// Regression test: verify env.js uses lazy getters and ghl.js asserts config.
// Covers the OAuth client_id=undefined bug.
import { env } from '../src/config/env.js';
import { getAuthorizeUrl } from '../src/lib/ghl.js';

let pass = 0;
let fail = 0;
function check(label, ok, extra) {
  if (ok) { console.log(`[OK]  ${label}`); pass++; }
  else    { console.log(`[FAIL] ${label} ${extra || ''}`); fail++; }
}

// --- Test 1: baseline — URL contiene el client_id real del .env ---
const baseline = getAuthorizeUrl('STATE_A');
check(
  'baseline URL contains real GHL_CLIENT_ID from .env',
  baseline.includes('client_id=6a42ce486053a29f0b3911c9-mqznssed'),
  baseline
);
check(
  'baseline URL does NOT contain client_id=undefined',
  !baseline.includes('client_id=undefined'),
  baseline
);

// --- Test 2: lazy getter — mutar process.env tras import debe reflejarse ---
const originalClientId = process.env.GHL_CLIENT_ID;
process.env.GHL_CLIENT_ID = 'RUNTIME_TEST_VAL_123';
const lazyUrl = getAuthorizeUrl();
check(
  'lazy getter: env.ghl.clientId reflects runtime change',
  env.ghl.clientId === 'RUNTIME_TEST_VAL_123'
);
check(
  'lazy getter: getAuthorizeUrl() reflects runtime change',
  lazyUrl.includes('client_id=RUNTIME_TEST_VAL_123'),
  lazyUrl
);
process.env.GHL_CLIENT_ID = originalClientId;

// --- Test 3: assertion — sin GHL_CLIENT_ID debe lanzar error claro ---
delete process.env.GHL_CLIENT_ID;
let threw = null;
try { getAuthorizeUrl(); } catch (e) { threw = e; }
check(
  'assertOAuthConfigured: throws when GHL_CLIENT_ID missing',
  threw instanceof Error
);
check(
  'assertOAuthConfigured: error message mentions GHL_CLIENT_ID',
  threw && /GHL_CLIENT_ID/.test(threw.message),
  threw && threw.message
);
process.env.GHL_CLIENT_ID = originalClientId;

// --- Test 4: assertion también para CLIENT_SECRET y REDIRECT_URI ---
const originalSecret = process.env.GHL_CLIENT_SECRET;
delete process.env.GHL_CLIENT_SECRET;
let threw2 = null;
try { getAuthorizeUrl(); } catch (e) { threw2 = e; }
check(
  'assertOAuthConfigured: throws when GHL_CLIENT_SECRET missing',
  threw2 instanceof Error && /GHL_CLIENT_SECRET/.test(threw2.message),
  threw2 && threw2.message
);
process.env.GHL_CLIENT_SECRET = originalSecret;

const originalRedirect = process.env.GHL_REDIRECT_URI;
delete process.env.GHL_REDIRECT_URI;
let threw3 = null;
try { getAuthorizeUrl(); } catch (e) { threw3 = e; }
check(
  'assertOAuthConfigured: throws when GHL_REDIRECT_URI missing',
  threw3 instanceof Error && /GHL_REDIRECT_URI/.test(threw3.message),
  threw3 && threw3.message
);
process.env.GHL_REDIRECT_URI = originalRedirect;

// --- Test 5: tras restaurar, vuelve a funcionar normal ---
const restoredUrl = getAuthorizeUrl();
check(
  'after restore: URL is valid again with real client_id',
  restoredUrl.includes('client_id=6a42ce486053a29f0b3911c9-mqznssed'),
  restoredUrl
);

console.log(`\n== RESULT: ${pass} passed, ${fail} failed ==`);
if (fail > 0) process.exit(1);
console.log('== TODO VERDE ==');
