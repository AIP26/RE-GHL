// OAuth GoHighLevel — Paso 2.
// Endpoints previstos:
//   GET  /api/auth        -> redirige a marketplace.gohighlevel.com/oauth/authorize?...
//   GET  /api/auth/callback -> intercambia code por tokens, los cifra y guarda en Supabase
//   POST /api/auth/sso    -> recibe locationId+userId del iframe -> session token (JWT)
import { Router } from 'express';

const r = Router();

r.get('/', (_req, res) => res.status(501).json({ error: 'pending_step_2' }));
r.get('/callback', (_req, res) => res.status(501).json({ error: 'pending_step_2' }));
r.post('/sso', (_req, res) => res.status(501).json({ error: 'pending_step_3' }));

export default r;
