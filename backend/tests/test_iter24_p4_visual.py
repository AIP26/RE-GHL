"""Iteration 24 — BLOQUE P4 fixes visuales del portal público.

Cubre:
  FIX 1 — Sin scrollbars en el iframe del CTA (overflow:hidden, min-height 650/780).
  FIX 2 — PDF button ANTES del embed también en desktop (order:2 en ambos viewports).
  FIX 3 — favicon.ico devuelve 200 con MLS design; link tags en portal + panel.
"""
import os
import requests

BASE = 'http://localhost:3000'


def test_fix1_no_scrollbars_css():
    with open('/app/src/lib/render.js') as f:
        css = f.read()
    # Contenedor con overflow: hidden, sin max-height
    assert '.ghl-form-embed-inner' in css
    # No debe quedar el clamp de P3
    assert 'max-height: 500px' not in css, 'P3 max-height 500px sigue presente'
    assert 'max-height: 600px' not in css, 'P3 max-height 600px sigue presente'
    # Nuevo comportamiento
    assert 'overflow: hidden' in css
    assert 'min-height: 650px' in css
    # Calendarios más altos
    assert 'min-height: 780px' in css
    # iframe con width 100% y sin border
    assert 'width: 100% !important' in css


def test_fix2_pdf_order_before_embed_all_viewports():
    with open('/app/src/lib/render.js') as f:
        css = f.read()
    # pdf order: 2, embed order: 3 (siempre)
    assert '.agent-card > .pdf-btn { order: 2; }' in css
    assert '.agent-card > .ghl-form-embed { order: 3; }' in css
    # NO debe quedar el override desktop de P3 (order:4)
    assert 'order: 4' not in css, 'Sigue el override desktop de P3 (order:4)'


def test_fix2_no_dual_pdf_buttons():
    with open('/app/src/routes/public.js') as f:
        js = f.read()
    # Un solo botón .pdf-btn
    assert js.count('class="btn btn-ghost pdf-btn"') == 1
    # Sin restos de enfoques anteriores
    assert 'pdf-mobile-only' not in js
    assert 'pdf-desktop-only' not in js


def test_fix3_favicon_ico_200():
    r = requests.get(f'{BASE}/favicon.ico', timeout=10)
    assert r.status_code == 200
    assert r.headers.get('content-type', '').lower() in ('image/vnd.microsoft.icon', 'image/x-icon', 'image/ico', 'image/icon'), r.headers.get('content-type')
    # Debe ser un ICO real (magic bytes: 00 00 01 00)
    assert r.content[:4] == b'\x00\x00\x01\x00', f'Not a valid ICO magic: {r.content[:4].hex()}'
    # Tamaño razonable
    assert 200 < len(r.content) < 10_000, f'ICO size sospechoso: {len(r.content)}'


def test_fix3_apple_touch_icon_200():
    r = requests.get(f'{BASE}/apple-touch-icon.png', timeout=10)
    assert r.status_code == 200
    # PNG magic
    assert r.content[:8] == b'\x89PNG\r\n\x1a\n'


def test_fix3_favicon_in_public_portal_head():
    """El portal público debe referenciar favicon.ico y apple-touch-icon.png."""
    # Portal responde 200 (o al menos el head bien formado). Testear via
    # una ficha que exista o comprobar el render de render.js directamente.
    with open('/app/src/lib/render.js') as f:
        js = f.read()
    assert 'rel="icon"' in js
    assert 'href="/favicon.ico"' in js
    assert 'rel="apple-touch-icon"' in js
    assert 'href="/apple-touch-icon.png"' in js


def test_fix3_favicon_in_panel_head():
    r = requests.get(f'{BASE}/panel/', timeout=10)
    assert r.status_code == 200
    assert 'rel="icon"' in r.text
    assert '/favicon.ico' in r.text


def test_fix3_favicon_file_exists():
    assert os.path.exists('/app/public/favicon.ico'), 'favicon.ico no existe'
    assert os.path.exists('/app/public/apple-touch-icon.png'), 'apple-touch-icon.png no existe'
    assert os.path.getsize('/app/public/favicon.ico') > 100


def test_regression_iframe_has_scrolling_no():
    """El iframe emitido lleva scrolling='no' para reforzar FIX 1."""
    with open('/app/src/routes/public.js') as f:
        js = f.read()
    assert 'scrolling="no"' in js


def test_regression_server_health():
    r = requests.get(f'{BASE}/api/health', timeout=10)
    assert r.status_code == 200


if __name__ == '__main__':
    tests = [v for k, v in globals().items() if k.startswith('test_') and callable(v)]
    passed = failed = 0
    for t in tests:
        try:
            t(); print(f'✓ {t.__name__}'); passed += 1
        except AssertionError as e:
            print(f'✗ {t.__name__}: {e}'); failed += 1
        except Exception as e:
            print(f'✗ {t.__name__} (crash): {e!r}'); failed += 1
    print(f'\n{passed}/{passed+failed} passed')
