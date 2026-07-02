// OAuth 2.0 GoHighLevel — Paso 2.
// Montado a nivel raíz como /auth (NO /api/auth) porque el Redirect URI
// configurado en GHL es https://panel.mktscaled.com/auth/callback
import { Router } from 'express';
import crypto from 'node:crypto';

import { getAuthorizeUrl, exchangeCodeForToken } from '../lib/ghl.js';
import { upsertTenantFromOAuth } from '../lib/tenants.js';
import { upsertAgencyFromOAuth } from '../lib/agencies.js';

const r = Router();

/** Log seguro: nunca imprime tokens ni secretos. Sólo el "shape" del response
 *  (keys presentes) + valores no sensibles como companyId, locationId, scope. */
function logOAuthShape(prefix, tokenResp) {
  if (!tokenResp || typeof tokenResp !== 'object') {
    console.log(`[${prefix}] response no-object:`, tokenResp);
    return;
  }
  const SENSITIVE = new Set(['access_token', 'refresh_token', 'id_token']);
  const shape = {};
  for (const [k, v] of Object.entries(tokenResp)) {
    if (SENSITIVE.has(k)) {
      shape[k] = typeof v === 'string' ? `<redacted ${v.length}ch>` : '<redacted>';
    } else {
      shape[k] = v;
    }
  }
  console.log(`[${prefix}] response keys=[${Object.keys(tokenResp).join(',')}]`, shape);
}

// GET /auth  -> inicia el flow OAuth (redirige al chooselocation de GHL)
r.get('/', (_req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  // State opcional para Marketplace apps de GHL; lo enviamos como
  // defensa en profundidad. No lo validamos en el callback (la integridad
  // del flow la garantiza el redirect_uri registrado en GHL).
  res.redirect(getAuthorizeUrl(state));
});

// GET /auth/callback  -> recibe el code, intercambia por tokens y persiste.
r.get('/callback', async (req, res) => {
  const { code, error: oauthError, error_description } = req.query;

  if (oauthError) {
    return res.status(400).send(
      renderHtml('Error de autorización', `<p>GHL devolvió: <code>${escapeHtml(String(oauthError))}</code>.</p>
       <p>${escapeHtml(String(error_description || ''))}</p>`)
    );
  }
  if (!code) {
    return res.status(400).send(renderHtml('Faltó el parámetro <code>code</code>', '<p>Reintenta la instalación desde el Marketplace.</p>'));
  }

  try {
    const tokenResp = await exchangeCodeForToken(String(code));
    logOAuthShape('oauth/callback', tokenResp);

    const locationId = tokenResp.locationId || tokenResp.location_id;
    const companyId  = tokenResp.companyId  || tokenResp.company_id;

    // Caso A — instalación a nivel Location (sub-cuenta): flujo normal.
    if (locationId) {
      const tenant = await upsertTenantFromOAuth(tokenResp);
      return res.send(
        renderHtml(
          '¡Instalación exitosa!',
          `<p>Tu cuenta de GoHighLevel quedó conectada.</p>
           <p><strong>Location ID:</strong> <code>${escapeHtml(tenant.ghl_location_id)}</code></p>
           <p>Ya puedes cerrar esta ventana y abrir el menú lateral desde GHL.</p>`
        )
      );
    }

    // Caso B — instalación a nivel Agency (Company): guardamos el token de
    // agencia y esperamos a que un agente abra el panel desde una sub-cuenta.
    // En ese momento el SSO mintará el location token on-demand.
    if (companyId) {
      const agency = await upsertAgencyFromOAuth(tokenResp);
      console.log('[oauth/callback] agency install ok, companyId=%s agencyId=%s', companyId, agency.id);
      return res.send(
        renderHtml(
          '¡Instalación de agencia lista!',
          `<p>Conectaste la app <strong>a nivel agencia</strong> (Company).</p>
           <p><strong>Company ID:</strong> <code>${escapeHtml(companyId)}</code></p>
           <p>Ahora, dentro de cualquier sub-cuenta donde quieras usar la app, abre <em>Listings</em> desde el menú lateral. La primera vez que un agente entre, activamos automáticamente esa sub-cuenta.</p>
           <p style="color:#64748b;font-size:14px">No hace falta reinstalar por cada sub-cuenta.</p>`
        )
      );
    }

    // Caso C — GHL no devolvió ninguno. Reportamos el shape para diagnóstico.
    console.error('[oauth/callback] response sin locationId ni companyId. Keys:', Object.keys(tokenResp));
    return res.status(400).send(
      renderHtml(
        'No pudimos completar la instalación',
        `<p>GoHighLevel no devolvió <code>locationId</code> ni <code>companyId</code> en la respuesta.</p>
         <p>Contacta a soporte con estos datos:</p>
         <pre>${escapeHtml(JSON.stringify(Object.keys(tokenResp), null, 2))}</pre>`
      )
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[oauth/callback]', err?.response?.data || err);
    const detail = err?.response?.data
      ? JSON.stringify(err.response.data, null, 2)
      : err.message;
    return res
      .status(500)
      .send(renderHtml('No pudimos completar la instalación', `<pre>${escapeHtml(detail)}</pre>`));
  }
});

// ---------------------------------------------------------------------
// Helpers de respuesta HTML (página simple post-install)
// ---------------------------------------------------------------------
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderHtml(title, body) {
  return `<!doctype html><html lang="es"><head>
<meta charset="utf-8"><title>${escapeHtml(title)} — mktscaled</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:8vh auto;padding:24px;color:#111}
  h1{font-size:22px;margin:0 0 16px}
  code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:14px}
  pre{background:#0b1020;color:#d6e0ff;padding:12px;border-radius:6px;overflow:auto}
</style></head>
<body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
}

export default r;
