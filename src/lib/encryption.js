// AES-256-GCM para cifrar oauth_token / refresh_token antes de escribir en Supabase.
// La clave debe ser 32 bytes (64 hex chars). Genera con:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
import crypto from 'node:crypto';
import { env } from '../config/env.js';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;   // GCM recomendado
const TAG_LEN = 16;

function getKey() {
  if (!env.encryption.key) throw new Error('ENCRYPTION_KEY no configurada.');
  const buf = Buffer.from(env.encryption.key, 'hex');
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY debe ser 32 bytes (64 hex).');
  return buf;
}

export function encrypt(plaintext) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // [iv | tag | ciphertext] -> base64
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decrypt(payload) {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
