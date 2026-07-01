"""
Tests for ficha subdomain routing fix.
Bug: GET http://localhost:3000/L4B9TP with Host: ficha.mktscaled.com was returning
'Portal no encontrado' because middleware tried to look up ficha.mktscaled.com in
`dominios` table. Fix: middleware detects ficha.<APP_DOMAIN>, sets req.isFichaHost,
and routes.js adds r.get('/:id') that delegates to handleFichaOrganica.

Server runs on localhost:3000 (Node monolith).
"""
import re
import pytest
import requests

BASE = "http://localhost:3000"
FICHA_HOST = "ficha.mktscaled.com"
KNOWN_SLUG = "L4B9TP"
PREVIEW_TENANT = "2079e30e-62f5-4e2f-b976-d099535410e8"
EXPECTED_TITLE = "Departamento en Tziara"


# ---------------- BUG FIX PRINCIPAL ----------------
class TestFichaSubdomainRootSlug:
    def test_root_slug_returns_200_with_organic_wrap(self):
        r = requests.get(f"{BASE}/{KNOWN_SLUG}", headers={"Host": FICHA_HOST}, timeout=15)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}. Body: {r.text[:400]}"
        assert "organic-wrap" in r.text, "Missing <div class='organic-wrap'> - not rendering ficha orgánica"
        assert EXPECTED_TITLE in r.text, f"Missing expected title '{EXPECTED_TITLE}'"
        assert "Portal no encontrado" not in r.text, "Guard leaked 'Portal no encontrado' into ficha subdomain response"


# ---------------- REGRESSION: backward compat /ficha/:id ----------------
class TestFichaBackwardCompat:
    def test_ficha_id_route_still_works_with_preview(self):
        url = f"{BASE}/ficha/{KNOWN_SLUG}?preview={PREVIEW_TENANT}"
        r = requests.get(url, timeout=15)
        assert r.status_code == 200, f"Expected 200 on /ficha/:id, got {r.status_code}"
        assert "organic-wrap" in r.text, "Backward-compat route /ficha/:id no renderiza ficha orgánica"
        assert EXPECTED_TITLE in r.text


# ---------------- EDGE: slug inexistente en ficha subdomain ----------------
class TestFichaSubdomainNonexistentSlug:
    def test_nonexistent_slug_returns_404_not_portal_not_found(self):
        r = requests.get(f"{BASE}/NONEXISTENT", headers={"Host": FICHA_HOST}, timeout=15)
        assert r.status_code == 404, f"Expected 404, got {r.status_code}"
        assert "Portal no encontrado" not in r.text, \
            "Guard leak: should fall to handler notFound, NOT middleware Portal no encontrado"
        assert "no está disponible" in r.text or "no encontrada" in r.text.lower(), \
            f"Expected neutral not-found msg from handler; body starts: {r.text[:300]}"


# ---------------- EDGE: ficha subdomain root '/' ----------------
class TestFichaSubdomainRoot:
    def test_root_path_on_ficha_host_does_not_show_portal_not_found(self):
        r = requests.get(f"{BASE}/", headers={"Host": FICHA_HOST}, timeout=15)
        # Acceptable: 404/500/etc. but MUST NOT show the middleware guard message.
        assert "Portal no encontrado" not in r.text, \
            f"Guard leaked on '/' with ficha host. status={r.status_code} body[:300]={r.text[:300]}"


# ---------------- REGRESSION: Portal cliente con preview ----------------
class TestPortalPreviewHome:
    def test_home_with_preview_renders_cards_grid(self):
        r = requests.get(f"{BASE}/?preview={PREVIEW_TENANT}", timeout=20)
        assert r.status_code == 200
        assert "cards-grid" in r.text or "empty" in r.text, \
            "Home debería renderizar cards-grid (o empty state) con preview activo"
        assert "Portal no encontrado" not in r.text


# ---------------- REGRESSION: guard bloquea hosts desconocidos ----------------
class TestGuardBlocksUnknownHost:
    def test_unknown_host_returns_portal_not_found(self):
        r = requests.get(f"{BASE}/", headers={"Host": "unknown-domain.example.com"}, timeout=15)
        assert r.status_code == 404
        assert "Portal no encontrado" in r.text, \
            "El guard debe seguir bloqueando hosts desconocidos con 'Portal no encontrado'"


# ---------------- REGRESSION: PDF de ficha orgánica ----------------
class TestFichaPDFStillWorks:
    def test_pdf_endpoint_returns_pdf(self):
        # /api/* está montado antes del middleware host, no debería afectarle el fix.
        r = requests.get(f"{BASE}/api/pdf/ficha/{KNOWN_SLUG}", timeout=30)
        assert r.status_code == 200, f"PDF endpoint got {r.status_code}: {r.text[:300]}"
        ct = r.headers.get("content-type", "")
        assert "pdf" in ct.lower(), f"Expected PDF content-type, got: {ct}"
        # Magic bytes PDF
        assert r.content[:4] == b"%PDF", "Response body is not a valid PDF (magic bytes mismatch)"


# ---------------- Code verification ----------------
class TestCodeVerification:
    def test_middleware_has_ficha_host_branch(self):
        with open("/app/src/middleware/tenant.js") as f:
            src = f.read()
        assert "import { env } from '../config/env.js'" in src, "env import missing"
        assert "isFichaHost" in src
        # Robust match for the branch
        assert re.search(r"host\s*===\s*`ficha\.\$\{appDomain\}`", src), \
            "Missing `host === `ficha.${appDomain}`` branch in resolveTenantByHost"

    def test_public_has_shared_handler_and_root_slug_route(self):
        with open("/app/src/routes/public.js") as f:
            src = f.read()
        assert "async function handleFichaOrganica" in src, "Named handler handleFichaOrganica missing"
        assert "r.get('/ficha/:id'" in src, "Backward-compat /ficha/:id route missing"
        assert "r.get('/:id'" in src, "New r.get('/:id') route for ficha subdomain missing"
        # Guard bypass in requirePortalTenant
        assert "if (req.isFichaHost) return next()" in src, "requirePortalTenant missing isFichaHost bypass"
        # Root slug route conditional on isFichaHost
        assert re.search(r"if\s*\(!req\.isFichaHost\)\s*return\s*next\(\)", src), \
            "r.get('/:id') should short-circuit when !req.isFichaHost"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
