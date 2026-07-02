// Registrador central de rutas. Cada ruta se monta bajo /api/<recurso>.
import { Router } from 'express';

import health from './health.js';
import auth from './auth.js';
import webhook from './webhook.js';
import property from './property.js';
import collection from './collection.js';
import upload from './upload.js';
import pdf from './pdf.js';
import share from './share.js';
import agent from './agent.js';
import analytics from './analytics.js';
import domain from './domain.js';
import brand from './brand.js';
import apikeys from './apikeys.js';
import v1 from './v1.js';
import ghlProxy from './ghl-proxy.js';
import { requireSession } from '../middleware/auth.js';
import { env } from '../config/env.js';

export function buildApiRouter() {
  const r = Router();
  r.use('/health', health);
  r.use('/auth', auth);
  r.use('/webhook', webhook);
  r.use('/property', property);
  r.use('/collection', collection);
  r.use('/upload', upload);
  r.use('/pdf', pdf);
  r.use('/share', share);
  r.use('/agent', agent);
  r.use('/analytics', analytics);
  r.use('/domain', domain);
  r.use('/brand', brand);
  r.use('/apikeys', apikeys);
  r.use('/v1', v1);
  r.use('/ghl', ghlProxy);

  // GET /api/runtime-config — config pública que necesita el SPA del menú
  // lateral (Google Maps key, Cloudinary cloud name). Requiere sesión.
  r.get('/runtime-config', requireSession, (_req, res) => {
    res.json({
      googleMapsApiKey: env.googleMaps.apiKey || null,
      cloudinaryCloudName: env.cloudinary.cloudName || null,
    });
  });

  return r;
}
