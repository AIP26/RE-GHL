// Tests for POST /api/upload/sign after the PNG transparency bug-fix.
// Validates:
//   - kind=brand      → eager="f_auto,c_limit,w_1200"  (NO q_auto, NO f_webp)
//   - kind=agent      → eager="f_auto,c_limit,w_1200"
//   - kind=collection → eager="f_auto,c_limit,w_1200"
//   - kind=property   → eager="f_webp,q_80,w_2000,c_limit"  (unchanged)
//   - signature SHA1 reproducible with alphabetically-sorted params + apiSecret
//   - 401 without auth
//
// Server must be running on localhost:8001 with mock CLOUDINARY_* envs.
import crypto from 'node:crypto';
import 'dotenv/config';

const BASE = 'http://localhost:8001';
const LOCATION_ID = 'cNg6MFQcxv8bZnwCppoM';
const APISECRET = process.env.CLOUDINARY_API_SECRET;

let pass = 0, fail = 0;
const log = (ok, name, detail = '') => {
  const sym = ok ? 'PASS' : 'FAIL';
  if (ok) pass++; else fail++;
  console.log(`  [${sym}] ${name}${detail ? ' — ' + detail : ''}`);
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
  // Params sorted alphabetically -> eager, folder, timestamp
  const s = `eager=${eager}&folder=${folder}&timestamp=${timestamp}` + APISECRET;
  return crypto.createHash('sha1').update(s).digest('hex');
}

async function run() {
  console.log('=== POST /api/upload/sign — PNG transparency fix tests ===');

  // 401 without auth
  const noAuth = await sign(null, { kind: 'brand' });
  log(noAuth.status === 401, '401 without Authorization header', `got ${noAuth.status}`);

  const { token, tenant } = await sso('panel-test');
  log(!!token && !!tenant?.id, 'SSO returns token + tenant', `tenant_id=${tenant?.id}`);

  // kind=brand → eager must NOT contain q_auto or f_webp
  const b = await sign(token, { kind: 'brand' });
  log(b.status === 200, 'kind=brand → 200');
  log(b.body?.eager === 'f_auto,c_limit,w_1200',
      'kind=brand → eager="f_auto,c_limit,w_1200"',
      `got "${b.body?.eager}"`);
  log(!/q_auto/.test(b.body?.eager || ''), 'kind=brand → eager has NO q_auto');
  log(!/f_webp/.test(b.body?.eager || ''), 'kind=brand → eager has NO f_webp');
  log(b.body?.folder === `tenants/${tenant.id}/brand`, 'kind=brand → folder=tenants/<id>/brand', `got "${b.body?.folder}"`);

  // kind=collection (shares brand folder)
  const c = await sign(token, { kind: 'collection' });
  log(c.body?.eager === 'f_auto,c_limit,w_1200',
      'kind=collection → eager="f_auto,c_limit,w_1200"', `got "${c.body?.eager}"`);
  log(c.body?.folder === `tenants/${tenant.id}/brand`, 'kind=collection → folder=tenants/<id>/brand');

  // kind=agent (shares brand folder)
  const a = await sign(token, { kind: 'agent' });
  log(a.body?.eager === 'f_auto,c_limit,w_1200',
      'kind=agent → eager="f_auto,c_limit,w_1200"', `got "${a.body?.eager}"`);
  log(a.body?.folder === `tenants/${tenant.id}/brand`, 'kind=agent → folder=tenants/<id>/brand');

  // kind=property unchanged
  const p = await sign(token, { kind: 'property' });
  log(p.body?.eager === 'f_webp,q_80,w_2000,c_limit',
      'kind=property → eager="f_webp,q_80,w_2000,c_limit" (unchanged)',
      `got "${p.body?.eager}"`);
  log(p.body?.folder === `tenants/${tenant.id}/properties`, 'kind=property → folder=tenants/<id>/properties');

  // signature reproducibility for brand
  if (b.body) {
    const sig = expectedSig(b.body);
    log(sig === b.body.signature,
        'brand signature == SHA1(alpha-sorted params + apiSecret)',
        `local=${sig.slice(0,10)}… server=${b.body.signature.slice(0,10)}…`);
  }
  // signature reproducibility for property
  if (p.body) {
    const sig = expectedSig(p.body);
    log(sig === p.body.signature, 'property signature reproducible');
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => { console.error('FATAL:', e); process.exit(2); });
