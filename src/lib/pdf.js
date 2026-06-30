// Composer de la ficha técnica PDF — Paso 12 (rediseño 2026-02).
// PDFKit, generación bajo demanda, sin almacenamiento.
//
// 4 versiones (kind = `${withAgent ? 'con' : 'sin'}-agente-${pages}pag`):
//   - con-agente-1pag → sólo página 1 (hero + bloque color + 3 fotos + barra contacto)
//   - con-agente-2pag → página 1 + página de detalles (mapa + requisitos + contacto) + página grid 2x3 fotos
//   - sin-agente-1pag → idem 1pag pero SIN logo, SIN agencia, SIN datos de contacto
//   - sin-agente-2pag → idem 2pag pero SIN logo/agencia/contacto
//
// Diseño inspirado en referencias del cliente (estilo "flyer inmobiliario"):
//   * Hero full-width + logo overlay top-right
//   * Bloque sólido lateral derecho con color de marca (EN VENTA/RENTA + precio)
//   * Amenidades en 2 columnas con bullets simples (no chips)
//   * Fotos con borde fino (1.5pt) color de marca
//   * Mapa Google Static Maps con borde de marca (fallback a placeholder si
//     GOOGLE_MAPS_API_KEY no está disponible)
//
// Reglas Master Context:
//   - PDFKit NO soporta WebP → /f_jpg de Cloudinary
//   - Fotos clickeables: con-agente → portal del agente · sin-agente → URL orgánica
import PDFDocument from 'pdfkit';
import axios from 'axios';
import { parsePhotos } from './render.js';

// A4 (595.28 x 841.89) con margen consistente
const PAGE_MARGIN = 28;
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const CONTENT_WIDTH = A4_WIDTH - PAGE_MARGIN * 2;
const CONTENT_RIGHT = PAGE_MARGIN + CONTENT_WIDTH;

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/** Cloudinary transform: forzar JPEG porque PDFKit no soporta WebP.
 *  Importante: si la URL ya trae un segmento de transformación entre
 *  `/upload/` y `/v<version>/` (típico cuando Cloudinary devuelve la URL
 *  con `f_webp,q_80,...`), DEBEMOS reemplazarlo — no concatenarlo —
 *  porque Cloudinary encadena transforms y el último format gana. */
function asJpg(url, width = 1200) {
  if (!url || typeof url !== 'string') return null;
  if (!url.includes('/upload/')) return url;
  const transform = `f_jpg,q_auto:good,c_limit,w_${width}`;
  const re = /\/upload\/(?:[^/]+\/)?(v\d+\/)/;
  if (re.test(url)) return url.replace(re, `/upload/${transform}/$1`);
  return url.replace('/upload/', `/upload/${transform}/`);
}

/** Cloudinary transform: forzar PNG preservando canal alpha (logos, badges).
 *  CRÍTICO: NO usar `q_auto` ni `f_auto` para logos — pueden meter `q_auto`
 *  con compresión lossy o `f_webp` que rompe transparencia en PDFKit.
 *  Mismo fix que en el portal web (kind=brand sin q_auto). */
function asPng(url, width = 400) {
  if (!url || typeof url !== 'string') return null;
  if (!url.includes('/upload/')) return url;
  const transform = `f_png,c_limit,w_${width}`;
  const re = /\/upload\/(?:[^/]+\/)?(v\d+\/)/;
  if (re.test(url)) return url.replace(re, `/upload/${transform}/$1`);
  return url.replace('/upload/', `/upload/${transform}/`);
}

/** Descarga binaria tolerante a fallos. Devuelve null en error. */
async function fetchBuffer(url, { timeout = 10_000 } = {}) {
  if (!url) return null;
  try {
    const { data } = await axios.get(url, { responseType: 'arraybuffer', timeout });
    return Buffer.from(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pdf] fetch image failed:', url, err.message);
    return null;
  }
}

/** Construye URL de Google Maps Static. Devuelve null si falta key o lat/lng.
 *  IMPORTANTE: en producción (Railway) `GOOGLE_MAPS_API_KEY` debe estar seteada
 *  con la API "Maps Static API" habilitada y SIN restricción de referrer
 *  (las llamadas vienen del servidor, no del browser). */
export function staticMapUrl(lat, lng, { width = 640, height = 320, zoom = 15 } = {}) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || lat == null || lng == null) return null;
  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: String(zoom),
    size: `${width}x${height}`,
    scale: '2',
    maptype: 'roadmap',
    markers: `color:red|${lat},${lng}`,
    key,
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

/** Sanitiza un #RGB/#RRGGBB; cae a `fallback` si inválido. */
function safeHex(v, fallback) {
  if (typeof v !== 'string' || !/^#([0-9a-f]{3}){1,2}$/i.test(v)) return fallback;
  return v;
}

/** Devuelve una versión más oscura del hex (para la barra de contacto). */
function darken(hex, amount = 0.18) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.length === 4
    ? '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3]
    : hex);
  if (!m) return hex;
  const r = Math.max(0, Math.floor(parseInt(m[1], 16) * (1 - amount)));
  const g = Math.max(0, Math.floor(parseInt(m[2], 16) * (1 - amount)));
  const b = Math.max(0, Math.floor(parseInt(m[3], 16) * (1 - amount)));
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

function fmtPrice(n, currency = 'USD') {
  if (n == null || n === '') return '';
  const num = Number(n);
  if (!Number.isFinite(num)) return '';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(num);
}

/** Operación label grande: "EN VENTA" / "EN RENTA" / "DISPONIBLE". */
function operationLabel(op) {
  const t = String(op || '').trim().toLowerCase();
  if (t === 'venta') return { line1: 'EN', line2: 'VENTA', kind: 'venta' };
  if (t === 'renta') return { line1: 'EN', line2: 'RENTA', kind: 'renta' };
  return { line1: '', line2: 'DISPONIBLE', kind: 'otro' };
}

/** Línea de precio en el bloque lateral (ej. "RENTA $7,000 MENSUAL"). */
function priceBlockText(p, opKind) {
  if (p.precio_a_consultar) return ['PRECIO', 'A CONSULTAR'];
  const usd = p.precio_usd ? fmtPrice(p.precio_usd, 'USD') : '';
  const mxn = p.precio_mxn ? fmtPrice(p.precio_mxn, 'MXN') : '';
  const principal = mxn || usd;
  if (!principal) return ['PRECIO', 'A CONSULTAR'];
  if (opKind === 'renta') return ['RENTA', principal, 'MENSUAL'];
  return ['VENTA', principal, ''];
}

// ---------------------------------------------------------------------
// Icon primitives — SVG paths reales dibujados con PDFKit (sin fuentes)
// ---------------------------------------------------------------------
// Estrategia: paths definidos en viewbox 24×24 (estándar Material/Lucide).
// `drawSvgIcon` escala al tamaño objetivo, traslada y pinta. PDFKit
// soporta SVG path syntax nativo en `doc.path()`.
function drawSvgIcon(doc, x, y, size, pathD, fillColor) {
  doc.save();
  doc.translate(x, y).scale(size / 24);
  doc.path(pathD).fill(fillColor);
  doc.restore();
}

// Pin de ubicación (Material outlined → filled). Tamaño v=24.
const PATH_PIN = 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z';

// Teléfono (Material filled). Tamaño v=24.
const PATH_PHONE = 'M6.62 10.79c1.44 2.83 3.76 5.15 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z';

// WhatsApp (logo oficial simplificado, círculo + auricular + cola).
// Path único que combina el círculo y el auricular interior con regla "even-odd".
const PATH_WHATSAPP_BG = 'M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.97L2 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21h.04c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2zm0 18.13h-.03c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.264 8.264 0 0 1-1.26-4.37c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.82 2.42a8.183 8.183 0 0 1 2.41 5.83c0 4.55-3.7 8.25-8.2 8.25z';
const PATH_WHATSAPP_HANDSET = 'M16.56 14.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.14-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.49-.41-.42-.56-.43-.14-.01-.31-.01-.48-.01-.17 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.57.12.17 1.75 2.67 4.24 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.68-1.18.2-.58.2-1.07.14-1.18-.06-.11-.23-.17-.48-.3z';

function drawPin(doc, x, y, color, size) {
  drawSvgIcon(doc, x, y, size, PATH_PIN, color);
}
function drawPhoneIcon(doc, x, y, color, size) {
  drawSvgIcon(doc, x, y, size, PATH_PHONE, color);
}
/** WhatsApp con fondo verde + auricular blanco. */
function drawWhatsAppIcon(doc, x, y, size) {
  drawSvgIcon(doc, x, y, size, PATH_WHATSAPP_BG, '#25d366');
  drawSvgIcon(doc, x, y, size, PATH_WHATSAPP_HANDSET, '#ffffff');
}

// Instagram, Email, Web (para Contact Us en página 2).
const PATH_INSTAGRAM = 'M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.89 5.89 0 0 0-2.13 1.38A5.89 5.89 0 0 0 .63 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.31.79.73 1.46 1.38 2.13a5.89 5.89 0 0 0 2.13 1.38c.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56a5.89 5.89 0 0 0 2.13-1.38 5.89 5.89 0 0 0 1.38-2.13c.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.89 5.89 0 0 0-1.38-2.13A5.89 5.89 0 0 0 19.86.63C19.1.33 18.22.13 16.95.07 15.67.01 15.26 0 12 0zm0 5.84A6.16 6.16 0 0 0 5.84 12 6.16 6.16 0 0 0 12 18.16 6.16 6.16 0 0 0 18.16 12 6.16 6.16 0 0 0 12 5.84zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.41-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z';
const PATH_EMAIL = 'M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z';
const PATH_WEB = 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM18.92 8h-2.95a15.65 15.65 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.92 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.99 7.99 0 0 1 5.08 16zm2.95-8H5.08a7.99 7.99 0 0 1 4.33-3.56A15.65 15.65 0 0 0 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z';

function drawInstagramIcon(doc, x, y, color, size) {
  drawSvgIcon(doc, x, y, size, PATH_INSTAGRAM, color);
}
function drawEmailIcon(doc, x, y, color, size) {
  drawSvgIcon(doc, x, y, size, PATH_EMAIL, color);
}
function drawWebIcon(doc, x, y, color, size) {
  drawSvgIcon(doc, x, y, size, PATH_WEB, color);
}

/** Caja con imagen + borde fino del color de marca. */
function drawPhotoBox(doc, buf, x, y, w, h, borderColor, borderWidth = 1.5) {
  if (buf) {
    try {
      // Clip a un rectángulo para que la imagen llene el cell aunque sea más ancha
      doc.save();
      doc.rect(x, y, w, h).clip();
      // cover-fit: escalar para llenar el cell sin deformar
      doc.image(buf, x, y, { cover: [w, h], align: 'center', valign: 'center' });
      doc.restore();
    } catch (e) {
      doc.rect(x, y, w, h).fill('#f1f5f9');
    }
  } else {
    doc.rect(x, y, w, h).fill('#f1f5f9');
  }
  // Borde
  doc.lineWidth(borderWidth).strokeColor(borderColor).rect(x, y, w, h).stroke();
}

// ---------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------

export async function buildPropertyPDF({
  record, brand, agent, withAgent, twoPages, baseUrl,
}) {
  const p = record?.properties || {};

  // Color de marca: color_principal > color_acento > default cálido
  const primary = safeHex(brand?.color_principal, safeHex(brand?.color_acento, '#5e4d3e'));
  const primaryDark = darken(primary, 0.22);

  // Fotos
  const photos = parsePhotos(p.fotos_urls);
  const hero = asJpg(photos[0], 1600);
  const footer3 = photos.slice(1, 4).map((u) => asJpg(u, 800));
  // Para "2pag": foto wide para Page2 y Page3, foto secundaria + 6 del grid
  const page2Hero = asJpg(photos[1] || photos[0], 1400);
  const page2Secondary = asJpg(photos[2] || photos[1], 600);
  const page3Hero = asJpg(photos[3] || photos[0], 1400);
  const gridSix = photos.slice(2, 8).map((u) => asJpg(u, 800));

  const logoUrl = withAgent ? asPng(brand?.logo_url, 400) : null;
  const mapUrl = staticMapUrl(p.latitud, p.longitud);

  // Descarga en paralelo
  const [
    heroBuf, footer3Bufs, page2HeroBuf, page2SecondaryBuf,
    page3HeroBuf, gridSixBufs, logoBuf, mapBuf,
  ] = await Promise.all([
    fetchBuffer(hero),
    Promise.all(footer3.map(fetchBuffer)),
    twoPages ? fetchBuffer(page2Hero) : Promise.resolve(null),
    twoPages ? fetchBuffer(page2Secondary) : Promise.resolve(null),
    twoPages ? fetchBuffer(page3Hero) : Promise.resolve(null),
    twoPages ? Promise.all(gridSix.map(fetchBuffer)) : Promise.resolve([]),
    fetchBuffer(logoUrl),
    fetchBuffer(mapUrl),
  ]);

  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE_MARGIN,
    info: {
      Title: p.titulo || 'Propiedad',
      Author: brand?.nombre_agencia || 'mktscaled',
      Subject: 'Ficha técnica',
    },
  });

  const ctx = {
    doc, p, brand, agent, withAgent, primary, primaryDark,
    heroBuf, footer3Bufs, page2HeroBuf, page2SecondaryBuf,
    page3HeroBuf, gridSixBufs, logoBuf, mapBuf,
    baseUrl, record,
  };

  drawPage1(ctx);

  if (twoPages) {
    doc.addPage();
    drawPage2(ctx);
    doc.addPage();
    drawPage3(ctx);
  }

  return doc;
}

// ---------------------------------------------------------------------
// Page 1 — Hero + bloque color lateral + 3 fotos footer + barra contacto
// ---------------------------------------------------------------------
function drawPage1(ctx) {
  const {
    doc, p, brand, withAgent, primary, primaryDark,
    heroBuf, footer3Bufs, logoBuf, baseUrl, record,
  } = ctx;

  const x = PAGE_MARGIN;
  let y = PAGE_MARGIN;

  // ===== HERO photo full-width con opacidad 60% =====
  const HERO_H = 280;
  if (heroBuf) {
    try {
      doc.save();
      doc.opacity(0.6); // toda la imagen al 60% — efecto "fade" para legibilidad
      doc.rect(x, y, CONTENT_WIDTH, HERO_H).clip();
      doc.image(heroBuf, x, y, { cover: [CONTENT_WIDTH, HERO_H], align: 'center', valign: 'center' });
      doc.restore();
    } catch (e) {
      doc.rect(x, y, CONTENT_WIDTH, HERO_H).fill('#e5e7eb');
    }
  } else {
    doc.rect(x, y, CONTENT_WIDTH, HERO_H).fill('#e5e7eb');
  }
  doc.opacity(1); // garantizar reset por si el branch del catch dejó algo abierto

  // Logo overlay top-right (solo con-agente) — 100% opacidad, sobre la foto atenuada.
  // Importante: NO usar fondo de color, el PNG ya tiene transparencia gracias a asPng().
  if (withAgent && logoBuf) {
    const LOGO_W = 140;
    const LOGO_H = 75;
    const lx = x + CONTENT_WIDTH - LOGO_W - 14;
    const ly = y + 14;
    doc.save();
    doc.opacity(1);
    try {
      doc.image(logoBuf, lx, ly, { fit: [LOGO_W, LOGO_H], align: 'right', valign: 'top' });
    } catch (e) { /* skip */ }
    doc.restore();
  }

  // Link sobre el hero
  const heroLink = clickUrl({ withAgent, brand, record, baseUrl });
  if (heroLink) doc.link(x, y, CONTENT_WIDTH, HERO_H, heroLink);

  y += HERO_H;

  // ===== BLOQUE INFERIOR: split 2 columnas =====
  // Right column = bloque sólido color marca con EN VENTA/RENTA + precio
  // Left column = título, dirección, descripción, amenidades

  const FOOTER_H = 180;        // altura reservada para 3 fotos + barra
  const BLOCK_TOP = y;
  const BLOCK_H = A4_HEIGHT - PAGE_MARGIN - BLOCK_TOP - FOOTER_H;
  const RIGHT_W = 195;
  const LEFT_W = CONTENT_WIDTH - RIGHT_W;
  const leftX = x;
  const rightX = x + LEFT_W;

  // --- Bloque color (derecha): EN VENTA/RENTA + copy + viñetas + precio ---
  doc.rect(rightX, BLOCK_TOP, RIGHT_W, BLOCK_H).fill(primary);

  const op = operationLabel(p.tipo_operacion);
  const padX = 16;
  let ry = BLOCK_TOP + 18;

  // "EN" (línea 1, peso medio)
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(28)
    .text(op.line1, rightX + padX, ry, { width: RIGHT_W - padX * 2, lineBreak: false });
  ry += 32;

  // "VENTA" o "RENTA" (línea 2, peso máximo)
  doc.font('Helvetica-Bold').fontSize(38)
    .text(op.line2, rightX + padX, ry, { width: RIGHT_W - padX * 2, lineBreak: false });
  ry += 50;

  // Texto genérico (copy fijo aprobado por cliente)
  const COPY_GENERIC = 'Una oportunidad pensada para quienes buscan calidad, ubicación y el respaldo de un proceso confiable de principio a fin.';
  doc.font('Helvetica').fontSize(9).fillColor('#ffffff')
    .text(COPY_GENERIC, rightX + padX, ry, {
      width: RIGHT_W - padX * 2, lineGap: 2, align: 'left',
    });
  ry = doc.y + 14;

  // Viñetas según tipo_operacion (4 ítems)
  const bullets = lateralBullets(op.kind);
  for (const b of bullets) {
    if (ry + 14 > BLOCK_TOP + BLOCK_H - 60) break;
    drawWhiteBullet(doc, rightX + padX, ry, b, RIGHT_W - padX * 2);
    ry += 16;
  }

  // Precio destacado en el fondo del bloque (sin repetir "VENTA"/"RENTA")
  const priceText = priceMain(p);
  const priceSuffix = op.kind === 'renta' ? '/ mes' : '';
  const priceY = BLOCK_TOP + BLOCK_H - 56;
  doc.font('Helvetica-Bold').fontSize(24).fillColor('#ffffff')
    .text(priceText, rightX + padX, priceY, {
      width: RIGHT_W - padX * 2, lineBreak: false, ellipsis: true,
    });
  if (priceSuffix) {
    doc.font('Helvetica').fontSize(11).fillColor('#ffffff')
      .text(priceSuffix, rightX + padX, priceY + 28, {
        width: RIGHT_W - padX * 2, lineBreak: false,
      });
  }

  // --- Columna izquierda (texto) ---
  let ly = BLOCK_TOP + 18;
  const lPadX = 4;

  // Título grande uppercase
  doc.font('Helvetica-Bold').fontSize(20).fillColor(primaryDark)
    .text((p.titulo || 'Propiedad').toUpperCase(), leftX + lPadX, ly, {
      width: LEFT_W - 12, lineGap: 0,
    });
  ly = doc.y + 6;

  // Pin + dirección
  const direccion = [p.colonia, p.ciudad, p.estado_municipio, p.codigo_postal ? `C.P. ${p.codigo_postal}` : '']
    .filter(Boolean).join(', ');
  if (direccion) {
    drawPin(doc, leftX + lPadX, ly, '#dc2626', 12);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1f2937')
      .text(direccion, leftX + lPadX + 18, ly + 1, { width: LEFT_W - 30, lineBreak: false, ellipsis: true });
    ly += 18;
  }

  // Descripción (3-4 líneas máx)
  if (p.descripcion) {
    doc.font('Helvetica').fontSize(9.5).fillColor('#374151')
      .text(String(p.descripcion).trim(), leftX + lPadX, ly, {
        width: LEFT_W - 12, lineGap: 2.5, height: 64, ellipsis: true, align: 'justify',
      });
    ly = Math.min(ly + 64, doc.y) + 10;
  }

  // Amenidades en 2 sub-columnas con bullets
  const amenidades = buildAmenitiesList(p);
  if (amenidades.length) {
    const colW = (LEFT_W - 24) / 2;
    const col1 = amenidades.slice(0, Math.ceil(amenidades.length / 2));
    const col2 = amenidades.slice(Math.ceil(amenidades.length / 2));
    const maxRows = Math.max(col1.length, col2.length);
    const rowH = 16;
    // Limitar al espacio disponible antes del footer
    const maxAvailableH = BLOCK_TOP + BLOCK_H - ly - 6;
    const rowsCap = Math.max(2, Math.min(maxRows, Math.floor(maxAvailableH / rowH)));

    for (let i = 0; i < rowsCap; i++) {
      const baseY = ly + i * rowH;
      if (col1[i]) drawBullet(doc, leftX + lPadX, baseY, col1[i], colW, primaryDark);
      if (col2[i]) drawBullet(doc, leftX + lPadX + colW + 12, baseY, col2[i], colW, primaryDark);
    }
  }

  // ===== FOOTER: 3 fotos en fila =====
  const footerY = A4_HEIGHT - PAGE_MARGIN - FOOTER_H + 8;
  const PHOTO_GAP = 8;
  const photoW = (CONTENT_WIDTH - PHOTO_GAP * 2) / 3;
  const photoH = 140;
  for (let i = 0; i < 3; i++) {
    const px = x + i * (photoW + PHOTO_GAP);
    drawPhotoBox(doc, footer3Bufs[i], px, footerY, photoW, photoH, primary, 1.5);
    if (heroLink) doc.link(px, footerY, photoW, photoH, heroLink);
  }

  // ===== Barra de contacto inferior =====
  const barY = footerY + photoH + 6;
  const barH = A4_HEIGHT - PAGE_MARGIN - barY;
  if (withAgent) {
    drawContactBar(ctx, x + CONTENT_WIDTH - 280, barY, 280, barH);
  }
}

// ---------------------------------------------------------------------
// Page 2 — Foto wide + banda color + (mapa + dirección | requisitos + precio + contacto)
// ---------------------------------------------------------------------
function drawPage2(ctx) {
  const {
    doc, p, brand, withAgent, primary, primaryDark,
    page2HeroBuf, page2SecondaryBuf, mapBuf, baseUrl, record,
  } = ctx;

  const x = PAGE_MARGIN;
  let y = PAGE_MARGIN;

  // ===== Foto ancha arriba =====
  const TOP_H = 200;
  if (page2HeroBuf) {
    try {
      doc.save();
      doc.rect(x, y, CONTENT_WIDTH, TOP_H).clip();
      doc.image(page2HeroBuf, x, y, { cover: [CONTENT_WIDTH, TOP_H], align: 'center', valign: 'center' });
      doc.restore();
    } catch (e) { doc.rect(x, y, CONTENT_WIDTH, TOP_H).fill('#e5e7eb'); }
  } else {
    doc.rect(x, y, CONTENT_WIDTH, TOP_H).fill('#e5e7eb');
  }
  y += TOP_H;

  // ===== Banda de color con título corto =====
  const BAND_H = 42;
  doc.rect(x, y, CONTENT_WIDTH, BAND_H).fill(primary);
  const shortTitle = makeShortTitle(p.titulo);
  // Líneas decorativas a los costados del título
  const titleW = doc.font('Helvetica-Bold').fontSize(18).widthOfString(shortTitle);
  const titleY = y + (BAND_H - 18) / 2;
  doc.fillColor('#ffffff').text(shortTitle, x, titleY, { width: CONTENT_WIDTH, align: 'center', lineBreak: false });
  // Líneas con dot a los lados
  const centerX = x + CONTENT_WIDTH / 2;
  const lineY = y + BAND_H / 2;
  const margin = titleW / 2 + 18;
  doc.lineWidth(0.8).strokeColor('#ffffff');
  doc.moveTo(x + 24, lineY).lineTo(centerX - margin, lineY).stroke();
  doc.moveTo(centerX + margin, lineY).lineTo(x + CONTENT_WIDTH - 24, lineY).stroke();
  doc.circle(x + 24, lineY, 1.6).fill('#ffffff');
  doc.circle(x + CONTENT_WIDTH - 24, lineY, 1.6).fill('#ffffff');
  doc.circle(centerX - margin, lineY, 1.6).fill('#ffffff');
  doc.circle(centerX + margin, lineY, 1.6).fill('#ffffff');
  y += BAND_H + 16;

  // ===== Split 2 columnas =====
  const RIGHT_W = 215;
  const LEFT_W = CONTENT_WIDTH - RIGHT_W - 14;
  const bottomLimit = A4_HEIGHT - PAGE_MARGIN;

  // --- Columna izquierda: LOCACIÓN ---
  let ly = y;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(primaryDark).text('LOCACIÓN', x, ly);
  ly += 22;

  // Mapa con borde de marca
  const MAP_H = 165;
  if (mapBuf) {
    drawPhotoBox(doc, mapBuf, x, ly, LEFT_W, MAP_H, primary, 1.5);
  } else {
    // Placeholder: rectángulo con borde de marca + texto centrado
    doc.rect(x, ly, LEFT_W, MAP_H).fill('#f8fafc');
    doc.lineWidth(1.5).strokeColor(primary).rect(x, ly, LEFT_W, MAP_H).stroke();
    doc.fillColor('#94a3b8').font('Helvetica').fontSize(9)
      .text('Mapa de ubicación', x, ly + MAP_H / 2 - 6, { width: LEFT_W, align: 'center', lineBreak: false });
  }
  ly += MAP_H + 12;

  // Pin + dirección
  const direccion = p.direccion_completa
    || [p.colonia, p.ciudad, p.estado_municipio, p.codigo_postal ? `C.P. ${p.codigo_postal}` : '']
      .filter(Boolean).join(', ');
  if (direccion) {
    drawPin(doc, x, ly, '#dc2626', 12);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1f2937')
      .text(direccion, x + 18, ly + 1, { width: LEFT_W - 20, lineBreak: true });
    ly = doc.y + 6;
  }

  // Párrafo descripción
  if (p.descripcion) {
    doc.font('Helvetica').fontSize(9.5).fillColor('#374151')
      .text(String(p.descripcion).trim(), x, ly, {
        width: LEFT_W, lineGap: 2.5, height: 90, ellipsis: true, align: 'justify',
      });
    ly = Math.min(ly + 90, doc.y) + 12;
  }

  // Foto secundaria (si cabe)
  const SECONDARY_H = Math.min(150, bottomLimit - ly - 10);
  if (SECONDARY_H > 60) {
    drawPhotoBox(doc, page2SecondaryBuf, x, ly, LEFT_W, SECONDARY_H, primary, 1.5);
  }

  // --- Columna derecha: requisitos / promo / contacto ---
  const rightX = x + LEFT_W + 14;
  let ry = y;

  // Bloque 1: requisitos
  const reqs = buildRequisitos(p);
  const REQ_H = 14 + reqs.length * 18 + 14;
  doc.rect(rightX, ry, RIGHT_W, REQ_H).fill(primary);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff');
  reqs.forEach((r, i) => {
    const by = ry + 14 + i * 18;
    doc.circle(rightX + 16, by + 5, 2).fill('#ffffff');
    doc.fillColor('#ffffff').text(r.toUpperCase(), rightX + 26, by, {
      width: RIGHT_W - 36, lineBreak: false, ellipsis: true,
    });
  });
  ry += REQ_H + 8;

  // Bloque 2: información + precio
  const op = operationLabel(p.tipo_operacion);
  const priceLines = priceBlockText(p, op.kind);
  const PRICE_H = 145;
  doc.rect(rightX, ry, RIGHT_W, PRICE_H).fill(primary);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff')
    .text('INFORMACIÓN DE', rightX, ry + 16, { width: RIGHT_W, align: 'center', lineBreak: false });
  doc.text('LA PROPIEDAD', rightX, ry + 32, { width: RIGHT_W, align: 'center', lineBreak: false });
  // Precio grande
  doc.font('Helvetica-Bold').fontSize(28).fillColor('#ffffff')
    .text(priceLines[1] || priceLines[0], rightX, ry + 62, { width: RIGHT_W, align: 'center', lineBreak: false });
  if (priceLines[2] || priceLines[0]) {
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#ffffff')
      .text(priceLines[2] || (op.kind === 'venta' ? 'PRECIO' : 'MENSUAL'), rightX, ry + 100, {
        width: RIGHT_W, align: 'center', lineBreak: false,
      });
  }
  ry += PRICE_H + 8;

  // Bloque 3: contact (sólo con-agente)
  if (withAgent && (brand || ctx.agent)) {
    const CONTACT_H = bottomLimit - ry;
    doc.rect(rightX, ry, RIGHT_W, CONTACT_H).fill(primary);
    drawContactBlock(ctx, rightX, ry, RIGHT_W, CONTACT_H);
  }
}

// ---------------------------------------------------------------------
// Page 3 — Foto wide + banda color + grid 2x3 fotos
// ---------------------------------------------------------------------
function drawPage3(ctx) {
  const {
    doc, p, primary, primaryDark,
    page3HeroBuf, gridSixBufs, baseUrl, record, withAgent, brand,
  } = ctx;

  const x = PAGE_MARGIN;
  let y = PAGE_MARGIN;

  // Foto ancha arriba
  const TOP_H = 200;
  if (page3HeroBuf) {
    try {
      doc.save();
      doc.rect(x, y, CONTENT_WIDTH, TOP_H).clip();
      doc.image(page3HeroBuf, x, y, { cover: [CONTENT_WIDTH, TOP_H], align: 'center', valign: 'center' });
      doc.restore();
    } catch (e) { doc.rect(x, y, CONTENT_WIDTH, TOP_H).fill('#e5e7eb'); }
  } else {
    doc.rect(x, y, CONTENT_WIDTH, TOP_H).fill('#e5e7eb');
  }
  y += TOP_H;

  // Banda color
  const BAND_H = 42;
  doc.rect(x, y, CONTENT_WIDTH, BAND_H).fill(primary);
  const shortTitle = makeShortTitle(p.titulo) + ' · GALERÍA';
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(15)
    .text(shortTitle, x, y + (BAND_H - 15) / 2, { width: CONTENT_WIDTH, align: 'center', lineBreak: false });
  y += BAND_H + 16;

  // Grid 2x3 (6 fotos)
  const cols = 2;
  const rows = 3;
  const gap = 10;
  const availableH = A4_HEIGHT - PAGE_MARGIN - y;
  const cellW = (CONTENT_WIDTH - gap * (cols - 1)) / cols;
  const cellH = (availableH - gap * (rows - 1)) / rows;
  const linkUrl = clickUrl({ withAgent, brand, record, baseUrl });

  for (let i = 0; i < cols * rows; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = x + col * (cellW + gap);
    const cy = y + row * (cellH + gap);
    drawPhotoBox(doc, gridSixBufs[i], cx, cy, cellW, cellH, primary, 1.5);
    if (linkUrl && gridSixBufs[i]) doc.link(cx, cy, cellW, cellH, linkUrl);
  }
}

// ---------------------------------------------------------------------
// Helpers de contenido
// ---------------------------------------------------------------------

/** Bullet "• texto" con elipsis. */
function drawBullet(doc, x, y, text, width, color) {
  doc.fillColor(color).circle(x + 3, y + 5, 2).fill();
  doc.fillColor('#1f2937').font('Helvetica').fontSize(10)
    .text(text, x + 12, y, { width: width - 14, lineBreak: false, ellipsis: true });
}

/** Línea de precio destacada (sólo el monto, sin etiqueta). */
function priceMain(p) {
  if (p.precio_a_consultar) return 'A CONSULTAR';
  const usd = p.precio_usd ? fmtPrice(p.precio_usd, 'USD') : '';
  const mxn = p.precio_mxn ? fmtPrice(p.precio_mxn, 'MXN') : '';
  return mxn || usd || 'A CONSULTAR';
}

/** Viñetas fijas del bloque lateral según operación (4 ítems). */
function lateralBullets(opKind) {
  if (opKind === 'renta') {
    return [
      'Asesoría personalizada',
      'Contrato seguro y claro',
      'Requisitos accesibles',
      'Acompañamiento durante tu estancia',
    ];
  }
  return [
    'Asesoría personalizada',
    'Documentación en regla',
    'Crédito bancario aceptado',
    'Acompañamiento en todo el proceso',
  ];
}

/** Bullet blanco para el bloque lateral (texto blanco sobre fondo color marca). */
function drawWhiteBullet(doc, x, y, text, width) {
  doc.fillColor('#ffffff').circle(x + 3, y + 6, 2).fill();
  doc.font('Helvetica').fontSize(9).fillColor('#ffffff')
    .text(text, x + 12, y, { width: width - 14, lineBreak: false, ellipsis: true });
}

/** Lista de amenidades combinada: medidas + amenidades del campo. */
function buildAmenitiesList(p) {
  const out = [];
  if (p.recamaras) out.push(`${p.recamaras} Recámara${Number(p.recamaras) === 1 ? '' : 's'}`);
  if (p.banos_completos) out.push(`${p.banos_completos} Baño${Number(p.banos_completos) === 1 ? '' : 's'}`);
  if (p.medios_banos) out.push(`${p.medios_banos} Medio Baño${Number(p.medios_banos) === 1 ? '' : 's'}`);
  if (p.estacionamientos) out.push(`${p.estacionamientos} Estacionamiento${Number(p.estacionamientos) === 1 ? '' : 's'}`);
  if (p.m2_construccion) out.push(`${p.m2_construccion} m² construcción`);
  if (p.m2_terreno && Number(p.m2_terreno) !== Number(p.m2_construccion)) out.push(`${p.m2_terreno} m² terreno`);
  const extras = (p.amenidades || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const a of extras) {
    if (out.length >= 12) break;
    out.push(a);
  }
  return out;
}

/** Lista de requisitos para el bloque derecho de página 2.
 *  Si el cliente la cargó en `requisitos` la usamos; si no, default razonable. */
function buildRequisitos(p) {
  if (p.requisitos && typeof p.requisitos === 'string') {
    return p.requisitos.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 7);
  }
  const op = String(p.tipo_operacion || '').toLowerCase();
  if (op === 'renta') {
    return [
      'Renta largo plazo',
      'Requisitos',
      '1 mes de renta',
      '1 depósito',
      'Estudio socioeconómico',
      'Mascotas bienvenidas',
    ];
  }
  return [
    'Trato directo',
    'Escrituras al corriente',
    'Libre de gravamen',
    'Crédito bancario aceptado',
    'Infonavit / Fovissste',
    'Cita previa',
  ];
}

/** Recorta el título a 2-3 palabras significativas para la banda. */
function makeShortTitle(title) {
  if (!title) return 'PROPIEDAD';
  const words = String(title).replace(/[—–-]/g, ' ').split(/\s+/).filter(Boolean);
  return words.slice(0, 3).join(' ').toUpperCase();
}

/** Barra de contacto compacta para Page1 (teléfono + WhatsApp). */
function drawContactBar(ctx, x, y, w, h) {
  const { doc, agent, brand, primaryDark } = ctx;
  const phone = agent?.telefono || brand?.telefono;
  const wa = agent?.whatsapp || brand?.whatsapp;
  if (!phone && !wa) return;
  doc.rect(x, y, w, h).fill(primaryDark);
  const iconSize = 16;
  let cx = x + 14;
  const cy = y + (h - iconSize) / 2;
  drawPhoneIcon(doc, cx, cy, '#ffffff', iconSize);
  cx += iconSize + 6;
  drawWhatsAppIcon(doc, cx, cy, iconSize);
  cx += iconSize + 12;
  const num = wa || phone;
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#ffffff')
    .text(formatPhone(num), cx, y + (h - 12) / 2, { width: w - (cx - x) - 14, lineBreak: false, ellipsis: true });
}

/** Bloque de contacto vertical para Page2 (instagram, email, web, phone, wa). */
function drawContactBlock(ctx, x, y, w, h) {
  const { doc, agent, brand } = ctx;
  const lines = [];
  const ig = brand?.instagram;
  if (ig) {
    const handle = ig.match(/instagram\.com\/([^/?]+)/i)?.[1];
    lines.push({ icon: 'ig', text: handle ? '@' + handle : ig });
  }
  if (brand?.email) lines.push({ icon: 'em', text: brand.email });
  if (brand?.subdominio) lines.push({ icon: 'web', text: brand.subdominio });
  if (agent?.telefono || brand?.telefono) lines.push({ icon: 'tel', text: formatPhone(agent?.telefono || brand.telefono) });
  if (agent?.whatsapp || brand?.whatsapp) lines.push({ icon: 'wa', text: formatPhone(agent?.whatsapp || brand.whatsapp) });

  // Header "Contact Us"
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff')
    .text('Contact Us', x + 16, y + 14, { width: w - 32, lineBreak: false });

  const lineH = Math.max(18, Math.floor((h - 36) / Math.max(lines.length, 1)));
  let ly = y + 36;
  for (const ln of lines) {
    if (ly + 14 > y + h - 4) break;
    const iconY = ly + 1;
    if (ln.icon === 'ig') drawInstagramIcon(doc, x + 16, iconY, '#ffffff', 12);
    else if (ln.icon === 'em') drawEmailIcon(doc, x + 16, iconY, '#ffffff', 12);
    else if (ln.icon === 'web') drawWebIcon(doc, x + 16, iconY, '#ffffff', 12);
    else if (ln.icon === 'tel') drawPhoneIcon(doc, x + 16, iconY, '#ffffff', 12);
    else if (ln.icon === 'wa') drawWhatsAppIcon(doc, x + 16, iconY, 12);
    doc.font('Helvetica').fontSize(10).fillColor('#ffffff')
      .text(ln.text, x + 36, ly, { width: w - 50, lineBreak: false, ellipsis: true });
    ly += lineH;
  }
}

function formatPhone(p) {
  if (!p) return '';
  const digits = String(p).replace(/\D+/g, '');
  if (digits.length === 12) return `+${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  if (digits.length === 11) return `+${digits.slice(0, 1)} ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  if (digits.length === 10) return `+52 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  return String(p);
}

/** URL clickeable de las fotos. */
function clickUrl({ withAgent, brand, record, baseUrl }) {
  if (withAgent) {
    const slug = record?.properties?.slug_url || record?.id;
    const host = brand?.subdominio;
    if (host) return `https://${host}/p/${slug}`;
    return baseUrl ? `${baseUrl}/p/${slug}` : null;
  }
  return baseUrl || null;
}
