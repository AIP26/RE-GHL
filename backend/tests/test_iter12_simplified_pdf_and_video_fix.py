"""
Iteration 12 — Regression suite for:
  1) PDF simplificado en portal público /p/:slug  (UN solo botón "Descargar ficha PDF" → con-agente-2pag)
  2) PDF simplificado en ficha orgánica ficha.<APP_DOMAIN>/:id  (UN solo botón → /api/pdf/ficha/:id?pages=2)
  3) Panel Mis Listings mantiene las 4 variantes intactas (code-verification)
  4) FIX Cloudinary signature (resource_type removido de string-to-sign)
  5) FIX VideoUpload compacto 80px
  6) Regresión endpoints PDF y galería BLOQUE 7
"""
import os
import re
import hashlib
import pathlib
import pytest
import requests

BASE_URL = "http://localhost:3000"
PREVIEW = "2079e30e-62f5-4e2f-b976-d099535410e8"
SLUG_PORTAL = "departamento-en-tziara"
SLUG_FICHA = "L4B9TP"
LOCATION_ID = "cNg6MFQcxv8bZnwCppoM"
USER_ID = "pyr7tK7t6wBZMpsL5pFJ"
FICHA_HOST = None  # resolved from APP_DOMAIN


def _load_env(path="/app/.env"):
    kv = {}
    p = pathlib.Path(path)
    if not p.exists():
        return kv
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        kv[k.strip()] = v.strip().strip('"').strip("'")
    return kv


ENV = _load_env()
APP_DOMAIN = ENV.get("APP_DOMAIN", "mktscaled.com")
CLOUDINARY_API_SECRET = ENV.get("CLOUDINARY_API_SECRET", "")
FICHA_HOST = f"ficha.{APP_DOMAIN}"


@pytest.fixture(scope="session")
def sso_token():
    r = requests.get(
        f"{BASE_URL}/api/auth/sso",
        params={"locationId": LOCATION_ID, "userId": USER_ID},
        timeout=15,
    )
    assert r.status_code == 200, f"SSO failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("token")
    assert tok, "No token in SSO response"
    return tok


@pytest.fixture(scope="session")
def public_js():
    return pathlib.Path("/app/src/routes/public.js").read_text()


@pytest.fixture(scope="session")
def upload_js():
    return pathlib.Path("/app/src/routes/upload.js").read_text()


@pytest.fixture(scope="session")
def panel_app_js():
    return pathlib.Path("/app/public/panel/app.js").read_text()


# ---------------------------------------------------------------------
# 1) PDF simplificado en portal público /p/:slug
# ---------------------------------------------------------------------
class TestPortalPdfSimplified:
    def test_portal_page_has_exactly_one_pdf_button(self):
        url = f"{BASE_URL}/p/{SLUG_PORTAL}?preview={PREVIEW}"
        r = requests.get(url, timeout=20)
        assert r.status_code == 200, f"HTTP {r.status_code}"
        html = r.text

        # Exactly one portal-pdf-download-btn
        occurrences = html.count('data-testid="portal-pdf-download-btn"')
        assert occurrences == 1, f"Expected 1 portal-pdf-download-btn, got {occurrences}"

        # Match anchor with text and href
        m = re.search(
            r'<a[^>]*data-testid="portal-pdf-download-btn"[^>]*>([\s\S]*?)</a>',
            html,
        )
        assert m, "portal-pdf-download-btn anchor not found"
        inner = m.group(1).strip()
        assert "Descargar ficha PDF" in inner, f"Button text mismatch: {inner!r}"

        anchor_tag = m.group(0)
        assert (
            f'href="/p/{SLUG_PORTAL}/pdf?v=con-agente-2pag"' in anchor_tag
        ), f"href not pointing to con-agente-2pag: {anchor_tag}"

    def test_portal_page_has_no_old_variants_or_picker_header(self):
        url = f"{BASE_URL}/p/{SLUG_PORTAL}?preview={PREVIEW}"
        html = requests.get(url, timeout=20).text

        # No other PDF version links should be exposed in the served HTML
        for v in ("con-agente-1pag", "sin-agente-1pag", "sin-agente-2pag"):
            assert v not in html, f"Old variant '{v}' still present in portal HTML"

        # Old picker header "Ficha PDF" (as picker title). We check that the
        # literal picker header pattern from before is not present.
        # The current UI must not include the standalone header string "Ficha PDF" used as a title.
        # We check that no <div|h3|h4 ...>Ficha PDF</...> exists.
        assert not re.search(
            r"<(?:h\d|div|p|span)[^>]*>\s*Ficha PDF\s*<", html
        ), "Old 'Ficha PDF' picker header still present"

    def test_portal_pdf_href_returns_pdf_200(self):
        url = (
            f"{BASE_URL}/p/{SLUG_PORTAL}/pdf?v=con-agente-2pag&preview={PREVIEW}"
        )
        r = requests.get(url, timeout=45)
        assert r.status_code == 200, f"HTTP {r.status_code}"
        ct = r.headers.get("content-type", "")
        assert "application/pdf" in ct, f"content-type={ct}"
        assert r.content[:4] == b"%PDF", "PDF magic bytes missing"


# ---------------------------------------------------------------------
# 2) PDF simplificado en ficha orgánica ficha.<APP_DOMAIN>/:id
# ---------------------------------------------------------------------
class TestFichaOrganicPdfSimplified:
    def _get_ficha_html(self):
        # Use Host override to hit ficha subdomain routing
        r = requests.get(
            f"{BASE_URL}/{SLUG_FICHA}",
            headers={"Host": FICHA_HOST},
            timeout=20,
        )
        assert r.status_code == 200, f"HTTP {r.status_code}"
        return r.text

    def test_ficha_page_has_exactly_one_pdf_button(self):
        html = self._get_ficha_html()
        occ = html.count('data-testid="ficha-pdf-download-btn"')
        assert occ == 1, f"Expected 1 ficha-pdf-download-btn, got {occ}"

        m = re.search(
            r'<a[^>]*data-testid="ficha-pdf-download-btn"[^>]*>([\s\S]*?)</a>',
            html,
        )
        assert m, "ficha-pdf-download-btn anchor not found"
        anchor = m.group(0)
        inner = m.group(1).strip()
        assert "Descargar ficha PDF" in inner, f"Button text mismatch: {inner!r}"
        assert (
            f'href="/api/pdf/ficha/{SLUG_FICHA}?pages=2"' in anchor
        ), f"href mismatch: {anchor}"

    def test_ficha_page_has_no_old_two_buttons(self):
        html = self._get_ficha_html()
        assert "Descargar 1 página" not in html, "Old 'Descargar 1 página' still present"
        assert "Descargar 2 páginas" not in html, "Old 'Descargar 2 páginas' still present"

    def test_ficha_pdf_endpoint_returns_pdf_200(self):
        r = requests.get(
            f"{BASE_URL}/api/pdf/ficha/{SLUG_FICHA}?pages=2", timeout=45
        )
        assert r.status_code == 200, f"HTTP {r.status_code}"
        assert "application/pdf" in r.headers.get("content-type", "")
        assert r.content[:4] == b"%PDF"


# ---------------------------------------------------------------------
# 3) Panel Mis Listings mantiene 4 variantes intactas (code-verification)
# ---------------------------------------------------------------------
class TestPanelKeeps4Variants:
    def test_panel_app_js_contains_all_4_variants_once(self, panel_app_js):
        for v in (
            "con-agente-1pag",
            "con-agente-2pag",
            "sin-agente-1pag",
            "sin-agente-2pag",
        ):
            count = panel_app_js.count(v)
            assert count >= 1, f"Variant '{v}' missing in panel/app.js"
            # Expectation: exactly one occurrence per spec
            assert count == 1, f"Variant '{v}' appears {count} times (expected 1)"


# ---------------------------------------------------------------------
# 4) FIX Cloudinary signature — resource_type removed from string-to-sign
# ---------------------------------------------------------------------
class TestCloudinarySignVideo:
    def test_sign_video_signature_matches_and_no_resource_type(self, sso_token):
        assert CLOUDINARY_API_SECRET, "CLOUDINARY_API_SECRET missing in /app/.env"
        r = requests.post(
            f"{BASE_URL}/api/upload/sign-video",
            headers={"Authorization": f"Bearer {sso_token}"},
            timeout=15,
        )
        assert r.status_code == 200, f"HTTP {r.status_code} — {r.text[:300]}"
        j = r.json()

        # Required fields
        for k in ("cloudName", "apiKey", "timestamp", "folder", "eager",
                  "eagerAsync", "signature", "uploadUrl"):
            assert k in j, f"Missing field: {k}"

        # NO resource_type / resourceType leaked
        assert "resourceType" not in j, "Response should NOT include 'resourceType'"
        assert "resource_type" not in j, "Response should NOT include 'resource_type'"

        # Field shapes
        assert j["eager"] == "f_auto,vc_h264,w_1280,c_limit,q_auto"
        assert j["eagerAsync"] is True
        assert re.match(r"^tenants/[0-9a-f-]{36}/properties/videos$", j["folder"]), (
            f"folder shape wrong: {j['folder']}"
        )
        assert j["uploadUrl"] == (
            f"https://api.cloudinary.com/v1_1/{j['cloudName']}/video/upload"
        )

        # Rebuild string-to-sign (alphabetical) — MUST NOT include resource_type
        params = {
            "eager": j["eager"],
            "eager_async": "true",
            "folder": j["folder"],
            "timestamp": str(j["timestamp"]),
        }
        to_sign = "&".join(f"{k}={params[k]}" for k in sorted(params)) + CLOUDINARY_API_SECRET
        expected = hashlib.sha1(to_sign.encode("utf-8")).hexdigest()
        assert j["signature"] == expected, (
            f"Signature mismatch. expected={expected} got={j['signature']}"
        )

        # Sanity: adding resource_type WOULD produce a different signature
        params_wrong = dict(params, resource_type="video")
        to_sign_wrong = (
            "&".join(f"{k}={params_wrong[k]}" for k in sorted(params_wrong))
            + CLOUDINARY_API_SECRET
        )
        wrong_sig = hashlib.sha1(to_sign_wrong.encode("utf-8")).hexdigest()
        assert wrong_sig != j["signature"], (
            "Sanity check failed — including resource_type should not match"
        )


# ---------------------------------------------------------------------
# 5) Client no envía resource_type + VideoUpload compacto 80px
# ---------------------------------------------------------------------
class TestPanelJsCodeVerification:
    def test_no_fd_append_resource_type_in_video_upload(self, panel_app_js):
        # Locate function body of VideoUpload
        m = re.search(
            r"function\s+VideoUpload\s*\([^)]*\)\s*\{",
            panel_app_js,
        )
        assert m, "VideoUpload function not found"
        start = m.start()
        # Find balanced end (rough: next 'function ' at column 0 or 6000 chars ahead)
        body = panel_app_js[start : start + 6000]
        assert "fd.append('resource_type'" not in body, (
            "fd.append('resource_type', ...) still present in VideoUpload"
        )
        assert 'fd.append("resource_type"' not in body, (
            'fd.append("resource_type", ...) still present in VideoUpload'
        )
        # Comment explaining why it was removed must be there
        assert "resource_type" in body, (
            "Explanatory comment mentioning resource_type must remain"
        )
        assert "PATH" in body or "/video/upload" in body, (
            "Comment should mention that resource_type goes in URL PATH"
        )

    def test_video_upload_empty_state_is_compact_80px(self, panel_app_js):
        # In the empty state (else branch), <label ... style={ height: '80px' ...}>
        m = re.search(
            r'video-uploader-empty[^>]*style=\$\{\s*\{([^}]*)\}',
            panel_app_js,
        )
        assert m, "video-uploader-empty label style block not found"
        style_block = m.group(1)
        assert "height: '80px'" in style_block, (
            f"Empty state height not 80px: {style_block!r}"
        )
        assert "minHeight: '80px'" in style_block, (
            f"Empty state minHeight not 80px: {style_block!r}"
        )
        # Old value must NOT be present in the empty state block
        assert "'96px'" not in style_block, (
            "Old 96px still present in empty state style"
        )


# ---------------------------------------------------------------------
# 6) Regresión endpoints PDF end-to-end
# ---------------------------------------------------------------------
class TestPdfRegression:
    def test_pdf_portal_con_agente_2pag(self):
        r = requests.get(
            f"{BASE_URL}/p/{SLUG_PORTAL}/pdf?v=con-agente-2pag&preview={PREVIEW}",
            timeout=45,
        )
        assert r.status_code == 200
        assert "application/pdf" in r.headers.get("content-type", "")
        assert r.content[:4] == b"%PDF"

    def test_pdf_portal_con_agente_1pag(self):
        r = requests.get(
            f"{BASE_URL}/p/{SLUG_PORTAL}/pdf?v=con-agente-1pag&preview={PREVIEW}",
            timeout=45,
        )
        assert r.status_code == 200
        assert "application/pdf" in r.headers.get("content-type", "")
        assert r.content[:4] == b"%PDF"

    def test_pdf_ficha_pages_2(self):
        r = requests.get(
            f"{BASE_URL}/api/pdf/ficha/{SLUG_FICHA}?pages=2", timeout=45
        )
        assert r.status_code == 200
        assert "application/pdf" in r.headers.get("content-type", "")
        assert r.content[:4] == b"%PDF"


# ---------------------------------------------------------------------
# 7) Regresión galería BLOQUE 7
# ---------------------------------------------------------------------
class TestGalleryRegression:
    def test_portal_has_gallery_v2(self):
        html = requests.get(
            f"{BASE_URL}/p/{SLUG_PORTAL}?preview={PREVIEW}", timeout=20
        ).text
        assert 'class="gallery-v2"' in html
        assert 'class="g-hero"' in html
        assert "thumb has-overlay" in html
        assert "+ 4 fotos" in html
        assert 'class="lightbox"' in html

    def test_ficha_organic_has_gallery_v2(self):
        html = requests.get(
            f"{BASE_URL}/{SLUG_FICHA}",
            headers={"Host": FICHA_HOST},
            timeout=20,
        ).text
        assert 'class="gallery-v2"' in html
        assert 'class="g-hero"' in html
        assert "thumb has-overlay" in html
        assert 'class="lightbox"' in html


# ---------------------------------------------------------------------
# 8) Regresión POST /api/upload/sign (image) sigue funcionando
# ---------------------------------------------------------------------
class TestSignImageRegression:
    def test_sign_image_returns_valid_signature(self, sso_token):
        assert CLOUDINARY_API_SECRET, "CLOUDINARY_API_SECRET missing"
        r = requests.post(
            f"{BASE_URL}/api/upload/sign",
            headers={"Authorization": f"Bearer {sso_token}"},
            json={"kind": "property"},
            timeout=15,
        )
        assert r.status_code == 200, f"HTTP {r.status_code} — {r.text[:300]}"
        j = r.json()
        for k in ("cloudName", "apiKey", "timestamp", "folder", "eager",
                  "signature", "uploadUrl"):
            assert k in j, f"Missing field: {k}"
        assert "/image/upload" in j["uploadUrl"]
        # Verify signature: params = eager, folder, timestamp
        params = {
            "eager": j["eager"],
            "folder": j["folder"],
            "timestamp": str(j["timestamp"]),
        }
        to_sign = "&".join(f"{k}={params[k]}" for k in sorted(params)) + CLOUDINARY_API_SECRET
        expected = hashlib.sha1(to_sign.encode("utf-8")).hexdigest()
        assert j["signature"] == expected, (
            f"Image signature mismatch. expected={expected} got={j['signature']}"
        )
