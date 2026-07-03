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
    with open('/app/src/lib/render.js') as f:
        css = f.read()
    # font-size 22-26px, border-left 4px, padding generoso, color primary
    heading_block = re.search(r'\.ghl-form-heading\s*\{[^}]+\}', css)
    assert heading_block, 'No se encontró bloque .ghl-form-heading'
    block = heading_block.group(0)
    assert 'font-size: 22px' in block, f'Falta font-size 22px: {block}'
    assert 'border-left: 4px solid var(--color-primary' in block
    assert 'padding: 18px' in block
    assert 'font-weight: 700' in block
    assert 'color: var(--color-primary' in block
    # media query desktop: fontSize 26px
    assert 'font-size: 26px' in css, 'Falta media query desktop con font-size 26px'


def test_fix2_pdf_via_css_order():
    """PDF button se coloca vía CSS order (no display:none duplicado)."""
    with open('/app/src/lib/render.js') as f:
        css = f.read()
    with open('/app/src/routes/public.js') as f:
        js = f.read()
    # Un solo pdf-btn en el HTML
    assert js.count('class="btn btn-ghost pdf-btn"') == 1
    # CSS order rules
    assert '.agent-card > .pdf-btn' in css
    # Mobile default (fuera de @media desktop): pdf order: 2
    # Desktop @media: pdf order: 4
    assert re.search(r'@media\s*\(min-width:\s*768px\)\s*\{\s*\.agent-card\s*>\s*\.pdf-btn\s*\{\s*order:\s*4', css, re.DOTALL), 'Falta CSS media query desktop con order: 4'


def test_fix3_data_height_parsed_from_legacy_embed():
    """resolveGhlAssetSrc debe capturar data-height del <iframe> legacy."""
    with open('/app/src/routes/public.js') as f:
        js = f.read()
    # Regex del parser
    assert 'data-height=' in js
    assert 'const height = heightMatch ? Number(heightMatch[1]) : null' in js
    # renderGhlFormEmbed usa la altura como --ghl-h inline
    assert '--ghl-h:' in js or 'ghl-h:' in js
    assert 'innerStyle' in js


def test_fix3_css_max_height_clamps_ghl_h():
    with open('/app/src/lib/render.js') as f:
        css = f.read()
    # CSS: mobile min(var(--ghl-h), 500px) + max-height: 500px
    assert 'min(var(--ghl-h), 500px)' in css
    # desktop min(var(--ghl-h), 600px) + max-height: 600px
    assert 'min(var(--ghl-h), 600px)' in css
    assert 'max-height: 500px' in css
    assert 'max-height: 600px' in css
    assert 'overflow-y: auto' in css


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
