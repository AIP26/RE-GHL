// Job: refresca los access_tokens de GHL antes de que expiren.
// Se ejecuta cada 23 horas.
//
// Estrategia (Iter 20 — post-diagnóstico "needs_reauth inmediato"):
//   1. Refresca cada agency (tabla `agencies`) via POST /oauth/token con su
//      refresh_token. Si el refresh falla, mantenemos el access_token
//      actual en el pool (aún puede tener horas de vida útil).
//   2. Para cada tenant activo, intenta primero refresh directo (rápido).
//   3. Si el refresh directo falla y hay agencies disponibles, re-mintea el
//      location token vía POST /oauth/locationToken usando el agency
//      access_token. Este flujo funciona incluso cuando el refresh_token
//      del tenant es rechazado ("Invalid client credentials") — típico de
//      tokens mintados desde agency.
//   4. Sólo si tanto refresh como mint fallan, se marca `needs_reauth`.
//
// La función está estructurada con inyección de dependencias (parámetro
// `deps`) para permitir tests unitarios sin tocar Supabase ni GHL reales.
import * as realGhl from '../lib/ghl.js';
import * as realTenants from '../lib/tenants.js';
import * as realAgencies from '../lib/agencies.js';
import { decrypt as realDecrypt } from '../lib/encryption.js';

/** Dependencias por defecto (producción). Los tests inyectan mocks. */
export const defaultDeps = {
  refreshAccessToken: realGhl.refreshAccessToken,
  mintLocationToken: realGhl.mintLocationToken,
  listRefreshableTenants: realTenants.listRefreshableTenants,
  updateTenantTokens: realTenants.updateTenantTokens,
  markNeedsReauth: realTenants.markNeedsReauth,
  listActiveAgencies: realAgencies.listActiveAgencies,
  getAgencyWithTokens: realAgencies.getAgencyWithTokens,
  updateAgencyTokens: realAgencies.updateAgencyTokens,
  decrypt: realDecrypt,
};

/**
 * Intenta re-mintear un location token desde alguna agency del pool.
 * Prioridad: la agency vinculada por FK (tenant.agency_id) primero, luego
 * el resto en orden.
 */
async function tryMintLocationTokenForTenant(tenant, agencyPool, deps, logger) {
  const linked = tenant.agency_id ? agencyPool.find((a) => a.id === tenant.agency_id) : null;
  const ordered = linked
    ? [linked, ...agencyPool.filter((a) => a.id !== linked.id)]
    : agencyPool;
  for (const agency of ordered) {
    try {
      const minted = await deps.mintLocationToken(
        agency.access_token,
        agency.ghl_company_id,
        tenant.ghl_location_id,
      );
      logger.log(`[refresh-tokens] tenant=${tenant.id} mint OK via agency=${agency.id}`);
      return {
        access_token: minted.access_token,
        refresh_token: minted.refresh_token,
      };
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) {
        logger.warn(`[refresh-tokens] tenant=${tenant.id} location no existe (404) — abort mint`);
        return null;
      }
      logger.warn(`[refresh-tokens] tenant=${tenant.id} mint via agency=${agency.id} status=${status || 'ERR'}`);
    }
  }
  return null;
}

/** Refresca todas las agencies activas. Siempre devuelve un pool con al
 *  menos los access_tokens actuales (aunque el refresh haya fallado). */
async function refreshAllAgencies(deps, logger) {
  const agencies = await deps.listActiveAgencies();
  const pool = [];
  let ok = 0;
  let failed = 0;
  for (const a of agencies) {
    try {
      const withTokens = await deps.getAgencyWithTokens(a.id);
      const resp = await deps.refreshAccessToken(withTokens.refresh_token_plain);
      await deps.updateAgencyTokens(a.id, {
        access_token: resp.access_token,
        refresh_token: resp.refresh_token,
      });
      pool.push({ id: a.id, ghl_company_id: a.ghl_company_id, access_token: resp.access_token });
      ok += 1;
    } catch (err) {
      failed += 1;
      logger.error(
        `[refresh-tokens] AGENCY refresh FALLÓ agencyId=${a.id}:`,
        err?.response?.data || err.message,
      );
      // Fallback: mantener el token actual en el pool — aún puede tener horas
      // de vida útil para el mint de location tokens.
      try {
        const withTokens = await deps.getAgencyWithTokens(a.id);
        pool.push({ id: a.id, ghl_company_id: a.ghl_company_id, access_token: withTokens.access_token });
      } catch (e2) {
        logger.error(`[refresh-tokens] AGENCY loadTokens agencyId=${a.id}:`, e2.message);
      }
    }
  }
  logger.log(`[refresh-tokens] agencies: ok=${ok} failed=${failed} total=${agencies.length}`);
  return { ok, failed, total: agencies.length, pool };
}

/**
 * Refresca todos los tenants activos con doble estrategia (refresh → mint).
 *
 * @param {object} opts
 * @param {object} [opts.logger=console]
 * @param {object} [opts.deps=defaultDeps]  Inyección de deps para tests.
 */
export async function refreshAllTenantTokens({ logger = console, deps = defaultDeps } = {}) {
  const agencyResult = await refreshAllAgencies(deps, logger);
  // Iter 23 — Procesamos tenants 'active' Y 'needs_reauth'. Los que están en
  // needs_reauth son los candidatos objetivo del mint-fallback: si el mint
  // funciona vía la agency, `updateTenantTokens` los devuelve a 'active' en
  // la misma llamada (setea status:'active' automáticamente).
  const tenants = await deps.listRefreshableTenants();
  const nActive = tenants.filter((t) => t.status === 'active').length;
  const nReauth = tenants.filter((t) => t.status === 'needs_reauth').length;
  logger.log(`[refresh-tokens] tenants: procesando ${tenants.length} (active=${nActive} needs_reauth=${nReauth})`);

  let ok = 0;
  let mintedFallback = 0;
  let recoveredFromReauth = 0;
  let failed = 0;

  for (const t of tenants) {
    const wasReauth = t.status === 'needs_reauth';
    // 2.a refresh directo
    let directOk = false;
    try {
      const refreshTokenPlain = deps.decrypt(t.refresh_token);
      const tokenResp = await deps.refreshAccessToken(refreshTokenPlain);
      await deps.updateTenantTokens(t.id, {
        access_token: tokenResp.access_token,
        refresh_token: tokenResp.refresh_token,
      });
      ok += 1;
      if (wasReauth) recoveredFromReauth += 1;
      directOk = true;
    } catch (err) {
      logger.warn(
        `[refresh-tokens] tenant=${t.id} location=${t.ghl_location_id} status=${t.status} refresh directo falló:`,
        err?.response?.data?.error_description || err?.response?.data || err.message,
      );
    }
    if (directOk) continue;

    // 2.b fallback mintLocationToken
    if (agencyResult.pool.length === 0) {
      logger.warn(`[refresh-tokens] tenant=${t.id} sin agencies — needs_reauth`);
      await safeMarkNeedsReauth(deps, t.id, logger);
      failed += 1;
      continue;
    }
    const minted = await tryMintLocationTokenForTenant(t, agencyResult.pool, deps, logger);
    if (minted) {
      try {
        await deps.updateTenantTokens(t.id, minted);
        mintedFallback += 1;
        if (wasReauth) recoveredFromReauth += 1;
      } catch (e) {
        logger.error(`[refresh-tokens] tenant=${t.id} updateTenantTokens post-mint:`, e.message);
        await safeMarkNeedsReauth(deps, t.id, logger);
        failed += 1;
      }
    } else {
      logger.warn(`[refresh-tokens] tenant=${t.id} mint fallback agotado — needs_reauth`);
      await safeMarkNeedsReauth(deps, t.id, logger);
      failed += 1;
    }
  }

  logger.log(
    `[refresh-tokens] tenants: ok=${ok} mintedFallback=${mintedFallback} recoveredFromReauth=${recoveredFromReauth} failed=${failed} total=${tenants.length}`
  );
  return {
    ok,
    mintedFallback,
    recoveredFromReauth,
    failed,
    total: tenants.length,
    agencies: { ok: agencyResult.ok, failed: agencyResult.failed, total: agencyResult.total },
  };
}

async function safeMarkNeedsReauth(deps, tenantId, logger) {
  try { await deps.markNeedsReauth(tenantId); }
  catch (e) { logger.error(`[refresh-tokens] markNeedsReauth tenantId=${tenantId}:`, e.message); }
}
