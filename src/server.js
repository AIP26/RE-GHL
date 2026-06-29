// Entrada del servidor Express — mktscaled-listings.
// El stack completo, multi-tenant, vive aquí. Hot-path: bajo middleware.
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import morgan from 'morgan';

import { env } from './config/env.js';
import { buildApiRouter } from './routes/index.js';
import publicRoutes from './routes/public.js';
import { resolveTenantByHost } from './middleware/tenant.js';
import { startJobs } from './jobs/index.js';

const app = express();

// Trust proxy (Railway, Cloudflare, etc.) para Host / IP / HTTPS correctos.
app.set('trust proxy', true);

// Seguridad + perf
app.use(
  helmet({
    contentSecurityPolicy: false, // se afinará cuando sirvamos HTML público
    crossOriginEmbedderPolicy: false, // iframe en GHL
  })
);
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

// API privada / admin (siempre bajo /api)
app.use('/api', buildApiRouter());

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
