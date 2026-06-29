# PRD — mktscaled-listings (Real Estate SaaS para GHL)

> Documento vivo. Crece a medida que avanzamos por los 14 pasos.

## Problema original (verbatim del usuario)

Construir un SaaS de listings inmobiliarios sobre GoHighLevel, distribuido vía Marketplace de GHL,
que permite a agencias inmobiliarias publicar propiedades profesionalmente con su propio dominio,
sin salir del ecosistema de GHL. Master Context v2.6 (junio 2026).

Frase resumen: *"Un agente sube una propiedad en GHL, y automáticamente aparece una página
pública profesional en su dominio."*

## Personas

| Persona | Necesidad |
|---------|-----------|
| Dueño de inmobiliaria (admin) | Configurar marca, dominio, agentes, ver métricas |
| Agente (vendedor) | Subir propiedades, generar fichas PDF, compartir URLs |
| Comprador/cliente final | Navegar portal público, ver fichas, contactar |
| Colega de la industria | Ver URL orgánica neutral sin branding del agente |

## Requisitos core (estáticos, del Master Context)

- Multi-tenant por `ghl_location_id`; cada cliente con su propio dominio CNAME.
- Custom Object "Propiedad" en GHL es el origen de verdad de las propiedades.
- Supabase guarda: tenants, agentes, marca, dominios, colecciones, fichas orgánicas, page_views.
- Portal público de 5 páginas mobile-first.
- Ficha PDF con 4 variantes (con/sin agente × 1/2 págs), bajo demanda con PDFKit.
- Widget de contacto: WhatsApp **O** Live Chat GHL — nunca ambos.
- URL orgánica neutral en `ficha.mktscaled.com/:id` sin branding ni CTA.
- Refresh de tokens GHL cada 23h vía node-cron.
- Primer agente admin creado automáticamente al instalar la app.
- SSO del iframe: GHL pasa `locationId` + `userId` → emitimos JWT propio.

## Estado de implementación

### 2026-02 — Sesión 2 — Paso 2: OAuth GHL + AES-256 + cron refresh 23h
- ✅ `src/lib/ghl.js`: `getAuthorizeUrl`, `exchangeCodeForToken`, `refreshAccessToken` con endpoints reales de GHL (marketplace.gohighlevel.com/oauth/chooselocation + services.leadconnectorhq.com/oauth/token).
- ✅ `src/lib/tenants.js`: `upsertTenantFromOAuth` (idempotente por `ghl_location_id`), `listActiveTenants`, `getTenantWithTokens` (descifra al leer), `updateTenantTokens`, `markNeedsReauth`. Todo cifra/descifra con AES-256-GCM al pasar por la capa de DB.
- ✅ `src/routes/oauth.js` montado en `/auth` (no `/api/auth`) — coincide con el Redirect URI `https://panel.mktscaled.com/auth/callback` configurado en GHL. Endpoints: `GET /auth` (302 a GHL con state) y `GET /auth/callback` (intercambia + persiste + pantalla HTML de éxito/error).
- ✅ `src/jobs/refresh-tokens.js`: refresca todos los tenants activos, cifra los nuevos tokens, marca `needs_reauth` si refresh falla.
- ✅ `src/jobs/index.js`: cron `0 */23 * * *` para refresh + stub cron `*/1 * * * *` para CNAME (Paso 10).
- ✅ Integración Supabase verificada end-to-end con `scripts/integration-step-2.js`: upsert OK, tokens cifrados en reposo, roundtrip decrypt OK, idempotencia OK, cleanup OK.
- ✅ Servidor probado: `GET /auth` → 302 a `marketplace.gohighlevel.com/oauth/chooselocation?...redirect_uri=https%3A%2F%2Fpanel.mktscaled.com%2Fauth%2Fcallback&...`.
- ✅ `.env` creado con credenciales reales del usuario + claves AES-256 y JWT generadas.

### 2026-02 — Sesión 1 — Paso 1 + estructura base
- ✅ Stack reemplazado: FastAPI + Mongo → Node.js + Express + Supabase.
- ✅ `sql/schema.sql` con las 8 tablas, constraints, índices y RLS.
- ✅ Estructura del repo Node.js (src/server.js, routes, lib, middleware, jobs).
- ✅ `.env.example` con todas las variables que se irán necesitando.
- ✅ `railway.json` para deploy a Railway Pro.
- ✅ `.gitignore` + `README.md` listos para `git push`.
- ✅ Helpers base: encryption AES-256-GCM, JWT session, Supabase client, Cloudinary `toJpgUrl`.
- ✅ Stubs de rutas: cada paso futuro ya tiene su archivo y endpoint placeholder (`501`).
- ✅ Server arranca con health check en `/api/health`.

## Backlog priorizado

### P0 — Próximos pasos para tener app funcional
- [x] **Paso 2** — OAuth GHL completo (`/auth`, `/auth/callback`) + cifrado tokens + node-cron refresh 23h.
- [ ] **Paso 3** — Webhook instalar/desinstalar + creación automática primer admin + `/api/auth/sso` (locationId+userId → JWT).
- [ ] **Paso 4** — Crear Custom Object "Propiedad" via API GHL + guardar `ghl-field-ids.json`.

### P1 — Producto mínimo vendible
- [ ] **Paso 5** — Menú lateral React: formulario completo con Google Places + checkboxes amenidades + drag-and-drop fotos.
- [ ] **Paso 6** — Upload fotos a Cloudinary (WebP, 2000px, q80) + reordenar.
- [ ] **Paso 7** — CRUD colecciones + asignación N:N.
- [ ] **Paso 8** — Gestión de agentes + límites por plan.
- [ ] **Paso 9** — Portal público (5 páginas) + page_views.
- [ ] **Paso 10** — Configuración dominio + verificación CNAME cada 60s.
- [ ] **Paso 11** — Personalización marca + widget contacto.
- [ ] **Paso 12** — Ficha PDF (4 versiones, PDFKit, `/f_jpg`).
- [ ] **Paso 13** — URL orgánica `fichas_url` + contador vistas + expiración.

### P2 — Distribución / Fase 2
- [ ] **Paso 14** — API pública v1 + Snapshot GHL + publicación Marketplace.
- [ ] Bolsa inmobiliaria entre agentes (proyecto SEPARADO — no mezclar).
- [ ] Arte automático para redes sociales 1080×1080.
- [ ] MLS import.

## Decisiones técnicas vigentes

1. Railway **Pro** (Hobby hiberna).
2. DNS en GHL — no Cloudflare.
3. Amenidades GHL como texto separado por coma; fotos como URLs separadas por pipe `|`.
4. PDF bajo demanda, stream directo, no almacenado. Imágenes `/f_jpg` de Cloudinary.
5. Google Maps key sin restricción de referrer (multi-dominio).
6. SSL para dominios custom de clientes: alta manual en Railway dashboard por el creador.
7. Slug anti-duplicado por tenant con sufijos `-2`, `-3`, ...
8. RLS habilitado en todas las tablas; backend usa SERVICE_ROLE_KEY.

## Riesgos abiertos

- SSL manual no automatizable → operativo del creador a escala.
- Google Maps sin restricción de referrer → quota/costo a monitorear.
- Refresh tokens GHL: si falla, dejamos tenant en `needs_reauth` y debe reinstalar.
