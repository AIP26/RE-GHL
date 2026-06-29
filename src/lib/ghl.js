// Helper HTTP de la API de GoHighLevel.
// OAuth 2.0 (marketplace) + cliente autenticado para llamadas posteriores.
import axios from 'axios';
import { env } from '../config/env.js';

export const GHL_API_BASE = 'https://services.leadconnectorhq.com';
export const GHL_OAUTH_AUTHORIZE = 'https://marketplace.gohighlevel.com/oauth/chooselocation';
export const GHL_OAUTH_TOKEN = `${GHL_API_BASE}/oauth/token`;
export const GHL_API_VERSION = '2021-07-28';

// ---------------------------------------------------------------------
// Asserción defensiva: si alguna var crítica falta en el momento de
// construir la URL, fallamos ruidosamente en vez de generar una URL
// con `client_id=undefined`.
// ---------------------------------------------------------------------
function assertOAuthConfigured() {
  const missing = [];
  if (!env.ghl.clientId)     missing.push('GHL_CLIENT_ID');
  if (!env.ghl.clientSecret) missing.push('GHL_CLIENT_SECRET');
  if (!env.ghl.redirectUri)  missing.push('GHL_REDIRECT_URI');
  if (missing.length) {
    throw new Error(
      `GHL OAuth no configurado en runtime: faltan ${missing.join(', ')}. ` +
      `Verifica las variables de entorno del proyecto (Railway -> Variables).`
    );
  }
}

// ---------------------------------------------------------------------
// OAuth: URL de autorización
// ---------------------------------------------------------------------
export function getAuthorizeUrl(state) {
  assertOAuthConfigured();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.ghl.clientId,
    redirect_uri: env.ghl.redirectUri,
    scope: env.ghl.scopes || '',
  });
  if (state) params.set('state', state);
  return `${GHL_OAUTH_AUTHORIZE}?${params.toString()}`;
}

// ---------------------------------------------------------------------
// OAuth: intercambio code -> tokens
// ---------------------------------------------------------------------
export async function exchangeCodeForToken(code) {
  assertOAuthConfigured();
  const body = new URLSearchParams({
    client_id: env.ghl.clientId,
    client_secret: env.ghl.clientSecret,
    grant_type: 'authorization_code',
    code,
    user_type: env.ghl.userType,
    redirect_uri: env.ghl.redirectUri,
  });

  const { data } = await axios.post(GHL_OAUTH_TOKEN, body.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    timeout: 30_000,
  });
  return data;
}

// ---------------------------------------------------------------------
// OAuth: refresh
// ---------------------------------------------------------------------
export async function refreshAccessToken(refreshToken) {
  assertOAuthConfigured();
  const body = new URLSearchParams({
    client_id: env.ghl.clientId,
    client_secret: env.ghl.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    user_type: env.ghl.userType,
  });

  const { data } = await axios.post(GHL_OAUTH_TOKEN, body.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    timeout: 30_000,
  });
  return data;
}

// ---------------------------------------------------------------------
// Cliente autenticado para la API v2
// ---------------------------------------------------------------------
export function ghlClient(accessToken) {
  return axios.create({
    baseURL: GHL_API_BASE,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: GHL_API_VERSION,
      Accept: 'application/json',
    },
    timeout: 30_000,
  });
}

// ---------------------------------------------------------------------
// Users API — obtiene datos del usuario (lo usamos para el instalador)
// ---------------------------------------------------------------------
export async function getUserById(accessToken, userId) {
  const { data } = await ghlClient(accessToken).get(`/users/${userId}`);
  // GHL devuelve {user: {...}} o {...} según el endpoint. Normalizamos.
  return data?.user || data;
}
