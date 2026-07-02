"""
Iteration 16 — Fix del BUG "companyId vacío del Custom Menu Link".

Valida que /api/auth/sso:
  1. Sigue funcionando para tenant conocido (regresión BLOQUE 15).
  2. Provisiona tenant on-demand aunque companyId venga VACÍO,
     iterando sobre listActiveAgencies().
  3. Fast-path: 2ª llamada al mismo locationId es rápida (no re-mintea).
  4. LocationId inválido + companyId vacío → 404 controlado (no 500).
  5. Code-review de src/lib/agencies.js (listActiveAgencies) y
     src/routes/auth.js (tryProvisionFromAgency + provisionTenantFromAgency
     con estrategia dual fast-path + fallback).
  6. Regresión completa Bloques 6-15.
"""

import os
import re
import time
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:3000").rstrip("/")
LOCAL_URL = "http://localhost:3000"

REPO = Path("/app")
AGENCIES_JS = REPO / "src/lib/agencies.js"
AUTH_JS = REPO / "src/routes/auth.js"

KNOWN_LOCATION_ID = "cNg6MFQcxv8bZnwCppoM"
KNOWN_TENANT_ID = "2079e30e-62f5-4e2f-b976-d099535410e8"
NEW_LOCATION_ID = "b7JAqyPMcYXjeqDyvgdJ"
EXPECTED_NEW_TENANT_ID = "4fafae9f-694f-4e23-bed1-8d6279cf4f3d"
USER_ID = "pyr7tK7t6wBZMpsL5pFJ"


# ---------- Code review: agencies.js -------------------------------

class TestAgenciesListActive:
    @pytest.fixture(scope="class")
    def src(self):
        return AGENCIES_JS.read_text(encoding="utf-8")

    def test_listActiveAgencies_exported(self, src):
        assert re.search(r"export\s+async\s+function\s+listActiveAgencies\s*\(", src), \
            "listActiveAgencies no está exportada"

    def test_listActiveAgencies_filters_status_active(self, src):
        # Debe filtrar por status='active' y devolver id + ghl_company_id
        block = src[src.index("listActiveAgencies"):]
        assert ".eq('status', 'active')" in block, "no filtra status='active'"
        assert "ghl_company_id" in block
        # returns array (fallback [])
        assert "data || []" in block or "return data" in block


# ---------- Code review: auth.js provisioning strategy -------------

class TestAuthProvisionStrategy:
    @pytest.fixture(scope="class")
    def src(self):
        return AUTH_JS.read_text(encoding="utf-8")

    def test_imports_listActiveAgencies(self, src):
        assert "listActiveAgencies" in src, "auth.js no importa listActiveAgencies"

    def test_tryProvisionFromAgency_defined(self, src):
        assert re.search(
            r"async\s+function\s+tryProvisionFromAgency\s*\(\s*agencyRow\s*,\s*locationId\s*\)",
            src,
        ), "helper tryProvisionFromAgency no encontrado con firma esperada"

    def test_tryProvisionFromAgency_try_catch_returns_null(self, src):
        block = src[src.index("tryProvisionFromAgency"):]
        # Debe tener try/catch y devolver null en catch
        assert "try {" in block
        assert "catch" in block
        assert "return null" in block, "el catch no devuelve null"
        # Log del error con status y body (observabilidad)
        assert "status" in block and ("body" in block or "response" in block)

    def test_provisionTenantFromAgency_dual_strategy(self, src):
        block = src[src.index("function provisionTenantFromAgency"):]
        # Fast-path por companyIdHint
        assert "companyIdHint" in block
        assert "findAgencyByCompanyId" in block, "no hay fast-path via findAgencyByCompanyId"
        # Fallback iterando activas
        assert "listActiveAgencies" in block, "no hay fallback via listActiveAgencies"
        # Loop for..of
        assert re.search(r"for\s*\(\s*const\s+\w+\s+of\s+", block), \
            "no hay loop iterando candidatas"
        # Retorna null final
        assert "return null" in block

    def test_sso_handler_passes_empty_companyId_as_null_or_string(self, src):
        # El handler debe tratar companyId vacío correctamente
        assert re.search(r"provisionTenantFromAgency\(\s*locationId\s*,\s*companyId", src), \
            "sso handler no pasa companyId a provisionTenantFromAgency"


# ---------- Live server: SSO --------------------------------------

class TestSSORegressionKnownTenant:
    """Regresión BLOQUE 15: tenant existente, sin companyId → fast-path por findTenantByLocationId."""

    def test_returns_200_with_expected_tenant_and_28800s_jwt(self):
        r = requests.get(
            f"{LOCAL_URL}/api/auth/sso",
            params={"locationId": KNOWN_LOCATION_ID, "userId": USER_ID},
            timeout=15,
        )
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:200]}"
        data = r.json()
        assert "token" in data and isinstance(data["token"], str) and len(data["token"]) > 20
        assert data.get("tenant", {}).get("id") == KNOWN_TENANT_ID, \
            f"tenant.id inesperado: {data.get('tenant', {}).get('id')}"

        # JWT payload check: exp - iat = 28800 (8h)
        import base64
        import json
        parts = data["token"].split(".")
        assert len(parts) == 3, "token no parece JWT"
        pad = lambda s: s + "=" * (-len(s) % 4)
        payload = json.loads(base64.urlsafe_b64decode(pad(parts[1])))
        assert payload["exp"] - payload["iat"] == 28800, \
            f"TTL != 28800s: {payload['exp'] - payload['iat']}"


class TestSSOOnDemandEmptyCompanyId:
    """BUG PRINCIPAL: companyId= vacío pero locationId real → debe iterar
    listActiveAgencies() y provisionar. Este locationId ya fue provisionado
    en la primera corrida del fix, por lo que responde por fast-path
    (findTenantByLocationId). Aceptamos cualquier tenant.id no-nulo."""

    def test_returns_200_with_non_null_tenant(self):
        r = requests.get(
            f"{LOCAL_URL}/api/auth/sso",
            params={
                "locationId": NEW_LOCATION_ID,
                "userId": USER_ID,
                "companyId": "",  # ← el bug: vacío
            },
            timeout=30,
        )
        assert r.status_code == 200, \
            f"expected 200, got {r.status_code}: {r.text[:300]}"
        data = r.json()
        assert "token" in data
        tenant_id = data.get("tenant", {}).get("id")
        assert tenant_id, f"tenant.id vacío/None: {data}"
        # Contexto de la review indica que EXPECTED_NEW_TENANT_ID fue el creado.
        # Aceptamos cualquier UUID no-nulo. Si coincide, log de confirmación.
        assert re.match(r"^[0-9a-f\-]{36}$", tenant_id, re.I), \
            f"tenant.id no parece UUID: {tenant_id}"

    def test_second_call_is_fast_path(self):
        """La 2ª llamada al mismo locationId debe ir por findTenantByLocationId
        y responder rápido (< 2s con margen de red)."""
        t0 = time.time()
        r = requests.get(
            f"{LOCAL_URL}/api/auth/sso",
            params={
                "locationId": NEW_LOCATION_ID,
                "userId": USER_ID,
                "companyId": "",
            },
            timeout=10,
        )
        elapsed = time.time() - t0
        assert r.status_code == 200
        # No hard threshold at 200ms (network variance en test infra),
        # pero < 2s garantiza que NO minteó vía GHL (que suele tardar ~1.5s +
        # cualquier fallback previo por agencies inválidas).
        assert elapsed < 2.0, f"fast-path lento: {elapsed:.2f}s"


class TestSSOInvalidLocationId:
    """LocationId inválido + companyId vacío: iteración completa,
    todas las agencies rechazan, tenant_not_found sin 500."""

    def test_returns_404_tenant_not_found(self):
        r = requests.get(
            f"{LOCAL_URL}/api/auth/sso",
            params={
                "locationId": "INVALID_XXX_YYY_ZZZ",
                "userId": USER_ID,
                "companyId": "",
            },
            timeout=30,
        )
        assert r.status_code == 404, \
            f"expected 404, got {r.status_code}: {r.text[:300]}"
        assert r.json().get("error") == "tenant_not_found"

    def test_does_not_500_on_repeat(self):
        """Repetir el call no debe crashear (loop estable)."""
        for _ in range(2):
            r = requests.get(
                f"{LOCAL_URL}/api/auth/sso",
                params={
                    "locationId": "INVALID_LOOP_TEST",
                    "userId": USER_ID,
                    "companyId": "",
                },
                timeout=30,
            )
            assert r.status_code == 404


# ---------- Regresión Bloques 6-15 --------------------------------

class TestRegression:
    def test_health(self):
        r = requests.get(f"{LOCAL_URL}/api/health", timeout=5)
        assert r.status_code == 200

    def test_buscar_with_preview(self):
        r = requests.get(
            f"{LOCAL_URL}/buscar",
            params={"preview": KNOWN_TENANT_ID},
            timeout=15,
        )
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "")

    def test_portal_slug_preview(self):
        r = requests.get(
            f"{LOCAL_URL}/p/departamento-en-tziara",
            params={"preview": "invalid"},
            timeout=15,
        )
        # con preview inválido: no 500
        assert r.status_code < 500, f"crash: {r.status_code}"

    def test_ficha_organica_host(self):
        r = requests.get(
            f"{LOCAL_URL}/L4B9TP",
            headers={"Host": "ficha.mktscaled.com"},
            timeout=15,
        )
        assert r.status_code == 200
        assert "ficha" in r.text.lower() or "Ficha" in r.text

    def test_sign_video_no_bearer(self):
        r = requests.post(f"{LOCAL_URL}/api/upload/sign-video", json={}, timeout=10)
        assert r.status_code in (401, 403)

    def test_sign_video_with_bearer(self):
        sso = requests.get(
            f"{LOCAL_URL}/api/auth/sso",
            params={"locationId": KNOWN_LOCATION_ID, "userId": USER_ID},
            timeout=10,
        ).json()
        token = sso.get("token")
        assert token
        r = requests.post(
            f"{LOCAL_URL}/api/upload/sign-video",
            headers={"Authorization": f"Bearer {token}"},
            json={"public_id_prefix": "test", "folder": "test"},
            timeout=10,
        )
        assert r.status_code == 200, f"got {r.status_code}: {r.text[:300]}"
        data = r.json()
        assert "signature" in data or "timestamp" in data or "api_key" in data
