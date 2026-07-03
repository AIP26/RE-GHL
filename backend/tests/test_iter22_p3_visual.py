"""Iteration 22 — BLOQUE P3 fixes visuales.

Cubre:
  FIX 1 — Heading .ghl-form-heading estilo premium (fontSize 22-26px,
          border-left 4px con color primario, padding generoso).
  FIX 2 — PDF button vía CSS order (no duplicación de HTML); mobile order:2
          antes del embed order:3, desktop pdf order:4 (después del embed).
  FIX 3 — Altura del embed configurable vía --ghl-h con cap responsive;
          data-height del embed legacy se transmite como --ghl-h inline.
"""
import re
import requests

BASE = 'http://localhost:3000'


def test_fix1_heading_premium_styles():
    """P3 FIX 1 vigente en P4: heading premium mantiene estilo."""
    with open('/app/src/lib/render.js') as f:
        css = f.read()
    heading_block = re.search(r'\.ghl-form-heading\s*\{[^}]+\}', css)
    assert heading_block
    block = heading_block.group(0)
    assert 'font-size: 22px' in block
    assert 'border-left: 4px solid var(--color-primary' in block
    assert 'padding: 18px' in block
    assert 'font-weight: 700' in block
    assert 'color: var(--color-primary' in block
    assert 'font-size: 26px' in css


def test_fix2_pdf_via_css_order():
    """P3 → P4: pdf-btn en order 2, embed en order 3 (mobile + desktop)."""
    with open('/app/src/lib/render.js') as f:
        css = f.read()
    with open('/app/src/routes/public.js') as f:
        js = f.read()
    assert js.count('class="btn btn-ghost pdf-btn"') == 1
    assert '.agent-card > .pdf-btn { order: 2; }' in css
    assert '.agent-card > .ghl-form-embed { order: 3; }' in css


def test_fix3_data_height_parsed_from_legacy_embed():
    """P3 FIX 3 sigue vigente: parser de data-height del embed legacy."""
    with open('/app/src/routes/public.js') as f:
        js = f.read()
    assert 'data-height=' in js
    assert 'const height = heightMatch ? Number(heightMatch[1]) : null' in js


def test_fix3_no_scrollbars_in_embed_container():
    """P4 override: embed container ya no clampa altura — sin scrollbars."""
    with open('/app/src/lib/render.js') as f:
        css = f.read()
    assert 'overflow: hidden' in css
    assert 'min-height: 650px' in css


def test_server_health():
    """Regresión — servidor arranca correctamente tras cambios en CSS."""
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
