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
  // Canva dice 1006×585 con left:-6, pero Sharp no permite > canvas ni negativos
  const photoResized = await sharp(photoBuf)
    .resize(1000, 585, { fit: 'cover', position: 'center' })
    .removeAlpha()
    .toBuffer();

  // Opacidad 80%: overlay con alpha
  const photoOverlay = await sharp({
    create: { width: 1000, height: 585, channels: 4, background: { r: 245, g: 240, b: 234, alpha: 0.2 } },
  }).png().toBuffer();

  // Gradient blur simulado con SVG (139×250 rotado -90° = 250×139)
  // Posición Canva: top:566, left:661 → en 1000×1000: top:566, left:661
  // Pero 566+139=705, 661+250=911 ✅ dentro del canvas
  const gradientSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="250" height="139" viewBox="0 0 250 139">
    <defs>
      <linearGradient id="blurFade" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${CREAM}" stop-opacity="0"/>
        <stop offset="50%" stop-color="${CREAM}" stop-opacity="0.6"/>
        <stop offset="100%" stop-color="${CREAM}" stop-opacity="1"/>
      </linearGradient>
      <filter id="blur"><feGaussianBlur stdDeviation="6"/></filter>
    </defs>
    <rect width="250" height="139" fill="url(#blurFade)" filter="url(#blur)"/>
  </svg>`;

  // Rectángulo precio: 250×105, top:757, left:606
  const rectPrecioSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="250" height="105" viewBox="0 0 250 105">
    <rect width="250" height="105" fill="${CREAM}" rx="4"/>
  </svg>`;

  // Barra inferior: 1000×67, top:789
  const barraSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="67" viewBox="0 0 1000 67">
    <rect width="1000" height="67" fill="${accent}"/>
  </svg>`;

  // Líneas divisoras
  const lineasSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
    <!-- Línea negra header: (600,74) → (600,194) -->
    <line x1="600" y1="74" x2="600" y2="194" stroke="#000000" stroke-width="3"/>
    <!-- Línea crema barra izq: (195,797) → (195,862) -->
    <line x1="195" y1="797" x2="195" y2="862" stroke="${CREAM}" stroke-width="3"/>
    <!-- Línea crema barra centro: (402,794) → (402,858) -->
    <line x1="402" y1="794" x2="402" y2="858" stroke="${CREAM}" stroke-width="3"/>
  </svg>`;

  // Textos
  const nombreCondominio = truncate(p.nombre_condominio || p.titulo || 'Propiedad', TITLE_MAX_CHARS);
  const tipoInmueble = (p.tipo_inmueble || '').toUpperCase();
  const tipoOperacion = p.tipo_operacion || '';
  const colonia = p.colonia || '';
  const direccionFooter = footerAddress(p);
  const precioStr = formatPrice(p);
  const notaPrecio = (p.nota_precio || '').trim();
  const wa = (version === 'client' && agent?.whatsapp) ? String(agent.whatsapp) : '';

  const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
    ${fontFaceDefs(fonts)}
    
    <!-- CASA: x=299, y=36, font=53.4pt -->
    <text x="299" y="89" font-family="Montserrat" font-weight="700" font-size="53.4" fill="${accent}">${esc(tipoInmueble)}</text>
    
    <!-- EN VENTA: x=207, y=112, font=45.6pt -->
    <text x="207" y="157" font-family="Montserrat" font-weight="400" font-size="45.6" fill="#000000">${esc(tipoOperacion)}</text>
    
    <!-- MALLORCA: x=620, y=70, font=36.7pt -->
    <text x="620" y="107" font-family="Montserrat" font-weight="700" font-size="36.7" fill="${accent}">${esc(nombreCondominio)}</text>
    
    <!-- POLÍGONO SUR: x=620, y=145, font=25.7pt -->
    <text x="620" y="171" font-family="Montserrat" font-weight="400" font-size="25.7" fill="#000000">${esc(colonia)}</text>
    
    <!-- Precio: x=614, y=746, font=26.3pt, centrado -->
    <text x="731" y="772" font-family="Montserrat" font-weight="700" font-size="26.3" fill="#000000" text-anchor="middle">${esc(precioStr)}</text>
    
    <!-- Nota precio: x=631, y=795, font=17pt, centrado -->
    ${notaPrecio ? `<text x="731" y="812" font-family="Montserrat" font-weight="400" font-size="17" fill="${accent}" text-anchor="middle">${esc(notaPrecio)}</text>` : ''}
    
    <!-- 2.5 BAÑOS: x=-12, y=812, font=15.6pt, centrado → ajustado a x=88 -->
    <text x="88" y="827" font-family="Montserrat" font-weight="400" font-size="15.6" fill="${CREAM}" text-anchor="middle">${safeNum(p.banos_completos)} BAÑOS</text>
    
    <!-- 3 RECAMARAS: x=193, y=812, font=15.6pt, centrado → x=298 -->
    <text x="298" y="827" font-family="Montserrat" font-weight="400" font-size="15.6" fill="${CREAM}" text-anchor="middle">${safeNum(p.recamaras)} RECÁMARAS</text>
    
    <!-- 2 NIVELES: x=407, y=812, font=13.7pt, centrado → x=504 -->
    <text x="504" y="827" font-family="Montserrat" font-weight="400" font-size="13.7" fill="${CREAM}" text-anchor="middle">${safeNum(p.niveles)} NIVELES</text>
    
    <!-- m²: cuarta columna -->
    <text x="710" y="827" font-family="Montserrat" font-weight="400" font-size="13.7" fill="${CREAM}" text-anchor="middle">${safeNum(p.m2_construccion)} M²</text>
    
    <!-- Dirección: x=113, y=899, font=18.3pt -->
    <text x="113" y="917" font-family="Montserrat" font-weight="400" font-size="18.3" fill="#000000">📍 ${esc(direccionFooter)}</text>
    
    <!-- WhatsApp -->
    ${wa ? `<text x="113" y="945" font-family="Montserrat" font-weight="400" font-size="14" fill="#666666">WhatsApp: ${esc(wa)}</text>` : ''}
  </svg>`;

  // Composites (todo debe caber en 1000×1000)
  const composites = [
    // Foto + overlay opacidad
    { input: photoResized, top: 210, left: 0 },
    { input: photoOverlay, top: 210, left: 0 },
    // Gradient blur
    { input: Buffer.from(gradientSvg), top: 566, left: 661 },
    // Rectángulo precio
    { input: Buffer.from(rectPrecioSvg), top: 757, left: 606 },
    // Barra inferior
    { input: Buffer.from(barraSvg), top: 789, left: 0 },
    // Líneas
    { input: Buffer.from(lineasSvg), top: 0, left: 0 },
  ];

  // Logo: Canva lo pone en (-54, -14) pero Sharp no permite negativos
  // Lo posicionamos en (0, 0) y recortamos visualmente si es necesario
  if (logoBuf) {
    const logoProcessed = await sharp(logoBuf)
      .resize(277, 249, { fit: 'inside', withoutEnlargement: false })
      .png()
      .toBuffer();
    composites.push({ input: logoProcessed, top: 0, left: 0 });
  }

  // Textos (encima de todo)
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
