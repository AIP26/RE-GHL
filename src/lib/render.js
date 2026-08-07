// Helpers de render para el portal público (Paso 9).
// Templates como funciones de JS — sin engine externo. Escape obligatorio
// en todo valor proveniente de DB/GHL.

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
export function esc(v) {
  if (v == null) return '';
  return String(v).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

/** Sanitiza un color hex. Acepta #RGB / #RRGGBB. Devuelve null si inválido. */
export function safeColor(v, fallback = null) {
  if (typeof v !== 'string') return fallback;
  const t = v.trim();
  return /^#([0-9a-fA-F]{3}){1,2}$/.test(t) ? t : fallback;
}

/** Formato de precio. Por defecto en USD con separador de miles. */
export function fmtPrice(n, currency = 'USD') {
  if (n == null || n === '') return '';
  const num = Number(n);
  if (!Number.isFinite(num)) return '';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(num);
}

/** Resuelve qué precios mostrar para una propiedad.
 *
 *  Orden de prioridad:
 *    1) Campos nuevos `precio_principal` + `moneda_principal`
 *       (con `precio_secundario` + `moneda_secundaria` opcionales).
 *    2) FALLBACK para propiedades antiguas NUNCA migradas:
 *       `precio_usd` → USD principal, `precio_mxn` → MXN secundario.
 *
 *  Devuelve `{ principal, secundario }` donde cada uno es
 *  `{ amount, currency, formatted }` o `null` si no aplica.
 *
 *  `precio_a_consultar`: devuelve formatted="Consultar precio" en principal.
 */
export function getDisplayPrices(p) {
  if (!p) return { principal: null, secundario: null };
  if (p.precio_a_consultar) {
    return { principal: { amount: null, currency: null, formatted: 'Consultar precio' }, secundario: null };
  }

  // 1) Campos nuevos
  if (p.precio_principal != null && p.precio_principal !== '' && p.moneda_principal) {
    const principal = {
      amount: Number(p.precio_principal),
      currency: String(p.moneda_principal).toUpperCase(),
      formatted: fmtPrice(p.precio_principal, String(p.moneda_principal).toUpperCase()),
    };
    let secundario = null;
    if (p.precio_secundario != null && p.precio_secundario !== '' && p.moneda_secundaria) {
      secundario = {
        amount: Number(p.precio_secundario),
        currency: String(p.moneda_secundaria).toUpperCase(),
        formatted: fmtPrice(p.precio_secundario, String(p.moneda_secundaria).toUpperCase()),
      };
    }
    return { principal, secundario };
  }

  // 2) Fallback legacy
  if (p.precio_usd != null && p.precio_usd !== '') {
    const principal = { amount: Number(p.precio_usd), currency: 'USD', formatted: fmtPrice(p.precio_usd, 'USD') };
    const secundario = (p.precio_mxn != null && p.precio_mxn !== '')
      ? { amount: Number(p.precio_mxn), currency: 'MXN', formatted: fmtPrice(p.precio_mxn, 'MXN') }
      : null;
    return { principal, secundario };
  }
  if (p.precio_mxn != null && p.precio_mxn !== '') {
    return {
      principal: { amount: Number(p.precio_mxn), currency: 'MXN', formatted: fmtPrice(p.precio_mxn, 'MXN') },
      secundario: null,
    };
  }

  return { principal: null, secundario: null };
}

/** URL absoluta del portal (https + subdominio). */
export function portalUrl(brand, pathname = '/') {
  const host = brand?.subdominio || 'listings.mktscaled.com';
  const safe = pathname.startsWith('/') ? pathname : '/' + pathname;
  return `https://${host}${safe}`;
}

/** Embebido de Google Maps por lat/lng (sin API key — el iframe gratuito). */
export function mapsEmbedHref(lat, lng) {
  if (!lat || !lng) return '';
  return `https://www.google.com/maps?q=${encodeURIComponent(lat + ',' + lng)}&output=embed&z=15`;
}
export function mapsViewHref(lat, lng) {
  if (!lat || !lng) return '';
  return `https://www.google.com/maps?q=${encodeURIComponent(lat + ',' + lng)}`;
}

/** Parsea las URLs de fotos guardadas en GHL como "url1|url2|url3". */
export function parsePhotos(value) {
  if (!value || typeof value !== 'string') return [];
  return value.split('|').map((s) => s.trim()).filter(Boolean);
}

/** Cloudinary transform helper. Si la URL es de res.cloudinary.com,
 *  inserta el segmento de transformación tras /upload/. */
export function cld(url, transform) {
  if (!url || typeof url !== 'string' || !transform) return url;
  if (!url.includes('/upload/')) return url;
  return url.replace('/upload/', `/upload/${transform}/`);
}

/** Genera el bloque <head> con CSS vars, SEO y meta tags. */
export function head({
  title,
  ogTitle,
  description = '',
  brand,
  ogImage,
  ogUrl,
  canonical,
  noindex = false,
  pixelFacebook = null,
}) {
  const primary = safeColor(brand?.color_principal, '#0f172a');
  const secondary = safeColor(brand?.color_secundario, '#1e293b');
  const accent = safeColor(brand?.color_acento, '#f59e0b');
  const ga4 = brand?.ga4_tag;
  const _ogTitle = ogTitle || title;

  return `
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}" />` : ''}
${noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${canonical ? `<link rel="canonical" href="${esc(canonical)}" />` : ''}
<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(_ogTitle)}" />
${description ? `<meta property="og:description" content="${esc(description)}" />` : ''}
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}" />` : ''}
${ogUrl ? `<meta property="og:url" content="${esc(ogUrl)}" />` : ''}
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" type="image/x-icon" href="/favicon.ico" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="preconnect" href="https://res.cloudinary.com" crossorigin />
<style>${baseStyles({ primary, secondary, accent })}</style>
<script>
// BLOQUE P6 — Compartir la URL actual via Web Share API con fallback a
// clipboard + toast simple. Vinculado desde onclick="return window.__mktShareCurrent(this)"
// en los botones .share-btn-mobile emitidos por renderCTA.
(function() {
  function showToast(msg) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:9999;background:#0f172a;color:#fff;padding:10px 16px;border-radius:8px;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.18);opacity:0;transition:opacity .2s ease';
    document.body.appendChild(t);
    requestAnimationFrame(function() { t.style.opacity = '1'; });
    setTimeout(function() { t.style.opacity = '0'; setTimeout(function() { t.remove(); }, 300); }, 2200);
  }
  window.__mktShareCurrent = async function(btn) {
    var url = window.location.href;
    var title = (btn && btn.getAttribute('data-share-title')) || document.title;
    var text = (btn && btn.getAttribute('data-share-text')) || 'Mira esta propiedad';
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ title: title, text: text, url: url }); return false; }
      catch (e) { if (e && e.name === 'AbortError') return false; /* fallthrough */ }
    }
    try { await navigator.clipboard.writeText(url); showToast('URL copiada ✓'); }
    catch (e) { showToast('No pude copiar'); }
    return false;
  };
})();
</script>
${ga4 ? `
<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(ga4)}"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${esc(ga4)}');
</script>` : ''}
${pixelFacebook ? `
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${esc(pixelFacebook)}');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${esc(pixelFacebook)}&ev=PageView&noscript=1"
/></noscript>` : ''}
</head>
<body>`;
}

function baseStyles({ primary, secondary, accent }) {
  return `
:root {
  --color-primary: ${primary};
  --color-secondary: ${secondary};
  --color-accent: ${accent};
  --color-text: #0f172a;
  --color-text-muted: #64748b;
  --color-bg: #ffffff;
  --color-surface: #ffffff;
  --color-border: #e5e7eb;
  --color-muted: #f8fafc;
  --shadow-sm: 0 1px 2px rgba(0,0,0,.06);
  --shadow: 0 4px 16px rgba(0,0,0,.08);
  --radius: 14px;
  --radius-sm: 8px;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: var(--color-text);
  background: var(--color-bg);
  -webkit-font-smoothing: antialiased;
  line-height: 1.45;
}
a { color: var(--color-primary); text-decoration: none; }
img { max-width: 100%; height: auto; display: block; }
.container { max-width: 1200px; margin: 0 auto; padding: 0 16px; }
@media (min-width: 768px) { .container { padding: 0 24px; } }
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 12px 18px; border-radius: 999px;
  font-weight: 600; font-size: 14px;
  background: var(--color-primary); color: #fff;
  border: 0; cursor: pointer; text-decoration: none;
  transition: transform .05s, box-shadow .15s, background .15s;
}
.btn:hover { box-shadow: var(--shadow); transform: translateY(-1px); }
.btn-accent { background: var(--color-accent); color: #1a1300; }
.btn-ghost { background: transparent; color: var(--color-primary); border: 1px solid var(--color-border); }
.btn-block { display: flex; width: 100%; }

/* Header de marca (colección/detalle/búsqueda) */
.brand-header {
  position: sticky; top: 0; z-index: 30;
  background: rgba(255,255,255,.96);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--color-border);
}
.brand-header .row { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; gap: 16px; }
.brand-header .logo { display: flex; align-items: center; gap: 10px; color: var(--color-primary); font-weight: 800; font-size: 18px; }
.brand-header .logo img { height: 36px; width: auto; }
.brand-header nav a { color: var(--color-text); font-size: 14px; font-weight: 500; }
@media (max-width: 640px) { .brand-header nav { display: none; } }

/* Hero (home) */
.hero {
  position: relative;
  min-height: 78vh;
  display: flex; align-items: center;
  background: var(--color-secondary);
  color: #fff;
  overflow: hidden;
}
.hero::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(0,0,0,.35) 0%, rgba(0,0,0,.55) 100%);
}
.hero-bg { position: absolute; inset: 0; object-fit: cover; width: 100%; height: 100%; }
.hero-content { position: relative; z-index: 2; width: 100%; padding: 60px 0; }
.hero-content h1 { font-size: 32px; font-weight: 800; margin: 0 0 8px; letter-spacing: -.02em; }
.hero-content p { font-size: 16px; opacity: .9; margin: 0 0 24px; }
@media (min-width: 768px) { .hero-content h1 { font-size: 52px; } .hero-content p { font-size: 19px; } }

/* Search box */
.search-box {
  background: #fff; color: var(--color-text);
  border-radius: var(--radius);
  padding: 12px;
  display: grid; gap: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,.18);
}
@media (min-width: 768px) {
  .search-box {
    grid-template-columns: 1fr 1fr 2fr auto;
    padding: 10px;
  }
}
.search-box select, .search-box input {
  width: 100%; padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 14px; font-family: inherit;
}
@media (min-width: 768px) {
  .search-box select, .search-box input { border: 0; padding: 14px; }
}

/* Section */
.section { padding: 40px 0; }
.section-title { font-size: 22px; font-weight: 800; margin: 0 0 18px; letter-spacing: -.01em; }
@media (min-width: 768px) { .section-title { font-size: 28px; } }

/* Cards grid */
.cards-grid {
  display: grid; gap: 16px;
  grid-template-columns: 1fr;
}
@media (min-width: 640px) { .cards-grid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1024px) { .cards-grid { grid-template-columns: repeat(3, 1fr); } }

.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
  display: flex; flex-direction: column;
  transition: transform .12s, box-shadow .15s;
}
.card:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
.card a.cover-link { display: block; }
.card .cover {
  position: relative; aspect-ratio: 4/3; background: var(--color-muted);
}
.card .cover img { width: 100%; height: 100%; object-fit: cover; }
.card .tag {
  position: absolute; top: 10px; left: 10px;
  background: var(--color-accent); color: #1a1300;
  padding: 4px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px;
}
.card .body { padding: 14px 14px 16px; display: flex; flex-direction: column; gap: 6px; }
.card .price { font-size: 19px; font-weight: 800; color: var(--color-primary); }
.card .price-mxn { font-size: 12px; color: var(--color-text-muted); }
.card .title { font-size: 15px; font-weight: 700; color: var(--color-text); margin: 0; line-height: 1.3; }
.card .loc { font-size: 13px; color: var(--color-text-muted); }
.card .stats {
  display: flex; gap: 12px; font-size: 12px; color: var(--color-text-muted);
  border-top: 1px solid var(--color-border); padding-top: 10px; margin-top: 6px;
}
.card .stats span { display: inline-flex; align-items: center; gap: 4px; }

/* Empty state */
.empty {
  text-align: center; padding: 40px 16px;
  border: 1px dashed var(--color-border); border-radius: var(--radius);
  color: var(--color-text-muted);
}

/* Detail page */
/* Legacy grid-gallery — mantenido por compatibilidad, deprecated. */
.detail-gallery {
  display: grid; gap: 6px;
  grid-template-columns: 1fr;
}
@media (min-width: 768px) {
  .detail-gallery {
    grid-template-columns: 3fr 2fr;
    grid-template-rows: 200px 200px;
  }
  .detail-gallery > a:first-child { grid-row: span 2; }
}
.detail-gallery a {
  display: block; aspect-ratio: 4/3; overflow: hidden; border-radius: var(--radius-sm);
  background: var(--color-muted);
}
@media (min-width: 768px) { .detail-gallery a { aspect-ratio: auto; height: 100%; } }
.detail-gallery img { width: 100%; height: 100%; object-fit: cover; }

/* --- Gallery v2 (BLOQUE 7) — hero + thumbnails horizontales --- */
.gallery-v2 { display: block; }
.gallery-v2 .g-hero {
  display: block; width: 100%; height: 280px; overflow: hidden;
  border-radius: var(--radius); background: var(--color-muted); cursor: zoom-in;
  position: relative;
}
.gallery-v2 .g-hero img {
  width: 100%; height: 100%; object-fit: cover; display: block;
  transition: transform .4s ease;
}
.gallery-v2 .g-hero:hover img { transform: scale(1.02); }
@media (min-width: 768px) { .gallery-v2 .g-hero { height: 500px; } }

.gallery-v2 .thumbs {
  display: flex; gap: 6px; margin-top: 6px;
  overflow-x: auto; overflow-y: hidden;
  scroll-snap-type: x proximity; -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  padding-bottom: 2px; /* espacio para scrollbar en desktop */
}
.gallery-v2 .thumbs::-webkit-scrollbar { height: 4px; }
.gallery-v2 .thumbs::-webkit-scrollbar-thumb { background: rgba(0,0,0,.2); border-radius: 2px; }
.gallery-v2 .thumb {
  position: relative; flex: 0 0 auto;
  height: 64px; width: 96px; overflow: hidden; border-radius: 6px;
  background: var(--color-muted); cursor: pointer; scroll-snap-align: start;
  transition: opacity .2s ease;
}
.gallery-v2 .thumb:hover { opacity: .85; }
.gallery-v2 .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
@media (min-width: 768px) {
  .gallery-v2 .thumb { height: 80px; width: 120px; }
}

.detail-grid {
  display: grid; gap: 24px;
}
@media (min-width: 900px) { .detail-grid { grid-template-columns: 1fr 320px; align-items: start; } }
.detail-side { position: sticky; top: 80px; }

.price-block { padding: 18px 0; border-bottom: 1px solid var(--color-border); }
.price-block .usd { font-size: 32px; font-weight: 800; color: var(--color-primary); letter-spacing: -.02em; }
.price-block .mxn { color: var(--color-text-muted); font-size: 14px; margin-top: 4px; }

.stats-row {
  display: grid; grid-template-columns: repeat(2, 1fr);
  gap: 12px; padding: 16px 0;
  border-bottom: 1px solid var(--color-border);
}
@media (min-width: 480px) { .stats-row { grid-template-columns: repeat(4, 1fr); } }
.stat-cell { background: var(--color-muted); padding: 10px 12px; border-radius: var(--radius-sm); }
.stat-cell .l { font-size: 11px; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .3px; }
.stat-cell .v { font-size: 16px; font-weight: 700; }

.amenities { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 0; }
.amenities .chip { background: var(--color-muted); padding: 6px 12px; border-radius: 999px; font-size: 12px; color: var(--color-text); }

.map-frame { width: 100%; aspect-ratio: 4/3; border: 0; border-radius: var(--radius-sm); }

.agent-card {
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius); padding: 18px;
  display: flex; flex-direction: column; gap: 12px;
}
.agent-card-top { display: flex; align-items: center; gap: 12px; }
.agent-card-top img { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; }
.agent-card-top .ph { width: 56px; height: 56px; border-radius: 50%; background: var(--color-primary); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 22px; }
.agent-card-name { font-weight: 700; }
.agent-card-rol { font-size: 11px; color: var(--color-text-muted); text-transform: uppercase; }

/* Bottom bar móvil con CTA principal */
.mobile-cta {
  position: fixed; bottom: 0; left: 0; right: 0;
  background: #fff;
  border-top: 1px solid var(--color-border);
  padding: 10px 12px;
  display: flex; gap: 8px; z-index: 60;
  box-shadow: 0 -4px 16px rgba(0,0,0,.08);
}
.mobile-cta .btn { flex: 1; padding: 14px 18px; font-size: 15px; }
@media (min-width: 900px) { .mobile-cta { display: none; } }

/* GHL Form / Calendar embed (BLOQUE P4 FIX 1 — sin scrollbars).
 *   - Iter previa clampeaba a 500/600 con overflow-y: auto → scrollbars
 *     visibles cuando el widget de GHL era más alto que el cap. Nuevo
 *     enfoque: contenedor overflow:hidden, iframe con min-height 650px
 *     que se expande según el widget. El scroll natural de la página
 *     es suficiente — el visitante ya está en modo scroll vertical de
 *     la ficha completa. */
.ghl-form-embed {
  margin-top: 16px;
  border-radius: 10px;
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border);
  overflow: hidden;
  width: 100%;
}
.ghl-form-heading {
  margin: 0;
  padding: 18px 16px 18px 20px;
  border-left: 4px solid var(--color-primary, #0ea5e9);
  border-bottom: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-primary, #0ea5e9) 6%, #fff);
  color: var(--color-primary, #0ea5e9);
  font-size: 22px;
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -.015em;
}
@media (min-width: 768px) {
  .ghl-form-heading { font-size: 26px; padding: 20px 18px 20px 22px; }
}
.ghl-form-embed-inner {
  overflow: hidden;
  width: 100%;
  display: block;
}
.ghl-form-embed-inner iframe {
  display: block;
  width: 100% !important;
  border: 0;
  min-height: 650px;
}
/* Calendarios GHL suelen necesitar más alto que forms simples. */
.ghl-form-embed[data-kind="calendar"] .ghl-form-embed-inner iframe { min-height: 780px; }

/* PDF button placement (BLOQUE P4 FIX 2 — antes del embed en TODOS los viewports).
 *   Iter previa (P3) ponía PDF en order:4 en desktop → aparecía DEBAJO del
 *   embed. El agente quería el PDF visible sin scrollear el calendario, por
 *   eso ahora lo dejamos en order:2 tanto en mobile como desktop (entre
 *   datos del agente order:1 y embed order:3). */
.agent-card > .agent-card-top { order: 1; }
.agent-card > .agent-contact-lines { order: 1; }
.agent-card > .pdf-btn { order: 2; }
.agent-card > .share-btn-mobile { order: 2; }
.agent-card > .ghl-form-embed { order: 3; }
.agent-card > .btn.btn-block { order: 3; } /* CTA fallback WhatsApp */

/* BLOQUE P6 — Botón "Compartir" sólo visible en mobile (< 768px).
 * Ficheros server-rendered; usamos display:none con media query pura. */
.share-btn-mobile { display: none; }
@media (max-width: 767px) {
  .share-btn-mobile { display: block; }
}

/* Widget WhatsApp flotante */
.wa-fab {
  position: fixed; bottom: 80px; right: 16px;
  width: 56px; height: 56px; border-radius: 50%;
  background: #25d366; color: #fff;
  display: flex; align-items: center; justify-content: center;
  text-decoration: none; box-shadow: 0 8px 24px rgba(37, 211, 102, .35);
  z-index: 55;
  transition: transform .15s;
}
.wa-fab:hover { transform: scale(1.08); }
@media (min-width: 900px) { .wa-fab { bottom: 24px; } }

/* Footer */
footer.site-foot {
  background: var(--color-secondary); color: #cbd5e1;
  padding: 32px 0 24px; margin-top: 60px;
}
footer.site-foot .row { display: grid; gap: 18px; }
@media (min-width: 768px) { footer.site-foot .row { grid-template-columns: 2fr 1fr 1fr; } }
footer.site-foot .brand { color: #fff; font-weight: 800; font-size: 18px; }
footer.site-foot a { color: #cbd5e1; }
footer.site-foot a:hover { color: #fff; }
footer.site-foot .associations { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px; align-items: center; }
footer.site-foot .associations img { height: 36px; width: auto; opacity: .9; }

/* Filters */
.filters {
  background: var(--color-muted);
  padding: 14px;
  border-radius: var(--radius);
  display: grid; gap: 10px;
  grid-template-columns: repeat(2, 1fr);
  margin-bottom: 22px;
}
@media (min-width: 768px) { .filters { grid-template-columns: repeat(6, 1fr); } }
.filters select, .filters input { width: 100%; padding: 10px 12px; border-radius: var(--radius-sm); border: 1px solid var(--color-border); font-size: 14px; background: #fff; }
.filters-actions { grid-column: 1 / -1; display: flex; gap: 8px; flex-wrap: wrap; }
.filters-actions .btn { flex: 1; min-width: 140px; }
@media (min-width: 768px) { .filters-actions { justify-content: flex-end; } .filters-actions .btn { flex: 0 0 auto; } }

.filters-details { border: 1px solid var(--color-border); border-radius: var(--radius); background: #fff; margin-bottom: 22px; overflow: hidden; }
.filters-details[open] { box-shadow: 0 1px 2px rgba(15,23,42,.04); }
.filters-summary {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; cursor: pointer; font-weight: 700; font-size: 15px;
  list-style: none; user-select: none;
}
.filters-summary::-webkit-details-marker { display: none; }
.filters-summary::after {
  content: '›'; font-size: 22px; color: var(--color-text-muted); transform: rotate(90deg); transition: transform .18s ease;
  margin-left: 8px;
}
.filters-details[open] > .filters-summary::after { transform: rotate(-90deg); }
.filters-summary .filters-hint { font-size: 12px; color: var(--color-text-muted); font-weight: 500; margin-left: auto; margin-right: 10px; }
.filters-form { margin-bottom: 0 !important; border-top: 1px solid var(--color-border); border-radius: 0; }

/* Lightbox simple */
.lightbox {
  position: fixed; inset: 0; background: rgba(0,0,0,.95);
  display: none; align-items: center; justify-content: center;
  z-index: 100; padding: 16px;
}
.lightbox.open { display: flex; }
.lightbox img { max-width: 100%; max-height: 92vh; object-fit: contain; }
.lightbox .close { position: absolute; top: 16px; right: 16px; color: #fff; background: rgba(255,255,255,.15); width: 44px; height: 44px; border-radius: 50%; border: 0; font-size: 22px; cursor: pointer; }
.lightbox .nav { position: absolute; top: 50%; transform: translateY(-50%); color: #fff; background: rgba(255,255,255,.15); width: 44px; height: 44px; border-radius: 50%; border: 0; font-size: 22px; cursor: pointer; }
.lightbox .nav.prev { left: 16px; }
.lightbox .nav.next { right: 16px; }
.lightbox .counter { position: absolute; top: 16px; left: 16px; color: #fff; font-size: 13px; }

/* Organic (Página 5) — sin branding */
.organic-wrap { max-width: 720px; margin: 0 auto; padding: 24px 16px 60px; }
.organic-disclaimer { font-size: 11px; color: #94a3b8; text-align: center; margin-top: 28px; }
`;
}

/** Footer + close body. */
export function footer(brand, { showFooter = true } = {}) {
  if (!showFooter) return '</body></html>';
  return `
<footer class="site-foot">
  <div class="container row">
    <div>
      ${brand?.logo_url ? `<img src="${esc(brand.logo_url)}" alt="${esc(brand.nombre_agencia || '')}" style="height:42px;margin-bottom:10px" />` : `<div class="brand">${esc(brand?.nombre_agencia || 'Propiedades')}</div>`}
      <div style="font-size:13px;margin-top:8px;opacity:.75">© ${new Date().getFullYear()} ${esc(brand?.nombre_agencia || '')}</div>
    </div>
    <div>
      <div style="color:#fff;font-weight:700;margin-bottom:10px">Contacto</div>
      ${brand?.telefono ? `<div><a href="tel:${esc(brand.telefono)}">${esc(brand.telefono)}</a></div>` : ''}
      ${brand?.email ? `<div><a href="mailto:${esc(brand.email)}">${esc(brand.email)}</a></div>` : ''}
      ${brand?.whatsapp ? `<div><a href="https://wa.me/${esc(String(brand.whatsapp).replace(/[^\d]/g, ''))}" rel="noopener">WhatsApp</a></div>` : ''}
    </div>
    <div>
      <div style="color:#fff;font-weight:700;margin-bottom:10px">Síguenos</div>
      ${brand?.facebook ? `<div><a href="${esc(brand.facebook)}" target="_blank" rel="noopener">Facebook</a></div>` : ''}
      ${brand?.instagram ? `<div><a href="${esc(brand.instagram)}" target="_blank" rel="noopener">Instagram</a></div>` : ''}
      ${brand?.linkedin ? `<div><a href="${esc(brand.linkedin)}" target="_blank" rel="noopener">LinkedIn</a></div>` : ''}
      ${brand?.youtube ? `<div><a href="${esc(brand.youtube)}" target="_blank" rel="noopener">YouTube</a></div>` : ''}
      ${(brand?.asociaciones || []).length ? `<div class="associations">${brand.asociaciones.map((a) => `<img src="${esc(a.logo_url)}" alt="${esc(a.nombre)}" title="${esc(a.nombre)}" />`).join('')}</div>` : ''}
    </div>
  </div>
</footer>
</body></html>`;
}

/** Brand header (no para Home — el Home tiene hero). */
export function brandHeader(brand, opts = {}) {
  const homeHref = '/';
  return `
<header class="brand-header">
  <div class="container row">
    <a class="logo" href="${homeHref}">
      ${brand?.logo_url ? `<img src="${esc(brand.logo_url)}" alt="${esc(brand?.nombre_agencia || '')}" />` : esc(brand?.nombre_agencia || 'Inicio')}
    </a>
    <nav>
      <a href="/buscar">Buscar propiedades</a>
      ${brand?.telefono ? `<a href="tel:${esc(brand.telefono)}" style="margin-left:18px;color:var(--color-primary);font-weight:700">${esc(brand.telefono)}</a>` : ''}
    </nav>
  </div>
</header>`;
}

/** Card de propiedad (listado). */
const SVG_ICON = (path) => `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px">${path}</svg>`;
export const ICON_BED = SVG_ICON('<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>');
export const ICON_BATH = SVG_ICON('<path d="M9 6 6.5 3.5a1.5 1.5 0 0 0-1-.5C4.683 3 4 3.683 4 4.5V17a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><line x1="10" y1="5" x2="8" y2="7"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="7" y1="19" x2="7" y2="21"/><line x1="17" y1="19" x2="17" y2="21"/>');
export const ICON_AREA = SVG_ICON('<path d="M3 3h18v18H3z"/><path d="M3 9h18"/><path d="M9 21V9"/>');
export const ICON_CAR = SVG_ICON('<path d="M5 17h14"/><path d="M5 11l1.5-4.5A2 2 0 0 1 8.5 5h7a2 2 0 0 1 2 1.5L19 11"/><circle cx="7.5" cy="14.5" r="1.5"/><circle cx="16.5" cy="14.5" r="1.5"/><rect x="3" y="11" width="18" height="6" rx="2"/>');

export function propertyCard(record) {
  const p = record?.properties || {};
  const photos = parsePhotos(p.fotos_urls);
  const hero = photos[0] ? cld(photos[0], 'c_fill,w_640,h_480,q_auto,f_auto') : '';
  const tag = p.etiqueta && p.etiqueta !== '' ? p.etiqueta : null;
  const slug = p.slug_url || record.id;
  const prices = getDisplayPrices(p);
  const principalText = prices.principal?.formatted || '';
  const secundarioText = prices.secundario?.formatted || '';
  return `
<article class="card">
  <a class="cover-link" href="/p/${esc(slug)}">
    <div class="cover">
      ${hero ? `<img src="${esc(hero)}" alt="${esc(p.titulo || 'Propiedad')}" loading="lazy" />` : ''}
      ${tag ? `<span class="tag">${esc(tag)}</span>` : ''}
    </div>
  </a>
  <div class="body">
    <div class="price">${esc(principalText)}</div>
    ${secundarioText ? `<div class="price-mxn">${esc(secundarioText)}</div>` : ''}
    <h3 class="title"><a href="/p/${esc(slug)}" style="color:inherit">${esc(p.titulo || 'Propiedad')}</a></h3>
    <div class="loc">${esc([p.colonia, p.ciudad].filter(Boolean).join(', '))}</div>
    <div class="stats">
      ${p.recamaras ? `<span>${ICON_BED} ${esc(p.recamaras)} rec</span>` : ''}
      ${p.banos_completos ? `<span>${ICON_BATH} ${esc(p.banos_completos)} baños</span>` : ''}
      ${p.m2_construccion ? `<span>${ICON_AREA} ${esc(p.m2_construccion)} m²</span>` : ''}
    </div>
  </div>
</article>`;
}
