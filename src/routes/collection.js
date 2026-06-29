// CRUD colecciones — Paso 7.
import { Router } from 'express';
const r = Router();
r.all('/', (_req, res) => res.status(501).json({ error: 'pending_step_7' }));
r.all('/:id', (_req, res) => res.status(501).json({ error: 'pending_step_7' }));
export default r;
