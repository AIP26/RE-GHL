"""
Iteration 13 backend validation tests.

Cubre los 3 fixes finales:
  FIX 1 — Mapa Google embed en ficha orgánica (ficha.<APP_DOMAIN>/:id).
  FIX 2 — Overlay '+N fotos' eliminado en portal /p/:slug y ficha orgánica.
  FIX 3a — HTTPS redirect middleware (test aislado con mini-express).
  FIX 3b — Mixed content: grep 'http://' en /app/public/panel/app.js == 0 lines.

Y regresiones:
  - Galería (BLOQUE 7) intacta (g-hero + 10 thumbs SIN has-overlay).
  - Lightbox funcional (data-idx en thumbs).
  - PDF endpoints /api/pdf/ficha y /p/:slug/pdf.
  - Endpoints upload/sign (image + video).
  - Middleware ficha subdomain: /, /:id, hosts desconocidos.

El servidor Node monolito corre en localhost:3000. Todas las pruebas son
read-only o firmas HMAC — no persisten datos.
"""

import os
import re
import subprocess
import time
import socket

import pytest
import requests

BASE_URL = "http://localhost:3000"
FICHA_HOST = "ficha.mktscaled.com"
TENANT_ID = "2079e30e-62f5-4e2f-b976-d099535410e8"
PORTAL_SLUG = "departamento-en-tziara"
FICHA_ID = "L4B9TP"
FICHA_LAT = "21.1399676"
FICHA_LNG = "-86.8318964"

PANEL_JS = "/app/public/panel/app.js"
SERVER_JS = "/app/src/server.js"


# ---------------------------------------------------------------------------
# FIX 1 — Mapa en ficha orgánica
# ---------------------------------------------------------------------------
class TestFix1MapaFicha:
    """Google Maps embed aparece en ficha.<APP_DOMAIN>/:id cuando hay lat/lng."""

    def test_ficha_contiene_seccion_ubicacion(self):
        r = requests.get(f"{BASE_URL}/{FICHA_ID}", headers={"Host": FICHA_HOST}, timeout=15)
        assert r.status_code == 200, f"ficha {FICHA_ID} devolvió {r.status_code}"
        html = r.text
        # Título de sección
        assert "Ubicación" in html, "No se encontró el título 'Ubicación' en la ficha"

    def test_ficha_contiene_iframe_map_frame(self):
        r = requests.get(f"{BASE_URL}/{FICHA_ID}", headers={"Host": FICHA_HOST}, timeout=15)
        html = r.text
        # iframe con class="map-frame"
        m = re.search(r'<iframe[^>]*class="map-frame"[^>]*src="([^"]+)"[^>]*>', html)
        assert m, "No se encontró <iframe class='map-frame'> en la ficha"
        src = m.group(0)
        assert 'loading="lazy"' in src, "iframe map-frame debe tener loading='lazy'"
        embed_url = m.group(1)
        # Validar contenido del src del iframe
        # Debe ser google maps con q=lat,lng y output=embed
        assert "google.com/maps" in embed_url, f"src del iframe no apunta a google maps: {embed_url}"
        assert "output=embed" in embed_url, f"src del iframe no tiene output=embed: {embed_url}"
        # lat/lng URL-encoded: comma → %2C
        assert FICHA_LAT in embed_url, f"lat {FICHA_LAT} no aparece en src del iframe: {embed_url}"
        assert FICHA_LNG in embed_url or "-86.8318964" in embed_url, (
            f"lng {FICHA_LNG} no aparece en src del iframe: {embed_url}"
        )

    def test_ficha_contiene_boton_ver_en_google_maps(self):
        r = requests.get(f"{BASE_URL}/{FICHA_ID}", headers={"Host": FICHA_HOST}, timeout=15)
        html = r.text
        # Debe existir un <a> con texto "Ver en Google Maps" apuntando a maps.google
        m = re.search(
            r'<a[^>]+href="([^"]*google\.com/maps[^"]*)"[^>]*>[^<]*Ver en Google Maps',
            html,
        )
        assert m, "No se encontró el link 'Ver en Google Maps' con href a google.com/maps"
        href = m.group(1)
        assert FICHA_LAT in href, f"link Ver en Google Maps no tiene la latitud: {href}"


# ---------------------------------------------------------------------------
# FIX 2 — Overlay '+N fotos' completamente removido
# ---------------------------------------------------------------------------
class TestFix2OverlayRemovido:
    """El overlay '+N fotos' no debe aparecer ni en /p/:slug ni en ficha orgánica."""

    def test_portal_slug_sin_overlay(self):
        url = f"{BASE_URL}/p/{PORTAL_SLUG}?preview={TENANT_ID}"
        r = requests.get(url, timeout=15)
        assert r.status_code == 200, f"/p/{PORTAL_SLUG} devolvió {r.status_code}"
        html = r.text
        # Debe existir la galería
        assert "gallery-v2" in html, "gallery-v2 debería seguir presente"
        assert "g-hero" in html, "g-hero debería seguir presente"
        # NO debe haber overlay
        assert 'class="thumb-overlay"' not in html, "Encontró class='thumb-overlay' — debía removerse"
        assert 'thumb has-overlay' not in html, "Encontró 'thumb has-overlay' — debía removerse"
        # Texto '+ N fotos' visible al usuario (dentro de un elemento HTML — no en comentarios)
        # Extraer texto visible (quitando comentarios y tags)
        visible = re.sub(r'<!--.*?-->', '', html, flags=re.DOTALL)
        # match: '+ 4 fotos', '+4 fotos', '+ N fotos'
        assert not re.search(r'>\s*\+\s*\d+\s*fotos\s*<', visible), (
            "Se encontró texto '+N fotos' visible en el DOM"
        )

    def test_ficha_organica_sin_overlay(self):
        r = requests.get(f"{BASE_URL}/{FICHA_ID}", headers={"Host": FICHA_HOST}, timeout=15)
        assert r.status_code == 200
        html = r.text
        assert "gallery-v2" in html
        assert "g-hero" in html
        assert 'class="thumb-overlay"' not in html
        assert 'thumb has-overlay' not in html
        visible = re.sub(r'<!--.*?-->', '', html, flags=re.DOTALL)
        assert not re.search(r'>\s*\+\s*\d+\s*fotos\s*<', visible)

    def test_galeria_11_fotos_10_thumbs(self):
        """11 fotos totales → 1 hero + 10 thumbs sin overlay."""
        r = requests.get(f"{BASE_URL}/{FICHA_ID}", headers={"Host": FICHA_HOST}, timeout=15)
        html = r.text
        # Contar <a class="thumb" ...  data-idx=...>
        thumbs = re.findall(r'<a\s+class="thumb"[^>]*data-idx="\d+"', html)
        assert len(thumbs) == 10, f"Se esperaban 10 thumbs (11 fotos - 1 hero), encontrados {len(thumbs)}"
        # Hero con data-idx="0"
        assert re.search(r'<a\s+class="g-hero"[^>]*data-idx="0"', html), "No se encontró g-hero con data-idx='0'"

    def test_lightbox_funcional(self):
        r = requests.get(f"{BASE_URL}/{FICHA_ID}", headers={"Host": FICHA_HOST}, timeout=15)
        html = r.text
        # Elemento lightbox
        assert re.search(r'class="lightbox"', html) or "class=\"lightbox\"" in html, (
            "No se encontró el elemento .lightbox en la ficha"
        )

    def test_render_js_sin_css_thumb_overlay(self):
        """El CSS de .thumb-overlay debe estar removido del render.js."""
        with open("/app/src/lib/render.js", "r", encoding="utf-8") as f:
            content = f.read()
        # No debe existir ninguna regla CSS .thumb-overlay o .has-overlay
        assert ".thumb-overlay" not in content, "CSS .thumb-overlay debía haberse removido de render.js"
        assert ".has-overlay" not in content, "CSS .has-overlay debía haberse removido de render.js"


# ---------------------------------------------------------------------------
# FIX 3a — HTTPS redirect middleware (test aislado con mini-express)
# ---------------------------------------------------------------------------
def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture(scope="module")
def mini_express_https_redirect():
    """Levanta un mini-express que replica el middleware HTTPS redirect
    en producción, en un puerto libre. Se apaga al finalizar."""
    port = _free_port()
    script = f"""
const express = require('/app/node_modules/express');
const app = express();
app.set('trust proxy', true);

// Replica EXACTA del middleware de /app/src/server.js:48-56
const NODE_ENV = 'production';
app.use((req, res, next) => {{
  if (NODE_ENV !== 'production') return next();
  if (req.path === '/api/health' || req.path === '/health') return next();
  const proto = req.headers['x-forwarded-proto'];
  if (proto && proto.split(',')[0].trim() === 'http') {{
    return res.redirect(301, 'https://' + req.headers.host + req.url);
  }}
  next();
}});

app.get('*', (req, res) => res.status(200).send('OK ' + req.path));

const server = app.listen({port}, '127.0.0.1', () => {{
  console.log('mini-https-test listening on {port}');
}});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
"""
    script_path = "/tmp/mini_https_redirect.cjs"
    with open(script_path, "w") as f:
        f.write(script)
    proc = subprocess.Popen(
        ["node", script_path],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    # Esperar arranque
    deadline = time.time() + 8
    ready = False
    while time.time() < deadline:
        try:
            requests.get(f"http://127.0.0.1:{port}/ping", timeout=0.5, allow_redirects=False)
            ready = True
            break
        except Exception:
            time.sleep(0.15)
    if not ready:
        try:
            out, err = proc.communicate(timeout=1)
        except Exception:
            out, err = b"", b""
        proc.kill()
        pytest.fail(f"mini-express no arrancó en el puerto {port}. stderr: {err.decode(errors='ignore')}")
    yield port
    proc.terminate()
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()


class TestFix3aHttpsRedirect:
    """Middleware HTTPS: 301 si x-forwarded-proto=http, salvo health / dev."""

    def test_redirect_301_cuando_proto_es_http(self, mini_express_https_redirect):
        port = mini_express_https_redirect
        r = requests.get(
            f"http://127.0.0.1:{port}/p/x",
            headers={"x-forwarded-proto": "http", "Host": "example.com"},
            allow_redirects=False,
            timeout=5,
        )
        assert r.status_code == 301, f"Esperaba 301, obtuvo {r.status_code}"
        assert r.headers.get("Location") == "https://example.com/p/x", (
            f"Location incorrecto: {r.headers.get('Location')}"
        )

    def test_health_check_no_redirect_aunque_proto_sea_http(self, mini_express_https_redirect):
        port = mini_express_https_redirect
        for path in ("/api/health", "/health"):
            r = requests.get(
                f"http://127.0.0.1:{port}{path}",
                headers={"x-forwarded-proto": "http", "Host": "example.com"},
                allow_redirects=False,
                timeout=5,
            )
            assert r.status_code == 200, f"{path} debía pasar sin redirect (obtuvo {r.status_code})"
            assert r.text == f"OK {path}"

    def test_sin_header_proto_pasa_sin_redirect(self, mini_express_https_redirect):
        port = mini_express_https_redirect
        r = requests.get(
            f"http://127.0.0.1:{port}/p/x",
            headers={"Host": "example.com"},
            allow_redirects=False,
            timeout=5,
        )
        assert r.status_code == 200

    def test_proto_https_pasa_sin_redirect(self, mini_express_https_redirect):
        port = mini_express_https_redirect
        r = requests.get(
            f"http://127.0.0.1:{port}/p/x",
            headers={"x-forwarded-proto": "https", "Host": "example.com"},
            allow_redirects=False,
            timeout=5,
        )
        assert r.status_code == 200

    def test_middleware_esta_presente_en_server_js(self):
        """Sanity check estático — el middleware debe existir en el archivo real."""
        with open(SERVER_JS, "r", encoding="utf-8") as f:
            src = f.read()
        # El middleware exact líneas 48-56
        assert "trust proxy" in src
        assert "x-forwarded-proto" in src
        assert "res.redirect(301" in src
        assert "/api/health" in src and "/health" in src
        assert "env.nodeEnv !== 'production'" in src

    def test_health_endpoint_real_devuelve_200(self):
        """Sobre el server real (dev), /api/health debe estar disponible."""
        r = requests.get(f"{BASE_URL}/api/health", timeout=5)
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# FIX 3b — Mixed content: 0 líneas 'http://' en panel/app.js
# ---------------------------------------------------------------------------
class TestFix3bMixedContent:
    def test_panel_app_js_sin_http_urls(self):
        with open(PANEL_JS, "r", encoding="utf-8") as f:
            content = f.read()
        lines_with_http = [
            (i + 1, ln) for i, ln in enumerate(content.splitlines()) if "http://" in ln
        ]
        assert lines_with_http == [], (
            f"grep 'http://' en {PANEL_JS} devolvió {len(lines_with_http)} líneas: {lines_with_http[:5]}"
        )

    def test_panel_usa_window_location_origin(self):
        with open(PANEL_JS, "r", encoding="utf-8") as f:
            content = f.read()
        # portalBase debe usar window.location.origin
        assert "window.location.origin" in content
        # Y el patrón esperado en línea ~2211
        assert re.search(r"\$\{window\.location\.origin\}/\?preview=", content), (
            "No se encontró el patrón `${window.location.origin}/?preview=` en panel/app.js"
        )


# ---------------------------------------------------------------------------
# Regresiones
# ---------------------------------------------------------------------------
class TestRegressionPDF:
    def test_ficha_pdf_pages_2(self):
        r = requests.get(f"{BASE_URL}/api/pdf/ficha/{FICHA_ID}?pages=2", timeout=45)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"

    def test_portal_pdf_con_agente_2pag(self):
        url = f"{BASE_URL}/p/{PORTAL_SLUG}/pdf?v=con-agente-2pag&preview={TENANT_ID}"
        r = requests.get(url, timeout=45)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"


class TestRegressionUploadSign:
    """Los endpoints de firma requieren Bearer JWT — validamos que respondan 401
    (endpoint activo) y NO 404/500. Firma completa se cubrió en iter 12."""

    def test_sign_image_endpoint_activo(self):
        r = requests.post(f"{BASE_URL}/api/upload/sign", json={}, timeout=10)
        assert r.status_code in (400, 401, 403), (
            f"/api/upload/sign devolvió {r.status_code} (esperaba 401/403 sin token)"
        )

    def test_sign_video_endpoint_activo(self):
        r = requests.post(f"{BASE_URL}/api/upload/sign-video", json={}, timeout=10)
        assert r.status_code in (400, 401, 403), (
            f"/api/upload/sign-video devolvió {r.status_code} (esperaba 401/403 sin token)"
        )


class TestRegressionFichaSubdomain:
    def test_root_en_ficha_host_devuelve_404_ruta_no_valida(self):
        r = requests.get(f"{BASE_URL}/", headers={"Host": FICHA_HOST}, timeout=10)
        assert r.status_code == 404
        # Copy español
        assert "Ruta no válida" in r.text or "ruta no v" in r.text.lower()

    def test_ficha_id_con_ficha_host_renderiza_ficha(self):
        r = requests.get(f"{BASE_URL}/{FICHA_ID}", headers={"Host": FICHA_HOST}, timeout=15)
        assert r.status_code == 200
        # Ficha usa disclaimer "Ficha técnica · Información sujeta a verificación"
        assert "Ficha técnica" in r.text or "ficha-organica" in r.text or "organic-disclaimer" in r.text

    def test_host_desconocido_devuelve_portal_no_encontrado(self):
        r = requests.get(
            f"{BASE_URL}/",
            headers={"Host": "no-existe-jamas-random.example.com"},
            timeout=10,
        )
        assert r.status_code == 404
        assert "Portal no encontrado" in r.text
