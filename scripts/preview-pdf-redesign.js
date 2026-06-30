// Genera las 4 versiones del PDF para revisión visual.
// Output: /tmp/pdf-preview/<version>.pdf
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { findTenantByLocationId } from '../src/lib/tenants.js';
import { loadBrand, loadAgents, getPropertyById, listProperties } from '../src/lib/public-data.js';
import { buildPropertyPDF } from '../src/lib/pdf.js';

const LOCATION_ID = 'cNg6MFQcxv8bZnwCppoM';
const OUT_DIR = '/tmp/pdf-preview';
const VERSIONS = [
  { name: 'con-agente-1pag', withAgent: true, twoPages: false },
  { name: 'con-agente-2pag', withAgent: true, twoPages: true },
  { name: 'sin-agente-1pag', withAgent: false, twoPages: false },
  { name: 'sin-agente-2pag', withAgent: false, twoPages: true },
];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const t = await findTenantByLocationId(LOCATION_ID);
  if (!t) throw new Error('tenant not found');
  const props = await listProperties(t.id, { limit: 5 });
  if (!props.length) throw new Error('no properties available');

  // Buscar una propiedad CON fotos (>=4) y coordenadas para mejor revisión
  let chosen = props.find((pr) => {
    const fs = String(pr.properties?.fotos_urls || '').split('|').filter(Boolean);
    return fs.length >= 4 && pr.properties?.latitud && pr.properties?.longitud;
  }) || props[0];
  const record = await getPropertyById(t.id, chosen.id);

  console.log('property:', record.id, '·', record.properties?.titulo);
  console.log('photos count:', String(record.properties?.fotos_urls || '').split('|').filter(Boolean).length);
  console.log('coords:', record.properties?.latitud, ',', record.properties?.longitud);

  const [brand, agents] = await Promise.all([loadBrand(t.id), loadAgents(t.id)]);
  const agent = agents[record.properties?.agente_responsable] || null;
  console.log('brand colors → principal:', brand?.color_principal, '· acento:', brand?.color_acento);
  console.log('agent:', agent?.nombre, '·', agent?.whatsapp);

  for (const v of VERSIONS) {
    process.stdout.write(`  · generando ${v.name}… `);
    const doc = await buildPropertyPDF({
      record, brand, agent,
      withAgent: v.withAgent,
      twoPages: v.twoPages,
      baseUrl: `https://${brand?.subdominio || 'preview.mktscaled.com'}`,
    });
    const outPath = path.join(OUT_DIR, `${v.name}.pdf`);
    const ws = fs.createWriteStream(outPath);
    doc.pipe(ws);
    doc.end();
    await new Promise((res, rej) => { ws.on('finish', res); ws.on('error', rej); });
    const stats = fs.statSync(outPath);
    console.log('OK ·', (stats.size / 1024).toFixed(1) + ' KB');
  }

  // Variante extra: forzar tipo_operacion='renta' para verificar las viñetas de renta.
  // Sólo genera con-agente-2pag (que es la versión donde aparece el bloque de viñetas).
  process.stdout.write('  · generando con-agente-2pag-RENTA-test… ');
  const rentaRecord = JSON.parse(JSON.stringify(record));
  rentaRecord.properties.tipo_operacion = 'renta';
  const rentaDoc = await buildPropertyPDF({
    record: rentaRecord, brand, agent,
    withAgent: true, twoPages: true,
    baseUrl: `https://${brand?.subdominio || 'preview.mktscaled.com'}`,
  });
  const rentaPath = path.join(OUT_DIR, 'con-agente-2pag-RENTA-test.pdf');
  const rws = fs.createWriteStream(rentaPath);
  rentaDoc.pipe(rws);
  rentaDoc.end();
  await new Promise((res, rej) => { rws.on('finish', res); rws.on('error', rej); });
  console.log('OK ·', (fs.statSync(rentaPath).size / 1024).toFixed(1) + ' KB');

  console.log('\nlisto: ls -la', OUT_DIR);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
