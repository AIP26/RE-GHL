// Carga y validación de variables de entorno.
// IMPORTANTE: todas las propiedades de `env` son GETTERS lazy que leen
// `process.env` en cada acceso. Esto evita el bug de "snapshot a tiempo
// de import" donde un valor undefined al momento de evaluar el módulo
// quedaba congelado para toda la vida del proceso (ej. en Railway).
import 'dotenv/config';

const REQUIRED = ['NODE_ENV', 'PORT'];

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  // eslint-disable-next-line no-console
  console.error(`[env] Faltan variables obligatorias: ${missing.join(', ')}`);
  process.exit(1);
}

// Variables que serán requeridas en pasos posteriores (solo documentación).
export const FUTURE_REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'GHL_CLIENT_ID',
  'GHL_CLIENT_SECRET',
  'GHL_REDIRECT_URI',
  'ENCRYPTION_KEY',
  'JWT_SECRET',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'GOOGLE_MAPS_API_KEY',
];

/**
 * Construye un objeto con getters que leen `process.env` en cada acceso.
 * - Valor string: nombre de la env var
 * - Valor función: resolver custom (para defaults, parseo numérico, etc.)
 */
function lazy(map) {
  const obj = {};
  for (const [key, envOrFn] of Object.entries(map)) {
    const getter = typeof envOrFn === 'function' ? envOrFn : () => process.env[envOrFn];
    Object.defineProperty(obj, key, { get: getter, enumerable: true });
  }
  return obj;
}

export const env = {
  get nodeEnv() { return process.env.NODE_ENV; },
  get port() { return Number(process.env.PORT); },
  get appDomain() { return process.env.APP_DOMAIN; },
  get logLevel() { return process.env.LOG_LEVEL || 'info'; },

  supabase: lazy({
    url: 'SUPABASE_URL',
    serviceKey: 'SUPABASE_SERVICE_KEY',
  }),
  ghl: lazy({
    clientId: 'GHL_CLIENT_ID',
    clientSecret: 'GHL_CLIENT_SECRET',
    redirectUri: 'GHL_REDIRECT_URI',
    userType: () => process.env.GHL_USER_TYPE || 'Location',
    webhookPublicKey: 'GHL_WEBHOOK_PUBLIC_KEY',
  }),
  encryption: lazy({
    key: 'ENCRYPTION_KEY',
  }),
  jwt: lazy({
    secret: 'JWT_SECRET',
    expiresIn: () => process.env.JWT_EXPIRES_IN || '23h',
  }),
  cloudinary: lazy({
    cloudName: 'CLOUDINARY_CLOUD_NAME',
    apiKey: 'CLOUDINARY_API_KEY',
    apiSecret: 'CLOUDINARY_API_SECRET',
  }),
  googleMaps: lazy({
    apiKey: 'GOOGLE_MAPS_API_KEY',
  }),
};
