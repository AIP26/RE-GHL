// Test CAD end-to-end: usa la API HTTP del panel (PUT /api/property/:id)
// para setear precio_principal=850000 + moneda_principal=CAD,
// genera el PDF, lee /p/:slug, verifica que ambos muestren CAD correctamente.
import 'dotenv/config';
import fs from 'fs';
import axios from 'axios';
import { findTenantByLocationId } from '../src/lib/tenants.js';
import { getSupabase } from '../src/lib/supabase.js';
import { signSession } from '../src/lib/jwt.js';
import { loadBrand, loadAgents, getPropertyById, listProperties } from '../src/lib/public-data.js';
import { buildPropertyPDF } from '../src/lib/pdf.js';
import { getDisplayPrices } from '../src/lib/render.js';

const LOCATION_ID = 'cNg6MFQcxv8bZnwCppoM';
const BASE = process.env.PROBE_BASE || 'http://localhost:3000';

function ok(cond, msg) { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) process.exitCode = 1; }

async function main() {
  const sb = getSupabase();
  const t = await findTenantByLocationId(LOCATION_ID);
  const { data: ag } = await sb.from('agentes').select('*').eq('tenant_id', t.id).eq('rol', 'admin').limit(1).single();
  const token = signSession({ tenantId: t.id, locationId: t.ghl_location_id, agentId: ag.id, ghlUserId: ag.ghl_user_id, rol: 'admin' });
  const admin = axios.create({ baseURL: BASE, headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true });

  // Pick a property with photos
  const props = await listProperties(t.id, { limit: 5 });
  const target = props.find((p) => String(p.properties?.fotos_urls || '').split('|').filter(Boolean).length >= 3) || props[0];
  console.log('property:', target.id, '·', target.properties?.titulo);

  // ============ UNIT: getDisplayPrices ============
  console.log('\n=== unit: getDisplayPrices() ===');
  let r = getDisplayPrices({ precio_principal: 850000, moneda_principal: 'CAD' });
  ok(r.principal?.currency === 'CAD', 'CAD reconocido: ' + r.principal?.currency);
  ok((r.principal?.formatted || '').match(/CA(D|\$)/), 'CAD format: ' + r.principal?.formatted);

  r = getDisplayPrices({ precio_usd: 230000 });
  ok(r.principal?.currency === 'USD', 'fallback legacy USD: ' + r.principal?.currency);

  r = getDisplayPrices({ precio_a_consultar: true });
  ok(r.principal?.formatted === 'Consultar precio', 'precio_a_consultar OK');

  // Prioridad: nuevos campos ganan sobre legacy
  r = getDisplayPrices({ precio_principal: 100000, moneda_principal: 'CAD', precio_usd: 999999 });
  ok(r.principal?.currency === 'CAD' && r.principal?.amount === 100000, 'nuevo campo gana sobre legacy: ' + r.principal?.formatted);

  // ============ Set property to CAD via API ============
  console.log('\n=== PUT /api/property/:id con CAD ===');
  let resp = await admin.put('/api/property/' + target.id, {
    precio_principal: 850000,
    moneda_principal: 'CAD',
    precio_secundario: 11500000,
    moneda_secundaria: 'MXN',
  });
  ok(resp.status === 200, 'PUT HTTP 200 (got ' + resp.status + ')');

  // Re-fetch
  const fresh = await getPropertyById(t.id, target.id);
  const p = fresh.properties;
  console.log('  → precio_principal =', p.precio_principal, '· moneda_principal =', p.moneda_principal);
  console.log('  → precio_secundario =', p.precio_secundario, '· moneda_secundaria =', p.moneda_secundaria);
  ok(String(p.moneda_principal).toUpperCase() === 'CAD', 'GHL guardó moneda_principal=CAD');
  ok(Number(p.precio_principal) === 850000, 'GHL guardó precio_principal=850000');

  // ============ PDF ============
  console.log('\n=== PDF: precio principal en CAD ===');
  const brand = await loadBrand(t.id);
  const agents = await loadAgents(t.id);
  const agent = agents[p.agente_responsable] || null;
  const doc = await buildPropertyPDF({
    record: fresh, brand, agent, withAgent: true, twoPages: false,
    baseUrl: 'https://test.preview.mktscaled.com',
  });
  const outPath = '/app/public/panel/pdf-preview/con-agente-CAD-test.pdf';
  const ws = fs.createWriteStream(outPath);
  doc.pipe(ws);
  doc.end();
  await new Promise((res, rej) => { ws.on('finish', res); ws.on('error', rej); });
  ok(fs.statSync(outPath).size > 100_000, 'PDF generado (>100KB)');

  // ============ Portal público ============
  console.log('\n=== GET /p/:slug en CAD ===');
  const slug = p.slug_url || target.id;
  const html = (await axios.get(`${BASE}/p/${slug}?preview=${t.id}`, { validateStatus: () => true })).data;
  ok(typeof html === 'string' && html.length > 1000, 'portal HTML recibido (' + (html.length || 0) + ' bytes)');
  const hasAmount = String(html).includes('850,000');
  const hasCADToken = String(html).includes('CA$') || String(html).includes('CAD');
  const hasSecondary = String(html).includes('11,500,000') || String(html).includes('MX$');
  ok(hasAmount, 'portal incluye monto 850,000');
  ok(hasCADToken, 'portal incluye marcador CAD (CA$ o "CAD")');
  ok(hasSecondary, 'portal incluye secundario MXN 11,500,000');

  // ============ /api/v1 también expone los nuevos campos ============
  console.log('\n=== /api/v1/properties/:id ===');
  // crear una API key de prueba
  resp = await admin.post('/api/apikeys', { nombre: 'cad-test-' + Date.now() });
  const apiKey = resp.data?.plain_once;
  const keyId = resp.data?.api_key?.id;
  const v1 = await axios.get(`${BASE}/api/v1/properties/${target.id}`, {
    headers: { 'X-API-Key': apiKey }, validateStatus: () => true,
  });
  ok(v1.status === 200, 'v1 HTTP 200');
  const d = v1.data?.data || {};
  ok(d.precio_principal === 850000, 'v1 expone precio_principal');
  ok(d.moneda_principal === 'CAD', 'v1 expone moneda_principal=CAD');
  ok(d.precio_secundario === 11500000, 'v1 expone precio_secundario');
  ok(d.moneda_secundaria === 'MXN', 'v1 expone moneda_secundaria=MXN');
  // cleanup
  await admin.delete('/api/apikeys/' + keyId);

  // ============ Rollback ============
  console.log('\n=== rollback ===');
  await admin.put('/api/property/' + target.id, {
    precio_principal: 230000,
    moneda_principal: 'USD',
    precio_secundario: 4700000,
    moneda_secundaria: 'MXN',
  });
  console.log('  ✓ valores restaurados');

  console.log('\n=== resumen ===');
  console.log(process.exitCode ? '✗ FAIL' : '✓ PASS — CAD end-to-end OK');
  console.log('PDF preview: ' + outPath.replace('/app/public', ''));
}

main().catch((e) => { console.error('FATAL', e?.response?.status, e?.response?.data || e.message); process.exit(1); });
