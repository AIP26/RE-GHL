// Helper HTTP de la API de GoHighLevel.
// OAuth 2.0 (marketplace) + cliente autenticado para llamadas posteriores.
import axios from 'axios';
import { env } from '../config/env.js';

export const GHL_API_BASE = 'https://services.leadconnectorhq.com';
export const GHL_OAUTH_AUTHORIZE = 'https://marketplace.gohighlevel.com/oauth/chooselocation';
export const GHL_OAUTH_TOKEN = `${GHL_API_BASE}/oauth/token`;
export const GHL_API_VERSION = '2021-07-28';

// ---------------------------------------------------------------------
// OAuth: URL de autorización
// ---------------------------------------------------------------------
export function getAuthorizeUrl(state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.ghl.clientId,
    redirect_uri: env.ghl.redirectUri,
    scope: env.ghl.scopes,
  });
  if (state) params.set('state', state);
  return `${GHL_OAUTH_AUTHORIZE}?${params.toString()}`;
}

// ---------------------------------------------------------------------
// OAuth: intercambio code -> tokens
// ---------------------------------------------------------------------
export async function exchangeCodeForToken(code) {
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
  return data; // { access_token, refresh_token, expires_in, scope, userType, locationId, companyId, userId, ... }
}

// ---------------------------------------------------------------------
// OAuth: refresh
// ---------------------------------------------------------------------
export async function refreshAccessToken(refreshToken) {
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
// Cliente autenticado (para llamadas a la API después del OAuth)
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
