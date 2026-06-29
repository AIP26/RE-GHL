// Ficha técnica PDF (PDFKit, bajo demanda) — Paso 12.
// 4 versiones: con/sin agente x 1/2 páginas.
// Imágenes solicitadas a Cloudinary con /f_jpg/ (PDFKit no soporta WebP).
import { Router } from 'express';
const r = Router();
r.get('/:propertyId', (_req, res) => res.status(501).json({ error: 'pending_step_12' }));
r.get('/organica/:fichaId', (_req, res) => res.status(501).json({ error: 'pending_step_12' }));
export default r;
