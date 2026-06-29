// CRUD propiedades (GHL Custom Object) — Paso 5.
import { Router } from 'express';
const r = Router();
r.all('/', (_req, res) => res.status(501).json({ error: 'pending_step_5' }));
r.all('/:id', (_req, res) => res.status(501).json({ error: 'pending_step_5' }));
export default r;
