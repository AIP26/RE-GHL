// Registrador central de rutas. Cada ruta se monta bajo /api/<recurso>.
// Los stubs viven para que la estructura quede lista y los siguientes pasos
// solo tengan que implementar handlers.
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
  return r;
}
