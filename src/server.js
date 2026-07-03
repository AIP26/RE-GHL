// Entrada del servidor Express — mktscaled-listings.
// El stack completo, multi-tenant, vive aquí. Hot-path: bajo middleware.
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { env } from './config/env.js';
import { buildApiRouter } from './routes/index.js';
import oauthRoutes from './routes/oauth.js';
import publicRoutes from './routes/public.js';
import { resolveTenantByHost } from './middleware/tenant.js';
import { startJobs } from './jobs/index.js';

// Resolución de paths INDEPENDIENTE del cwd (cwd cambia entre Nixpacks,
// systemd, supervisor, docker, etc.). __dirname relativo a este archivo es
// la única forma robusta para servir static en cualquier deploy.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// Captura defensiva — si algún async escapa al error handler de Express,
// log y seguir viviendo (mejor que crashear el proceso completo en Railway).
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[unhandledRejection]', reason?.response?.data || reason);
});
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('[uncaughtException]', err);
});

const app = express();

// Trust proxy (Railway, Cloudflare, etc.) para Host / IP / HTTPS correctos.
app.set('trust proxy', true);

// HTTPS enforcement — Railway y Cloudflare terminan TLS y nos pasan el request
// vía HTTP con `x-forwarded-proto: http` cuando el cliente vino sin https.
// Redirigimos 301 al equivalente HTTPS para eliminar el warning "No seguro"
// y forzar upgrade permanente en el navegador. Solo activo en producción — en
// desarrollo local no hay proxy TLS y el header estaría ausente igualmente.
// Excepción: health checks (Railway los hace en HTTP interno sobre el pod) —
// se dejan pasar sin redirect para no romper el orchestrator.
app.use((req, res, next) => {
  if (env.nodeEnv !== 'production') return next();
  if (req.path === '/api/health' || req.path === '/health') return next();
  const proto = req.headers['x-forwarded-proto'];
  if (proto && proto.split(',')[0].trim() === 'http') {
    return res.redirect(301, 'https://' + req.headers.host + req.url);
  }
  next();
});

// Seguridad + perf
app.use(
  helmet({
    contentSecurityPolicy: false, // se afinará cuando sirvamos HTML público
    crossOriginEmbedderPolicy: false, // iframe en GHL
  })
);

// Iframe-embed override para el panel de GHL.
//
// helmet setea por defecto `X-Frame-Options: SAMEORIGIN` en toda respuesta,
// lo que hace que GHL bloquee el iframe del panel ANTES de que app.js corra.
// Sobrescribimos el header para las rutas del panel (subdominio dedicado
// `panel.<APP_DOMAIN>` o path `/panel/*`) permitiendo el embed desde los
// dominios oficiales de GHL + el custom domain del cliente.
//
// Importante: este middleware corre DESPUÉS de helmet porque `res.setHeader`
// sobrescribe el valor previo — si estuviera antes, helmet lo pisaría con
// SAMEORIGIN cuando se ejecute.
app.use((req, res, next) => {
  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  const panelHost = env.appDomain ? `panel.${env.appDomain.toLowerCase()}` : null;
  const isPanel = (panelHost && host === panelHost) || req.path.startsWith('/panel');
  if (isPanel) {
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader(
      'Content-Security-Policy',
      "frame-ancestors 'self' " +
      "https://*.gohighlevel.com " +
      "https://*.leadconnectorhq.com " +
      "https://*.msgsndr.com " +
      "https://*.highleveldemo.com " +
      "https://app.thebrokers.info"
    );
  }
  next();
});

app.use(compression());
app.use(cors());
app.use(
  express.json({
    limit: '2mb',
    // Capturamos el raw body para que el handler del webhook pueda verificar
    // la firma Ed25519 (X-GHL-Signature) sobre los bytes originales.
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

// API privada / admin (siempre bajo /api)
app.use('/api', buildApiRouter());

// OAuth GHL — montado en /auth (no /api/auth) porque el redirect URI
// registrado en GHL es https://panel.mktscaled.com/auth/callback
app.use('/auth', oauthRoutes);

// Panel del menú lateral GHL (iframe). Sirve /public/panel/ como SPA.
// Path absoluto resuelto desde la ubicación de server.js — NO desde cwd
// (Railway/Nixpacks suelen arrancar con cwd distinto a la raíz del repo).
const panelDir = path.resolve(REPO_ROOT, 'public', 'panel');
const panelIndex = path.join(panelDir, 'index.html');
const panelExists = fs.existsSync(panelIndex);

// eslint-disable-next-line no-console
console.log(`[boot] panel static -> ${panelDir} (index exists: ${panelExists})`);
if (!panelExists) {
  // eslint-disable-next-line no-console
  console.warn('[boot] WARN /panel servirá 404 — public/panel/index.html no se encontró. Verifica que se commiteó al repo.');
}

app.use('/panel', express.static(panelDir, { index: 'index.html', extensions: ['html'], fallthrough: true }));

// Favicon + apple-touch-icon (BLOQUE P4 FIX 3).
//   El navegador pide /favicon.ico automáticamente en cada visita — sin
//   este handler produce 404 ruidosos en los logs. El asset es un ICO
//   multi-size (16/32/48) con "MLS" blanco sobre fondo #1a1a2e.
//   Usamos rutas explícitas (no express.static bajo '/') para evitar
//   colisiones con el resolveTenantByHost que corre después.
const publicRoot = path.resolve(REPO_ROOT, 'public');
app.get('/favicon.ico', (_req, res) => {
  res.sendFile(path.join(publicRoot, 'favicon.ico'), {
    headers: { 'Cache-Control': 'public, max-age=86400' },
  }, (err) => { if (err) res.status(404).end(); });
});
app.get('/apple-touch-icon.png', (_req, res) => {
  res.sendFile(path.join(publicRoot, 'apple-touch-icon.png'), {
    headers: { 'Cache-Control': 'public, max-age=86400' },
  }, (err) => { if (err) res.status(404).end(); });
});
// Fallback SPA: cualquier ruta bajo /panel/* que NO matchee un archivo estático
// devuelve index.html para que el routing del SPA (hash-based) funcione tras
// refresh o deep-link.
app.get(/^\/panel(\/.*)?$/, (req, res, next) => {
  if (!panelExists) return next();
  res.sendFile(panelIndex);
});

// Subdominio dedicado del panel: cuando GHL abre el Custom Menu Link en
// `panel.<APP_DOMAIN>/?locationId=...&userId=...`, la ruta es `/` (no
// `/panel/`). Servimos el mismo index.html; los assets (/panel/style.css,
// /panel/app.js) siguen siendo paths absolutos y funcionan desde cualquier
// host. Sólo aplica en modo GET `/` para no interferir con otras rutas.
app.get('/', (req, res, next) => {
  if (!panelExists) return next();
  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  const panelHost = env.appDomain ? `panel.${env.appDomain.toLowerCase()}` : null;
  if (panelHost && host === panelHost) {
    return res.sendFile(panelIndex);
  }
  next();
});

// Páginas públicas multi-tenant: se montan en la raíz, resolviendo el tenant
// por header Host. Se ejecutan después de /api para que las rutas /api/* no
// caigan aquí.
app.use(resolveTenantByHost, publicRoutes);

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.originalUrl });
});

// Error handler global
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error('[error]', err);
  res.status(err.status || 500).json({
    error: 'server_error',
    message: env.nodeEnv === 'production' ? undefined : err.message,
  });
});

const server = app.listen(env.port, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[mktscaled-listings] listening on :${env.port} (${env.nodeEnv})`);
});

// Arranca jobs (no-op si no hay credenciales todavía).
startJobs();

// Cierre limpio
function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`[mktscaled-listings] ${signal} received, closing...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
