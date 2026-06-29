// Upload de fotos a Cloudinary (WebP, max 2000px, quality 80) — Paso 6.
import { Router } from 'express';
const r = Router();
r.post('/', (_req, res) => res.status(501).json({ error: 'pending_step_6' }));
export default r;
