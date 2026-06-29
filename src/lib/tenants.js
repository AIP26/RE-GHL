// Helpers de acceso a la tabla `tenants` en Supabase.
// Encapsula el cifrado/descifrado de tokens para que el resto del código
// nunca toque oauth_token / refresh_token en claro.
import { getSupabase } from './supabase.js';
import { encrypt, decrypt } from './encryption.js';

const TABLE = 'tenants';

/**
 * Crea o actualiza un tenant a partir de la respuesta del intercambio OAuth.
 * Idempotente: si ya existe el ghl_location_id, actualiza tokens y status.
 */
export async function upsertTenantFromOAuth(tokenResponse) {
  const sb = getSupabase();
  const locationId = tokenResponse.locationId || tokenResponse.location_id;
  if (!locationId) {
    throw new Error('OAuth response sin locationId — ¿user_type correcto?');
  }
  const row = {
    ghl_location_id: locationId,
    oauth_token: encrypt(tokenResponse.access_token),
    refresh_token: encrypt(tokenResponse.refresh_token),
    status: 'active',
  };
  const { data, error } = await sb
    .from(TABLE)
    .upsert(row, { onConflict: 'ghl_location_id' })
    .select('id, ghl_location_id, plan, status, created_at')
    .single();
  if (error) throw error;
  return data;
}

/** Devuelve todos los tenants activos (sin tokens descifrados). */
export async function listActiveTenants() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from(TABLE)
    .select('id, ghl_location_id, oauth_token, refresh_token, status')
    .eq('status', 'active');
  if (error) throw error;
  return data;
}

/** Devuelve un tenant + tokens descifrados (úsalo solo cuando necesites llamar GHL). */
export async function getTenantWithTokens(tenantId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from(TABLE)
    .select('id, ghl_location_id, oauth_token, refresh_token, status, plan')
    .eq('id', tenantId)
    .single();
  if (error) throw error;
  return {
    ...data,
    access_token: decrypt(data.oauth_token),
    refresh_token_plain: decrypt(data.refresh_token),
  };
}

/** Persiste tokens refrescados (cifrándolos). */
export async function updateTenantTokens(tenantId, { access_token, refresh_token }) {
  const sb = getSupabase();
  const { error } = await sb
    .from(TABLE)
    .update({
      oauth_token: encrypt(access_token),
      refresh_token: encrypt(refresh_token),
      status: 'active',
    })
    .eq('id', tenantId);
  if (error) throw error;
}

/** Marca el tenant como `needs_reauth` cuando el refresh token falla. */
export async function markNeedsReauth(tenantId) {
  const sb = getSupabase();
  const { error } = await sb
    .from(TABLE)
    .update({ status: 'needs_reauth' })
    .eq('id', tenantId);
  if (error) throw error;
}
