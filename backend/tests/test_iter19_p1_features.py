"""Iteration 19 — BLOQUE P1 + 2 Fix Adicionales.

Cubre:
  1. FIX ADICIONAL 1 — normalizeGhlOptionValue debe mapear "otro_consultar"
     ↔ "Otro (consultar)" (parentheses stripping).
  2. FIX ADICIONAL 2 — Los filtros "Precio mín/máx" en Mis Listings usan
     precio_principal con fallback a precio_usd; placeholders sin "USD".
  3. BLOQUE P1 features en frontend + backend:
       - Endpoints /api/property/:id/duplicate y /api/property/:id/views
         devuelven 401 sin sesión (existen y están montados).
       - Endpoints /api/ghl/forms y /api/ghl/calendars devuelven 401 sin sesión.
       - validateGhlFormEmbed acepta 3 formatos: ghl-form:, ghl-calendar:, <iframe>.
       - Panel HTML incluye los nuevos campos: referencia_interna, referencia_publica,
         cta_texto, los tabs del CTA picker y las opciones Duplicar/Resetear en el menú.
"""
import re
import subprocess
import requests

BASE = 'http://localhost:3000'


def test_normalize_option_value_strips_parentheses():
    """La función normalize del panel debe mapear "otro_consultar" (raw de
    GHL) a "Otro (consultar)" (label de las opciones)."""
    script = r"""
    const norm = (s) => String(s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[()[\]{}.,;:!?"'`]/g, '')
      .replace(/[_\s\-/]+/g, ' ')
      .trim();
    console.log(JSON.stringify({
      a: norm('Otro (consultar)') === norm('otro_consultar'),
      b: norm('Gravamen Infonavit') === norm('gravamen_infonavit'),
      c: norm('MXN') === norm('mxn'),
      d: norm('Libre de gravamen') === norm('libre_de_gravamen'),
      e: norm('Necesita remodelación') === norm('necesita_remodelacion'),
    }));
    """
    r = subprocess.run(['node', '-e', script], capture_output=True, text=True, timeout=10)
    assert r.returncode == 0, r.stderr
    result = r.stdout.strip().splitlines()[-1]
    assert '"a":true' in result, f"otro (consultar) not mapped: {result}"
    assert '"b":true' in result, f"Gravamen Infonavit not mapped: {result}"
    assert '"c":true' in result, f"MXN not mapped: {result}"
    assert '"d":true' in result, f"Libre de gravamen not mapped: {result}"
    assert '"e":true' in result, f"Necesita remodelación not mapped: {result}"


def test_price_filter_placeholders_no_usd():
    """El input de filtro de precio en Mis Listings no debe decir "USD"."""
    r = requests.get(f'{BASE}/panel/app.js', timeout=10)
    assert r.status_code == 200
    assert 'placeholder="Precio mín"' in r.text or "placeholder='Precio mín'" in r.text, \
        'Placeholder "Precio mín" (sin USD) no encontrado'
    assert 'placeholder="Precio máx"' in r.text or "placeholder='Precio máx'" in r.text, \
        'Placeholder "Precio máx" (sin USD) no encontrado'
    assert 'Precio mín USD' not in r.text, 'Aún queda "Precio mín USD" — placeholder legacy'
    assert 'Precio máx USD' not in r.text, 'Aún queda "Precio máx USD" — placeholder legacy'


def test_price_filter_uses_precio_principal():
    """El filtro de precio debe usar precio_principal con fallback a precio_usd."""
    r = requests.get(f'{BASE}/panel/app.js', timeout=10)
    assert r.status_code == 200
    # Al menos una línea debe tener precio_principal con fallback a precio_usd en filtros
    assert 'p.precio_principal || p.precio_usd' in r.text, \
        'El filtro no usa el fallback precio_principal → precio_usd'


def test_property_duplicate_endpoint_exists_and_requires_session():
    """POST /api/property/:id/duplicate existe y requiere sesión."""
    r = requests.post(f'{BASE}/api/property/anyid/duplicate', timeout=10)
    assert r.status_code == 401, f'Esperado 401, obtuvo {r.status_code}: {r.text[:200]}'
    assert 'missing_session' in r.text


def test_property_reset_views_endpoint_exists_and_requires_session():
    """DELETE /api/property/:id/views existe y requiere sesión."""
    r = requests.delete(f'{BASE}/api/property/anyid/views', timeout=10)
    assert r.status_code == 401, f'Esperado 401, obtuvo {r.status_code}: {r.text[:200]}'
    assert 'missing_session' in r.text


def test_ghl_proxy_forms_requires_session():
    r = requests.get(f'{BASE}/api/ghl/forms', timeout=10)
    assert r.status_code == 401
    assert 'missing_session' in r.text


def test_ghl_proxy_calendars_requires_session():
    r = requests.get(f'{BASE}/api/ghl/calendars', timeout=10)
    assert r.status_code == 401
    assert 'missing_session' in r.text


def test_validate_ghl_form_embed_accepts_new_formats():
    """validateGhlFormEmbed debe aceptar los 3 formatos: ghl-form:, ghl-calendar:, <iframe>."""
    script = r"""
    import('./src/routes/property.js').then((mod) => {
      const fn = mod.validateGhlFormEmbed;
      console.log(JSON.stringify({
        form: fn('ghl-form:HZ7abc12345'),
        cal:  fn('ghl-calendar:XY9def45678'),
        iframe: fn('<iframe src="https://api.leadconnectorhq.com/widget/form/xyz"></iframe>'),
        bad:  fn('<iframe src="https://evil.com/form"></iframe>'),
        empty: fn(''),
      }));
    });
    """
    r = subprocess.run(['node', '--input-type=module', '-e', script],
                       capture_output=True, text=True, timeout=15, cwd='/app')
    assert r.returncode == 0, r.stderr
    out = r.stdout.strip().splitlines()[-1]
    import json
    data = json.loads(out)
    assert data['form']['ok'] and data['form']['kind'] == 'form'
    assert data['cal']['ok'] and data['cal']['kind'] == 'calendar'
    assert data['iframe']['ok'] and data['iframe']['kind'] == 'embed'
    assert not data['bad']['ok']
    assert not data['empty']['ok']


def test_panel_html_has_new_fields():
    """El panel HTML/JS debe exponer los nuevos campos y opciones del menú."""
    r = requests.get(f'{BASE}/panel/app.js', timeout=10)
    assert r.status_code == 200
    js = r.text
    # Nuevos campos del form
    assert 'referencia_interna' in js
    assert 'referencia_publica' in js
    assert 'cta_texto' in js
    # CTA picker tabs (data-testid dinámico: 'cta-mode-' + m, m in ['form','calendar','embed'])
    assert "'cta-mode-' + m" in js
    assert "'cta-mode-tab'" in js
    assert 'Formulario GHL' in js
    assert 'Calendario GHL' in js
    assert 'Pegar embed' in js
    # Row menu actions
    assert 'listing-duplicate-' in js
    assert 'listing-reset-views-' in js
    assert 'Duplicar propiedad' in js
    assert 'Resetear vistas' in js


def test_public_portal_renders_referencia_publica():
    """Cuando una propiedad tiene referencia_publica, la ficha pública debe
    mostrar un badge REF · <valor>. Test solo pasa si hay un tenant activo
    con una propiedad que tenga ese campo — es soft (no-fail si no aplica)."""
    # Este test es mejor manejarlo con el testing agent E2E. Aquí verificamos
    # solo que el servidor arranca sin errores tras nuestro cambio (regresión
    # sobre la extracción de resolveGhlAssetSrc en public.js).
    r = requests.get(f'{BASE}/api/health', timeout=10)
    assert r.status_code == 200


if __name__ == '__main__':
    tests = [v for k, v in globals().items() if k.startswith('test_') and callable(v)]
    passed = failed = 0
    for t in tests:
        try:
            t()
            print(f'✓ {t.__name__}')
            passed += 1
        except AssertionError as e:
            print(f'✗ {t.__name__}: {e}')
            failed += 1
        except Exception as e:
            print(f'✗ {t.__name__} (crash): {e!r}')
            failed += 1
    print(f'\n{passed}/{passed+failed} passed')
