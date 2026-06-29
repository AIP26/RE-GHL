// Verificación de firma de webhooks de GoHighLevel.
//
// GHL Marketplace v2 firma con Ed25519 y manda el header X-GHL-Signature.
// (El legado X-WH-Signature con RSA queda deprecado el 1-Jul-2026.)
//
// La clave pública Ed25519 se obtiene del dashboard del Marketplace de tu app
// y se inyecta vía env var GHL_WEBHOOK_PUBLIC_KEY (en formato PEM SPKI o
// base64 raw de 32 bytes).
//
// Si la variable NO está configurada, registramos un WARN y aceptamos el
// webhook (útil en dev). En producción, configurar siempre la clave.
import crypto from 'node:crypto';
import { env } from '../config/env.js';

function loadPublicKey() {
  const raw = env.ghl.webhookPublicKey;
  if (!raw) return null;
  try {
    if (raw.includes('BEGIN PUBLIC KEY')) {
      return crypto.createPublicKey({ key: raw, format: 'pem' });
    }
    // 32 bytes en base64 = Ed25519 raw -> envolvemos en SPKI
    const buf = Buffer.from(raw, 'base64');
    if (buf.length === 32) {
      // Prefijo SPKI Ed25519: 302a300506032b6570032100 + 32 bytes
      const spki = Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        buf,
      ]);
      return crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
    }
    // Asumir DER base64
    return crypto.createPublicKey({
      key: Buffer.from(raw, 'base64'),
      format: 'der',
      type: 'spki',
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[webhook] GHL_WEBHOOK_PUBLIC_KEY inválida:', err.message);
    return null;
  }
}

let publicKey = null;
let publicKeyTried = false;

/**
 * Verifica la firma Ed25519 del webhook.
 * @param {Buffer} rawBody  El body crudo (no parseado).
 * @param {string} signature  Header X-GHL-Signature (base64).
 * @returns {{ ok: boolean, reason: string }}
 */
export function verifyWebhookSignature(rawBody, signature) {
  if (!publicKeyTried) {
    publicKey = loadPublicKey();
    publicKeyTried = true;
  }
  if (!publicKey) {
    return { ok: true, reason: 'no_public_key_configured' };
  }
  if (!signature) {
    return { ok: false, reason: 'missing_signature_header' };
  }
  try {
    const sig = Buffer.from(signature, 'base64');
    const ok = crypto.verify(null, rawBody, publicKey, sig);
    return { ok, reason: ok ? 'verified' : 'invalid_signature' };
  } catch (err) {
    return { ok: false, reason: `verify_error:${err.message}` };
  }
}
