// Webhook del Marketplace GHL — Paso 3.
// Al instalar: crea tenant + crea primer agente admin (con datos del instalador).
// Al desinstalar: marca tenant status='inactive'.
import { Router } from 'express';

const r = Router();

r.post('/', (_req, res) => res.status(501).json({ error: 'pending_step_3' }));

export default r;
