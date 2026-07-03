// Helpers de acceso a la tabla `tenants` en Supabase.
// Encapsula el cifrado/descifrado de tokens.
import { getSupabase } from './supabase.js';
import { encrypt, decrypt } from './encryption.js';

const TABLE = 'tenants';

/** Crea o actualiza un tenant a partir de la respuesta del intercambio OAuth. */
export async function upsertTenantFromOAuth(tokenResponse) {
  const sb = getSupabase();
  const locationId = tokenResponse.locationId || tokenResponse.location_id;
  if (!locationId) throw new Error('OAuth response sin locationId — ¿user_type correcto?');
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

/** Devuelve un tenant por ghl_location_id o null. Sin descifrar tokens. */
export async function findTenantByLocationId(locationId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from(TABLE)
    .select('id, ghl_location_id, status, plan')
    .eq('ghl_location_id', locationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Devuelve un tenant + tokens descifrados (úsalo solo cuando llames GHL). */
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

/** Devuelve todos los tenants **procesables por el cron de refresh**:
 *  `status IN ('active', 'needs_reauth')`.
 *
 *  Iter 23 — Antes filtraba sólo por 'active', lo que excluía a los tenants
 *  en 'needs_reauth' — precisamente el escenario donde el mint-fallback
 *  vía agency debería intentar rescatarlos. Ahora el cron los procesa;
 *  `updateTenantTokens` los devuelve a 'active' automáticamente si el
 *  fallback tuvo éxito.
 *
 *  Incluye `agency_id` cuando la columna existe (post migration_step19).
 *  Si la columna no existe todavía, cae a la lista básica sin agency_id. */
export async function listRefreshableTenants() {
  const sb = getSupabase();
  const REFRESHABLE = ['active', 'needs_reauth'];
  let { data, error } = await sb
    .from(TABLE)
    .select('id, ghl_location_id, oauth_token, refresh_token, status, agency_id')
    .in('status', REFRESHABLE);
  if (error && /agency_id/.test(error.message || '')) {
    const fallback = await sb
      .from(TABLE)
      .select('id, ghl_location_id, oauth_token, refresh_token, status')
      .in('status', REFRESHABLE);
    if (fallback.error) throw fallback.error;
    return (fallback.data || []).map((r) => ({ ...r, agency_id: null }));
  }
  if (error) throw error;
  return data;
}

/** @deprecated Sólo por compat con scripts smoke. Usa listRefreshableTenants
 *  para el cron. Este devuelve únicamente 'active'. */
export async function listActiveTenants() {
  const sb = getSupabase();
  let { data, error } = await sb
    .from(TABLE)
    .select('id, ghl_location_id, oauth_token, refresh_token, status, agency_id')
    .eq('status', 'active');
  if (error && /agency_id/.test(error.message || '')) {
    const fallback = await sb
      .from(TABLE)
      .select('id, ghl_location_id, oauth_token, refresh_token, status')
      .eq('status', 'active');
    if (fallback.error) throw fallback.error;
    return (fallback.data || []).map((r) => ({ ...r, agency_id: null }));
  }
  if (error) throw error;
  return data;
}

/** Asocia un tenant con la agency que lo aprovisionó. Best-effort: si la
 *  columna agency_id no existe todavía (migración pendiente) simplemente
 *  loguea y sigue — el cron cae a iteración sobre agencies activas. */
export async function linkTenantToAgency(tenantId, agencyId) {
  const sb = getSupabase();
  const { error } = await sb.from(TABLE).update({ agency_id: agencyId }).eq('id', tenantId);
  if (error) {
    if (/agency_id/.test(error.message || '')) {
      console.warn('[tenants.linkTenantToAgency] columna agency_id no existe (aplicar sql/migration_step19_tenant_agency_link.sql). Continúo sin link.');
      return;
    }
    throw error;
  }
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
  const { error } = await sb.from(TABLE).update({ status: 'needs_reauth' }).eq('id', tenantId);
  if (error) throw error;
}

/** Marca el tenant como `inactive` (desinstalación). NO borra datos. */
export async function markInactive(tenantId) {
  const sb = getSupabase();
  const { error } = await sb.from(TABLE).update({ status: 'inactive' }).eq('id', tenantId);
  if (error) throw error;
}
