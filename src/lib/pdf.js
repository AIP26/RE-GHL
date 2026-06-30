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
  // Si hay un segmento de transformación viejo justo después de /upload/
  // (lo detectamos por la presencia de coma o flags antes del /v<num>/),
  // lo reemplazamos íntegro. Si no, simplemente insertamos.
  const re = /\/upload\/(?:[^/]+\/)?(v\d+\/)/;
  if (re.test(url)) {
    return url.replace(re, `/upload/${transform}/$1`);
  }
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
// Icon primitives (no fonts emoji — vectores PDFKit)
// ---------------------------------------------------------------------

/** Pin rojo (gota invertida) en (x,y). h = altura total. */
function drawPin(doc, x, y, color = '#dc2626', h = 11) {
  const r = h * 0.32;
  const cx = x + r;
  const cy = y + r;
  doc.save();
  // Cuerpo: círculo
  doc.circle(cx, cy, r).fill(color);
  // Punta: triángulo descendente
  doc.moveTo(cx - r * 0.85, cy + r * 0.45)
    .lineTo(cx + r * 0.85, cy + r * 0.45)
    .lineTo(cx, y + h)
    .closePath()
    .fill(color);
  // Centro blanco
  doc.circle(cx, cy, r * 0.32).fill('#ffffff');
  doc.restore();
}

/** Ícono de teléfono (auricular simplificado). */
function drawPhoneIcon(doc, x, y, color = '#ffffff', size = 11) {
  doc.save();
  doc.lineWidth(size * 0.18).strokeColor(color);
  const s = size;
  // Forma de auricular: rotada
  doc.roundedRect(x + s * 0.05, y + s * 0.05, s * 0.4, s * 0.9, s * 0.15).stroke();
  doc.roundedRect(x + s * 0.55, y + s * 0.05, s * 0.4, s * 0.9, s * 0.15).stroke();
  doc.moveTo(x + s * 0.25, y + s * 0.7).lineTo(x + s * 0.75, y + s * 0.3).stroke();
  doc.restore();
}

/** Ícono WhatsApp (círculo verde con burbuja blanca). */
function drawWhatsAppIcon(doc, x, y, size = 12) {
  doc.save();
  const r = size / 2;
  doc.circle(x + r, y + r, r).fill('#25d366');
  // Burbuja blanca interior
  doc.fillColor('#ffffff');
  doc.circle(x + r, y + r * 0.95, r * 0.55).fill();
  // Cola pequeña
  doc.moveTo(x + r * 0.55, y + r * 1.5)
    .lineTo(x + r * 0.3, y + r * 1.75)
    .lineTo(x + r * 0.85, y + r * 1.45)
    .closePath()
    .fill();
  doc.restore();
}

/** Ícono Instagram simplificado (cuadrado redondeado con círculo). */
function drawInstagramIcon(doc, x, y, color = '#ffffff', size = 11) {
  doc.save();
  doc.lineWidth(size * 0.12).strokeColor(color);
  doc.roundedRect(x + 1, y + 1, size - 2, size - 2, size * 0.22).stroke();
  doc.circle(x + size / 2, y + size / 2, size * 0.22).stroke();
  doc.circle(x + size * 0.78, y + size * 0.22, size * 0.06).fill(color);
  doc.restore();
}

/** Ícono email (sobre). */
function drawEmailIcon(doc, x, y, color = '#ffffff', size = 11) {
  doc.save();
  doc.lineWidth(size * 0.12).strokeColor(color);
  doc.rect(x + 1, y + size * 0.2, size - 2, size * 0.6).stroke();
  doc.moveTo(x + 1, y + size * 0.2).lineTo(x + size / 2, y + size * 0.55).lineTo(x + size - 1, y + size * 0.2).stroke();
  doc.restore();
}

/** Ícono web (globo). */
function drawWebIcon(doc, x, y, color = '#ffffff', size = 11) {
  doc.save();
  doc.lineWidth(size * 0.1).strokeColor(color);
  const r = size / 2 - 1;
  const cx = x + size / 2;
  const cy = y + size / 2;
  doc.circle(cx, cy, r).stroke();
  // Meridianos
  doc.moveTo(cx, cy - r).lineTo(cx, cy + r).stroke();
  // Ecuador
  doc.moveTo(cx - r, cy).lineTo(cx + r, cy).stroke();
  // Curvas laterales (elipses)
  doc.ellipse(cx, cy, r * 0.5, r).stroke();
  doc.restore();
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

  const logoUrl = withAgent ? asJpg(brand?.logo_url, 400) : null;
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

  // ===== HERO photo full-width =====
  const HERO_H = 280;
  if (heroBuf) {
    try {
      doc.save();
      doc.rect(x, y, CONTENT_WIDTH, HERO_H).clip();
      doc.image(heroBuf, x, y, { cover: [CONTENT_WIDTH, HERO_H], align: 'center', valign: 'center' });
      doc.restore();
    } catch (e) {
      doc.rect(x, y, CONTENT_WIDTH, HERO_H).fill('#e5e7eb');
    }
  } else {
    doc.rect(x, y, CONTENT_WIDTH, HERO_H).fill('#e5e7eb');
  }

  // Logo overlay top-right (solo con-agente)
  if (withAgent && logoBuf) {
    const LOGO_W = 130;
    const LOGO_H = 70;
    const lx = x + CONTENT_WIDTH - LOGO_W - 12;
    const ly = y + 12;
    // Caja de fondo color de marca semitransparente (sólo color sólido en PDFKit)
    doc.save();
    doc.rect(lx - 8, ly - 8, LOGO_W + 16, LOGO_H + 16).fill(primaryDark);
    try {
      doc.image(logoBuf, lx, ly, { fit: [LOGO_W, LOGO_H], align: 'center', valign: 'center' });
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

  // --- Bloque color (derecha) ---
  doc.rect(rightX, BLOCK_TOP, RIGHT_W, BLOCK_H).fill(primary);

  // Operation label "EN VENTA" / "EN RENTA"
  const op = operationLabel(p.tipo_operacion);
  doc.fillColor('#ffffff');
  doc.font('Helvetica-Bold').fontSize(28).text(op.line1, rightX + 14, BLOCK_TOP + 22, {
    width: RIGHT_W - 28, lineBreak: false,
  });
  doc.font('Helvetica-Bold').fontSize(38).text(op.line2, rightX + 14, BLOCK_TOP + 52, {
    width: RIGHT_W - 28, lineBreak: false,
  });

  // Tagline pequeño (extracto descripción)
  const tagline = makeTagline(p);
  if (tagline) {
    doc.font('Helvetica').fontSize(9.5).fillColor('#ffffff')
      .text(tagline, rightX + 14, BLOCK_TOP + 102, {
        width: RIGHT_W - 28, lineGap: 2, height: 72, ellipsis: true,
      });
  }

  // Precio en el fondo del bloque
  const priceLines = priceBlockText(p, op.kind);
  const priceBlockY = BLOCK_TOP + BLOCK_H - 92;
  let py = priceBlockY;
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#ffffff')
    .text(priceLines[0], rightX + 14, py, { width: RIGHT_W - 28, lineBreak: false });
  py += 24;
  doc.font('Helvetica-Bold').fontSize(26).fillColor('#ffffff')
    .text(priceLines[1], rightX + 14, py, { width: RIGHT_W - 28, lineBreak: false, ellipsis: true });
  py += 30;
  if (priceLines[2]) {
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#ffffff')
      .text(priceLines[2], rightX + 14, py, { width: RIGHT_W - 28, lineBreak: false });
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

  // Bloque 2: promo + precio
  const op = operationLabel(p.tipo_operacion);
  const priceLines = priceBlockText(p, op.kind);
  const PRICE_H = 145;
  doc.rect(rightX, ry, RIGHT_W, PRICE_H).fill(primary);
  doc.font('Helvetica').fontSize(11).fillColor('#ffffff')
    .text('PROMO ESPECIAL', rightX, ry + 16, { width: RIGHT_W, align: 'center', lineBreak: false });
  doc.text('ESTE MES', rightX, ry + 32, { width: RIGHT_W, align: 'center', lineBreak: false });
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

/** Tagline corto a partir de descripción/etiqueta. */
function makeTagline(p) {
  if (p.etiqueta) {
    const e = String(p.etiqueta).toLowerCase();
    if (e.includes('destac')) return 'Propiedad destacada con excelente ubicación y amenidades.';
    if (e.includes('oport')) return 'Excelente oportunidad de inversión con precio competitivo.';
    if (e.includes('nuev')) return 'Recién publicada — sé el primero en conocerla.';
  }
  const d = String(p.descripcion || '').replace(/\s+/g, ' ').trim();
  if (d.length < 30) return 'Ideal para quienes buscan una excelente opción con precio accesible y amenidades.';
  // Primera oración corta
  const firstSentence = d.split(/[.!?]\s/)[0];
  if (firstSentence.length > 30 && firstSentence.length < 140) return firstSentence + '.';
  return d.slice(0, 110).trim() + '…';
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
