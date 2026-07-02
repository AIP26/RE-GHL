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

### 2026-02 — Sesión 3 — Paso 3: Webhook + SSO + middleware
- ✅ `src/lib/agentes.js`: `findAgentByGhlUser`, `upsertAgent` (idempotente por UNIQUE(tenant_id, ghl_user_id)), `ensureFirstAdmin`.
- ✅ `src/lib/tenants.js`: agregado `findTenantByLocationId`, `markInactive`.
- ✅ `src/lib/ghl.js`: agregado `getUserById` (GHL Users API).
- ✅ `src/lib/webhook-verify.js`: verificación Ed25519 de `X-GHL-Signature` (estándar nuevo de GHL). Soporta PEM SPKI o base64 raw de 32 bytes. Si no hay clave configurada, registra WARN y acepta (dev).
- ✅ `src/routes/webhook.js` montado en `/api/webhook` (la URL real configurada en GHL: `https://listings.mktscaled.com/api/webhook`). Maneja `LocationCreate`/`INSTALL` y `LocationDelete`/`UNINSTALL`. Idempotente. Devuelve 200 incluso en errores internos para evitar reintentos infinitos de GHL.
- ✅ `src/routes/auth.js`:
    - `GET /api/auth/sso?locationId=&userId=` → 200 con `{token, agente, tenant}` (JWT 23h). 404 si tenant no existe, 403 si inactive, 409 si needs_reauth.
    - `GET /api/auth/me` (protegido) → contexto del agente actual.
- ✅ `src/middleware/auth.js`: `requireSession` verifica JWT + carga tenant + agente desde DB y los adjunta a `req.tenant`, `req.agente`. Plus `requireAdmin` para endpoints admin-only.
- ✅ `src/server.js`: raw body capture en `express.json({verify})` para validar firma del webhook sobre bytes originales.
- ✅ Integration test `scripts/integration-step-3.js` pasa end-to-end:
    - webhook LocationCreate crea admin con datos del payload (cuando GHL Users API falla por token inválido, fallback al payload — verificado).
    - SSO admin firma JWT con `rol=admin` y exp=23h.
    - SSO con userId nuevo crea agente automáticamente con rol=agente.
    - `/me` sin token → 401; con token inválido → 401; con token válido → devuelve agente + tenant.
    - webhook LocationDelete marca tenant `inactive` (NO borra datos).
    - SSO post-uninstall → 403 `tenant_inactive`.

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
- [x] **Paso 3** — Webhook instalar/desinstalar + creación automática primer admin + `/api/auth/sso` (locationId+userId → JWT) + `requireSession` middleware.
- [ ] **Paso 4** — Crear Custom Object "Propiedad" via API GHL + guardar `ghl-field-ids.json`.

### P1 — Producto mínimo vendible
- [ ] **Paso 5** — Menú lateral React: formulario completo con Google Places + checkboxes amenidades + drag-and-drop fotos.
- [ ] **Paso 6** — Upload fotos a Cloudinary (WebP, 2000px, q80) + reordenar.
- [ ] **Paso 7** — CRUD colecciones + asignación N:N.
- [ ] **Paso 8** — Gestión de agentes + límites por plan.
- [x] **Paso 9** — Portal público (5 páginas) + page_views.
- [x] **Paso 10** — Configuración dominio + verificación CNAME cada 60s.
- [x] **Paso 11** — Personalización marca + widget contacto.
- [x] **Paso 12** — Ficha PDF (4 versiones, PDFKit, `/f_jpg`).
- [x] **Paso 13** — URL orgánica `fichas_url` + contador vistas + expiración.

### P2 — Distribución / Fase 2
- [x] **Paso 14** — API pública v1 (`/api/v1/properties`, `/properties/:id`, `/collections`, `/docs`) + gestión de API keys (`/api/apikeys` CRUD) + UI tab "API" en Configuración. SHA-256 hash, plain_once, last_used_at. 2026-02-15 ✅ Testing 22/22 backend + UI flujo completo PASS (iteration_6.json).
- [x] **QA Bloque 0** — Rediseño completo del PDF (viñetas por operación, mapa fallback, PNG transparente). 2026-02 ✅
- [x] **QA Bloque 1** — Mis Listings: menú flotante (portal-based), editar propiedad, cambio de agente. 2026-02 ✅
- [x] **QA Bloque 2** — Colecciones: menú flotante, placeholder defensivo para fotos rotas. 2026-02 ✅
- [x] **QA Bloque 3** — Nueva propiedad: colección inline, D&D fotos, moneda CAD/USD/MXN dinámica. 2026-02 ✅
- [x] **QA Bloque 4** — CTA con embed formulario GHL (whitelist server-side, iframe sandbox). 2026-02 ✅ (iteration_7.json)
- [x] **QA Bloque 5** — Buscador `/buscar` accesible con filtros re-editables + reproductor video YouTube/Vimeo en `/p/:slug` + upload de video propio a Cloudinary (`video_propio_url`). 2026-02 ✅ Testing 52/52 PASS (iteration_8.json).
- [x] **QA Bloque 6 — Cierre FASE 1**: (A) eliminado `/app/public/panel/pdf-preview/` (11 MB temporales). (B) SSO: `JWT_EXPIRES_IN=8h` + re-login automático transparente en `api()` cuando el token expira (dedup con `_reSsoInFlight`, guard anti-loop `opts._retried` y `path !== '/auth/sso'`). (C) Checklist pre-Marketplace auditado: webhook (INSTALL/UNINSTALL/PLAN, siempre 200), OAuth `/auth`→`/auth/callback`, uninstall preserva datos (`markInactive`), 3 subdominios prod (`listings`/`ficha`/`panel`.mktscaled.com) todos 200 con SSL válido, `step-4` idempotente con 56 fields (incluye Bloque 3 y `video_propio_url`). 2026-02 ✅ Testing PASS (iteration_9.json).
- [x] **Hotfix ficha subdomain (bloqueante Marketplace)**: `ficha.<APP_DOMAIN>/<slug>` devolvía 'Portal no encontrado' porque el middleware `resolveTenantByHost` intentaba buscar el subdominio compartido en la tabla `dominios`. Fix: middleware detecta `ficha.${env.appDomain}` y marca `req.isFichaHost = true` sin lookup; `requirePortalTenant` bypass cuando isFichaHost; nueva ruta `r.get('/:id')` que delega al handler compartido `handleFichaOrganica` (extraído de `/ficha/:id`). Home `/` sobre ficha host devuelve 404 controlado. 2026-02 ✅ Testing 9/9 PASS (iteration_10.json).
- [x] **QA Bloque 7 — Rediseño galería premium**: hero (500px desktop / 280px mobile) + fila horizontal scrolleable de thumbnails (80/64px), overlay "+ N fotos" sobre el 6º thumbnail cuando hay >6 thumbs, lightbox reutilizable con teclado + swipe mobile + navegación circular. Helpers `renderGalleryHtml()` y `renderLightbox()` compartidos entre `/p/:slug` y `/ficha/:id`. Clase `.g-hero` para evitar colisión con `.hero` del landing (que tenía `min-height:78vh`). 2026-02 ✅ Testing 30/30 PASS (iteration_11.json).
- [x] **Simplificación PDF pública + fixes video**: (a) `/p/:slug` muestra UN solo botón "Descargar ficha PDF" hacia `con-agente-2pag` (eliminados los 4 botones del picker). (b) `ficha.<APP_DOMAIN>/:id` muestra UN solo botón hacia `?pages=2` (eliminados los 2 antiguos). (c) Panel Mis Listings mantiene las 4 variantes. (d) VideoUpload compacto ~80px en estado vacío + 200px de preview. (e) FIX Cloudinary "Invalid Signature": removido `resource_type` de `params` en backend y de `FormData` en cliente — Cloudinary NO firma ese campo porque va en el path URL (`/video/upload` vs `/image/upload`). 2026-02 ✅ Testing 16/16 PASS (iteration_12.json).
- [x] **Fixes finales: mapa ficha orgánica + overlay + HTTPS**: (1) mapa Google embed agregado en `handleFichaOrganica` (misma regla que `/p/:slug`: `p.latitud && p.longitud && !p.ocultar_direccion_exacta`), (2) overlay "+N fotos" del 6º thumbnail removido en `/p/:slug` y ficha orgánica (fila ya es scrolleable, overlay confundía UX; CSS `.thumb-overlay` también limpiado), (3a) middleware `x-forwarded-proto: http → 301 https://<host><url>` en `server.js` (solo prod, con excepción para `/api/health` y `/health` para no romper Railway), (3b) mixed-content resuelto: `panel/app.js:2205` ahora usa `${window.location.origin}` en vez de `http://${portalHost}`. 2026-02 ✅ Testing 23/23 PASS (iteration_13.json).
- [x] **Limpieza registros de prueba GHL**: script `scripts/cleanup-test-records.js` con dry-run + `--confirm`. Busca patrones `TEST_*`, `QA_*`, `test-*`, `*_test` en el título del Custom Object. Bug lateral encontrado y fixed: `deleteObjectRecord` helper en `ghl.js` enviaba `locationId` como query param (GHL responde 422 "property locationId should not exist" — a diferencia de POST/PUT, DELETE NO lo acepta). Eliminados 2 registros `TEST_BLOCK4_good` del tenant preview. Total propiedades bajó de 6 → 4 sin residuos. 2026-02 ✅
- [x] **BLOQUE 15 — Fix OAuth Marketplace (Agency install)**: OAuth callback fallaba cuando GHL devolvía `companyId` sin `locationId` (install desde cuenta de Agency). Fix: (a) `logOAuthShape()` en callback loguea el token response redactando access/refresh/id tokens con su length para diagnóstico auditable, (b) branch: `locationId` → tenant normal, `companyId` → nueva tabla `agencies` (migration_step15), ninguno → 400 con keys del response, (c) SSO endpoint acepta `?companyId=`; si el tenant no existe pero la agency sí, mintea location token vía `POST /oauth/locationToken` (`Version: 2021-07-28`) y provisiona el tenant on-demand, (d) panel/app.js forwardea `companyId` en bootstrap y en `reAuthFromUrl`, (e) mensaje HTML claro en callback si la migración de `agencies` no está aplicada. 2026-02 ✅ Testing 26/26 PASS (iteration_14.json). **Requiere ejecutar `sql/migration_step15_agencies.sql` en Supabase antes del próximo deploy.**
- [x] **BLOQUE 16 — Provision on-demand robusto (companyId vacío)**: Custom Menu Link de GHL entrega `companyId=` vacío al iframe pese al placeholder `{{company.id}}`. Fix: nuevo helper `listActiveAgencies()` + estrategia dual en `/api/auth/sso` — (1) fast-path `findAgencyByCompanyId(companyIdHint)` si viene, (2) fallback iterando todas las agencies activas y probando `mintLocationToken` con cada una; la primera que succeed provisiona el tenant. Helper `tryProvisionFromAgency()` envuelve el mint en try/catch (loguea status+body de GHL, devuelve null si falla) para no romper el loop. Confirmado E2E: `locationId=b7JAqyPMcYXjeqDyvgdJ` con `companyId=` vacío provisiona tenant `4fafae9f-694f-4e23-bed1-8d6279cf4f3d` en 1.5s (1ª call), fast-path ~50ms (2ª call). 2026-02 ✅ Testing 18/18 PASS (iteration_15.json).
- [x] **BLOQUE 17 — Panel root en subdominio `panel.<APP_DOMAIN>`**: GHL Custom Menu Link apunta a `https://panel.mktscaled.com/?locationId=X&userId=Y` pero el servidor devolvía 404 porque el panel sólo se servía en `/panel/*`. Fix: nuevo handler `app.get('/')` en `server.js` ANTES de `resolveTenantByHost` — si `host === panel.${env.appDomain}` (normalizado con `.toLowerCase()` y `.split(':')[0]` para case-insensitive + port strip), sirve `panelIndex`; sino `next()` al pipeline normal. Assets `/panel/*.{js,css}` siguen accesibles desde cualquier host (paths absolutos). No rompe ni el guard "Portal no encontrado" ni el subdominio ficha ni la ruta `/panel/` legacy. 2026-02 ✅ Testing 16/16 PASS (iteration_16.json).
- [ ] Snapshot GHL + publicación Marketplace (requiere SSO real con JWT de GHL).
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
