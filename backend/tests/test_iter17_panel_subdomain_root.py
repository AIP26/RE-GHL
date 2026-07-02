"""
Iteración 17 — Fix panel root en subdominio panel.<APP_DOMAIN>.

Verifica que el handler `app.get('/')` agregado ANTES de resolveTenantByHost
+ publicRoutes en /app/src/server.js sirva el panelIndex cuando el host
matchea exactamente `panel.<APP_DOMAIN>` (case-insensitive, port stripped).

Regresiones incluidas: /panel/ clásico, ficha subdomain, guard 'Portal no
encontrado', SSO flow, /api/health, /buscar preview, /L4B9TP, /api/upload/sign-video.
"""
import os
import re
import pytest
import requests

BASE = os.environ.get("TEST_BASE_URL", "http://localhost:3000").rstrip("/")
APP_DOMAIN = os.environ.get("APP_DOMAIN", "mktscaled.com")
PANEL_HOST = f"panel.{APP_DOMAIN}"


# ---------------------------------------------------------------------------
# Panel root on panel.<APP_DOMAIN>
# ---------------------------------------------------------------------------
class TestPanelSubdomainRoot:
    def test_panel_root_with_query_params(self):
        r = requests.get(
            f"{BASE}/",
            params={"locationId": "b7JAqyPMcYXjeqDyvgdJ", "userId": "pyr7tK7t6wBZMpsL5pFJ"},
            headers={"Host": PANEL_HOST},
            timeout=10,
        )
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:200]}"
        assert "text/html" in r.headers.get("content-type", "").lower()
        html = r.text
        assert "<title>mktscaled — Panel</title>" in html, "panel title missing"
        assert 'href="/panel/style.css"' in html, "style.css absolute path missing"
        assert re.search(r'src="/panel/app\.js\?v=\d+"', html), "app.js absolute path missing"

    def test_panel_root_without_query_params(self):
        r = requests.get(f"{BASE}/", headers={"Host": PANEL_HOST}, timeout=10)
        assert r.status_code == 200
        assert "<title>mktscaled — Panel</title>" in r.text

    def test_panel_root_case_insensitive_host(self):
        r = requests.get(f"{BASE}/", headers={"Host": PANEL_HOST.upper()}, timeout=10)
        assert r.status_code == 200
        assert "<title>mktscaled — Panel</title>" in r.text

    def test_panel_root_host_with_port_suffix(self):
        r = requests.get(f"{BASE}/", headers={"Host": f"{PANEL_HOST}:443"}, timeout=10)
        assert r.status_code == 200
        assert "<title>mktscaled — Panel</title>" in r.text


# ---------------------------------------------------------------------------
# Panel assets absolute path — must work from ANY host
# ---------------------------------------------------------------------------
class TestPanelAssets:
    def test_panel_appjs_from_panel_host(self):
        r = requests.get(f"{BASE}/panel/app.js", headers={"Host": PANEL_HOST}, timeout=10)
        assert r.status_code == 200
        ctype = r.headers.get("content-type", "").lower()
        assert "javascript" in ctype, f"content-type not javascript: {ctype}"

    def test_panel_stylecss_from_panel_host(self):
        r = requests.get(f"{BASE}/panel/style.css", headers={"Host": PANEL_HOST}, timeout=10)
        assert r.status_code == 200
        ctype = r.headers.get("content-type", "").lower()
        assert "css" in ctype, f"content-type not css: {ctype}"


# ---------------------------------------------------------------------------
# Regression: guard 'Portal no encontrado' for arbitrary hosts
# ---------------------------------------------------------------------------
class TestGuardRegression:
    def test_arbitrary_host_root_returns_404(self):
        r = requests.get(f"{BASE}/", headers={"Host": "no-tenant.example.com"}, timeout=10)
        assert r.status_code == 404, f"expected 404, got {r.status_code}"
        # Body may be HTML or JSON depending on route
        body = r.text
        assert (
            "Portal no encontrado" in body
            or "not_found" in body
        ), f"unexpected body: {body[:200]}"

    def test_listings_host_root_does_not_serve_panel(self):
        # Host listings.mktscaled.com must NOT trigger the panel handler
        r = requests.get(f"{BASE}/", headers={"Host": "listings.mktscaled.com"}, timeout=10)
        assert "<title>mktscaled — Panel</title>" not in r.text, (
            "listings host must NOT serve panel index"
        )


# ---------------------------------------------------------------------------
# Regression: legacy /panel/ path (backward compat)
# ---------------------------------------------------------------------------
class TestLegacyPanelPath:
    def test_panel_legacy_with_any_host(self):
        r = requests.get(
            f"{BASE}/panel/",
            params={"locationId": "x", "userId": "y"},
            headers={"Host": "anything.example.com"},
            timeout=10,
        )
        assert r.status_code == 200
        assert "<title>mktscaled — Panel</title>" in r.text


# ---------------------------------------------------------------------------
# Regression: ficha subdomain
# ---------------------------------------------------------------------------
class TestFichaRegression:
    def test_ficha_subdomain_path_L4B9TP(self):
        r = requests.get(
            f"{BASE}/L4B9TP",
            headers={"Host": f"ficha.{APP_DOMAIN}"},
            timeout=10,
        )
        assert r.status_code == 200, f"expected 200, got {r.status_code}"
        # Should contain ficha HTML (not the panel)
        assert "<title>mktscaled — Panel</title>" not in r.text
        # heuristics — ficha page typically has Ficha or property content
        assert "html" in r.headers.get("content-type", "").lower()

    def test_ficha_subdomain_root_returns_404(self):
        # Root `/` on ficha subdomain must NOT match the panel handler
        # (panel only matches panel.<APP_DOMAIN>) and must return 404
        r = requests.get(f"{BASE}/", headers={"Host": f"ficha.{APP_DOMAIN}"}, timeout=10)
        assert r.status_code == 404, f"expected 404, got {r.status_code}"
        assert "<title>mktscaled — Panel</title>" not in r.text


# ---------------------------------------------------------------------------
# SSO flow — /api/* mounted before publicRoutes, must not be affected
# ---------------------------------------------------------------------------
class TestSSOFlow:
    def test_sso_returns_200_with_valid_credentials(self):
        r = requests.get(
            f"{BASE}/api/auth/sso",
            params={
                "locationId": "cNg6MFQcxv8bZnwCppoM",
                "userId": "pyr7tK7t6wBZMpsL5pFJ",
            },
            timeout=15,
        )
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:300]}"
        data = r.json()
        assert "token" in data
        assert data.get("tenant", {}).get("id") == "2079e30e-62f5-4e2f-b976-d099535410e8"


# ---------------------------------------------------------------------------
# General regression Bloques 6-16
# ---------------------------------------------------------------------------
class TestGeneralRegression:
    def test_api_health(self):
        r = requests.get(f"{BASE}/api/health", timeout=10)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_buscar_preview(self):
        # Preview mode — a tenant slug is expected as ?preview=<tenant>
        r = requests.get(
            f"{BASE}/buscar",
            params={"preview": "2079e30e-62f5-4e2f-b976-d099535410e8"},
            timeout=10,
        )
        # Accept 200 (HTML page) — do NOT assert internal errors
        assert r.status_code == 200, f"expected 200, got {r.status_code}"
        assert "html" in r.headers.get("content-type", "").lower()

    def test_sign_video_with_bearer(self):
        # First get a valid token
        sso = requests.get(
            f"{BASE}/api/auth/sso",
            params={
                "locationId": "cNg6MFQcxv8bZnwCppoM",
                "userId": "pyr7tK7t6wBZMpsL5pFJ",
            },
            timeout=15,
        )
        if sso.status_code != 200:
            pytest.skip(f"SSO not available for sign-video regression: {sso.status_code}")
        token = sso.json().get("token")
        assert token, "no token returned from sso"
        r = requests.post(
            f"{BASE}/api/upload/sign-video",
            headers={"Authorization": f"Bearer {token}"},
            json={},
            timeout=10,
        )
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:200]}"
        data = r.json()
        assert "signature" in data
        assert "timestamp" in data
        assert "apiKey" in data or "api_key" in data

    def test_sign_video_without_bearer(self):
        r = requests.post(f"{BASE}/api/upload/sign-video", json={}, timeout=10)
        assert r.status_code in (401, 403), (
            f"expected 401/403 without bearer, got {r.status_code}"
        )
