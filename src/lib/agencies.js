// Helpers de acceso a la tabla `agencies` en Supabase.
// Instalaciones a nivel Agency (Company). Encapsula cifrado/descifrado.
import { getSupabase } from './supabase.js';
import { encrypt, decrypt } from './encryption.js';

const TABLE = 'agencies';

/** Crea o actualiza una agency a partir de la respuesta OAuth. */
export async function upsertAgencyFromOAuth(tokenResponse) {
  const sb = getSupabase();
  const companyId = tokenResponse.companyId || tokenResponse.company_id;
  if (!companyId) throw new Error('OAuth response sin companyId ni locationId');
  const row = {
    ghl_company_id: companyId,
    oauth_token: encrypt(tokenResponse.access_token),
    refresh_token: encrypt(tokenResponse.refresh_token),
    status: 'active',
  };
  const { data, error } = await sb
    .from(TABLE)
    .upsert(row, { onConflict: 'ghl_company_id' })
    .select('id, ghl_company_id, status, created_at')
    .single();
  if (error) throw error;
  return data;
}

/** Devuelve una agency por ghl_company_id o null (sin descifrar tokens). */
export async function findAgencyByCompanyId(companyId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from(TABLE)
    .select('id, ghl_company_id, status')
    .eq('ghl_company_id', companyId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Devuelve una agency + tokens descifrados (úsalo sólo cuando llames GHL). */
export async function getAgencyWithTokens(agencyId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from(TABLE)
    .select('id, ghl_company_id, oauth_token, refresh_token, status')
    .eq('id', agencyId)
    .single();
  if (error) throw error;
  return {
    ...data,
    access_token: decrypt(data.oauth_token),
    refresh_token_plain: decrypt(data.refresh_token),
  };
}

/** Devuelve todas las agencies activas (sin descifrar tokens). */
export async function listActiveAgencies() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from(TABLE)
    .select('id, ghl_company_id, status')
    .eq('status', 'active');
  if (error) throw error;
  return data || [];
}

/** Persiste tokens refrescados de una agency (cifrándolos). */
export async function updateAgencyTokens(agencyId, { access_token, refresh_token }) {
  const sb = getSupabase();
  const { error } = await sb
    .from(TABLE)
    .update({
      oauth_token: encrypt(access_token),
      refresh_token: encrypt(refresh_token),
      status: 'active',
    })
    .eq('id', agencyId);
  if (error) throw error;
}
