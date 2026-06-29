// Session tokens propios para el iframe del menú lateral.
// Se firma después del SSO contra locationId+userId que GHL pasa por query.
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function signSession(payload) {
  if (!env.jwt.secret) throw new Error('JWT_SECRET no configurado.');
  return jwt.sign(payload, env.jwt.secret, { expiresIn: env.jwt.expiresIn });
}

export function verifySession(token) {
  if (!env.jwt.secret) throw new Error('JWT_SECRET no configurado.');
  return jwt.verify(token, env.jwt.secret);
}
