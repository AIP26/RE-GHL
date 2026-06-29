// Scheduler de jobs con node-cron.
//  - Refresh tokens GHL cada 23h
//  - Verificación CNAME pendientes cada 60s
// Implementación detallada en Pasos 2 y 10.
import cron from 'node-cron';

export function startJobs() {
  // Paso 2: refresh tokens cada 23h.  (placeholder)
  cron.schedule('0 */23 * * *', () => {
    // TODO: iterar tenants y refrescar access tokens; si falla -> status=needs_reauth
  });

  // Paso 10: verificar CNAMEs pendientes cada 60s. (placeholder)
  cron.schedule('*/1 * * * *', () => {
    // TODO: dns.resolveCname para dominios donde cname_verificado=false
  });
}
