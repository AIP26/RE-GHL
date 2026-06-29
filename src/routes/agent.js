// CRUD agentes del tenant + límites por plan (Starter=1, Pro=5, Agency=∞) — Paso 8.
import { Router } from 'express';
const r = Router();
r.all('/', (_req, res) => res.status(501).json({ error: 'pending_step_8' }));
r.all('/:id', (_req, res) => res.status(501).json({ error: 'pending_step_8' }));
export default r;
