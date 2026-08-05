// Generador de flyers 1000×1000 JPEG para redes sociales / WhatsApp.
// Layout diseñado @1080; escalado con factor k = 1000/1080 ≈ 0.9259.
// Pipeline: Sharp composite (base crema → foto → gradiente → rect precio →
// barra inferior → línea vertical → logo (client only) → SVG con todos
// los textos).  Fuente Montserrat embebida vía @font-face (base64 en SVG)
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
const W = 1000;
const H = 1000;
const CREAM = '#f5f0ea';
const DEFAULT_ACCENT = '#75634d';
const TITLE_MAX_CHARS = 30;  // Máximo 30 caracteres para nombre de condominio

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

/** Bloque @font-face para embeber en el `<defs>` del SVG.  Sin esto,
 *  librsvg (backend de Sharp) no encuentra la fuente en el container. */
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
// Cloudinary → JPEG (mismo patrón que /lib/pdf.js).  Sharp puede leer WebP
// pero forzar JPEG desde Cloudinary evita descargas más pesadas.
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
// Utilidad para escapar texto dentro de SVG (< > & " ').
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

/** Auto-shrink de una línea:  proyecta ancho aprox (chars × fontSize × 0.55)
 *  y reduce el tamaño hasta caber en `maxWidth`.  No trunca. */
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

/**
 * Genera el flyer JPEG 1000×1000.
 *
 * @param {object} args
 * @param {object} args.property   Propiedades planas (titulo, precio_principal, ...)
 * @param {object} [args.brand]    configuracion_marca del tenant
 * @param {object} [args.agent]    Agente creador (whatsapp)
 * @param {'client'|'organic'} args.version
 * @param {string} args.photoUrl   URL de fotos[0]. Obligatoria.
 * @returns {Promise<Buffer>} JPEG buffer
 */
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

  // ---- Capa 2: foto principal cover a 1000×585 en (0, 209), opacidad 80%
  //     Sharp no acepta offsets negativos ni imágenes que excedan el canvas
  //     al hacer composite. Se ajusta a 1000×585 pegado al borde izq.
  const photoResized = await sharp(photoBuf)
    .resize(1000, 585, { fit: 'cover', position: 'center' })
    .removeAlpha()
    .toBuffer();
  const photoOpacityOverlay = await sharp({
    create: { width: 1000, height: 585, channels: 4,
      background: { r: 245, g: 240, b: 234, alpha: 0.20 } },
  }).png().toBuffer();

  // ---- Capa 3: gradiente crema fade en esquina inf-der de la foto -------
  //     De 200 px de ancho × 105 px alto, fade crema→transparente,
  //     ubicado justo antes del rect precio (top 693..798, left 606..806).
  const gradientSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="105" viewBox="0 0 200 105">
  <defs>
    <linearGradient id="fade" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${CREAM}" stop-opacity="0"/>
      <stop offset="100%" stop-color="${CREAM}" stop-opacity="1"/>
    </linearGradient>
  </defs>
  <rect width="200" height="105" fill="url(#fade)"/>
</svg>`;

  // ---- Capas 4-6: shapes (rect precio + barra inferior + línea vertical)
  //     Todos en un solo SVG-shapes para 1 composite call.
  const shapesSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
  <!-- Rectángulo crema detrás del precio -->
  <rect x="606" y="758" width="250" height="105" fill="${CREAM}" rx="4"/>
  
  <!-- Barra inferior de stats -->
  <rect x="0" y="879" width="1000" height="121" fill="${accent}"/>
  
  <!-- Línea vertical divisoria header -->
  <line x1="500" y1="40" x2="500" y2="180" stroke="#000000" stroke-width="2"/>
  
  <!-- Líneas separadoras stats -->
  <line x1="250" y1="879" x2="250" y2="1000" stroke="${CREAM}" stroke-width="3"/>
  <line x1="500" y1="879" x2="500" y2="1000" stroke="${CREAM}" stroke-width="3"/>
  <line x1="750" y1="879" x2="750" y2="1000" stroke="${CREAM}" stroke-width="3"/>
</svg>`;

  // ---- Capa 8: SVG con TODOS los textos ---------------------------------
  const nombreCondominio = truncate(p.nombre_condominio || p.titulo || 'Propiedad', TITLE_MAX_CHARS);
  const tipoInmueble = (p.tipo_inmueble || '').toUpperCase();
  const tipoOperacion = p.tipo_operacion || '';
  const colonia = fitAddress(p);   // dirección_colonia scaled
  const direccionFooter = footerAddress(p);
  const precioStr = formatPrice(p);
  const notaPrecio = (p.nota_precio || '').trim();

  // Autoshrink dirección_colonia si excede ~381px (right edge del canvas
  // menos el margen: 1000 - 619 = 381). Base 25.6pt.
  const coloniaSize = fitFontSize(colonia, 25.6, 381);
  // Auto-shrink del título para que quepa entre x=619 y el borde derecho
  // (margen visual ~20px → maxWidth = 1000 - 619 - 20 = 361).
  const tituloSize = fitFontSize(titulo, 36.8, 361);

  // Stats
  const banos = safeNum(p.banos_completos);
  const recamaras = safeNum(p.recamaras);
  const niveles = safeNum(p.niveles);
  const m2c = safeNum(p.m2_construccion);

  const wa = (version === 'client' && agent?.whatsapp) ? String(agent.whatsapp) : '';

  const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
  ${fontFaceDefs(fonts)}
  
  <!-- Header izquierdo: tipo_inmueble -->
  <text x="40" y="80" font-family="Montserrat" font-weight="700" font-size="28" fill="${accent}">${esc(tipoInmueble)}</text>
  
  <!-- Header izquierdo: tipo_operacion -->
  <text x="40" y="115" font-family="Montserrat" font-weight="400" font-size="20" fill="#000000">${esc(tipoOperacion)}</text>
  
  <!-- Header derecho: nombre del condominio -->
<text x="519" y="80" font-family="Montserrat" font-weight="700" font-size="${tituloSize}" fill="${accent}">${esc(nombreCondominio)}</text>

<!-- Header derecho: colonia/zona -->
<text x="519" y="115" font-family="Montserrat" font-weight="400" font-size="${coloniaSize}" fill="#000000">${esc(colonia)}</text>
  <!-- Precio -->
  <text x="626" y="805" font-family="Montserrat" font-weight="700" font-size="28" fill="#000000">${esc(precioStr)}</text>
  
  <!-- Nota de precio -->
  ${notaPrecio ? `<text x="626" y="835" font-family="Montserrat" font-weight="400" font-size="16" fill="${accent}">${esc(notaPrecio)}</text>` : ''}
  
  <!-- Stats -->
  <text x="125" y="940" font-family="Montserrat" font-weight="400" font-size="16" fill="${CREAM}" text-anchor="middle">${banos} BAÑOS</text>
  <text x="375" y="940" font-family="Montserrat" font-weight="400" font-size="16" fill="${CREAM}" text-anchor="middle">${recamaras} RECÁMARAS</text>
  <text x="625" y="940" font-family="Montserrat" font-weight="400" font-size="16" fill="${CREAM}" text-anchor="middle">${niveles} NIVELES</text>
  <text x="875" y="940" font-family="Montserrat" font-weight="400" font-size="16" fill="${CREAM}" text-anchor="middle">${m2c} M² CONST.</text>
  
  <!-- Dirección footer -->
  <text x="60" y="970" font-family="Montserrat" font-weight="400" font-size="14" fill="#000000">${esc(direccionFooter)}</text>
  
  <!-- WhatsApp (solo version=client) -->
  ${wa ? `<text x="60" y="990" font-family="Montserrat" font-weight="400" font-size="12" fill="#666666">${esc('WhatsApp: ' + wa)}</text>` : ''}
  
  <!-- Pin de ubicación -->
  <path d="M40 955 C40 950, 44 946, 48 946 C52 946, 56 950, 56 955 C56 962, 48 970, 48 970 C48 970, 40 962, 40 955 Z" fill="${accent}"/>
  <circle cx="48" cy="955" r="3" fill="#ffffff"/>
</svg>`;

  // ---- Ensamblado -----------------------------------------------------
  const composites = [
    // 2. Foto
    { input: photoResized, top: 209, left: 0 },
    // 2b. Overlay crema translúcido (simula opacidad 80% de la foto)
    { input: photoOpacityOverlay, top: 209, left: 0 },
    // 3. Gradiente fade en esquina inf-der de la foto
    { input: Buffer.from(gradientSvg), top: 693, left: 606 },
    // 4-6. Rect precio + barra inferior + separadores + línea vertical
    { input: Buffer.from(shapesSvg), top: 0, left: 0 },
  ];

  // 7. Logo (SOLO version=client). En el spec original quedaba
  //    bleeding a (-14,-55); sharp no permite offsets negativos.
  //    Se posiciona pegado a la esquina sup-izq del canvas.
  if (logoBuf) {
    const logoResized = await sharp(logoBuf)
      .resize(263, 194, { fit: 'inside', withoutEnlargement: false })
      .png()
      .toBuffer();
    composites.push({ input: logoResized, top: 10, left: 10 });
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

/** dirección_colonia: colonia · ciudad (formato compacto para header). */
function fitAddress(p) {
  return p.colonia || p.estado_municipio || '';
}

/** Dirección completa para el footer (más detallada). */
function footerAddress(p) {
  const parts = [p.direccion, p.colonia, p.ciudad, p.estado_municipio].filter(Boolean);
  return parts.join(', ') || 'Ubicación disponible bajo consulta';
}

/** "$X,XXX,XXX MXN" con separador de miles y moneda al final. */
function formatPrice(p) {
  const precio = Number(p.precio_principal || 0);
  const moneda = String(p.moneda_principal || '').toUpperCase() || 'MXN';
  if (!precio) return 'Precio bajo consulta';
  return '$' + precio.toLocaleString('en-US') + ' ' + moneda;
}
