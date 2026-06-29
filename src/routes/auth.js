// Auth API — Paso 3.
// Aquí queda solo el endpoint /sso (consumido por el iframe del menú lateral).
// El flow OAuth público vive en /auth (sin /api), implementado en routes/oauth.js.
import { Router } from 'express';

const r = Router();

// POST /api/auth/sso  -> {locationId, userId} -> session token (JWT)
r.post('/sso', (_req, res) => res.status(501).json({ error: 'pending_step_3' }));

export default r;
