// Helper HTTP de la API de GoHighLevel.
// OAuth 2.0 (marketplace) + cliente autenticado para llamadas posteriores.
import axios from 'axios';
import { env } from '../config/env.js';

export const GHL_API_BASE = 'https://services.leadconnectorhq.com';
export const GHL_OAUTH_AUTHORIZE = 'https://marketplace.gohighlevel.com/oauth/chooselocation';
export const GHL_OAUTH_TOKEN = `${GHL_API_BASE}/oauth/token`;
export const GHL_API_VERSION = '2021-07-28';

// ---------------------------------------------------------------------
// Scopes solicitados por la app — HARDCODEADOS a propósito.
// No leemos de env var para evitar OAuth roto si la variable no está
// presente en producción (caso real de Railway que ya nos mordió).
// Si necesitas cambiar scopes, edítalos aquí y republica en el Marketplace.
// ---------------------------------------------------------------------
export const GHL_SCOPES = [
  'locations.readonly',
  'contacts.write',
  'associations.write',
  'associations.readonly',
  'associations/relation.readonly',
  'associations/relation.write',
  'businesses.readonly',
  'businesses.write',
  'locations/customFields.readonly',
  'locations/customFields.write',
  'users.readonly',
  'objects/schema.write',
  'objects/record.readonly',
  'objects/record.write',
  'objects/schema.readonly',
].join(' ');

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
    scope: GHL_SCOPES,
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
  const cli = axios.create({
    baseURL: GHL_API_BASE,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: GHL_API_VERSION,
      Accept: 'application/json',
    },
    timeout: 30_000,
  });

  // Interceptor de error: deja un trace ruidoso en stdout para Railway
  // ANTES de re-lanzar. No mutamos el error — sólo logging.
  cli.interceptors.response.use(
    (r) => r,
    (err) => {
      const status = err?.response?.status;
      const cfg = err?.config || err?.response?.config || {};
      // eslint-disable-next-line no-console
      console.error(
        '[ghl:http]',
        JSON.stringify({
          method: (cfg.method || '').toUpperCase(),
          url: cfg.url,
          params: cfg.params,
          status,
          statusText: err?.response?.statusText,
          requestBody: (() => {
            try { return typeof cfg.data === 'string' ? JSON.parse(cfg.data) : cfg.data; }
            catch { return cfg.data; }
          })(),
          responseBody: err?.response?.data,
          traceId: err?.response?.headers?.['x-trace-id']
                || err?.response?.headers?.['x-request-id']
                || err?.response?.headers?.['x-correlation-id'],
          message: err?.message,
          code: err?.code,
        })
      );
      return Promise.reject(err);
    }
  );

  return cli;
}

// ---------------------------------------------------------------------
// Users API — obtiene datos del usuario (lo usamos para el instalador)
// ---------------------------------------------------------------------
export async function getUserById(accessToken, userId) {
  const { data } = await ghlClient(accessToken).get(`/users/${userId}`);
  return data?.user || data;
}

// ---------------------------------------------------------------------
// Custom Objects API v2 — schema + fields
// ---------------------------------------------------------------------

/** Crea un Custom Object schema. GHL retorna { object: { key, id, ... } }
 *  donde `key` viene ya prefijado como "custom_object.<tu-key>". */
export async function createCustomObjectSchema(accessToken, payload) {
  const { data } = await ghlClient(accessToken).post('/objects/', payload);
  return data?.object || data;
}

/** GET schema por key (con prefijo custom_object.). 404 si no existe. */
export async function getCustomObjectByKey(accessToken, fullKey, locationId) {
  const { data } = await ghlClient(accessToken).get(
    `/objects/${encodeURIComponent(fullKey)}`,
    { params: { locationId } }
  );
  return data?.object || data;
}

/** Lista los custom fields de un object schema y también devuelve las folders. */
export async function listCustomFieldsForObject(accessToken, fullObjectKey, locationId) {
  const cli = ghlClient(accessToken);
  try {
    const { data } = await cli.get(
      `/custom-fields/object-key/${encodeURIComponent(fullObjectKey)}`,
      { params: { locationId } }
    );
    return {
      fields: data?.fields || [],
      folders: data?.folders || [],
    };
  } catch (err) {
    // Fallback: si el endpoint moderno falla, intentamos el legado
    try {
      const { data } = await cli.get('/custom-fields/', {
        params: { locationId, objectType: fullObjectKey },
      });
      return {
        fields: data?.fields || data?.customFields || [],
        folders: data?.folders || [],
      };
    } catch {
      throw err;
    }
  }
}

/** Crea un custom field en un Custom Object. */
export async function createCustomField(accessToken, payload) {
  const { data } = await ghlClient(accessToken).post('/custom-fields/', payload);
  return data?.field || data?.customField || data;
}

// ---------------------------------------------------------------------
// Custom Object Records (instancias del schema "propiedad")
// ---------------------------------------------------------------------

/** POST /objects/{schemaKey}/records — crea un record. */
export async function createObjectRecord(accessToken, fullObjectKey, payload) {
  const { data } = await ghlClient(accessToken).post(
    `/objects/${encodeURIComponent(fullObjectKey)}/records`,
    payload
  );
  return data?.record || data;
}

/** GET /objects/{schemaKey}/records/{id} */
export async function getObjectRecord(accessToken, fullObjectKey, recordId, locationId) {
  const { data } = await ghlClient(accessToken).get(
    `/objects/${encodeURIComponent(fullObjectKey)}/records/${recordId}`,
    { params: { locationId } }
  );
  return data?.record || data;
}

/** PUT /objects/{schemaKey}/records/{id} */
export async function updateObjectRecord(accessToken, fullObjectKey, recordId, payload) {
  const { data } = await ghlClient(accessToken).put(
    `/objects/${encodeURIComponent(fullObjectKey)}/records/${recordId}`,
    payload
  );
  return data?.record || data;
}

export async function deleteObjectRecord(accessToken, fullObjectKey, recordId, locationId) {
  const { data } = await ghlClient(accessToken).delete(
    `/objects/${encodeURIComponent(fullObjectKey)}/records/${recordId}`,
    { params: { locationId } }
  );
  return data;
}

/** Búsqueda + paginación de records. */
export async function listObjectRecords(accessToken, fullObjectKey, { locationId, limit = 20, offset = 0, query }) {
  const body = {
    locationId,
    page: Math.floor(offset / limit) + 1,
    pageLimit: limit,
    query: query || '',
  };
  const { data } = await ghlClient(accessToken).post(
    `/objects/${encodeURIComponent(fullObjectKey)}/records/search`,
    body
  );
  return data;
}
