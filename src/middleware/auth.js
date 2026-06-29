// Verifica el session token (JWT propio) emitido tras el SSO del iframe GHL.
// Implementación detallada en Paso 3.
import { verifySession } from '../lib/jwt.js';

export function requireSession(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing_session' });
  try {
    req.session = verifySession(token);
    return next();
  } catch {
    return res.status(401).json({ error: 'invalid_session' });
  }
}
