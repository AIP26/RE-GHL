// Páginas públicas (home, colección, detalle, búsqueda) — Paso 9.
// Servidas en dominios custom de clientes (propiedades.thebrokers.mx etc.).
import { Router } from 'express';

const r = Router();

r.get('/', (_req, res) => res.status(501).send('pending_step_9: home'));
r.get('/coleccion/:slug', (_req, res) => res.status(501).send('pending_step_9: coleccion'));
r.get('/p/:slug', (_req, res) => res.status(501).send('pending_step_9: detalle'));
r.get('/buscar', (_req, res) => res.status(501).send('pending_step_9: buscar'));

export default r;
