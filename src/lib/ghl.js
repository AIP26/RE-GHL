// Helper HTTP de la API de GoHighLevel. Implementación detallada en Paso 2/3/4.
// Por ahora deja la firma para que el resto del código pueda importar.
import axios from 'axios';

export const GHL_API_BASE = 'https://services.leadconnectorhq.com';
export const GHL_OAUTH_BASE = 'https://marketplace.gohighlevel.com';
export const GHL_API_VERSION = '2021-07-28';

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

// TODO Paso 2: exchangeCodeForToken(code), refreshAccessToken(refreshToken)
// TODO Paso 4: createCustomObject(...), createCustomField(...)
// TODO Paso 5: getRecord, createRecord, updateRecord, listRecords
