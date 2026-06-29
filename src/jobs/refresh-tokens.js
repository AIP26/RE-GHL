// Job: refresca los access_tokens de GHL antes de que expiren (24h).
// Se ejecuta cada 23 horas. Si el refresh falla, marca el tenant como
// `needs_reauth` para que la app sepa que requiere reinstalación.
import { refreshAccessToken } from '../lib/ghl.js';
import {
  listActiveTenants,
  updateTenantTokens,
  markNeedsReauth,
} from '../lib/tenants.js';
import { decrypt } from '../lib/encryption.js';

export async function refreshAllTenantTokens({ logger = console } = {}) {
  const tenants = await listActiveTenants();
  logger.log(`[refresh-tokens] iniciando refresh para ${tenants.length} tenant(s)`);

  let ok = 0;
  let failed = 0;

  for (const t of tenants) {
    try {
      const refreshTokenPlain = decrypt(t.refresh_token);
      const tokenResp = await refreshAccessToken(refreshTokenPlain);
      await updateTenantTokens(t.id, {
        access_token: tokenResp.access_token,
        refresh_token: tokenResp.refresh_token,
      });
      ok += 1;
    } catch (err) {
      failed += 1;
      logger.error(
        `[refresh-tokens] FALLÓ tenant=${t.id} location=${t.ghl_location_id}:`,
        err?.response?.data || err.message
      );
      try {
        await markNeedsReauth(t.id);
      } catch (e2) {
        logger.error('[refresh-tokens] no se pudo marcar needs_reauth:', e2.message);
      }
    }
  }

  logger.log(`[refresh-tokens] terminado: ok=${ok} failed=${failed}`);
  return { ok, failed, total: tenants.length };
}
