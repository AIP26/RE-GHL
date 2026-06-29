// Helper Cloudinary. Configuración detallada en Paso 6.
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';

let configured = false;

export function getCloudinary() {
  if (!configured) {
    if (!env.cloudinary.cloudName || !env.cloudinary.apiKey || !env.cloudinary.apiSecret) {
      throw new Error('Cloudinary no configurado.');
    }
    cloudinary.config({
      cloud_name: env.cloudinary.cloudName,
      api_key: env.cloudinary.apiKey,
      api_secret: env.cloudinary.apiSecret,
      secure: true,
    });
    configured = true;
  }
  return cloudinary;
}

// Helper: convierte URL .webp -> versión JPEG para PDFKit (agrega /f_jpg/)
export function toJpgUrl(cloudinaryUrl) {
  if (!cloudinaryUrl) return cloudinaryUrl;
  return cloudinaryUrl.replace('/upload/', '/upload/f_jpg/');
}
