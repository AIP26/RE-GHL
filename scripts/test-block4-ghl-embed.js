// Bloque 4 — Test CTA formulario GHL embed
// 1) Backend: validateGhlFormEmbed helper (unit-style)
// 2) Backend POST /api/property con cta_tipo=formulario — 3 dominios OK + rechazo
// 3) Backend PUT /api/property/:id (con locationId query bugfix)
// 4) Portal público /p/:slug — iframe sandbox + fallback + mobile-cta suppress
// 5) Bug color_principal — CSS --color-primary del portal
import 'dotenv/config';
import axios from 'axios';
import { findTenantByLocationId } from '../src/lib/tenants.js';
import { signSession } from '../src/lib/jwt.js';
import { getSupabase } from '../src/lib/supabase.js';
import { validateGhlFormEmbed } from '../src/routes/property.js';

const LOCATION_ID = 'cNg6MFQcxv8bZnwCppoM';
const TENANT_ID_SB = '2079e30e-62f5-4e2f-b976-d099535410e8';
const PROPERTY_ID = '6a43eeec2f3969c31fb1999a';
const PROPERTY_SLUG = 'departamento-en-tziara';
const BASE = process.env.PROBE_BASE || 'http://localhost:3000';

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { console.log('  ✓ ' + msg); passed++; }
  else { console.log('  ✗ ' + msg); failed++; process.exitCode = 1; }
}

async function main() {
  const sb = getSupabase();
  const t = await findTenantByLocationId(LOCATION_ID);
  if (!t) throw new Error('tenant not found');
  const { data: ag } = await sb.from('agentes').select('*').eq('tenant_id', t.id).eq('rol', 'admin').limit(1).single();
  const token = signSession({ tenantId: t.id, locationId: t.ghl_location_id, agentId: ag.id, ghlUserId: ag.ghl_user_id, rol: 'admin' });
  const admin = axios.create({ baseURL: BASE, headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true });
  const pub = axios.create({ baseURL: BASE, validateStatus: () => true });

  // === 1. Unit tests validateGhlFormEmbed ===
  console.log('\n=== 1. Unit: validateGhlFormEmbed ===');
  const goodEmbeds = [
    '<iframe src="https://api.leadconnectorhq.com/widget/form/abc123" style="width:100%;height:600px"></iframe>',
    '<iframe src="https://link.msgsndr.com/widget/form/abc" ></iframe>',
    '<iframe src="https://app.gohighlevel.com/widget/form/xyz"></iframe>',
    "<iframe src='https://api.leadconnectorhq.com/widget/form/2sQKtWebhtEPRnZlNH2A' style='width:100%;height:600px;border:none;' scrolling='no' id='inline-2sQKtWebhtEPRnZlNH2A'></iframe>",
  ];
  for (const e of goodEmbeds) {
    const v = validateGhlFormEmbed(e);
    ok(v.ok === true, `accept ${e.slice(0, 60)}...`);
  }
  const badEmbeds = [
    ['<iframe src="https://google.com/forms/x"></iframe>', 'host_not_allowed'],
    ['<iframe src="https://api.leadconnectorhq.evil.com/form"></iframe>', 'host_not_allowed'],
    ['<div>no iframe</div>', 'no_iframe_src'],
    ['', 'empty'],
    ['<iframe src="not-a-url"></iframe>', 'invalid_url'],
  ];
  for (const [e, expected] of badEmbeds) {
    const v = validateGhlFormEmbed(e);
    ok(v.ok === false && v.error === expected, `reject ${e.slice(0, 50)} -> ${v.error} (expected ${expected})`);
  }

  // === 2. Backend PUT /api/property/:id with cta_tipo=formulario ===
  console.log('\n=== 2. Backend PUT /api/property/:id: whitelist ===');
  // Snapshot original cta_tipo/cta_valor
  const orig = await admin.get(`/api/property/${PROPERTY_ID}`);
  const origCtaTipo = orig.data?.record?.properties?.cta_tipo || 'global';
  const origCtaValor = orig.data?.record?.properties?.cta_valor || '';
  console.log(`  (snapshot original: cta_tipo=${origCtaTipo}, cta_valor="${(origCtaValor || '').slice(0, 60)}")`);

  // 3 allowed hosts should validate (backend won't return invalid_ghl_form_embed)
  const allowedTests = [
    { name: 'gohighlevel.com', embed: '<iframe src="https://app.gohighlevel.com/widget/form/xyz"></iframe>' },
    { name: 'leadconnectorhq.com', embed: '<iframe src="https://api.leadconnectorhq.com/widget/form/abc123"></iframe>' },
    { name: 'msgsndr.com', embed: '<iframe src="https://link.msgsndr.com/widget/form/abc"></iframe>' },
  ];
  for (const test of allowedTests) {
    const r = await admin.put(`/api/property/${PROPERTY_ID}`, { cta_tipo: 'formulario', cta_valor: test.embed });
    const rejected = r.status === 400 && r.data?.error === 'invalid_ghl_form_embed';
    ok(!rejected, `PUT ${test.name} not rejected as invalid_ghl_form_embed (status=${r.status})`);
  }

  // Not-allowed host should be rejected
  const badR = await admin.put(`/api/property/${PROPERTY_ID}`, {
    cta_tipo: 'formulario', cta_valor: '<iframe src="https://facebook.com/forms/x"></iframe>',
  });
  ok(badR.status === 400, `PUT facebook.com returns 400 (got ${badR.status})`);
  ok(badR.data?.error === 'invalid_ghl_form_embed', `PUT facebook.com error=invalid_ghl_form_embed (got ${badR.data?.error})`);
  ok(badR.data?.reason === 'host_not_allowed', `PUT facebook.com reason=host_not_allowed (got ${badR.data?.reason})`);

  // POST with google.com
  console.log('\n=== 3. Backend POST /api/property: formulario validation ===');
  const postBad = await admin.post('/api/property', {
    titulo: 'TEST_BLOCK4_bad', cta_tipo: 'formulario',
    cta_valor: '<iframe src="https://google.com/forms/abc"></iframe>',
  });
  ok(postBad.status === 400, `POST google.com returns 400 (got ${postBad.status})`);
  ok(postBad.data?.error === 'invalid_ghl_form_embed', `POST google.com error=invalid_ghl_form_embed`);
  ok(postBad.data?.reason === 'host_not_allowed', `POST google.com reason=host_not_allowed`);

  // POST with leadconnectorhq -> should NOT be rejected as invalid_ghl_form_embed
  const postGood = await admin.post('/api/property', {
    titulo: 'TEST_BLOCK4_good', cta_tipo: 'formulario',
    cta_valor: '<iframe src="https://api.leadconnectorhq.com/widget/form/abc123"></iframe>',
  });
  const invalidGhl = postGood.status === 400 && postGood.data?.error === 'invalid_ghl_form_embed';
  ok(!invalidGhl, `POST leadconnectorhq NOT rejected as invalid_ghl_form_embed (status=${postGood.status}, error=${postGood.data?.error})`);

  // Cleanup: delete the good test property if created
  if (postGood.status === 200 && (postGood.data?.record?.id || postGood.data?.record?._id)) {
    const delId = postGood.data.record.id || postGood.data.record._id;
    await admin.delete(`/api/property/${delId}`);
    console.log(`  (cleanup: deleted TEST_BLOCK4_good ${delId})`);
  }

  // === 4. Portal público /p/:slug — iframe sandbox render ===
  console.log('\n=== 4. Portal público /p/:slug: iframe render ===');
  // Set property to formulario + valid embed
  const validEmbed = '<iframe src="https://api.leadconnectorhq.com/widget/form/2sQKtWebhtEPRnZlNH2A" style="width:100%;height:600px"></iframe>';
  const setR = await admin.put(`/api/property/${PROPERTY_ID}`, { cta_tipo: 'formulario', cta_valor: validEmbed });
  ok(setR.status === 200, `PUT set formulario+valid embed status 200 (got ${setR.status})`);
  await new Promise((r) => setTimeout(r, 3000));

  const portalUrl = `/p/${PROPERTY_SLUG}?preview=${TENANT_ID_SB}`;
  const portalR = await pub.get(portalUrl);
  ok(portalR.status === 200, `GET ${portalUrl} status 200`);
  const html = String(portalR.data || '');
  ok(html.includes('class="ghl-form-embed"'), 'HTML contains class="ghl-form-embed"');
  const expectedSandbox = 'sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-top-navigation-by-user-activation"';
  ok(html.includes(expectedSandbox), `HTML contains exact sandbox attribute`);
  ok(html.includes('api.leadconnectorhq.com/widget/form/2sQKtWebhtEPRnZlNH2A'), 'HTML contains the iframe src');
  // Mobile CTA should NOT appear
  const hasMobileCta = /<div class="mobile-cta">/.test(html);
  ok(!hasMobileCta, 'mobile-cta div NOT rendered when valid formulario embed');

  // Fallback: invalid embed => cae al fallback global (whatsapp)
  console.log('\n=== 5. Portal público: fallback si formulario inválido ===');
  // Note: server-side validation blocks setting invalid via API. But if it was
  // saved historically (or empty), the public route should fall back. Test
  // with EMPTY cta_valor while cta_tipo='formulario'.
  const setEmpty = await admin.put(`/api/property/${PROPERTY_ID}`, { cta_tipo: 'formulario', cta_valor: '' });
  ok(setEmpty.status === 200, `PUT cta_tipo=formulario + cta_valor='' status 200 (got ${setEmpty.status})`);
  await new Promise((r) => setTimeout(r, 3000));
  const portalR2 = await pub.get(portalUrl);
  const html2 = String(portalR2.data || '');
  ok(!html2.includes('class="ghl-form-embed"'), 'fallback: NO ghl-form-embed div');
  ok(/href="https:\/\/wa\.me\//.test(html2), 'fallback: WhatsApp link rendered');

  // === 6. Bug color_principal ===
  console.log('\n=== 6. Bug color_principal ===');
  const { data: brandRow } = await sb.from('configuracion_marca').select('color_principal').eq('tenant_id', TENANT_ID_SB).maybeSingle();
  ok(brandRow?.color_principal === '#6e6964', `SB color_principal = '#6e6964' (got '${brandRow?.color_principal}')`);
  ok(html.includes('--color-primary: #6e6964') || html.includes('--color-primary:#6e6964'), `HTML CSS contains '--color-primary: #6e6964'`);

  // === Rollback ===
  // Per request instructions: rollback to cta_tipo='global' to avoid leaving the
  // public portal showing test embeds.
  console.log('\n=== Rollback ===');
  const rollback = await admin.put(`/api/property/${PROPERTY_ID}`, {
    cta_tipo: 'global', cta_valor: '',
  });
  console.log(`  rollback status: ${rollback.status} (cta_tipo=global, original was cta_tipo=${origCtaTipo})`);

  console.log(`\n===== ${passed} passed, ${failed} failed =====`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
