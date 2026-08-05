// Generador de flyers 1080×1080 JPEG para redes sociales / WhatsApp.
// Layout basado en diseño de Canva @1080×1080.
// Pipeline: Sharp composite (base crema → foto → gradiente blur → rect precio →
// barra inferior → línea vertical → logo (client only) → SVG con todos
// los textos). Fuente Montserrat embebida vía @font-face (base64 en SVG)
// para que librsvg no dependa del sistema.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FONT_DIR = path.resolve(__dirname, '../../assets/fonts');

// Canvas
const W = 1080;
const H = 1080;
const CREAM = '#f5f0ea';
const DEFAULT_ACCENT = '#75634d';
const TITLE_MAX_CHARS = 30;

// ---------------------------------------------------------------------
// Fuente Montserrat cargada 1 sola vez y cacheada en base64.
// ---------------------------------------------------------------------
let _fontCache = null;
async function loadFonts() {
  if (_fontCache) return _fontCache;
  const [reg, bold] = await Promise.all([
    fs.readFile(path.join(FONT_DIR, 'Montserrat-Regular.ttf')),
    fs.readFile(path.join(FONT_DIR, 'Montserrat-Bold.ttf')),
  ]);
  _fontCache = {
    regularB64: reg.toString('base64'),
    boldB64: bold.toString('base64'),
  };
  return _fontCache;
}

/** Bloque @font-face para embeber en el `<defs>` del SVG. */
function fontFaceDefs({ regularB64, boldB64 }) {
  return `<defs>
    <style>
      @font-face {
        font-family: 'Montserrat';
        font-weight: 400;
        src: url(data:font/ttf;base64,${regularB64}) format('truetype');
      }
      @font-face {
        font-family: 'Montserrat';
        font-weight: 700;
        src: url(data:font/ttf;base64,${boldB64}) format('truetype');
      }
      text { font-family: 'Montserrat', 'DejaVu Sans', 'Liberation Sans', 'Noto Sans', sans-serif; }
    </style>
  </defs>`;
}

// ---------------------------------------------------------------------
// Cloudinary → JPEG
// ---------------------------------------------------------------------
function asJpg(url, width = 1400) {
  if (!url || typeof url !== 'string' || !url.includes('/upload/')) return url;
  const transform = `f_jpg,q_auto:good,c_limit,w_${width}`;
  const re = /\/upload\/(?:[^/]+\/)?(v\d+\/)/;
  if (re.test(url)) return url.replace(re, `/upload/${transform}/$1`);
  return url.replace('/upload/', `/upload/${transform}/`);
}
function asPngNoQ(url, width = 400) {
  if (!url || typeof url !== 'string' || !url.includes('/upload/')) return url;
  const transform = `f_png,c_limit,w_${width}`;
  const re = /\/upload\/(?:[^/]+\/)?(v\d+\/)/;
  if (re.test(url)) return url.replace(re, `/upload/${transform}/$1`);
  return url.replace('/upload/', `/upload/${transform}/`);
}
async function fetchBuffer(url, { timeout = 12_000 } = {}) {
  if (!url) return null;
  try {
    const { data } = await axios.get(url, { responseType: 'arraybuffer', timeout });
    return Buffer.from(data);
  } catch (err) {
    console.warn('[flyer] fetch image failed:', url, err.message);
    return null;
  }
}

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(s, max) {
  const str = String(s || '');
  if (str.length <= max) return str;
  return str.slice(0, max - 1).trim() + '…';
}

function fitFontSize(text, initialPt, maxWidth) {
  const str = String(text || '');
  if (!str) return initialPt;
  const approx = (pt) => str.length * pt * 0.55;
  let pt = initialPt;
  while (pt > 10 && approx(pt) > maxWidth) pt -= 0.5;
  return Math.round(pt * 10) / 10;
}

// ---------------------------------------------------------------------
// PIPELINE PRINCIPAL
// ---------------------------------------------------------------------
export async function generateFlyer({ property, brand, agent, version, photoUrl }) {
  if (!photoUrl) throw new Error('missing_main_photo');
  const p = property;
  const accent = (brand?.color_principal && /^#[0-9a-fA-F]{6}$/.test(brand.color_principal))
    ? brand.color_principal
    : DEFAULT_ACCENT;
  const fonts = await loadFonts();

  // ---- Descargar assets en paralelo -------------------------------------
  const [photoBuf, logoBuf] = await Promise.all([
    fetchBuffer(asJpg(photoUrl, 1400)),
    version === 'client' && brand?.logo_url
      ? fetchBuffer(asPngNoQ(brand.logo_url, 400))
      : Promise.resolve(null),
  ]);
  if (!photoBuf) throw new Error('photo_download_failed');

  // ---- Capa 1: base crema ----------------------------------------------
  const base = sharp({
    create: { width: W, height: H, channels: 4, background: CREAM },
  });

 // ---- Capa 2: foto principal 1080×632, top=226, left=0, opacity=80%
const photoResized = await sharp(photoBuf)
  .resize(1080, 632, { fit: 'cover', position: 'center' })
  .removeAlpha()
  .toBuffer();
  
  // Overlay con opacidad 80% (alpha=0.8)
  const photoWithOpacity = await sharp({
    create: { width: 1087, height: 632, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0.8 } },
  })
    .composite([{ input: photoResized, blend: 'over' }])
    .png()
    .toBuffer();

  // ---- Capa 3: gradiente blur crema (simulado con SVG)
  // En Canva es una imagen blur rotada. Lo simulamos con SVG gradient.
  const gradientSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="270" height="150" viewBox="0 0 270 150">
    <defs>
      <linearGradient id="blurFade" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${CREAM}" stop-opacity="0"/>
        <stop offset="50%" stop-color="${CREAM}" stop-opacity="0.5"/>
        <stop offset="100%" stop-color="${CREAM}" stop-opacity="1"/>
      </linearGradient>
      <filter id="blur">
        <feGaussianBlur stdDeviation="8"/>
      </filter>
    </defs>
    <rect width="270" height="150" fill="url(#blurFade)" filter="url(#blur)"/>
  </svg>`;

  // ---- Capa 4: rectángulo crema precio 270×113, top=818, left=654
  const rectPrecioSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="270" height="113" viewBox="0 0 270 113">
    <rect width="270" height="113" fill="${CREAM}" rx="4"/>
  </svg>`;

  // ---- Capa 5: barra inferior dorada 1080×72, top=852
  const barraSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="72" viewBox="0 0 1080 72">
    <rect width="1080" height="72" fill="${accent}"/>
  </svg>`;

  // ---- Capa 6: líneas divisoras
  const lineasSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
    <!-- Línea vertical negra header x=648, y=209→80 -->
    <line x1="648" y1="209" x2="648" y2="80" stroke="#000000" stroke-width="3"/>
    <!-- Línea crema vertical 1 x=210, y=930→861 -->
    <line x1="210" y1="930" x2="210" y2="861" stroke="${CREAM}" stroke-width="3"/>
    <!-- Línea crema vertical 2 x=434, y=927→858 -->
    <line x1="434" y1="927" x2="434" y2="858" stroke="${CREAM}" stroke-width="3"/>
  </svg>`;

  // ---- Capa 7: SVG con TODOS los textos ---------------------------------
  const nombreCondominio = truncate(p.nombre_condominio || p.titulo || 'Propiedad', TITLE_MAX_CHARS);
  const tipoInmueble = (p.tipo_inmueble || '').toUpperCase();
  const tipoOperacion = p.tipo_operacion || '';
  const colonia = p.colonia || '';
  const direccionFooter = footerAddress(p);
  const precioStr = formatPrice(p);
  const notaPrecio = (p.nota_precio || '').trim();

  const wa = (version === 'client' && agent?.whatsapp) ? String(agent.whatsapp) : '';

  const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
    ${fontFaceDefs(fonts)}
    
    <!-- Header izquierdo: "CASA" x=323, y=39, font=57.7pt -->
    <text x="323" y="96" font-family="Montserrat" font-weight="700" font-size="57.7" fill="${accent}">${esc(tipoInmueble)}</text>
    
    <!-- Header izquierdo: "EN VENTA" x=223, y=121, font=49.2pt -->
    <text x="223" y="170" font-family="Montserrat" font-weight="400" font-size="49.2" fill="#000000">${esc(tipoOperacion)}</text>
    
    <!-- Header derecho: "MALLORCA" x=669, y=76, font=39.7pt -->
    <text x="669" y="116" font-family="Montserrat" font-weight="700" font-size="39.7" fill="${accent}">${esc(nombreCondominio)}</text>
    
    <!-- Header derecho: "POLÍGONO SUR" x=669, y=156, font=27.7pt -->
    <text x="669" y="184" font-family="Montserrat" font-weight="400" font-size="27.7" fill="#000000">${esc(colonia)}</text>
    
    <!-- Precio: x=663, y=806, centrado, font=28.4pt -->
    <text x="789" y="834" font-family="Montserrat" font-weight="700" font-size="28.4" fill="#000000" text-anchor="middle">${esc(precioStr)}</text>
    
    <!-- Nota precio: x=681, y=859, centrado, font=18.4pt -->
    ${notaPrecio ? `<text x="789" y="877" font-family="Montserrat" font-weight="400" font-size="18.4" fill="${accent}" text-anchor="middle">${esc(notaPrecio)}</text>` : ''}
    
    <!-- Stats: "2.5 BAÑOS" x=-13, y=876, centrado, font=16.8pt -->
    <text x="105" y="893" font-family="Montserrat" font-weight="400" font-size="16.8" fill="${CREAM}" text-anchor="middle">${safeNum(p.banos_completos)} BAÑOS</text>
    
    <!-- Stats: "3 RECAMARAS" x=209, y=876, centrado, font=16.8pt -->
    <text x="322" y="893" font-family="Montserrat" font-weight="400" font-size="16.8" fill="${CREAM}" text-anchor="middle">${safeNum(p.recamaras)} RECÁMARAS</text>
    
    <!-- Stats: "2 NIVELES" x=439, y=876, centrado, font=14.8pt -->
    <text x="536" y="893" font-family="Montserrat" font-weight="400" font-size="14.8" fill="${CREAM}" text-anchor="middle">${safeNum(p.niveles)} NIVELES</text>
    
    <!-- Stats: m² (cuarta columna, si aplica) -->
    <text x="750" y="893" font-family="Montserrat" font-weight="400" font-size="14.8" fill="${CREAM}" text-anchor="middle">${safeNum(p.m2_construccion)} M²</text>
    
    <!-- Footer: 📍 + dirección x=122, y=970, font=19.7pt -->
    <text x="122" y="990" font-family="Montserrat" font-weight="400" font-size="19.7" fill="#000000">📍 ${esc(direccionFooter)}</text>
    
    <!-- WhatsApp (solo version=client) -->
    ${wa ? `<text x="122" y="1020" font-family="Montserrat" font-weight="400" font-size="16" fill="#666666">WhatsApp: ${esc(wa)}</text>` : ''}
  </svg>`;

  // ---- Ensamblado -----------------------------------------------------
  const composites = [
    // 2. Foto con opacidad 80%
    { input: photoWithOpacity, top: 226, left: -6 },
    // 3. Gradiente blur
    { input: Buffer.from(gradientSvg), top: 612, left: 714 },
    // 4. Rectángulo crema precio
    { input: Buffer.from(rectPrecioSvg), top: 818, left: 654 },
    // 5. Barra inferior dorada
    { input: Buffer.from(barraSvg), top: 852, left: 0 },
    // 6. Líneas divisoras
    { input: Buffer.from(lineasSvg), top: 0, left: 0 },
  ];

  // 7. Logo (SOLO version=client). 
  // En Canva: 299×269, top=-59, left=-15 (recortado)
  // Sharp no permite offsets negativos, simulamos con recorte
  if (logoBuf) {
    const logoProcessed = await sharp(logoBuf)
      .resize(299, 269, { fit: 'inside', withoutEnlargement: false })
      .extend({
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toBuffer();
    composites.push({ input: logoProcessed, top: 0, left: 0 });
  }

  // 8. SVG con todos los textos (encima de todo)
  composites.push({ input: Buffer.from(textSvg), top: 0, left: 0 });

  const jpegBuf = await base
    .composite(composites)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();

  return jpegBuf;
}

// ---------------------------------------------------------------------
// Helpers de datos
// ---------------------------------------------------------------------
function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function footerAddress(p) {
  const parts = [p.direccion, p.colonia, p.ciudad, p.estado_municipio].filter(Boolean);
  return parts.join(', ') || 'Ubicación disponible bajo consulta';
}

function formatPrice(p) {
  const precio = Number(p.precio_principal || 0);
  const moneda = String(p.moneda_principal || '').toUpperCase() || 'MXN';
  if (!precio) return 'Precio bajo consulta';
  return '$' + precio.toLocaleString('en-US') + ' ' + moneda;
}
