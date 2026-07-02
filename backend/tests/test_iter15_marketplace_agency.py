"""
Iteration 15 (Marketplace/Agency install) — pytest suite.

Cubre:
  1. Code-review de /app/src/routes/oauth.js (logging redactado + branch).
  2. SSO regresión con locationId conocido.
  3. SSO 404 sin companyId, tenant desconocido.
  4. SSO 404 con companyId y tabla `agencies` inexistente (no debe 500).
  5. Panel forwards companyId en las 2 llamadas a /auth/sso.
  6. mintLocationToken firma correcta en /app/src/lib/ghl.js.
  7. Migration SQL step15 con schema esperado.
  8. agencies.js helpers exports.
  9. Server health.
 10. Regresión: /buscar, /p/:slug preview, /L4B9TP con Host ficha, /api/upload/sign-video.
"""

import base64
import json
import os
import re
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:3000").rstrip("/")
LOCAL_URL = "http://localhost:3000"

REPO = Path("/app")
OAUTH_JS = REPO / "src/routes/oauth.js"
AUTH_JS = REPO / "src/routes/auth.js"
GHL_JS = REPO / "src/lib/ghl.js"
AGENCIES_JS = REPO / "src/lib/agencies.js"
MIGRATION_SQL = REPO / "sql/migration_step15_agencies.sql"
PANEL_JS = REPO / "public/panel/app.js"

LOCATION_ID = "cNg6MFQcxv8bZnwCppoM"
USER_ID = "pyr7tK7t6wBZMpsL5pFJ"
EXPECTED_TENANT_ID = "2079e30e-62f5-4e2f-b976-d099535410e8"


# ---------- Code review: oauth.js -----------------------------------

class TestOAuthCallbackCode:
    """Verifica callback OAuth por lectura de código."""

    @pytest.fixture(scope="class")
    def src(self):
        return OAUTH_JS.read_text(encoding="utf-8")

    def test_logOAuthShape_exists_and_redacts(self, src):
        # función definida
        assert re.search(r"function\s+logOAuthShape\s*\(\s*prefix\s*,\s*tokenResp\s*\)", src), \
            "logOAuthShape(prefix, tokenResp) no encontrada"
        # redacta los tres sensibles
        for tok in ["access_token", "refresh_token", "id_token"]:
            assert f"'{tok}'" in src, f"logOAuthShape no incluye {tok} en SENSITIVE"
        # muestra length (redacted Nch)
        assert "redacted" in src and ".length" in src

    def test_callback_calls_logOAuthShape_before_branch(self, src):
        # aparece la invocación con el prefijo correcto
        assert "logOAuthShape('oauth/callback'" in src
        # ubicación: antes de leer locationId/companyId
        idx_log = src.index("logOAuthShape('oauth/callback'")
        idx_loc = src.index("tokenResp.locationId")
        assert idx_log < idx_loc, "logOAuthShape debe llamarse antes del branch"

    def test_branch_locationId_calls_upsertTenant(self, src):
        assert "upsertTenantFromOAuth(tokenResp)" in src
        assert "if (locationId)" in src

    def test_branch_companyId_calls_upsertAgency_with_agency_html(self, src):
        assert "upsertAgencyFromOAuth(tokenResp)" in src
        assert "if (companyId)" in src
        assert "Instalación de agencia" in src

    def test_branch_none_returns_400_with_keys(self, src):
        # 400 + keys del response en pre
        assert ".status(400)" in src
        assert "Object.keys(tokenResp)" in src
        # el response HTML incluye JSON de keys
        assert "JSON.stringify(Object.keys(tokenResp)" in src


# ---------- SSO endpoint --------------------------------------------

class TestSSO:
    def test_sso_known_tenant_returns_token(self):
        r = requests.get(
            f"{LOCAL_URL}/api/auth/sso",
            params={"locationId": LOCATION_ID, "userId": USER_ID},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "token" in data
        assert "agente" in data
        assert data["tenant"]["id"] == EXPECTED_TENANT_ID
        # JWT exp - iat = 28800s (8h)
        payload_b64 = data["token"].split(".")[1]
        # padding
        payload_b64 += "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        assert payload["exp"] - payload["iat"] == 28800, \
            f"expected 28800s TTL, got {payload['exp'] - payload['iat']}"

    def test_sso_unknown_tenant_no_company_returns_404(self):
        r = requests.get(
            f"{LOCAL_URL}/api/auth/sso",
            params={"locationId": "UNKNOWN_LOC", "userId": "UNKNOWN"},
            timeout=10,
        )
        assert r.status_code == 404
        assert r.json().get("error") == "tenant_not_found"

    def test_sso_unknown_tenant_with_companyId_graceful_404(self):
        """La tabla agencies no existe aún — el catch dentro del handler debe
        absorber el error PGRST205 y devolver 404, NO 500."""
        r = requests.get(
            f"{LOCAL_URL}/api/auth/sso",
            params={
                "locationId": "UNKNOWN_LOC",
                "userId": "UNKNOWN",
                "companyId": "FAKE_CO",
            },
            timeout=15,
        )
        assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text[:300]}"
        assert r.json().get("error") == "tenant_not_found"


# ---------- Panel forwards companyId --------------------------------

class TestPanelForwardsCompanyId:
    @pytest.fixture(scope="class")
    def src(self):
        return PANEL_JS.read_text(encoding="utf-8")

    def test_reAuthFromUrl_reads_and_forwards_companyId(self, src):
        # bloque cerca a la línea 19-35 (reAuthFromUrl)
        # Detectamos los patrones directamente
        occurrences = re.findall(r"params\.get\(['\"]companyId['\"]\)", src)
        assert len(occurrences) >= 2, \
            f"expected >=2 params.get('companyId') calls (bootstrap + reAuth), got {len(occurrences)}"
        # cada uno agrega a qs sólo si presente
        set_patterns = re.findall(
            r"if\s*\(\s*companyId\s*\)\s*qs\.set\(['\"]companyId['\"]\s*,\s*companyId\s*\)",
            src,
        )
        assert len(set_patterns) >= 2, \
            f"expected >=2 conditional qs.set(companyId), got {len(set_patterns)}"


# ---------- mintLocationToken --------------------------------------

class TestMintLocationTokenHelper:
    @pytest.fixture(scope="class")
    def src(self):
        return GHL_JS.read_text(encoding="utf-8")

    def test_export_and_signature(self, src):
        m = re.search(
            r"export\s+async\s+function\s+mintLocationToken\s*\(\s*agencyAccessToken\s*,\s*companyId\s*,\s*locationId\s*\)",
            src,
        )
        assert m, "mintLocationToken(agencyAccessToken, companyId, locationId) no encontrada"

    def test_posts_to_correct_url(self, src):
        assert "https://services.leadconnectorhq.com/oauth/locationToken" in src

    def test_headers_correct(self, src):
        # Extrae la función completa
        start = src.index("export async function mintLocationToken")
        end = src.index("\nexport ", start + 1) if src.find("\nexport ", start + 1) != -1 else start + 2000
        block = src[start:end]
        assert "Authorization" in block and "Bearer" in block
        assert "application/x-www-form-urlencoded" in block
        assert "Version" in block and "2021-07-28" in block

    def test_body_form_urlencoded(self, src):
        start = src.index("export async function mintLocationToken")
        block = src[start:start + 1500]
        # body incluye companyId y locationId
        assert "URLSearchParams" in block
        assert "companyId" in block and "locationId" in block


# ---------- Migration SQL step15 -----------------------------------

class TestAgenciesMigration:
    @pytest.fixture(scope="class")
    def sql(self):
        return MIGRATION_SQL.read_text(encoding="utf-8")

    def test_file_exists(self):
        assert MIGRATION_SQL.exists()

    def test_create_table_if_not_exists(self, sql):
        assert re.search(r"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.agencies", sql, re.I)

    def test_columns_and_defaults(self, sql):
        # id uuid PK default gen_random_uuid
        assert re.search(r"id\s+uuid\s+PRIMARY KEY\s+DEFAULT\s+gen_random_uuid\(\)", sql, re.I)
        # ghl_company_id text NOT NULL UNIQUE
        assert re.search(r"ghl_company_id\s+text\s+NOT NULL\s+UNIQUE", sql, re.I)
        # oauth_token text NOT NULL
        assert re.search(r"oauth_token\s+text\s+NOT NULL", sql, re.I)
        # refresh_token text NOT NULL
        assert re.search(r"refresh_token\s+text\s+NOT NULL", sql, re.I)
        # status default 'active'
        assert re.search(r"status\s+text\s+NOT NULL\s+DEFAULT\s+'active'", sql, re.I)
        # CHECK includes active/inactive/needs_reauth
        assert "active" in sql and "inactive" in sql and "needs_reauth" in sql
        assert re.search(r"CHECK\s*\(\s*status\s+IN", sql, re.I)
        # created_at timestamptz DEFAULT now()
        assert re.search(r"created_at\s+timestamptz.*DEFAULT\s+now\(\)", sql, re.I)

    def test_status_index(self, sql):
        assert re.search(
            r"CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_agencies_status\s+ON\s+public\.agencies\s*\(\s*status\s*\)",
            sql,
            re.I,
        )


# ---------- agencies.js helpers ------------------------------------

class TestAgenciesHelpers:
    @pytest.fixture(scope="class")
    def src(self):
        return AGENCIES_JS.read_text(encoding="utf-8")

    def test_exports_all_four_helpers(self, src):
        for name in ["upsertAgencyFromOAuth", "findAgencyByCompanyId",
                     "getAgencyWithTokens", "updateAgencyTokens"]:
            assert re.search(rf"export\s+async\s+function\s+{name}\b", src), \
                f"export async function {name} no encontrado"

    def test_upsert_encrypts_tokens(self, src):
        block = src[src.index("upsertAgencyFromOAuth"):]
        assert "encrypt(tokenResponse.access_token)" in block
        assert "encrypt(tokenResponse.refresh_token)" in block
        assert "onConflict: 'ghl_company_id'" in block

    def test_get_agency_decrypts(self, src):
        block = src[src.index("getAgencyWithTokens"):]
        assert "decrypt(data.oauth_token)" in block
        assert "decrypt(data.refresh_token)" in block


# ---------- Server health + regresión ------------------------------

class TestServerHealth:
    def test_health_endpoint(self):
        r = requests.get(f"{LOCAL_URL}/api/health", timeout=5)
        assert r.status_code == 200


class TestRegression:
    def test_buscar_filters(self):
        # /buscar requiere portal tenant resuelto por host o por ?preview=
        r = requests.get(
            f"{LOCAL_URL}/buscar",
            params={"preview": EXPECTED_TENANT_ID},
            timeout=15,
        )
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "")
        # los inputs de filtros deben estar presentes
        assert 'action="/buscar"' in r.text or "filters-form" in r.text

    def test_portal_preview_page(self):
        # Necesitamos un preview token válido — probemos con firma pública si existe
        r = requests.get(
            f"{LOCAL_URL}/p/departamento-en-tziara",
            params={"preview": "invalid"},
            timeout=15,
        )
        # con preview inválido debe devolver 404 o 401 pero no 500
        assert r.status_code in (200, 401, 403, 404), \
            f"got {r.status_code}: {r.text[:200]}"

    def test_ficha_organica_with_host(self):
        r = requests.get(
            f"{LOCAL_URL}/L4B9TP",
            headers={"Host": "ficha.mktscaled.com"},
            timeout=15,
        )
        assert r.status_code == 200
        assert "ficha" in r.text.lower() or "Ficha" in r.text

    def test_upload_sign_video_requires_auth(self):
        # sin bearer debe rechazar (401/403), no 404 (endpoint activo)
        r = requests.post(f"{LOCAL_URL}/api/upload/sign-video", json={}, timeout=10)
        assert r.status_code in (401, 403), \
            f"expected 401/403 (endpoint activo), got {r.status_code}"

    def test_upload_sign_video_with_valid_bearer(self):
        # Obtener token vía SSO
        sso = requests.get(
            f"{LOCAL_URL}/api/auth/sso",
            params={"locationId": LOCATION_ID, "userId": USER_ID},
            timeout=10,
        ).json()
        token = sso.get("token")
        assert token
        # Firmar un upload de video (payload mínimo)
        r = requests.post(
            f"{LOCAL_URL}/api/upload/sign-video",
            headers={"Authorization": f"Bearer {token}"},
            json={"public_id_prefix": "test", "folder": "test"},
            timeout=10,
        )
        # Debe devolver 200 con firma
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:300]}"
        data = r.json()
        # keys típicas de una firma cloudinary
        assert "signature" in data or "timestamp" in data or "api_key" in data, \
            f"response sin campos de firma: {list(data.keys())}"
