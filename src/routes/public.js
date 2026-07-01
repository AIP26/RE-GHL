// Páginas públicas (Paso 9) — servidas en dominios custom de clientes
// (propiedades.thebrokers.mx) o en preview vía ?preview=<tenantId>.
//
// 5 rutas:
//   GET /                 → Home con hero + buscador
//   GET /coleccion/:slug  → Grid de colección con filtros client-side
//   GET /p/:slug          → Detalle de propiedad + SEO + page_view
//   GET /buscar           → Resultados con filtros y page_view
//   GET /ficha/:id        → URL orgánica sin branding + page_view
//
// El render es HTML server-rendered (no React) para SEO/perf óptimos.
import { Router } from 'express';
import {
  loadBrand, loadAgents,
  listProperties, getPropertyById, findPropertyBySlug, loadCollectionWithIds,
  applyFilters, sortFeaturedFirst, recordPageView,
} from '../lib/public-data.js';
import {
  esc, fmtPrice, portalUrl, parsePhotos, cld,
  mapsEmbedHref, mapsViewHref,
  head, footer, brandHeader, propertyCard,
  getDisplayPrices,
  ICON_BED, ICON_BATH, ICON_AREA, ICON_CAR,
} from '../lib/render.js';
import { getSupabase } from '../lib/supabase.js';

const r = Router();

// Guard: todas las rutas públicas requieren tenant resuelto por el middleware.
// EXCEPCIÓN: el subdominio `ficha.<APP_DOMAIN>` NO tiene tenant a nivel host —
// el tenant se resuelve dentro del handler por el slug en la URL (fichas_url).
// Ese subdominio sólo expone la ruta orgánica (GET /:id) y su PDF.
function requirePortalTenant(req, res, next) {
  if (req.isFichaHost) return next();
  if (!req.portalTenantId) {
    return res.status(404).type('html').send(
      `<!doctype html><html><head><meta charset="utf-8"><title>Portal no encontrado</title></head>
       <body style="font-family:system-ui;text-align:center;padding:80px 24px">
         <h1 style="font-size:24px">Portal no encontrado</h1>
         <p style="color:#64748b">No hay un portal configurado en ${esc(req.headers.host || '')}.</p>
         <p style="color:#94a3b8;font-size:13px;margin-top:24px">¿Vienes a configurar tu dominio? Inicia sesión en GHL → Listings → Configuración → Dominio.</p>
       </body></html>`
    );
  }
  next();
}
r.use(requirePortalTenant);

// ---------------------------------------------------------------------
// FICHA SUBDOMAIN — `ficha.<APP_DOMAIN>/<slug>` es la URL orgánica compartida
// entre TODOS los tenants (sin branding, no-index). Delegamos al mismo handler
// que /ficha/:id. Sólo aplica cuando el middleware marcó isFichaHost=true;
// en cualquier otro host, cae al next() y el resto del router sigue normal.
// ---------------------------------------------------------------------
r.get('/:id', (req, res, next) => {
  if (!req.isFichaHost) return next();
  return handleFichaOrganica(req, res, next);
});

// ---------------------------------------------------------------------
// 1) HOME
// ---------------------------------------------------------------------
r.get('/', async (req, res, next) => {
  try {
    // El subdominio `ficha.<APP_DOMAIN>` es puro slug-router — no tiene home.
    // Sin este short-circuit el handler seguiría con tenantId=undefined y
    // Supabase respondería 500 con "invalid input syntax for type uuid".
    if (req.isFichaHost) return notFound(res, null, 'Ruta no válida en este dominio.');
    const tenantId = req.portalTenantId;
    const [brand, records, agents] = await Promise.all([
      loadBrand(tenantId),
      listProperties(tenantId, { limit: 24 }),
      loadAgents(tenantId),
    ]);
    const sorted = sortFeaturedFirst(records);
    const hero = brand?.hero_foto_url
      ? cld(brand.hero_foto_url, 'c_fill,w_1920,h_1080,q_auto,f_auto')
      : null;

    const title = brand?.nombre_agencia
      ? `${brand.nombre_agencia} — Propiedades en venta y renta`
      : 'Propiedades';
    const description = brand?.nombre_agencia
      ? `Encuentra casas, departamentos y oportunidades inmobiliarias con ${brand.nombre_agencia}.`
      : 'Encuentra tu próxima propiedad.';
    const ogImage = hero || (sorted[0]?.properties?.fotos_urls?.split('|')[0]);

    const html =
      head({ title, description, brand, ogImage, ogUrl: portalUrl(brand, '/'), canonical: portalUrl(brand, '/') }) +
      `<section class="hero">
        ${hero ? `<img class="hero-bg" src="${esc(hero)}" alt="" />` : ''}
        <div class="container hero-content">
          ${brand?.logo_url ? `<img src="${esc(brand.logo_url)}" alt="${esc(brand.nombre_agencia || '')}" style="height:56px;width:auto;margin-bottom:24px;display:block" />` : ''}
          <h1>${esc(brand?.nombre_agencia || 'Encuentra tu próxima propiedad')}</h1>
          <p>Casas, departamentos y oportunidades — listas para vivir o invertir.</p>
          <form class="search-box" method="GET" action="/buscar">
            <select name="operacion" aria-label="Operación">
              <option value="">Venta o renta</option>
              <option value="Venta">Venta</option>
              <option value="Renta">Renta</option>
            </select>
            <select name="tipo" aria-label="Tipo">
              <option value="">Cualquier tipo</option>
              <option value="Casa">Casa</option>
              <option value="Departamento">Departamento</option>
              <option value="Local">Local</option>
              <option value="Terreno">Terreno</option>
              <option value="Oficina">Oficina</option>
              <option value="Villa">Villa</option>
              <option value="Penthouse">Penthouse</option>
            </select>
            <input type="text" name="q" placeholder="Zona, colonia, palabras clave…" />
            <button type="submit" class="btn btn-accent">Buscar</button>
          </form>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <h2 class="section-title">Propiedades destacadas</h2>
          ${sorted.length
            ? `<div class="cards-grid">${sorted.slice(0, 12).map(propertyCard).join('')}</div>`
            : `<div class="empty">Aún no hay propiedades publicadas.</div>`}
        </div>
      </section>

      ${whatsappFab(brand)}` +
      footer(brand);
    res.type('html').send(html);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// 2) COLECCIÓN
// ---------------------------------------------------------------------
r.get('/coleccion/:slug', async (req, res, next) => {
  try {
    const tenantId = req.portalTenantId;
    const [brand, col] = await Promise.all([
      loadBrand(tenantId),
      loadCollectionWithIds(tenantId, req.params.slug),
    ]);
    if (!col) return notFound(res, brand, 'Colección no encontrada');

    // Pull all properties, filter to ids of this collection
    const recordsAll = await listProperties(tenantId, { limit: 100 });
    const records = recordsAll.filter((r) => col.propiedadIds.includes(r.id));
    const filtered = applyFilters(records, {
      operacion: req.query.operacion,
      precio_min: req.query.precio_min,
      precio_max: req.query.precio_max,
      recamaras: req.query.recamaras,
    });
    const sorted = sortFeaturedFirst(filtered);

    const heroImg = col.foto_url
      ? cld(col.foto_url, 'c_fill,w_1600,h_640,q_auto,f_auto')
      : (sorted[0]?.properties?.fotos_urls?.split('|')[0]);

    const title = `${col.nombre} — ${brand?.nombre_agencia || 'Propiedades'}`;
    const html =
      head({
        title,
        description: `${col.nombre}: ${sorted.length} propiedades disponibles.`,
        brand,
        ogImage: heroImg,
        ogUrl: portalUrl(brand, '/coleccion/' + col.slug),
        canonical: portalUrl(brand, '/coleccion/' + col.slug),
      }) +
      brandHeader(brand) +
      `${heroImg ? `<div style="position:relative;background:#0f172a">
        <img src="${esc(heroImg)}" alt="" style="width:100%;height:240px;object-fit:cover;opacity:.6" />
        <div class="container" style="position:absolute;inset:0;display:flex;align-items:center;color:#fff">
          <h1 style="font-size:32px;font-weight:800;margin:0">${esc(col.nombre)}</h1>
        </div>
      </div>` : ''}
      <section class="section">
        <div class="container">
          ${!heroImg ? `<h1 class="section-title">${esc(col.nombre)}</h1>` : ''}
          <form class="filters" method="GET">
            <select name="operacion"><option value="">Operación</option>${['Venta','Renta'].map((o)=>`<option value="${o}" ${req.query.operacion===o?'selected':''}>${o}</option>`).join('')}</select>
            <input name="precio_min" type="number" placeholder="Precio mín. USD" value="${esc(req.query.precio_min || '')}" />
            <input name="precio_max" type="number" placeholder="Precio máx. USD" value="${esc(req.query.precio_max || '')}" />
            <select name="recamaras"><option value="">Recámaras</option>${[1,2,3,4,5].map((n)=>`<option value="${n}" ${String(req.query.recamaras)===String(n)?'selected':''}>${n}+</option>`).join('')}</select>
            <button type="submit" class="btn">Filtrar</button>
          </form>
          <div style="color:var(--color-text-muted);font-size:13px;margin:-6px 0 18px">${sorted.length} propiedad${sorted.length===1?'':'es'} en esta colección</div>
          ${sorted.length
            ? `<div class="cards-grid">${sorted.map(propertyCard).join('')}</div>`
            : `<div class="empty">No hay propiedades que coincidan con los filtros.</div>`}
        </div>
      </section>
      ${whatsappFab(brand)}` +
      footer(brand);
    res.type('html').send(html);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// 3) DETALLE
// ---------------------------------------------------------------------
r.get('/p/:slug', async (req, res, next) => {
  try {
    const tenantId = req.portalTenantId;
    const [brand, record] = await Promise.all([
      loadBrand(tenantId),
      findPropertyBySlug(tenantId, req.params.slug),
    ]);
    if (!record) return notFound(res, brand, 'Propiedad no encontrada');
    const p = record.properties || {};
    recordPageView(tenantId, record.id, 'portal');

    const agents = await loadAgents(tenantId);
    const photos = parsePhotos(p.fotos_urls);
    const photoUrls = photos.map((u) => cld(u, 'c_fill,w_1280,h_960,q_auto,f_auto'));
    const photosFull = photos.map((u) => cld(u, 'c_limit,w_2000,q_auto,f_auto'));
    const heroPhoto = photoUrls[0];

    const prices = getDisplayPrices(p);
    const usd = prices.principal?.formatted || '';
    const mxn = prices.secundario?.formatted || '';

    const agent = agents[p.agente_responsable];

    const title = `${p.titulo || 'Propiedad'} | ${brand?.nombre_agencia || ''}`.trim().replace(/\|\s*$/, '');
    const description = (p.descripcion || '').slice(0, 160);

    // Amenidades vienen como texto separado por comas
    const amenidades = (p.amenidades || '').split(',').map((s) => s.trim()).filter(Boolean);

    const ctaBlock = renderCTA(p, agent, brand, record);
    const showMap = p.latitud && p.longitud && !p.ocultar_direccion_exacta;

    const html =
      head({
        title,
        description,
        brand,
        ogImage: photoUrls[0] || brand?.hero_foto_url,
        ogUrl: portalUrl(brand, '/p/' + (p.slug_url || record.id)),
        canonical: portalUrl(brand, '/p/' + (p.slug_url || record.id)),
      }) +
      brandHeader(brand) +
      `<section class="section">
        <div class="container">
          <div style="margin-bottom:12px;font-size:13px;color:var(--color-text-muted)">
            <a href="/" style="color:inherit">Inicio</a> ›
            <a href="/buscar?tipo=${esc(p.tipo_inmueble || '')}" style="color:inherit">${esc(p.tipo_inmueble || 'Propiedad')}</a> ›
            <span>${esc(p.colonia || p.ciudad || '')}</span>
          </div>

          <div class="detail-gallery-wrap" id="gallery">
            ${renderGalleryHtml(photoUrls, p.titulo || 'Propiedad')}
          </div>

          <div class="detail-grid" style="margin-top:24px">
            <div>
              <h1 style="font-size:26px;font-weight:800;margin:0 0 4px;letter-spacing:-.02em">${esc(p.titulo || 'Propiedad')}</h1>
              <div style="color:var(--color-text-muted);font-size:14px">${esc([p.colonia, p.ciudad, p.estado_municipio].filter(Boolean).join(', '))}</div>

              <div class="price-block">
                <div class="usd">${esc(usd)}</div>
                ${mxn ? `<div class="mxn">${esc(mxn)}</div>` : ''}
                ${p.cuota_mantenimiento ? `<div class="mxn">+ ${esc(fmtPrice(p.cuota_mantenimiento, 'MXN'))} / mes mantenimiento</div>` : ''}
                ${p.nota_precio ? `<div style="font-size:13px;color:var(--color-text-muted);margin-top:8px;font-style:italic">${esc(p.nota_precio)}</div>` : ''}
              </div>

              <div class="stats-row">
                ${p.recamaras ? statCell('Recámaras', p.recamaras, ICON_BED) : ''}
                ${p.banos_completos ? statCell('Baños', p.banos_completos, ICON_BATH) : ''}
                ${p.m2_construccion ? statCell('m² construcción', p.m2_construccion, ICON_AREA) : ''}
                ${p.estacionamientos ? statCell('Estacionamientos', p.estacionamientos, ICON_CAR) : ''}
              </div>

              ${p.descripcion ? `<div style="padding:18px 0;border-bottom:1px solid var(--color-border)">
                <h3 style="font-size:18px;font-weight:700;margin:0 0 10px">Descripción</h3>
                <p style="white-space:pre-line;line-height:1.6;color:var(--color-text);margin:0">${esc(p.descripcion)}</p>
              </div>` : ''}

              ${amenidades.length ? `<div style="padding:18px 0;border-bottom:1px solid var(--color-border)">
                <h3 style="font-size:18px;font-weight:700;margin:0 0 10px">Amenidades</h3>
                <div class="amenities">${amenidades.map((a) => `<span class="chip">${esc(a)}</span>`).join('')}</div>
              </div>` : ''}

              ${showMap ? `<div style="padding:18px 0">
                <h3 style="font-size:18px;font-weight:700;margin:0 0 10px">Ubicación</h3>
                <iframe class="map-frame" loading="lazy" src="${esc(mapsEmbedHref(p.latitud, p.longitud))}" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>
                <div style="margin-top:8px"><a href="${esc(mapsViewHref(p.latitud, p.longitud))}" target="_blank" rel="noopener" class="btn btn-ghost">Ver en Google Maps</a></div>
              </div>` : ''}

              ${renderVideoBlock(p)}
            </div>

            <aside class="detail-side">
              ${ctaBlock}
            </aside>
          </div>
        </div>
      </section>

      ${renderMobileCTA(p, agent, brand)}
      ${whatsappFab(brand)}

      ${renderLightbox(photosFull)}` +
      footer(brand);
    res.type('html').send(html);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// 3.b) PDF de detalle público (pickle del CTA del portal)
//      /p/:slug/pdf?v=con-agente-1pag  → stream del PDF
// ---------------------------------------------------------------------
r.get('/p/:slug/pdf', async (req, res, next) => {
  try {
    const tenantId = req.portalTenantId;
    const record = await findPropertyBySlug(tenantId, req.params.slug);
    if (!record) return notFound(res, null, 'Propiedad no encontrada');

    const VERSIONS = new Set(['con-agente-1pag', 'con-agente-2pag', 'sin-agente-1pag', 'sin-agente-2pag']);
    const v = VERSIONS.has(req.query.v) ? req.query.v : 'con-agente-1pag';
    const withAgent = v.startsWith('con-agente');
    const twoPages = v.endsWith('2pag');

    const [brand, agents] = await Promise.all([
      loadBrand(tenantId),
      loadAgents(tenantId),
    ]);
    const agent = agents[record.properties?.agente_responsable] || null;

    let baseUrl = null;
    if (!withAgent) {
      // Generamos/recuperamos ficha orgánica para que las fotos del PDF
      // sin-agente apunten a ficha.{APP_DOMAIN}/{id}
      const fichaId = await ensurePublicFichaForProperty(tenantId, record.id);
      baseUrl = fichaId ? `https://ficha.${process.env.APP_DOMAIN || 'mktscaled.com'}/${fichaId}` : null;
    }

    const { buildPropertyPDF } = await import('../lib/pdf.js');
    const doc = await buildPropertyPDF({ record, brand, agent, withAgent, twoPages, baseUrl });

    const fname = `${(record.properties?.slug_url || 'propiedad').replace(/[^a-z0-9-]/gi, '-')}-${v}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fname}"`);
    doc.pipe(res);
    doc.end();
  } catch (err) { next(err); }
});

async function ensurePublicFichaForProperty(tenantId, propertyId) {
  const sb = getSupabase();
  const { data: existing } = await sb
    .from('fichas_url')
    .select('id')
    .eq('tenant_id', tenantId).eq('property_id', propertyId).eq('activa', true)
    .limit(1).maybeSingle();
  if (existing) return existing.id;
  const alph = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = ''; for (let i = 0; i < 6; i++) id += alph[Math.floor(Math.random() * alph.length)];
  const { error } = await sb.from('fichas_url').insert({
    id, tenant_id: tenantId, property_id: propertyId, activa: true, vistas: 0,
  });
  return error ? null : id;
}

// ---------------------------------------------------------------------
// 4) BÚSQUEDA
// ---------------------------------------------------------------------
r.get('/buscar', async (req, res, next) => {
  try {
    const tenantId = req.portalTenantId;
    const [brand, recordsAll] = await Promise.all([
      loadBrand(tenantId),
      listProperties(tenantId, { limit: 100, query: req.query.q || '' }),
    ]);
    const filtered = applyFilters(recordsAll, {
      operacion: req.query.operacion,
      tipo: req.query.tipo,
      q: req.query.q,
      precio_min: req.query.precio_min,
      precio_max: req.query.precio_max,
      recamaras: req.query.recamaras,
    });
    const sorted = sortFeaturedFirst(filtered);

    const summary = [
      req.query.tipo,
      req.query.operacion,
      req.query.q,
    ].filter(Boolean).join(' · ') || 'todas las propiedades';

    const html =
      head({
        title: `Buscar: ${summary} — ${brand?.nombre_agencia || ''}`.trim(),
        description: `${sorted.length} propiedades encontradas.`,
        brand,
        canonical: portalUrl(brand, '/buscar'),
        noindex: true,
      }) +
      brandHeader(brand) +
      `<section class="section">
        <div class="container">
          <details class="filters-details" ${sorted.length === 0 || Object.keys(req.query).length ? 'open' : ''}>
            <summary class="filters-summary" data-testid="filters-toggle">
              <span>Filtros</span>
              <span class="filters-hint">${Object.keys(req.query).filter((k) => req.query[k]).length || 'sin'} activos</span>
            </summary>
            <form class="filters filters-form" method="GET" action="/buscar" data-testid="search-filters-form">
              <input name="q" placeholder="Zona, colonia, palabras clave…" value="${esc(req.query.q || '')}" data-testid="filter-q" />
              <select name="operacion" data-testid="filter-operacion"><option value="">Cualquier operación</option>${['Venta','Renta'].map((o)=>`<option value="${o}" ${req.query.operacion===o?'selected':''}>${o}</option>`).join('')}</select>
              <select name="tipo" data-testid="filter-tipo"><option value="">Cualquier tipo</option>${['Casa','Departamento','Local','Terreno','Oficina','Villa','Penthouse'].map((o)=>`<option value="${o}" ${req.query.tipo===o?'selected':''}>${o}</option>`).join('')}</select>
              <input name="precio_min" type="number" min="0" step="1000" placeholder="Precio mín." value="${esc(req.query.precio_min || '')}" data-testid="filter-precio-min" />
              <input name="precio_max" type="number" min="0" step="1000" placeholder="Precio máx." value="${esc(req.query.precio_max || '')}" data-testid="filter-precio-max" />
              <select name="recamaras" data-testid="filter-recamaras"><option value="">Recámaras</option>${[1,2,3,4,5].map((n)=>`<option value="${n}" ${String(req.query.recamaras)===String(n)?'selected':''}>${n}+</option>`).join('')}</select>
              <div class="filters-actions">
                <button type="submit" class="btn btn-accent" data-testid="filter-submit-btn">Buscar</button>
                <a href="/buscar" class="btn btn-ghost" data-testid="filter-clear-btn">Limpiar filtros</a>
              </div>
            </form>
          </details>
          <h1 style="font-size:22px;font-weight:800;margin:18px 0 4px">Resultados de búsqueda</h1>
          <div style="color:var(--color-text-muted);margin-bottom:18px;font-size:14px">${sorted.length} propiedad${sorted.length===1?'':'es'} para «${esc(summary)}»</div>
          ${sorted.length
            ? `<div class="cards-grid">${sorted.map(propertyCard).join('')}</div>`
            : `<div class="empty"><strong>No encontramos propiedades con esos filtros.</strong><br/><span style="font-size:13px">Prueba quitar algunos filtros o <a href="/buscar" style="color:var(--color-primary);font-weight:600">limpiar la búsqueda</a>.</span></div>`}
        </div>
      </section>
      ${whatsappFab(brand)}` +
      footer(brand);
    res.type('html').send(html);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// 5) URL ORGÁNICA
// ---------------------------------------------------------------------
r.get('/ficha/:id', (req, res, next) => handleFichaOrganica(req, res, next));

async function handleFichaOrganica(req, res, next) {
  try {
    const sb = getSupabase();
    const { data: ficha } = await sb
      .from('fichas_url')
      .select('property_id, tenant_id, activa, expira_en, vistas')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!ficha || !ficha.activa) {
      return notFound(res, null, 'Esta ficha no está disponible.');
    }
    if (ficha.expira_en && new Date(ficha.expira_en).getTime() < Date.now()) {
      return notFound(res, null, 'Esta ficha ha expirado.');
    }
    // Para fichas orgánicas, el tenant viene del propio registro
    const record = await getPropertyById(ficha.tenant_id, ficha.property_id);
    if (!record) return notFound(res, null, 'Propiedad no encontrada.');
    const p = record.properties || {};
    recordPageView(ficha.tenant_id, ficha.property_id, 'organica');
    // Incrementar contador de vistas (best-effort)
    sb.from('fichas_url').update({ vistas: (ficha.vistas || 0) + 1 }).eq('id', req.params.id).then(() => {});

    const photos = parsePhotos(p.fotos_urls);
    const photoUrls = photos.map((u) => cld(u, 'c_fill,w_1280,h_960,q_auto,f_auto'));
    const photosFull = photos.map((u) => cld(u, 'c_limit,w_2000,q_auto,f_auto'));
    const pricesOrg = getDisplayPrices(p);
    const usd = pricesOrg.principal?.formatted || '';
    const mxn = pricesOrg.secundario?.formatted || '';
    const amenidades = (p.amenidades || '').split(',').map((s) => s.trim()).filter(Boolean);

    // SEO orgánica: noindex (no queremos competir con el portal del agente)
    const html =
      head({
        title: p.titulo || 'Propiedad',
        description: (p.descripcion || '').slice(0, 160),
        brand: null,
        ogImage: photoUrls[0],
        noindex: true,
      }) +
      `<div class="organic-wrap">
        <div id="gallery">
          ${renderGalleryHtml(photoUrls, p.titulo || 'Propiedad')}
        </div>

        <h1 style="font-size:24px;font-weight:800;margin:22px 0 4px;letter-spacing:-.01em">${esc(p.titulo || 'Propiedad')}</h1>
        <div style="color:#64748b;font-size:14px">${esc([p.colonia, p.ciudad, p.estado_municipio].filter(Boolean).join(', '))}</div>

        <div style="margin:18px 0 8px;font-size:30px;font-weight:800;color:#0f172a">${esc(usd)}</div>
        ${mxn ? `<div style="color:#64748b;font-size:14px">${esc(mxn)}</div>` : ''}

        <div class="stats-row" style="margin:18px 0">
          ${p.recamaras ? statCell('Recámaras', p.recamaras, ICON_BED) : ''}
          ${p.banos_completos ? statCell('Baños', p.banos_completos, ICON_BATH) : ''}
          ${p.m2_construccion ? statCell('m² construcción', p.m2_construccion, ICON_AREA) : ''}
          ${p.estacionamientos ? statCell('Estacionamientos', p.estacionamientos, ICON_CAR) : ''}
        </div>

        ${p.descripcion ? `<div style="white-space:pre-line;line-height:1.7;color:#1e293b">${esc(p.descripcion)}</div>` : ''}

        ${amenidades.length ? `<div style="margin-top:18px">
          <div style="font-weight:700;margin-bottom:8px">Amenidades</div>
          <div class="amenities">${amenidades.map((a) => `<span class="chip">${esc(a)}</span>`).join('')}</div>
        </div>` : ''}

        <div style="margin-top:24px;display:flex;gap:8px;flex-wrap:wrap">
          <a href="/api/pdf/ficha/${esc(req.params.id)}" class="btn btn-ghost" style="flex:1;min-width:160px">Descargar 1 página</a>
          <a href="/api/pdf/ficha/${esc(req.params.id)}?pages=2" class="btn btn-ghost" style="flex:1;min-width:160px">Descargar 2 páginas</a>
        </div>

        <p class="organic-disclaimer">Ficha técnica · Información sujeta a verificación</p>
      </div>
      ${renderLightbox(photosFull)}` +
      '</body></html>';
    res.type('html').send(html);
  } catch (err) { next(err); }
}

// ---------------------------------------------------------------------
// Helpers locales del módulo
// ---------------------------------------------------------------------
function notFound(res, brand, msg) {
  const html =
    head({ title: 'No encontrado', brand: brand || null, noindex: true }) +
    (brand ? brandHeader(brand) : '') +
    `<section class="section"><div class="container">
      <div class="empty"><strong>${esc(msg)}</strong></div>
      <div style="text-align:center;margin-top:16px"><a href="/" class="btn btn-ghost">Volver al inicio</a></div>
    </div></section>` +
    footer(brand || null, { showFooter: !!brand });
  res.status(404).type('html').send(html);
}

function statCell(label, value, icon) {
  return `<div class="stat-cell"><div class="l">${icon} ${esc(label)}</div><div class="v">${esc(value)}</div></div>`;
}

/** Galería "hero + thumbnails" estilo portal premium.
 *  - Hero (photo 0): 500px desktop / 280px mobile, click → lightbox idx 0.
 *  - Thumbnails (photos 1..N-1): fila horizontal scrolleable, altura 80/64px.
 *  - Si hay >6 thumbnails, overlay "+ N fotos" sobre el 6º thumbnail
 *    (photos[6]) — click abre lightbox en foto 6.
 *  Depende del script inyectado por renderLightbox() para el binding. */
function renderGalleryHtml(photoUrls, titulo) {
  if (!photoUrls || !photoUrls.length) return '';
  const t = esc(titulo || 'Propiedad');
  const hero = photoUrls[0];
  const thumbs = photoUrls.slice(1);
  const MAX_THUMBS_BEFORE_OVERLAY = 6;
  const extraCount = thumbs.length - MAX_THUMBS_BEFORE_OVERLAY;

  const thumbsHtml = thumbs.map((url, i) => {
    const photoIdx = i + 1;
    const isOverlayThumb = extraCount > 0 && i === MAX_THUMBS_BEFORE_OVERLAY - 1;
    const overlay = isOverlayThumb
      ? `<div class="thumb-overlay">+ ${extraCount} foto${extraCount === 1 ? '' : 's'}</div>`
      : '';
    return `<a class="thumb${isOverlayThumb ? ' has-overlay' : ''}" href="javascript:void(0)" data-idx="${photoIdx}" aria-label="${t} - foto ${photoIdx + 1}">
      <img src="${esc(url)}" alt="${t} - foto ${photoIdx + 1}" loading="lazy" />
      ${overlay}
    </a>`;
  }).join('');

  return `<div class="gallery-v2">
    <a class="g-hero" href="javascript:void(0)" data-idx="0" aria-label="${t} - foto 1">
      <img src="${esc(hero)}" alt="${t} - foto 1" loading="eager" />
    </a>
    ${thumbs.length ? `<div class="thumbs" role="list">${thumbsHtml}</div>` : ''}
  </div>`;
}

/** Lightbox + script de binding. Escanea #gallery [data-idx] al load.
 *  Teclado (Esc, ←, →), click, y swipe horizontal en mobile. */
function renderLightbox(photosFull) {
  const fulls = JSON.stringify(photosFull || []);
  return `<div class="lightbox" id="lightbox" onclick="if(event.target.id==='lightbox')window.closeLightbox()">
      <button class="close" onclick="window.closeLightbox()" aria-label="Cerrar">×</button>
      <button class="nav prev" onclick="window.navLightbox(-1)" aria-label="Anterior">‹</button>
      <button class="nav next" onclick="window.navLightbox(1)" aria-label="Siguiente">›</button>
      <span class="counter" id="lb-counter"></span>
      <img id="lb-img" alt="" />
    </div>
    <script>(function(){
      var fulls = ${fulls};
      if (!fulls.length) return;
      var idx = 0;
      var lb = document.getElementById('lightbox');
      var img = document.getElementById('lb-img');
      var counter = document.getElementById('lb-counter');
      function show(){ img.src = fulls[idx]; counter.textContent = (idx+1)+' / '+fulls.length; }
      window.openLightbox = function(i){ idx = ((i|0) % fulls.length + fulls.length) % fulls.length; show(); lb.classList.add('open'); document.body.style.overflow='hidden'; };
      window.closeLightbox = function(){ lb.classList.remove('open'); document.body.style.overflow=''; };
      window.navLightbox = function(d){ idx = (idx + d + fulls.length) % fulls.length; show(); };
      document.querySelectorAll('#gallery [data-idx]').forEach(function(a){
        a.addEventListener('click', function(e){ e.preventDefault(); window.openLightbox(Number(a.getAttribute('data-idx')) || 0); });
      });
      document.addEventListener('keydown', function(e){
        if (!lb.classList.contains('open')) return;
        if (e.key === 'Escape') window.closeLightbox();
        else if (e.key === 'ArrowLeft') window.navLightbox(-1);
        else if (e.key === 'ArrowRight') window.navLightbox(1);
      });
      var tx = 0, ty = 0, tracking = false;
      lb.addEventListener('touchstart', function(e){ if(!e.touches[0]) return; tx = e.touches[0].clientX; ty = e.touches[0].clientY; tracking = true; }, { passive: true });
      lb.addEventListener('touchend', function(e){
        if (!tracking || !e.changedTouches[0]) return;
        var dx = e.changedTouches[0].clientX - tx;
        var dy = e.changedTouches[0].clientY - ty;
        tracking = false;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) window.navLightbox(dx < 0 ? 1 : -1);
      }, { passive: true });
    })();</script>`;
}


function ytEmbed(url) {
  const m = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([^&?\s]+)/);
  if (m) return `<iframe src="https://www.youtube.com/embed/${esc(m[1])}" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  const vimeo = String(url).match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `<iframe src="https://player.vimeo.com/video/${esc(vimeo[1])}" style="position:absolute;inset:0;width:100%;height:100%;border:0" allowfullscreen></iframe>`;
  return '';
}

/** Bloque de video en /p/:slug. Prioridad:
 *  1) video_propio_url (Cloudinary) → <video> nativo con controles.
 *  2) video_url (YouTube / Vimeo)  → iframe embed responsive 16:9.
 *  Si ninguno aplica devuelve '' (no se renderiza la sección). */
function renderVideoBlock(p) {
  const propio = (p.video_propio_url || '').trim();
  const embedUrl = (p.video_url || '').trim();
  const embedHtml = embedUrl ? ytEmbed(embedUrl) : '';

  if (!propio && !embedHtml) return '';

  const player = propio
    ? `<video src="${esc(propio)}" controls preload="metadata" playsinline
             style="position:absolute;inset:0;width:100%;height:100%;background:#000;object-fit:contain"></video>`
    : embedHtml;

  return `<div style="padding:18px 0;border-top:1px solid var(--color-border)">
    <h3 style="font-size:18px;font-weight:700;margin:0 0 10px">Video</h3>
    <div style="position:relative;padding-bottom:56.25%;height:0;border-radius:8px;overflow:hidden;background:#000">
      ${player}
    </div>
  </div>`;
}

function whatsappFab(brand) {
  if (!brand) return '';
  if (brand.widget_tipo === 'livechat' && brand.widget_valor) {
    // Inyectar snippet de GHL Live Chat (es HTML); confiamos en lo que el admin
    // pegó en su configuración. Sanitización: dejarlo opt-in. Aquí lo
    // metemos crudo porque el admin del tenant es quien lo provee.
    return `<div id="ghl-live-chat-mount">${brand.widget_valor}</div>`;
  }
  const num = (brand.widget_valor || brand.whatsapp || '').replace(/[^\d]/g, '');
  if (!num) return '';
  return `<a class="wa-fab" href="https://wa.me/${esc(num)}" target="_blank" rel="noopener" aria-label="WhatsApp">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.149-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>
  </a>`;
}

// Dominios GHL autorizados para embed de formulario. Debe coincidir con la
// whitelist server-side de `routes/property.js`.
const GHL_FORM_HOSTS_PUBLIC = ['gohighlevel.com', 'leadconnectorhq.com', 'msgsndr.com'];

/** Extrae el <iframe> del snippet HTML, valida su host contra la whitelist y
 *  devuelve un HTML seguro con `sandbox` permisivo suficiente para GHL Forms.
 *  Si el snippet no es válido devuelve '' (el caller cae a fallback). */
function renderGhlFormEmbed(html) {
  if (!html || typeof html !== 'string') return '';
  const m = html.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
  if (!m) return '';
  const src = m[1];
  let url;
  try { url = new URL(src); } catch { return ''; }
  const host = url.hostname.toLowerCase();
  const allowed = GHL_FORM_HOSTS_PUBLIC.some((d) => host === d || host.endsWith('.' + d));
  if (!allowed) return '';
  // Re-emitimos el iframe con atributos seguros y responsive.
  // No confiamos en atributos del snippet original (podría inyectar handlers).
  return `<div class="ghl-form-embed">
    <iframe
      src="${esc(src)}"
      title="Formulario de contacto"
      loading="lazy"
      referrerpolicy="no-referrer-when-downgrade"
      sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-top-navigation-by-user-activation"
      style="width:100%;height:600px;border:0;display:block"
    ></iframe>
  </div>`;
}

function renderCTA(p, agent, brand, record) {
  // Resolución por prioridad: override por propiedad > widget global
  const overrideType = p.cta_tipo;
  const overrideVal = p.cta_valor;

  let primaryHtml = '';
  if (overrideType === 'whatsapp' && overrideVal) {
    primaryHtml = `<a class="btn btn-block" href="https://wa.me/${esc(String(overrideVal).replace(/[^\d]/g, ''))}" target="_blank" rel="noopener">Contactar por WhatsApp</a>`;
  } else if (overrideType === 'formulario' && overrideVal) {
    primaryHtml = renderGhlFormEmbed(overrideVal);
    // Si el snippet no es válido, `renderGhlFormEmbed` devuelve '' y caemos al
    // fallback global más abajo (widget de contacto / whatsapp).
    if (!primaryHtml) {
      if (agent?.whatsapp) {
        primaryHtml = `<a class="btn btn-block" href="https://wa.me/${esc(String(agent.whatsapp).replace(/[^\d]/g, ''))}" target="_blank" rel="noopener">Contactar a ${esc(agent.nombre || 'el agente')}</a>`;
      } else if (brand?.whatsapp) {
        primaryHtml = `<a class="btn btn-block" href="https://wa.me/${esc(String(brand.whatsapp).replace(/[^\d]/g, ''))}" target="_blank" rel="noopener">Contactar por WhatsApp</a>`;
      }
    }
  } else if (overrideType === 'redirect' && overrideVal) {
    primaryHtml = `<a class="btn btn-block" href="${esc(overrideVal)}" target="_blank" rel="noopener">Más información</a>`;
  } else if (agent?.whatsapp) {
    primaryHtml = `<a class="btn btn-block" href="https://wa.me/${esc(String(agent.whatsapp).replace(/[^\d]/g, ''))}" target="_blank" rel="noopener">Contactar a ${esc(agent.nombre || 'el agente')}</a>`;
  } else if (brand?.whatsapp) {
    primaryHtml = `<a class="btn btn-block" href="https://wa.me/${esc(String(brand.whatsapp).replace(/[^\d]/g, ''))}" target="_blank" rel="noopener">Contactar por WhatsApp</a>`;
  }

  // Selector de versión del PDF.
  // En el portal del agente NO requerimos sesión — generamos PDFs públicos
  // vía /api/pdf/ficha/:id (la ficha la creamos al vuelo si no existe).
  const recId = record?.id || '';
  const pdfPicker = recId ? `
    <div class="pdf-picker" style="margin-top:10px">
      <div style="font-size:11px;font-weight:700;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px">Ficha PDF</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <a class="btn btn-ghost" href="/p/${esc(p.slug_url || recId)}/pdf?v=con-agente-1pag" style="font-size:12px;padding:8px 6px">Con datos · 1 pág</a>
        <a class="btn btn-ghost" href="/p/${esc(p.slug_url || recId)}/pdf?v=con-agente-2pag" style="font-size:12px;padding:8px 6px">Con datos · 2 págs</a>
        <a class="btn btn-ghost" href="/p/${esc(p.slug_url || recId)}/pdf?v=sin-agente-1pag" style="font-size:12px;padding:8px 6px">Orgánico · 1 pág</a>
        <a class="btn btn-ghost" href="/p/${esc(p.slug_url || recId)}/pdf?v=sin-agente-2pag" style="font-size:12px;padding:8px 6px">Orgánico · 2 págs</a>
      </div>
    </div>` : '';

  const agentBlock = agent ? `
    <div class="agent-card-top">
      ${agent.foto_url ? `<img src="${esc(agent.foto_url)}" alt="${esc(agent.nombre || '')}" />` : `<div class="ph">${esc((agent.nombre || '?').charAt(0))}</div>`}
      <div>
        <div class="agent-card-name">${esc(agent.nombre || 'Agente')}</div>
        <div class="agent-card-rol">${esc(agent.rol === 'admin' ? 'Asesor principal' : 'Asesor')}</div>
      </div>
    </div>
    ${agent.telefono ? `<a href="tel:${esc(agent.telefono)}" style="font-size:14px;color:var(--color-text)">${esc(agent.telefono)}</a>` : ''}
    ${agent.email ? `<a href="mailto:${esc(agent.email)}" style="font-size:13px;color:var(--color-text-muted)">${esc(agent.email)}</a>` : ''}
  ` : '';

  return `<div class="agent-card">
    ${agentBlock}
    ${primaryHtml}
    ${pdfPicker}
  </div>`;
}

function renderMobileCTA(p, agent, brand) {
  // Cuando el CTA es un formulario embebido válido, NO mostramos el botón
  // flotante (el iframe reemplaza el CTA — evita duplicación en mobile).
  if (p.cta_tipo === 'formulario' && p.cta_valor && renderGhlFormEmbed(p.cta_valor)) return '';
  // Mismo CTA primario que el sidebar, pero fijo en el bottom.
  let href = '';
  let label = 'Contactar';
  if (p.cta_tipo === 'whatsapp' && p.cta_valor) {
    href = `https://wa.me/${String(p.cta_valor).replace(/[^\d]/g, '')}`;
    label = 'WhatsApp';
  } else if (p.cta_tipo === 'redirect' && p.cta_valor) {
    href = p.cta_valor; label = 'Más información';
  } else if (agent?.whatsapp) {
    href = `https://wa.me/${String(agent.whatsapp).replace(/[^\d]/g, '')}`;
    label = `WhatsApp con ${agent.nombre?.split(' ')[0] || 'el agente'}`;
  } else if (brand?.whatsapp) {
    href = `https://wa.me/${String(brand.whatsapp).replace(/[^\d]/g, '')}`;
    label = 'WhatsApp';
  }
  if (!href) return '';
  return `<div class="mobile-cta"><a class="btn btn-block" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a></div>`;
}

export default r;
