// Scheduler de jobs con node-cron.
//  - Refresh tokens GHL cada 23h  (Paso 2)
//  - Verificación CNAME pendientes cada 60s  (Paso 10 — stub)
import cron from 'node-cron';
import { refreshAllTenantTokens } from './refresh-tokens.js';

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
  cron.schedule('*/1 * * * *', () => {
    // TODO Paso 10: dns.resolveCname para dominios con cname_verificado=false
  });

  // eslint-disable-next-line no-console
  console.log('[jobs] schedulers iniciados (refresh-tokens 23h, cname-verify 60s)');
}

// Permite forzar un refresh manualmente desde un script o un endpoint admin.
export { refreshAllTenantTokens };
