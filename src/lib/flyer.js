// Generador de flyers 1000×1000 JPEG para redes sociales / WhatsApp.
// Layout basado en diseño de Canva @1000×1000.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FONT_DIR = path.resolve(__dirname, '../../assets/fonts');

const W = 1000;
const H = 1000;
const CREAM = '#f5f0ea';
const DEFAULT_ACCENT = '#75634d';
const TITLE_MAX_CHARS = 30;

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

export async function generateFlyer({ property, brand, agent, version, photoUrl }) {
  if (!photoUrl) throw new Error('missing_main_photo');
  const p = property;
  const accent = (brand?.color_principal && /^#[0-9a-fA-F]{6}$/.test(brand.color_principal))
    ? brand.color_principal
    : DEFAULT_ACCENT;
  const fonts = await loadFonts();

  const [photoBuf, logoBuf] = await Promise.all([
    fetchBuffer(asJpg(photoUrl, 1400)),
    version === 'client' && brand?.logo_url
      ? fetchBuffer(asPngNoQ(brand.logo_url, 400))
      : Promise.resolve(null),
  ]);
  if (!photoBuf) throw new Error('photo_download_failed');

  // Base crema 1000×1000
  const base = sharp({
    create: { width: W, height: H, channels: 4, background: CREAM },
  });

  // Foto: 1000×585 (ajustada al canvas, no más ancha)
  const photoResized = await sharp(photoBuf)
    .resize(1000, 585, { fit: 'cover', position: 'center' })
    .removeAlpha()
    .toBuffer();

  // Opacidad 80%: overlay con alpha
  const photoOverlay = await sharp({
    create: { width: 1000, height: 585, channels: 4, background: { r: 245, g: 240, b: 234, alpha: 0.2 } },
  }).png().toBuffer();

  // Gradient blur simulado con SVG
  const gradientSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="250" height="200" viewBox="0 0 250 200">
    <defs>
      <linearGradient id="blurFade" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="${CREAM}" stop-opacity="0"/>
        <stop offset="40%" stop-color="${CREAM}" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="${CREAM}" stop-opacity="0.9"/>
      </linearGradient>
      <filter id="blur"><feGaussianBlur stdDeviation="10"/></filter>
    </defs>
    <rect width="250" height="200" fill="url(#blurFade)" filter="url(#blur)"/>
  </svg>`;

  // Rectángulo precio: 250×140, top:722, left:606 (crece hacia arriba)
  const rectPrecioSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="250" height="140" viewBox="0 0 250 140">
    <rect width="250" height="140" fill="${CREAM}" rx="4"/>
  </svg>`;

  // Barra inferior: 1000×67, top:789
  const barraSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="67" viewBox="0 0 1000 67">
    <rect width="1000" height="67" fill="${accent}"/>
  </svg>`;

  // Líneas divisoras
  const lineasSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
    <!-- Línea negra header: (600,74) → (600,194) -->
    <line x1="600" y1="74" x2="600" y2="194" stroke="#000000" stroke-width="3"/>
    <!-- Línea crema barra 1: BAÑOS | RECÁMARAS -->
    <line x1="200" y1="789" x2="200" y2="856" stroke="${CREAM}" stroke-width="3"/>
    <!-- Línea crema barra 2: RECÁMARAS | NIVELES -->
    <line x1="400" y1="789" x2="400" y2="856" stroke="${CREAM}" stroke-width="3"/>
    <!-- Línea crema barra 3: NIVELES | M² CONST -->
    <line x1="600" y1="789" x2="600" y2="856" stroke="${CREAM}" stroke-width="3"/>
    <!-- Línea crema barra 4: M² CONST | M² TERRENO -->
    <line x1="800" y1="789" x2="800" y2="856" stroke="${CREAM}" stroke-width="3"/>
  </svg>`;

  // Textos
  const nombreCondominio = truncate(p.nombre_condominio || p.titulo || 'Propiedad', TITLE_MAX_CHARS);
  
  // ========== NUEVO: Dividir nombre del condominio en dos líneas ==========
  const nombreParts = nombreCondominio.toUpperCase().split(' ');
  const nombreLinea1 = nombreParts[0] || '';
  const nombreLinea2 = nombreParts.slice(1).join(' ') || '';
  // =====================================================================
  
  const tipoInmuebleRaw = (p.tipo_inmueble || '').toUpperCase();
  const tipoInmueble = tipoInmuebleRaw === 'DEPARTAMENTO' ? 'DEPTO' : tipoInmuebleRaw;
  const tipoOperacionRaw = (p.tipo_operacion || '').toUpperCase();
  const tipoOperacion = tipoOperacionRaw === 'VENTA' || tipoOperacionRaw === 'RENTA' ? 'EN ' + tipoOperacionRaw : tipoOperacionRaw;
  const colonia = p.colonia || '';
  const m2t = safeNum(p.m2_terreno);
  const direccionFooter = footerAddress(p);
  const precioStr = formatPrice(p);
  const notaPrecio = (p.nota_precio || '').trim();
  const wa = (version === 'client' && agent?.whatsapp) ? String(agent.whatsapp) : '';

  const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
    ${fontFaceDefs(fonts)}
    
    <!-- DEPA: bajado para alinear visualmente con BALAY -->
    <text x="320" y="125" font-family="Montserrat" font-weight="700" font-size="65" fill="${accent}">${esc(tipoInmueble.toUpperCase())}</text>

    <!-- EN VENTA: más cerca de DEPA -->
    <text x="320" y="165" font-family="Montserrat" font-weight="400" font-size="45" fill="#000000">${esc(tipoOperacion)}</text>

    <!-- ========== NUEVO: Nombre condominio en dos líneas ========== -->
    <!-- Nombre condominio línea 1 -->
    <text x="620" y="110" font-family="Montserrat" font-weight="700" font-size="36.7" fill="${accent}">${esc(nombreLinea1)}</text>
    
    <!-- Nombre condominio línea 2 (solo si existe segunda palabra) -->
    ${nombreLinea2 ? `<text x="620" y="150" font-family="Montserrat" font-weight="700" font-size="28" fill="${accent}">${esc(nombreLinea2)}</text>` : ''}
    <!-- ========================================================== -->
    
    <!-- Colonia/Zona -->
    <text x="620" y="190" font-family="Montserrat" font-weight="400" font-size="25.7" fill="#000000">${esc(colonia.toUpperCase())}</text>

    <!-- Precio: centrado -->
    <text x="731" y="772" font-family="Montserrat" font-weight="700" font-size="26.3" fill="#000000" text-anchor="middle">${esc(precioStr)}</text>
    
    <!-- Nota precio -->
    ${notaPrecio ? `<text x="731" y="812" font-family="Montserrat" font-weight="400" font-size="17" fill="${accent}" text-anchor="middle">${esc(notaPrecio)}</text>` : ''}
    
    <!-- Stats -->
    <text x="100" y="835" font-family="Montserrat" font-weight="700" font-size="16" fill="${CREAM}" text-anchor="middle">${safeNum(p.banos_completos)} BAÑOS</text>
    <text x="300" y="835" font-family="Montserrat" font-weight="700" font-size="16" fill="${CREAM}" text-anchor="middle">${safeNum(p.recamaras)} RECÁMARAS</text>
    <text x="500" y="835" font-family="Montserrat" font-weight="700" font-size="16" fill="${CREAM}" text-anchor="middle">${safeNum(p.niveles)} NIVELES</text>
    <text x="700" y="835" font-family="Montserrat" font-weight="700" font-size="16" fill="${CREAM}" text-anchor="middle">${safeNum(p.m2_construccion)} M²</text>
    ${m2t > 0 ? `<text x="900" y="835" font-family="Montserrat" font-weight="700" font-size="16" fill="${CREAM}" text-anchor="middle">${m2t} M²</text>` : ''}

    <!-- Dirección centrada en negritas -->
    <text x="500" y="920" font-family="Montserrat" font-weight="700" font-size="25" fill="#000000" text-anchor="middle"> ${esc(direccionFooter)}</text>
    
    <!-- WhatsApp centrado -->
    ${wa ? `<text x="500" y="950" font-family="Montserrat" font-weight="400" font-size="16" fill="#666666" text-anchor="middle">WhatsApp: ${esc(wa)}</text>` : ''}
  </svg>`;

  // Composites
  const composites = [
    { input: photoResized, top: 210, left: 0 },
    { input: photoOverlay, top: 210, left: 0 },
    { input: Buffer.from(gradientSvg), top: 540, left: 606 },
    { input: Buffer.from(rectPrecioSvg), top: 722, left: 606 },
    { input: Buffer.from(barraSvg), top: 789, left: 0 },
    { input: Buffer.from(lineasSvg), top: 0, left: 0 },
  ];

  if (logoBuf) {
    const logoProcessed = await sharp(logoBuf)
      .resize(220, 200, { fit: 'inside', withoutEnlargement: false })
      .png()
      .toBuffer();
    composites.push({ input: logoProcessed, top: 40, left: 20 });
  }

  composites.push({ input: Buffer.from(textSvg), top: 0, left: 0 });

  const jpegBuf = await base
    .composite(composites)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();

  return jpegBuf;
}

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
