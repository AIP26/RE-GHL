// Composer de la ficha técnica PDF — Paso 12.
// PDFKit, no Puppeteer. Generación bajo demanda, sin almacenamiento.
//
// 4 versiones (kind = `${withAgent ? 'con' : 'sin'}-agente-${pages}pag`):
//   - con-agente-1pag, con-agente-2pag, sin-agente-1pag, sin-agente-2pag
//
// Reglas Master Context:
//   - PDFKit NO soporta WebP → solicitar /f_jpg a Cloudinary
//   - Fotos clickeables: con-agente → /p/:slug · sin-agente → /ficha/:id
//   - Mapa: Google Maps Static API → JPEG embebido
import PDFDocument from 'pdfkit';
import axios from 'axios';
import { parsePhotos } from './render.js';

const PAGE_MARGIN = 36;
const A4_WIDTH = 595.28;   // PDFKit default A4 width in points
const A4_HEIGHT = 841.89;
const CONTENT_WIDTH = A4_WIDTH - PAGE_MARGIN * 2;

// Pide a Cloudinary la versión JPEG y ancho razonable para el PDF.
// Aplica si la URL es de Cloudinary; si no, devuelve la URL tal cual.
function asJpg(url, width = 1200) {
  if (!url || typeof url !== 'string') return null;
  if (!url.includes('/upload/')) return url;
  return url.replace('/upload/', `/upload/f_jpg,c_limit,w_${width}/`);
}

// Descarga una URL como Buffer (imagen). Tolerante a fallos (devuelve null
// si la imagen no se puede bajar — el composer la skipea).
async function fetchBuffer(url, { timeout = 10_000 } = {}) {
  if (!url) return null;
  try {
    const { data } = await axios.get(url, { responseType: 'arraybuffer', timeout });
    return Buffer.from(data);
  } catch (err) {
    console.warn('[pdf] fetch image failed:', url, err.message);
    return null;
  }
}

// Google Maps Static URL (devuelve null si falta API key o lat/lng).
function staticMapUrl(lat, lng, { width = 600, height = 280, zoom = 15 } = {}) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || !lat || !lng) return null;
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

// Helpers de color/seguridad
function safeHex(v, fallback) {
  if (typeof v !== 'string' || !/^#([0-9a-f]{3}){1,2}$/i.test(v)) return fallback;
  return v;
}

function fmtPrice(n, currency = 'USD') {
  if (n == null || n === '') return '';
  const num = Number(n);
  if (!Number.isFinite(num)) return '';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(num);
}

/** Genera el PDF en streaming. Devuelve el `doc` PDFKit; el caller hace
 *  `doc.pipe(res)` antes y `doc.end()` lo cierra. */
export async function buildPropertyPDF({
  record, brand, agent, withAgent, twoPages, baseUrl,
}) {
  const p = record?.properties || {};

  // URLs y assets que pediremos en paralelo antes de empezar a dibujar
  const photos = parsePhotos(p.fotos_urls).slice(0, 9);
  const hero = asJpg(photos[0], 1600);
  const gallerySmall = photos.slice(1, 4).map((u) => asJpg(u, 600));
  const page2Photos = twoPages ? photos.slice(1, 9).map((u) => asJpg(u, 800)) : [];
  const mapUrl = staticMapUrl(p.latitud, p.longitud);
  const logoUrl = asJpg(brand?.logo_url, 400);
  const agentPhotoUrl = withAgent && agent?.foto_url ? asJpg(agent.foto_url, 200) : null;

  const [heroBuf, galleryBufs, page2Bufs, mapBuf, logoBuf, agentBuf] = await Promise.all([
    fetchBuffer(hero),
    Promise.all(gallerySmall.map(fetchBuffer)),
    Promise.all(page2Photos.map(fetchBuffer)),
    fetchBuffer(mapUrl),
    fetchBuffer(logoUrl),
    fetchBuffer(agentPhotoUrl),
  ]);

  // Configuración del documento
  const primary = safeHex(brand?.color_principal, '#0f172a');
  const accent = safeHex(brand?.color_acento, '#f59e0b');
  const muted = '#64748b';
  const border = '#e5e7eb';

  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE_MARGIN,
    info: {
      Title: p.titulo || 'Propiedad',
      Author: brand?.nombre_agencia || 'mktscaled',
      Subject: 'Ficha técnica',
    },
  });

  // ----- Página 1 -----
  drawPage1({
    doc, p, brand, agent, withAgent, primary, accent, muted, border,
    heroBuf, galleryBufs, mapBuf, logoBuf, agentBuf,
    baseUrl, record,
  });

  // ----- Página 2 (sólo "2pag") -----
  if (twoPages && page2Bufs.length) {
    doc.addPage();
    drawPage2({ doc, p, brand, withAgent, primary, muted, border, logoBuf, page2Bufs, baseUrl, record, agent });
  }

  return doc;
}

// ---------------------------------------------------------------------
// Layout — Página 1
// ---------------------------------------------------------------------
function drawPage1({
  doc, p, brand, agent, withAgent, primary, accent, muted, border,
  heroBuf, galleryBufs, mapBuf, logoBuf, agentBuf,
  baseUrl, record,
}) {
  const x = PAGE_MARGIN;
  let y = PAGE_MARGIN;

  // ----- HEADER -----
  const HEADER_H = withAgent ? 64 : 48;
  if (logoBuf) {
    try { doc.image(logoBuf, x, y, { fit: [120, HEADER_H], align: 'left', valign: 'top' }); } catch (e) { /* skip */ }
  } else if (brand?.nombre_agencia) {
    doc.fillColor(primary).font('Helvetica-Bold').fontSize(16).text(brand.nombre_agencia, x, y + 8);
  }
  if (withAgent) {
    // Datos de contacto agencia/agente arriba-derecha
    const right = x + CONTENT_WIDTH;
    let yy = y;
    doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(10);
    if (agent?.nombre) { doc.text(agent.nombre, right - 220, yy, { width: 220, align: 'right', lineBreak: false, ellipsis: true }); yy += 13; }
    doc.font('Helvetica').fontSize(9).fillColor(muted);
    if (agent?.telefono || brand?.telefono) { doc.text(agent?.telefono || brand.telefono, right - 220, yy, { width: 220, align: 'right', lineBreak: false, ellipsis: true }); yy += 11; }
    if (agent?.email || brand?.email) { doc.text(agent?.email || brand.email, right - 220, yy, { width: 220, align: 'right', lineBreak: false, ellipsis: true }); yy += 11; }
  }
  y += HEADER_H + 12;
  // Línea sutil
  doc.strokeColor(border).lineWidth(0.5).moveTo(x, y).lineTo(x + CONTENT_WIDTH, y).stroke();
  y += 14;

  // ----- FOTO HERO con badge de precio -----
  const heroH = 220;
  const heroLinkUrl = clickUrl({ withAgent, brand, record, baseUrl });
  if (heroBuf) {
    try {
      doc.image(heroBuf, x, y, { fit: [CONTENT_WIDTH, heroH], align: 'center', valign: 'center' });
    } catch (e) { /* skip */ }
  } else {
    doc.rect(x, y, CONTENT_WIDTH, heroH).fill('#f1f5f9');
  }
  // Click overlay
  if (heroLinkUrl) doc.link(x, y, CONTENT_WIDTH, heroH, heroLinkUrl);

  // Badge de precio
  const priceText = p.precio_a_consultar ? 'Consultar precio' : fmtPrice(p.precio_usd, 'USD');
  if (priceText) {
    const bw = Math.max(140, doc.widthOfString(priceText) + 28);
    const bh = 32;
    const bx = x + 14;
    const by = y + heroH - bh - 14;
    doc.save();
    doc.roundedRect(bx, by, bw, bh, 6).fill(primary);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(15).text(priceText, bx, by + 9, { width: bw, align: 'center' });
    doc.restore();
  }
  y += heroH + 16;

  // ----- TÍTULO + UBICACIÓN -----
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(18).text(p.titulo || 'Propiedad', x, y, { width: CONTENT_WIDTH });
  y = doc.y + 2;
  const ubicacion = [p.colonia, p.ciudad, p.estado_municipio].filter(Boolean).join(', ');
  if (ubicacion) {
    doc.fillColor(muted).font('Helvetica').fontSize(10).text(ubicacion, x, y, { width: CONTENT_WIDTH });
    y = doc.y + 8;
  }
  // Precio MXN secundario debajo del título si aplica
  const mxn = !p.precio_a_consultar && p.precio_mxn ? fmtPrice(p.precio_mxn, 'MXN') : '';
  if (mxn) {
    doc.fillColor(muted).font('Helvetica').fontSize(10).text(mxn, x, y);
    y = doc.y + 6;
  }

  // ----- STATS ROW -----
  const stats = [
    p.recamaras ? { l: 'Recámaras', v: p.recamaras } : null,
    p.banos_completos ? { l: 'Baños', v: p.banos_completos } : null,
    p.m2_construccion ? { l: 'm² constr.', v: p.m2_construccion } : null,
    p.estacionamientos ? { l: 'Estac.', v: p.estacionamientos } : null,
  ].filter(Boolean);
  if (stats.length) {
    const cellW = (CONTENT_WIDTH - 12) / stats.length;
    stats.forEach((s, i) => {
      const cx = x + i * (cellW + 4);
      doc.save();
      doc.roundedRect(cx, y, cellW, 44, 4).fill('#f8fafc');
      doc.fillColor(muted).font('Helvetica').fontSize(8).text(String(s.l).toUpperCase(), cx + 8, y + 6, { width: cellW - 16 });
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(16).text(String(s.v), cx + 8, y + 18, { width: cellW - 16 });
      doc.restore();
    });
    y += 56;
  }

  // ----- GALERÍA PEQUEÑA (fotos 2,3,4) -----
  const validGallery = galleryBufs.filter(Boolean);
  if (validGallery.length) {
    const cols = validGallery.length;
    const gap = 6;
    const cellW = (CONTENT_WIDTH - gap * (cols - 1)) / cols;
    const cellH = 80;
    validGallery.forEach((buf, i) => {
      const cx = x + i * (cellW + gap);
      try { doc.image(buf, cx, y, { fit: [cellW, cellH], align: 'center', valign: 'center' }); } catch (e) { /* skip */ }
      if (heroLinkUrl) doc.link(cx, y, cellW, cellH, heroLinkUrl);
    });
    y += cellH + 14;
  }

  // ----- DESCRIPCIÓN -----
  // Espacio disponible: lo que queda hasta el footer area (~ A4-PAGE_MARGIN-footer 68px)
  const SAFE_BOTTOM = A4_HEIGHT - PAGE_MARGIN - 76;
  if (p.descripcion && y < SAFE_BOTTOM - 40) {
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11).text('DESCRIPCIÓN', x, y);
    y = doc.y + 4;
    doc.fillColor('#1e293b').font('Helvetica').fontSize(9.5);
    const maxH = Math.min(80, SAFE_BOTTOM - y - 10);
    doc.text(String(p.descripcion).slice(0, 700), x, y, { width: CONTENT_WIDTH, lineGap: 2, ellipsis: true, height: maxH });
    y = Math.min(y + maxH, doc.y) + 10;
  }

  // ----- AMENIDADES -----
  const amenities = (p.amenidades || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (amenities.length && y < SAFE_BOTTOM - 30) {
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11).text('AMENIDADES', x, y);
    y = doc.y + 6;
    let cx = x;
    let cy = y;
    doc.font('Helvetica').fontSize(9).fillColor('#0f172a');
    for (const a of amenities.slice(0, 16)) {
      if (cy > SAFE_BOTTOM - 24) break; // no más espacio
      const w = doc.widthOfString(a) + 16;
      if (cx + w > x + CONTENT_WIDTH) { cx = x; cy += 22; }
      if (cy > SAFE_BOTTOM - 24) break;
      doc.save();
      doc.roundedRect(cx, cy - 2, w, 18, 3).fillAndStroke('#f1f5f9', border);
      doc.fillColor('#1e293b').text(a, cx + 8, cy + 1, { lineBreak: false });
      doc.restore();
      cx += w + 4;
    }
    y = cy + 24;
  }

  // ----- MAPA -----
  // Sólo si queda espacio razonable (>120px) — si no, lo saltamos
  if (mapBuf && y < SAFE_BOTTOM - 130) {
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11).text('UBICACIÓN', x, y);
    y = doc.y + 4;
    const mapH = Math.min(130, SAFE_BOTTOM - y - 4);
    try { doc.image(mapBuf, x, y, { fit: [CONTENT_WIDTH, mapH], align: 'center' }); } catch (e) { /* skip */ }
    y += mapH + 10;
  }

  // ----- FOOTER -----
  drawFooter({ doc, brand, agent, withAgent, agentBuf, logoBuf, primary, muted });
}

// ---------------------------------------------------------------------
// Layout — Página 2 (sólo versiones "2pag"): grid 2x4 con fotos 2-9
// ---------------------------------------------------------------------
function drawPage2({ doc, p, brand, withAgent, primary, muted, border, logoBuf, page2Bufs, baseUrl, record, agent }) {
  const x = PAGE_MARGIN;
  let y = PAGE_MARGIN;

  // Header mínimo
  if (logoBuf) {
    try { doc.image(logoBuf, x, y, { fit: [100, 40] }); } catch (e) { /* skip */ }
  } else if (brand?.nombre_agencia) {
    doc.fillColor(primary).font('Helvetica-Bold').fontSize(14).text(brand.nombre_agencia, x, y + 6);
  }
  y += 50;
  doc.strokeColor(border).lineWidth(0.5).moveTo(x, y).lineTo(x + CONTENT_WIDTH, y).stroke();
  y += 16;

  // Título de la sección
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11).text('GALERÍA', x, y);
  y = doc.y + 6;

  // Grid 2 columnas x 4 filas
  const cols = 2;
  const gap = 8;
  const cellW = (CONTENT_WIDTH - gap) / cols;
  const cellH = 150;
  const linkUrl = clickUrl({ withAgent, brand, record, baseUrl });

  page2Bufs.slice(0, 8).forEach((buf, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = x + col * (cellW + gap);
    const cy = y + row * (cellH + gap);
    if (!buf) {
      doc.rect(cx, cy, cellW, cellH).fillAndStroke('#f1f5f9', border);
      return;
    }
    try { doc.image(buf, cx, cy, { fit: [cellW, cellH], align: 'center', valign: 'center' }); } catch (e) { /* skip */ }
    if (linkUrl) doc.link(cx, cy, cellW, cellH, linkUrl);
  });

  // Footer mínimo (solo nombre agente si aplica)
  if (withAgent && agent?.nombre) {
    doc.fillColor(muted).font('Helvetica').fontSize(9)
      .text(agent.nombre, x, A4_HEIGHT - PAGE_MARGIN - 18, { width: CONTENT_WIDTH, align: 'center', lineBreak: false, ellipsis: true });
  }
}

// ---------------------------------------------------------------------
// Footer reutilizable (sólo en Página 1)
// ---------------------------------------------------------------------
function drawFooter({ doc, brand, agent, withAgent, agentBuf, logoBuf, primary, muted }) {
  const x = PAGE_MARGIN;
  const footY = A4_HEIGHT - PAGE_MARGIN - 60;

  doc.strokeColor('#e5e7eb').lineWidth(0.5).moveTo(x, footY - 8).lineTo(x + CONTENT_WIDTH, footY - 8).stroke();

  // Logo izquierda
  if (logoBuf) {
    try { doc.image(logoBuf, x, footY, { fit: [100, 50] }); } catch (e) { /* skip */ }
  }

  if (withAgent && (agent || brand)) {
    // Agente derecha
    const right = x + CONTENT_WIDTH;
    const blockW = 220;
    const blockX = right - blockW;
    let yy = footY;

    if (agentBuf) {
      try { doc.image(agentBuf, blockX, yy, { fit: [40, 40] }); } catch (e) { /* skip */ }
    }
    const textX = agentBuf ? blockX + 48 : blockX;
    const textW = blockW - (agentBuf ? 48 : 0);

    // OJO: lineBreak:false en todas las líneas para evitar autopaginación
    // si un email largo se sale de blockW. Cada línea es exactamente 12px alto.
    if (agent?.nombre) {
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(10)
        .text(agent.nombre, textX, yy, { width: textW, lineBreak: false, ellipsis: true });
      yy += 13;
    }
    doc.fillColor(muted).font('Helvetica').fontSize(9);
    if (agent?.telefono || brand?.telefono) {
      doc.text(agent?.telefono || brand.telefono, textX, yy, { width: textW, lineBreak: false, ellipsis: true });
      yy += 11;
    }
    if (agent?.whatsapp) {
      doc.text('WhatsApp: ' + agent.whatsapp, textX, yy, { width: textW, lineBreak: false, ellipsis: true });
      yy += 11;
    }
    if (agent?.email || brand?.email) {
      doc.text(agent?.email || brand.email, textX, yy, { width: textW, lineBreak: false, ellipsis: true });
    }
  } else if (brand?.nombre_agencia) {
    doc.fillColor(muted).font('Helvetica').fontSize(9)
      .text(brand.nombre_agencia, x + 120, footY + 18, { lineBreak: false });
  }
}

// ---------------------------------------------------------------------
// URL clickeable en las fotos del PDF
//   con-agente → portal público del agente /p/:slug
//   sin-agente → URL orgánica /ficha/:fichaId  (la pasamos como baseUrl)
// ---------------------------------------------------------------------
function clickUrl({ withAgent, brand, record, baseUrl }) {
  if (withAgent) {
    const slug = record?.properties?.slug_url || record?.id;
    const host = brand?.subdominio;
    if (host) return `https://${host}/p/${slug}`;
    return `${baseUrl || ''}/p/${slug}`;
  }
  // Sin-agente: baseUrl ya viene como la URL completa de la ficha orgánica
  return baseUrl || null;
}
