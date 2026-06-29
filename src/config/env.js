// Carga y validación de variables de entorno.
// Fallar rápido si falta algo crítico (sin valores default).
import 'dotenv/config';

const REQUIRED = [
  // Se vuelven obligatorias a medida que avanzamos en los pasos.
  // Por ahora solo NODE_ENV / PORT son indispensables para arrancar.
  'NODE_ENV',
  'PORT',
];

// Variables que serán requeridas en pasos posteriores. Las listamos para
// documentación, pero NO fallamos si faltan en esta fase inicial.
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

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  // eslint-disable-next-line no-console
  console.error(`[env] Faltan variables obligatorias: ${missing.join(', ')}`);
  process.exit(1);
}

export const env = {
  nodeEnv: process.env.NODE_ENV,
  port: Number(process.env.PORT),
  appDomain: process.env.APP_DOMAIN,
  logLevel: process.env.LOG_LEVEL || 'info',

  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
  },
  ghl: {
    clientId: process.env.GHL_CLIENT_ID,
    clientSecret: process.env.GHL_CLIENT_SECRET,
    redirectUri: process.env.GHL_REDIRECT_URI,
    scopes: process.env.GHL_SCOPES,
    userType: process.env.GHL_USER_TYPE || 'Location',
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
  googleMaps: {
    apiKey: process.env.GOOGLE_MAPS_API_KEY,
  },
};
