// Scheduler de jobs con node-cron.
//  - Refresh tokens GHL cada 23h  (Paso 2)
//  - Verificación CNAME pendientes cada 60s  (Paso 10 — stub)
import cron from 'node-cron';
import { refreshAllTenantTokens } from './refresh-tokens.js';
import { verifyPendingCnames } from './cname-verify.js';

let started = false;

export function startJobs() {
  if (started) return;
  started = true;

  // ---- Refresh tokens GHL cada 23h ----
  // Se ejecuta a los 0 minutos cada 23 horas (00:00, 23:00, 22:00...).
  // GHL access_token expira en 24h, así que con 23h tenemos margen seguro.
  cron.schedule('0 */23 * * *', async () => {
    try {
      await refreshAllTenantTokens();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[cron:refresh-tokens] error:', err.message);
    }
  });

  // ---- Verificación CNAME pendientes cada 60s (Paso 10) ----
  // DNS lookup contra los dominios con cname_verificado=false. Marca como
  // verificado cuando el CNAME resuelve correctamente a listings.{APP_DOMAIN}.
  cron.schedule('*/1 * * * *', async () => {
    try {
      await verifyPendingCnames();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[cron:cname-verify] error:', err.message);
    }
  });

  // eslint-disable-next-line no-console
  console.log('[jobs] schedulers iniciados (refresh-tokens 23h, cname-verify 60s)');
}

// Permite forzar un refresh manualmente desde un script o un endpoint admin.
export { refreshAllTenantTokens };
