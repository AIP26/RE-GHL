// Unit tests for refresh-tokens cron job — 4 scenarios post Iter 20 fix.
// Run: node --test src/jobs/refresh-tokens.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshAllTenantTokens } from './refresh-tokens.js';

const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };

/** Construye una tabla de deps mockeadas con estado observable. */
function buildDeps({ tenants = [], agencies = [], ghl = {} } = {}) {
  const state = {
    tenants: tenants.map((t) => ({ ...t })),
    agencies: agencies.map((a) => ({ ...a })),
    tenantUpdates: {},
    agencyUpdates: {},
    needsReauth: [],
  };
  const deps = {
    // GHL — el caller pasa {refresh: fn(rt)->tokens, mint: fn(at,cid,lid)->tokens}
    refreshAccessToken: ghl.refresh || (async () => { throw new Error('mock: refresh not stubbed'); }),
    mintLocationToken: ghl.mint || (async () => { throw new Error('mock: mint not stubbed'); }),

    // Tenants
    listRefreshableTenants: async () => state.tenants,
    updateTenantTokens: async (id, tokens) => { state.tenantUpdates[id] = tokens; },
    markNeedsReauth: async (id) => { state.needsReauth.push(id); },

    // Agencies
    listActiveAgencies: async () => state.agencies.map((a) => ({ id: a.id, ghl_company_id: a.ghl_company_id, status: 'active' })),
    getAgencyWithTokens: async (id) => {
      const a = state.agencies.find((x) => x.id === id);
      return {
        id: a.id,
        ghl_company_id: a.ghl_company_id,
        access_token: a.access_token,
        refresh_token_plain: a.refresh_token,
      };
    },
    updateAgencyTokens: async (id, tokens) => {
      state.agencyUpdates[id] = tokens;
      const a = state.agencies.find((x) => x.id === id);
      if (a) { a.access_token = tokens.access_token; a.refresh_token = tokens.refresh_token; }
    },

    // Encryption — para tests pasamos refresh_token en claro y decrypt = identity
    decrypt: (s) => s,
  };
  return { deps, state };
}

test('(i) refresh tenant OK — no fallback needed', async () => {
  const { deps, state } = buildDeps({
    tenants: [{ id: 'T1', ghl_location_id: 'LOC1', oauth_token: 'AT1', refresh_token: 'RT1', agency_id: null }],
    agencies: [],
    ghl: {
      refresh: async (rt) => {
        assert.equal(rt, 'RT1');
        return { access_token: 'AT1-new', refresh_token: 'RT1-new' };
      },
    },
  });
  const result = await refreshAllTenantTokens({ logger: silentLogger, deps });
  assert.equal(result.ok, 1);
  assert.equal(result.mintedFallback, 0);
  assert.equal(result.failed, 0);
  assert.deepEqual(state.tenantUpdates.T1, { access_token: 'AT1-new', refresh_token: 'RT1-new' });
  assert.deepEqual(state.needsReauth, []);
});

test('(ii) refresh tenant fail + mint OK — fallback exitoso', async () => {
  const { deps, state } = buildDeps({
    tenants: [{ id: 'T1', ghl_location_id: 'LOC1', oauth_token: 'AT1', refresh_token: 'RT1', agency_id: 'A1' }],
    agencies: [{ id: 'A1', ghl_company_id: 'COMP1', access_token: 'AAT1', refresh_token: 'ART1' }],
    ghl: {
      refresh: async (rt) => {
        if (rt === 'ART1') return { access_token: 'AAT1-new', refresh_token: 'ART1-new' };
        // Simula "Invalid client credentials" al refrescar el tenant
        const err = new Error('unauth');
        err.response = { status: 401, data: { error: 'UnAuthorized!', error_description: 'Invalid client credentials!' } };
        throw err;
      },
      mint: async (at, cid, lid) => {
        assert.equal(at, 'AAT1-new'); // Usa el agency token FRESCO
        assert.equal(cid, 'COMP1');
        assert.equal(lid, 'LOC1');
        return { access_token: 'MINTED-AT', refresh_token: 'MINTED-RT' };
      },
    },
  });
  const result = await refreshAllTenantTokens({ logger: silentLogger, deps });
  assert.equal(result.ok, 0);
  assert.equal(result.mintedFallback, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(state.tenantUpdates.T1, { access_token: 'MINTED-AT', refresh_token: 'MINTED-RT' });
  assert.deepEqual(state.needsReauth, []);
  // Agency también refrescada:
  assert.equal(state.agencyUpdates.A1.access_token, 'AAT1-new');
});

test('(iii) refresh tenant fail + mint fail → needs_reauth', async () => {
  const { deps, state } = buildDeps({
    tenants: [{ id: 'T1', ghl_location_id: 'LOC1', oauth_token: 'AT1', refresh_token: 'RT1', agency_id: 'A1' }],
    agencies: [{ id: 'A1', ghl_company_id: 'COMP1', access_token: 'AAT1', refresh_token: 'ART1' }],
    ghl: {
      refresh: async (rt) => {
        if (rt === 'ART1') return { access_token: 'AAT1-new', refresh_token: 'ART1-new' };
        const err = new Error('unauth');
        err.response = { status: 401, data: { error_description: 'Invalid client credentials!' } };
        throw err;
      },
      mint: async () => {
        // Simula que la agency tampoco puede mintear (no autoriza la location)
        const err = new Error('forbidden');
        err.response = { status: 403, data: { error: 'forbidden' } };
        throw err;
      },
    },
  });
  const result = await refreshAllTenantTokens({ logger: silentLogger, deps });
  assert.equal(result.ok, 0);
  assert.equal(result.mintedFallback, 0);
  assert.equal(result.failed, 1);
  assert.deepEqual(state.needsReauth, ['T1']);
});

test('(iv) refresh agency OK — pool queda con token fresco', async () => {
  const { deps, state } = buildDeps({
    tenants: [], // sin tenants, sólo verificamos que agencies se refrescan
    agencies: [
      { id: 'A1', ghl_company_id: 'COMP1', access_token: 'OLD-AT1', refresh_token: 'RT1' },
      { id: 'A2', ghl_company_id: 'COMP2', access_token: 'OLD-AT2', refresh_token: 'RT2' },
    ],
    ghl: {
      refresh: async (rt) => {
        if (rt === 'RT1') return { access_token: 'NEW-AT1', refresh_token: 'NEW-RT1' };
        if (rt === 'RT2') return { access_token: 'NEW-AT2', refresh_token: 'NEW-RT2' };
        throw new Error('unexpected rt');
      },
    },
  });
  const result = await refreshAllTenantTokens({ logger: silentLogger, deps });
  assert.equal(result.agencies.ok, 2);
  assert.equal(result.agencies.failed, 0);
  assert.equal(state.agencyUpdates.A1.access_token, 'NEW-AT1');
  assert.equal(state.agencyUpdates.A2.access_token, 'NEW-AT2');
});

test('(v extra) agency refresh falla pero pool mantiene AT actual — mint sigue funcionando', async () => {
  // Escenario real del diagnóstico: config bug hace que refreshAccessToken
  // devuelva "Invalid client credentials" para AGENCY tokens también.
  // Debemos poder seguir minteando con el AT actual de la agency.
  const { deps, state } = buildDeps({
    tenants: [{ id: 'T1', ghl_location_id: 'LOC1', oauth_token: 'AT1', refresh_token: 'RT1', agency_id: 'A1' }],
    agencies: [{ id: 'A1', ghl_company_id: 'COMP1', access_token: 'AAT-ACTUAL', refresh_token: 'ART1' }],
    ghl: {
      refresh: async () => {
        // Todos los refresh fallan (config bug)
        const err = new Error('unauth');
        err.response = { status: 401, data: { error_description: 'Invalid client credentials!' } };
        throw err;
      },
      mint: async (at, cid, lid) => {
        // El mint SIGUE FUNCIONANDO con el agency AT actual
        assert.equal(at, 'AAT-ACTUAL');
        assert.equal(lid, 'LOC1');
        return { access_token: 'MINTED-AT', refresh_token: 'MINTED-RT' };
      },
    },
  });
  const result = await refreshAllTenantTokens({ logger: silentLogger, deps });
  assert.equal(result.mintedFallback, 1, 'Aun con agency refresh roto, mint funciona');
  assert.equal(result.failed, 0);
  assert.equal(result.agencies.failed, 1);
  assert.equal(state.tenantUpdates.T1.access_token, 'MINTED-AT');
  assert.deepEqual(state.needsReauth, []);
});

test('(vi extra) tenant sin agencies disponibles → needs_reauth inmediato', async () => {
  const { deps, state } = buildDeps({
    tenants: [{ id: 'T1', ghl_location_id: 'LOC1', oauth_token: 'AT1', refresh_token: 'RT1', agency_id: null }],
    agencies: [],
    ghl: {
      refresh: async () => {
        const err = new Error('unauth');
        err.response = { status: 401, data: { error_description: 'Invalid client credentials!' } };
        throw err;
      },
    },
  });
  const result = await refreshAllTenantTokens({ logger: silentLogger, deps });
  assert.equal(result.failed, 1);
  assert.deepEqual(state.needsReauth, ['T1']);
});

test('(vii extra) prioridad de agency por FK — agency_id se prueba primero', async () => {
  // Dos agencies en el pool. Sólo A2 autoriza la location, pero A1 va primera
  // en la iteración. Con agency_id=A2, debe ser probada primero (fast path).
  let firstMintAgencyId = null;
  const { deps, state } = buildDeps({
    tenants: [{ id: 'T1', ghl_location_id: 'LOC1', oauth_token: 'AT1', refresh_token: 'RT1', agency_id: 'A2' }],
    agencies: [
      { id: 'A1', ghl_company_id: 'COMP1', access_token: 'AAT1', refresh_token: 'ART1' },
      { id: 'A2', ghl_company_id: 'COMP2', access_token: 'AAT2', refresh_token: 'ART2' },
    ],
    ghl: {
      refresh: async (rt) => ({ access_token: 'new-' + rt, refresh_token: 'newrt-' + rt }),
      mint: async (at, cid, lid) => {
        if (!firstMintAgencyId) firstMintAgencyId = cid;
        // Sólo A2 autoriza
        if (cid !== 'COMP2') { const err = new Error('403'); err.response = { status: 403 }; throw err; }
        return { access_token: 'MINTED-AT', refresh_token: 'MINTED-RT' };
      },
    },
  });
  // Forzamos fallar refresh tenant para activar mint fallback
  deps.refreshAccessToken = async (rt) => {
    if (rt === 'RT1') { const e = new Error('u'); e.response = { status: 401 }; throw e; }
    return { access_token: 'new-' + rt, refresh_token: 'newrt-' + rt };
  };
  const result = await refreshAllTenantTokens({ logger: silentLogger, deps });
  assert.equal(result.mintedFallback, 1);
  assert.equal(firstMintAgencyId, 'COMP2', 'agency FK-linked debe ser la primera intentada');
});

test('(viii Iter 23) tenant en needs_reauth se rescata vía mint y vuelve a active', async () => {
  // Escenario real del bug de Iter 23: el tenant está status='needs_reauth'
  // desde el arranque. El cron nuevo debe procesarlo (listRefreshableTenants),
  // fallar el refresh directo, tener éxito con mint via agency, y regresarlo
  // a status='active' (updateTenantTokens setea status automáticamente —
  // aquí solo verificamos el conteo `recoveredFromReauth`).
  const { deps, state } = buildDeps({
    tenants: [{
      id: 'T-STUCK', ghl_location_id: 'LOC-STUCK', oauth_token: 'AT', refresh_token: 'RT',
      status: 'needs_reauth', agency_id: 'A1',
    }],
    agencies: [{ id: 'A1', ghl_company_id: 'COMP1', access_token: 'AAT', refresh_token: 'ART' }],
    ghl: {
      refresh: async (rt) => {
        if (rt === 'ART') return { access_token: 'AAT-new', refresh_token: 'ART-new' };
        // Tenant refresh_token está muerto (por eso estaba needs_reauth)
        const err = new Error('u'); err.response = { status: 401, data: { error_description: 'Invalid refresh token' } }; throw err;
      },
      mint: async (at, cid, lid) => {
        return { access_token: 'RESCUED-AT', refresh_token: 'RESCUED-RT' };
      },
    },
  });
  const result = await refreshAllTenantTokens({ logger: silentLogger, deps });
  assert.equal(result.mintedFallback, 1, 'mint fallback debió ejecutarse');
  assert.equal(result.recoveredFromReauth, 1, 'debió contar como recuperado de needs_reauth');
  assert.equal(result.failed, 0);
  assert.deepEqual(state.tenantUpdates['T-STUCK'], { access_token: 'RESCUED-AT', refresh_token: 'RESCUED-RT' });
  assert.deepEqual(state.needsReauth, []);
});

test('(ix Iter 23) tenant active y needs_reauth en el mismo run se procesan ambos', async () => {
  const { deps, state } = buildDeps({
    tenants: [
      { id: 'T-ACTIVE', ghl_location_id: 'LOC-A', oauth_token: 'AT-A', refresh_token: 'RT-A', status: 'active', agency_id: null },
      { id: 'T-REAUTH', ghl_location_id: 'LOC-R', oauth_token: 'AT-R', refresh_token: 'RT-R', status: 'needs_reauth', agency_id: 'A1' },
    ],
    agencies: [{ id: 'A1', ghl_company_id: 'C1', access_token: 'AAT', refresh_token: 'ART' }],
    ghl: {
      refresh: async (rt) => {
        if (rt === 'ART') return { access_token: 'AAT-new', refresh_token: 'ART-new' };
        if (rt === 'RT-A') return { access_token: 'AT-A-new', refresh_token: 'RT-A-new' };
        // RT-R muerto → cae al fallback
        const err = new Error('u'); err.response = { status: 401 }; throw err;
      },
      mint: async () => ({ access_token: 'RESCUED', refresh_token: 'RESCUED-RT' }),
    },
  });
  const result = await refreshAllTenantTokens({ logger: silentLogger, deps });
  assert.equal(result.ok, 1);              // T-ACTIVE
  assert.equal(result.mintedFallback, 1);  // T-REAUTH
  assert.equal(result.recoveredFromReauth, 1);  // sólo T-REAUTH cuenta como recuperado
  assert.equal(result.total, 2);
});
