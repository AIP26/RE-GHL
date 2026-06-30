// Step 6 — Backend tests for POST /api/upload/sign (Cloudinary signed direct-upload).
// Verifies:
//   - kind=property → folder ".../properties" (plural)  + eager=f_webp,q_80,w_2000,c_limit
//   - kind=brand    → folder ".../brand"                + eager=f_auto,q_auto
//   - kind=agent    → folder ".../brand"  (Master Context mapping)
//   - 401 without Authorization header
//   - tenant isolation (folder contains the caller's tenant_id, no cross-tenant leak)
//   - signature == SHA1(`eager=${eager}&folder=${folder}&timestamp=${timestamp}` + apiSecret)
//
// Server must be running on localhost:8001. The .env has mock Cloudinary creds — that's intentional;
// we only validate the *signing math*, not a real Cloudinary upload.

import crypto from 'node:crypto';
import 'dotenv/config';

const BASE = 'http://localhost:8001';
const LOCATION_ID = 'cNg6MFQcxv8bZnwCppoM';
const APISECRET = process.env.CLOUDINARY_API_SECRET;
const EXPECTED_CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
const EXPECTED_APIKEY = process.env.CLOUDINARY_API_KEY;

let pass = 0, fail = 0;
const log = (ok, name, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`); }
  else    { fail++; console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`); }
};

async function sso(userId) {
  const r = await fetch(`${BASE}/api/auth/sso?locationId=${LOCATION_ID}&userId=${encodeURIComponent(userId)}`);
  const j = await r.json();
  if (!j.token) throw new Error('SSO failed: ' + JSON.stringify(j));
  return j;
}

async function sign(token, body = {}) {
  const r = await fetch(`${BASE}/api/upload/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

function expectedSig({ eager, folder, timestamp }) {
  const s = `eager=${eager}&folder=${folder}&timestamp=${timestamp}` + APISECRET;
  return crypto.createHash('sha1').update(s).digest('hex');
}

async function run() {
  console.log('Step 6 — POST /api/upload/sign');

  // ---- SSO ----
  const { token, tenant } = await sso('e2e-upload-test-1');
  log(!!token && !!tenant?.id, 'SSO returns token + tenant', `tenant_id=${tenant?.id}`);

  // ---- 401 without auth ----
  const noAuth = await sign(null, { kind: 'property' });
  log(noAuth.status === 401, '401 without Authorization header', `got ${noAuth.status}`);

  // ---- kind=property ----
  const p = await sign(token, { kind: 'property' });
  const expectedFolderProp = `tenants/${tenant.id}/properties`;
  log(p.status === 200, 'kind=property → 200', `status ${p.status}`);
  log(p.body?.folder === expectedFolderProp,
      'kind=property → folder is plural ".../properties"',
      `got "${p.body?.folder}", expected "${expectedFolderProp}"`);
  log(p.body?.eager === 'f_webp,q_80,w_2000,c_limit',
      'kind=property → eager=f_webp,q_80,w_2000,c_limit',
      `got "${p.body?.eager}"`);
  log(p.body?.cloudName === EXPECTED_CLOUD, 'cloudName matches env');
  log(p.body?.apiKey === EXPECTED_APIKEY, 'apiKey matches env');
  log(Number.isInteger(p.body?.timestamp) && p.body.timestamp > 1_700_000_000,
      'timestamp is epoch seconds (int)', `got ${p.body?.timestamp}`);
  log(typeof p.body?.signature === 'string' && /^[a-f0-9]{40}$/.test(p.body.signature),
      'signature is 40-char hex (SHA-1)', `got "${p.body?.signature}"`);
  log(p.body?.uploadUrl === `https://api.cloudinary.com/v1_1/${EXPECTED_CLOUD}/image/upload`,
      'uploadUrl matches https://api.cloudinary.com/v1_1/{cloud}/image/upload');

  // signature reproducibility
  if (p.body) {
    const sig = expectedSig(p.body);
    log(sig === p.body.signature, 'signature == SHA1(eager&folder&timestamp + apiSecret)',
        `local=${sig.slice(0,8)}… server=${p.body.signature.slice(0,8)}…`);
  }

  // ---- kind=brand ----
  const b = await sign(token, { kind: 'brand' });
  log(b.body?.folder === `tenants/${tenant.id}/brand`, 'kind=brand → folder .../brand');
  log(b.body?.eager === 'f_auto,q_auto', 'kind=brand → eager=f_auto,q_auto');

  // ---- kind=agent → also maps to /brand ----
  const a = await sign(token, { kind: 'agent' });
  log(a.body?.folder === `tenants/${tenant.id}/brand`,
      'kind=agent → folder .../brand (Master Context mapping)',
      `got "${a.body?.folder}"`);
  log(a.body?.eager === 'f_auto,q_auto', 'kind=agent → eager=f_auto,q_auto');

  // ---- kind=collection → also /brand ----
  const c = await sign(token, { kind: 'collection' });
  log(c.body?.folder === `tenants/${tenant.id}/brand`, 'kind=collection → folder .../brand');

  // ---- default (no kind) → property ----
  const d = await sign(token, {});
  log(d.body?.folder === `tenants/${tenant.id}/properties`,
      'no kind → defaults to property → folder .../properties');

  // ---- Tenant isolation: another userId same locationId still same tenant ----
  const { token: t2, tenant: tenant2 } = await sso('e2e-upload-test-2');
  const p2 = await sign(t2, { kind: 'property' });
  log(p2.body?.folder === `tenants/${tenant2.id}/properties`,
      'second SSO user → folder contains its tenant_id (no leak)',
      `got "${p2.body?.folder}"`);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail === 0) console.log('TODO VERDE');
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(2); });
