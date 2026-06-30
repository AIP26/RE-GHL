// Upload de fotos a Cloudinary mediante SIGNED DIRECT UPLOAD.
// El cliente sube directo a Cloudinary con la firma que generamos aquí,
// evitando que el archivo pase por nuestro backend (ahorra ancho de banda
// en Railway y latencia para el agente).
//
// Cloudinary docs: https://cloudinary.com/documentation/signatures
import { Router } from 'express';
import crypto from 'node:crypto';
import { requireSession } from '../middleware/auth.js';
import { env } from '../config/env.js';

const r = Router();

// POST /api/upload/sign
// Body opcional: { kind: 'property' | 'brand' | 'agent' | 'collection' }
// Responde con todos los params necesarios para que el cliente POSTee a
// https://api.cloudinary.com/v1_1/{cloudName}/image/upload
// Mapping explícito kind del cliente -> nombre de carpeta en Cloudinary.
// Master Context v2.6:
//   /tenants/{tenant_id}/properties/  -> fotos de propiedades
//   /tenants/{tenant_id}/brand/       -> logos, hero, asociaciones, fotos de agentes
const FOLDER_BY_KIND = {
  property: 'properties',
  brand: 'brand',
  agent: 'brand',       // fotos de agentes viven bajo brand según Master Context
  collection: 'brand',  // misma carpeta
};

r.post('/sign', requireSession, (req, res) => {
  if (!env.cloudinary.cloudName || !env.cloudinary.apiKey || !env.cloudinary.apiSecret) {
    return res.status(500).json({
      error: 'cloudinary_not_configured',
      hint: 'Setea CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET en el env.',
    });
  }

  const kind = (req.body?.kind || 'property').replace(/[^a-z]/g, '');
  const subfolder = FOLDER_BY_KIND[kind] || 'brand';
  const folder = `tenants/${req.tenant.id}/${subfolder}`;
  const timestamp = Math.floor(Date.now() / 1000);

  // Eager: para fotos de propiedad → WebP <=2000px q=80 (Master Context).
  // Para otras categorías de marca → f_auto,c_limit,w_1200 SIN q_auto.
  // `q_auto` puede stripear el canal alpha al elegir compresión lossy en
  // imágenes con transparencia. f_auto solo + c_limit garantiza que un PNG
  // transparente conserve la transparencia al servirse como WebP/AVIF.
  const eager = kind === 'property'
    ? 'f_webp,q_80,w_2000,c_limit'
    : 'f_auto,c_limit,w_1200';

  // Build the string to sign: parámetros en orden alfabético, "k=v&k=v" + api_secret
  const params = { eager, folder, timestamp: String(timestamp) };
  const toSign =
    Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&') + env.cloudinary.apiSecret;

  const signature = crypto.createHash('sha1').update(toSign).digest('hex');

  res.json({
    cloudName: env.cloudinary.cloudName,
    apiKey: env.cloudinary.apiKey,
    timestamp,
    folder,
    eager,
    signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${env.cloudinary.cloudName}/image/upload`,
  });
});

export default r;
