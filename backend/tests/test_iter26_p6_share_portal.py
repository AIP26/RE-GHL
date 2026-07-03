"""Iteration 26 — BLOQUE P6 Share button en portal público mobile."""
import re
import requests

BASE = 'http://localhost:3000'


def _get_portal():
    """Activa tenant si es necesario y retorna HTML del portal público."""
    r = requests.get(
        f'{BASE}/p/departamento-tziara-f?preview=2079e30e-62f5-4e2f-b976-d099535410e8',
        timeout=15,
    )
    if r.status_code == 404:
        import subprocess
        subprocess.run(['node', '-e', """
            import('./src/lib/supabase.js').then(async ({getSupabase}) => {
              await getSupabase().from('tenants').update({ status: 'active' }).eq('id','2079e30e-62f5-4e2f-b976-d099535410e8');
            });
        """], cwd='/app', capture_output=True, text=True, timeout=15)
        r = requests.get(
            f'{BASE}/p/departamento-tziara-f?preview=2079e30e-62f5-4e2f-b976-d099535410e8',
            timeout=15,
        )
    assert r.status_code == 200, f'Portal status {r.status_code}'
    return r.text


def test_share_button_emitted_in_dom():
    html = _get_portal()
    assert 'data-testid="portal-share-btn"' in html
    assert 'class="btn btn-ghost share-btn-mobile"' in html
    assert 'onclick="return window.__mktShareCurrent' in html
    # data attributes con título y text
    assert 'data-share-title="Departamento Tziara F"' in html
    assert 'data-share-text="Mira esta propiedad"' in html


def test_share_button_hidden_desktop_visible_mobile_via_css():
    html = _get_portal()
    # CSS embebido: display:none default, display:block en media (max-width:767px)
    assert '.share-btn-mobile { display: none; }' in html
    assert '@media (max-width: 767px)' in html
    assert '.share-btn-mobile { display: block; }' in html


def test_share_handler_inline_script():
    """El script window.__mktShareCurrent debe estar inline en <head>."""
    html = _get_portal()
    assert 'window.__mktShareCurrent' in html
    # Usa navigator.share con fallback a clipboard
    assert 'navigator.share' in html
    assert 'navigator.clipboard.writeText' in html
    # Silencia AbortError
    assert 'AbortError' in html


def test_share_button_position_between_pdf_and_embed():
    """En el HTML el orden de emisión debe ser: agentBlock → pdfBtn → shareBtn → embed."""
    with open('/app/src/routes/public.js') as f:
        js = f.read()
    # Match el bloque return de renderCTA
    m = re.search(r'return `<div class="agent-card">(.+?)</div>`;', js, re.DOTALL)
    assert m, 'No se encontró el template de agent-card'
    block = m.group(1)
    idx_agent = block.find('${agentBlock}')
    idx_pdf = block.find('${pdfBtn}')
    idx_share = block.find('${shareBtn}')
    idx_embed = block.find('${primaryHtml}')
    assert -1 < idx_agent < idx_pdf < idx_share < idx_embed, \
        f'Orden incorrecto: agent={idx_agent} pdf={idx_pdf} share={idx_share} embed={idx_embed}'


def test_regression_pdf_button_still_present():
    html = _get_portal()
    assert 'data-testid="portal-pdf-download-btn"' in html
    assert '>\n      Descargar ficha PDF\n' in html or 'Descargar ficha PDF' in html


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
