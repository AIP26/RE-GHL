// Verificación CNAME + activación de dominio del cliente — Paso 10.
import { Router } from 'express';
const r = Router();
r.post('/verify', (_req, res) => res.status(501).json({ error: 'pending_step_10' }));
r.get('/status', (_req, res) => res.status(501).json({ error: 'pending_step_10' }));
export default r;
