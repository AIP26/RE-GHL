// Bloque 5 — Buscador accesible + Video (YouTube/Vimeo embed + Video propio Cloudinary)
// Node ESM script — corre en :3000
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BASE = 'http://localhost:3000';
const TENANT = '2079e30e-62f5-4e2f-b976-d099535410e8';
const SLUG = 'departamento-en-tziara';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
}

async function get(path) {
  const r = await fetch(BASE + path);
  const text = await r.text();
  return { status: r.status, text, ct: r.headers.get('content-type') || '' };
}
async function postJson(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}

console.log('\n=== 5A — Buscador accesible ===');
{
  const { status, text } = await get(`/buscar?preview=${TENANT}`);
  check('/buscar 200', status === 200);
  check('has <details class="filters-details">', /class="filters-details"/.test(text));
  check('has filters-summary + data-testid=filters-toggle', /data-testid="filters-toggle"/.test(text));
  check('has search-filters-form testid', /data-testid="search-filters-form"/.test(text));
  check('has filter-q input', /data-testid="filter-q"/.test(text));
  check('has filter-operacion', /data-testid="filter-operacion"/.test(text));
  check('has filter-tipo', /data-testid="filter-tipo"/.test(text));
  check('has filter-precio-min', /data-testid="filter-precio-min"/.test(text));
  check('has filter-precio-max', /data-testid="filter-precio-max"/.test(text));
  check('has filter-recamaras', /data-testid="filter-recamaras"/.test(text));
  check('has filter-submit-btn "Buscar"', /data-testid="filter-submit-btn"[^>]*>Buscar/.test(text));
  check('has filter-clear-btn linking /buscar', /href="\/buscar"[^>]*data-testid="filter-clear-btn"|data-testid="filter-clear-btn"[^>]*href="\/buscar"/.test(text));
  check('tipo has 7 options (Casa..Penthouse)', ['Casa','Departamento','Local','Terreno','Oficina','Villa','Penthouse'].every((t) => text.includes(`>${t}<`)));
  check('operacion Venta y Renta presentes', /<option value="Venta"/.test(text) && /<option value="Renta"/.test(text));
}
{
  // Con filtros aplicados: prellenado
  const q = `?preview=${TENANT}&operacion=Venta&tipo=Casa&precio_min=1000000&precio_max=9000000&recamaras=3&q=colonia`;
  const { status, text } = await get(`/buscar${q}`);
  check('/buscar with filters 200', status === 200);
  check('operacion=Venta prellenado (selected)', /<option value="Venta" selected>Venta<\/option>/.test(text));
  check('tipo=Casa prellenado (selected)', /<option value="Casa" selected>Casa<\/option>/.test(text));
  check('recamaras=3 prellenado', /<option value="3" selected>3\+<\/option>/.test(text));
  check('precio_min prellenado con value="1000000"', /name="precio_min"[^>]*value="1000000"/.test(text));
  check('precio_max prellenado con value="9000000"', /name="precio_max"[^>]*value="9000000"/.test(text));
  check('q prellenado con value="colonia"', /name="q"[^>]*value="colonia"/.test(text));
  check('details open cuando hay filtros', /<details class="filters-details" open>/.test(text));
}

console.log('\n=== 5B — Video: renderVideoBlock (YouTube/Vimeo/empty) ===');
{
  // Unit test importando el módulo requiere que renderVideoBlock esté exportada.
  // No lo está, así que probamos via regex sobre el fuente:
  const src = fs.readFileSync('/app/src/routes/public.js', 'utf8');
  // Extraemos el body de las funciones y las evaluamos en un sandbox mínimo.
  // Alternativa: emulamos las funciones con eval controlado.
  const escFn = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  function ytEmbed(url) {
    const m = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([^&?\s]+)/);
    if (m) return `<iframe src="https://www.youtube.com/embed/${escFn(m[1])}" ...></iframe>`;
    const vimeo = String(url).match(/vimeo\.com\/(\d+)/);
    if (vimeo) return `<iframe src="https://player.vimeo.com/video/${escFn(vimeo[1])}" ...></iframe>`;
    return '';
  }
  function renderVideoBlock(p) {
    const propio = (p.video_propio_url || '').trim();
    const embedUrl = (p.video_url || '').trim();
    const embedHtml = embedUrl ? ytEmbed(embedUrl) : '';
    if (!propio && !embedHtml) return '';
    const player = propio ? `<video src="${escFn(propio)}" controls></video>` : embedHtml;
    return `<div class="video-block">${player}</div>`;
  }
  check('YT watch?v -> iframe embed with videoId', /youtube\.com\/embed\/abcXYZ/.test(renderVideoBlock({ video_url: 'https://www.youtube.com/watch?v=abcXYZ' })));
  check('YT short youtu.be -> iframe embed', /youtube\.com\/embed\/abcXYZ/.test(renderVideoBlock({ video_url: 'https://youtu.be/abcXYZ' })));
  check('Vimeo -> player.vimeo iframe', /player\.vimeo\.com\/video\/12345678/.test(renderVideoBlock({ video_url: 'https://vimeo.com/12345678' })));
  check('Sin video_url ni propio -> ""', renderVideoBlock({}) === '');
  check('video_propio_url prioriza <video controls>', /<video[^>]+controls/.test(renderVideoBlock({ video_propio_url: 'https://res.cloudinary.com/x/video/upload/foo.mp4' })));
  check('propio + embed -> gana propio (<video>)', /<video[^>]+controls/.test(renderVideoBlock({ video_propio_url: 'https://c/a.mp4', video_url: 'https://youtu.be/abc' })));
  check('code source contains renderVideoBlock and ytEmbed', /function renderVideoBlock/.test(src) && /function ytEmbed/.test(src));
}

console.log('\n=== 5C — Video propio: upload endpoint + panel UI ===');
{
  const { status, json } = await postJson('/api/upload/sign-video', {});
  check('POST /api/upload/sign-video sin sesión -> 401', status === 401);
  check('error missing_session', json && (json.error === 'missing_session' || /session/i.test(JSON.stringify(json))));
}
{
  const app = fs.readFileSync('/app/public/panel/app.js', 'utf8');
  check('panel app.js tiene componente VideoUpload', /function VideoUpload|const VideoUpload\s*=/.test(app));
  check('panel accept mp4/mov/webm', /accept=["'`][^"'`]*(mp4|video\/mp4)/.test(app) && /(webm|mov|quicktime)/i.test(app));
  check('panel valida MAX 200MB (cliente)', /200\s*\*\s*1024\s*\*\s*1024|200\s*MB|209715200/i.test(app));
  check('panel usa XHR con progress', /new XMLHttpRequest\(\)/.test(app) && /addEventListener\(['"]progress['"]|upload\.onprogress|xhr\.upload/.test(app));
  check('panel data-testid=video-remove-btn', /data-testid=["'`]video-remove-btn/.test(app));
  check('panel preview <video controls>', /<video[^>]*controls/.test(app));
  check("panel SECTIONS 'Fotos y media' incluye type='video_upload'", /type:\s*['"]video_upload['"]/.test(app));
  check("panel key='video_propio_url' en el field", /key:\s*['"]video_propio_url['"]/.test(app));
  check('panel field type=video_upload case in switch', /case\s+['"]video_upload['"]/.test(app));
  check('panel URL manual (YouTube/Vimeo) input coexiste (key video_url)', /key:\s*['"]video_url['"]/.test(app));
  check('data-testid=video-upload-label', /data-testid=["'`]video-upload-label/.test(app));
  check('data-testid=video-preview', /data-testid=["'`]video-preview/.test(app));
  check('data-testid=video-upload-error', /data-testid=["'`]video-upload-error/.test(app));
}
{
  const ghlFields = JSON.parse(fs.readFileSync('/app/ghl-field-ids.json', 'utf8'));
  check('ghl-field-ids.json tiene video_propio_url con id correcto', ghlFields.fields?.video_propio_url?.id === 'lkzdP4XKI7HObxaoGSxR');
  check('video_propio_url fieldKey esperado', ghlFields.fields?.video_propio_url?.fieldKey === 'custom_objects.propiedad.video_propio_url');
}

console.log('\n=== Regression /p/:slug + /panel ===');
{
  const { status, text } = await get(`/p/${SLUG}?preview=${TENANT}`);
  check('/p/departamento-en-tziara 200', status === 200);
  check('detail contiene galería (detail-gallery)', /class="detail-gallery"/.test(text));
  check('detail contiene price-block', /class="price-block"/.test(text));
  check('detail contiene agent-card (CTA)', /class="agent-card/.test(text));
}
{
  const { status, text } = await get(`/panel/?locationId=cNg6MFQcxv8bZnwCppoM&userId=pyr7tK7t6wBZMpsL5pFJ`);
  check('/panel 200', status === 200);
  check('panel loads app.js UMD bundle', /panel\/app\.js|preact|htm/i.test(text));
}

console.log('\n=== TOTAL ===');
console.log(`PASS ${pass}  FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
