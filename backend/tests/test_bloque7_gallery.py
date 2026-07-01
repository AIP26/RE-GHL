"""BLOQUE 7 - Tests for hero + thumbnails gallery + lightbox on /p/:slug and ficha.
Runs against local Node server on http://localhost:3000 (already up via supervisor).
"""
import re
import requests
import pytest

BASE = "http://localhost:3000"
SLUG_P = "departamento-en-tziara"
PREVIEW = "2079e30e-62f5-4e2f-b976-d099535410e8"
FICHA_SLUG = "L4B9TP"
FICHA_HOST = "ficha.mktscaled.com"


# ---------- helpers ----------
def _get_p_slug():
    r = requests.get(f"{BASE}/p/{SLUG_P}", params={"preview": PREVIEW}, timeout=15)
    assert r.status_code == 200, f"status {r.status_code}"
    return r.text


def _get_ficha():
    r = requests.get(f"{BASE}/{FICHA_SLUG}", headers={"Host": FICHA_HOST}, timeout=15)
    assert r.status_code == 200, f"status {r.status_code}"
    return r.text


# ---------- Gallery structure at /p/:slug ----------
class TestGalleryStructurePSlug:
    def test_contains_gallery_v2(self):
        html = _get_p_slug()
        assert 'class="gallery-v2"' in html

    def test_single_hero_with_data_idx_0(self):
        html = _get_p_slug()
        # exactly one g-hero with data-idx="0"
        heroes = re.findall(r'<a[^>]*class="g-hero"[^>]*data-idx="0"', html)
        assert len(heroes) == 1, f"expected 1 g-hero, found {len(heroes)}"

    def test_ten_thumbnails_with_correct_indices(self):
        html = _get_p_slug()
        # match all thumbs and their data-idx
        # <a class="thumb..." ... data-idx="N"
        thumbs = re.findall(r'<a[^>]*class="thumb(?:\s+has-overlay)?"[^>]*data-idx="(\d+)"', html)
        assert len(thumbs) == 10, f"expected 10 thumbs, got {len(thumbs)}"
        idxs = sorted(int(x) for x in thumbs)
        assert idxs == list(range(1, 11)), f"data-idx sequence wrong: {idxs}"

    def test_sixth_thumb_has_overlay_with_plus_4_fotos(self):
        html = _get_p_slug()
        # sixth thumb (data-idx=6) must have class 'thumb has-overlay' and '+ 4 fotos'
        m = re.search(
            r'<a[^>]*class="thumb has-overlay"[^>]*data-idx="6"[^>]*>.*?<div class="thumb-overlay">\+\s*4\s+fotos</div>',
            html,
            re.DOTALL,
        )
        assert m is not None, "6th thumb must have has-overlay + '+ 4 fotos'"

    def test_lightbox_present_at_end(self):
        html = _get_p_slug()
        assert '<div class="lightbox" id="lightbox"' in html
        # counter element present
        assert 'id="lb-counter"' in html
        # nav buttons
        assert 'class="nav prev"' in html and 'class="nav next"' in html

    def test_alt_tags_indexing(self):
        html = _get_p_slug()
        titulo = "Departamento en Tziara"
        # hero alt = "<titulo> - foto 1"
        assert f'alt="{titulo} - foto 1"' in html
        # each thumb alt should be "<titulo> - foto <n>" for n = 2..11
        for n in range(2, 12):
            assert f'alt="{titulo} - foto {n}"' in html, f"missing alt foto {n}"


# ---------- Ficha organica same gallery ----------
class TestFichaGallery:
    def test_ficha_has_gallery_v2_and_lightbox(self):
        html = _get_ficha()
        assert 'class="gallery-v2"' in html
        assert 'class="g-hero"' in html
        assert 'class="thumbs"' in html
        assert '<div class="lightbox" id="lightbox"' in html

    def test_ficha_has_overlay_plus_4_fotos(self):
        html = _get_ficha()
        m = re.search(
            r'class="thumb has-overlay"[^>]*data-idx="6"[^>]*>.*?<div class="thumb-overlay">\+\s*4\s+fotos</div>',
            html,
            re.DOTALL,
        )
        assert m is not None

    def test_ficha_hero_has_data_idx_0(self):
        html = _get_ficha()
        assert re.search(r'<a[^>]*class="g-hero"[^>]*data-idx="0"', html) is not None


# ---------- Regression: no endpoints broken ----------
class TestRegression:
    def test_buscar_filters(self):
        r = requests.get(f"{BASE}/buscar", params={"preview": PREVIEW, "tipo": "departamento"}, timeout=15)
        assert r.status_code == 200
        assert "<html" in r.text.lower()

    def test_pdf_detail_slug(self):
        # /p/:slug/pdf?v=... is the actual route for portal PDF (via slug).
        r = requests.get(
            f"{BASE}/p/{SLUG_P}/pdf",
            params={"preview": PREVIEW, "v": "sin-agente-1pag"},
            timeout=60,
        )
        assert r.status_code == 200, f"got {r.status_code}"
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"

    def test_pdf_ficha_id(self):
        r = requests.get(f"{BASE}/api/pdf/ficha/{FICHA_SLUG}", timeout=45)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"

    def test_portal_home_preview(self):
        r = requests.get(f"{BASE}/", params={"preview": PREVIEW}, timeout=15)
        assert r.status_code == 200

    def test_coleccion_route_shape(self):
        # Just ensure route pattern doesn't 500 - a missing slug should render brand 404, not blow up.
        r = requests.get(f"{BASE}/coleccion/does-not-exist", params={"preview": PREVIEW}, timeout=15)
        assert r.status_code in (200, 404)


# ---------- Lightbox script sanity ----------
class TestLightboxScript:
    def test_lightbox_wired_to_gallery(self):
        html = _get_p_slug()
        # binding scans '#gallery [data-idx]'
        assert "'#gallery [data-idx]'" in html or "\"#gallery [data-idx]\"" in html
        # arrow keys handler
        assert "ArrowLeft" in html and "ArrowRight" in html and "Escape" in html
        # body overflow toggle
        assert "document.body.style.overflow='hidden'" in html
