"""
Iteración 18 — BLOQUE P0: 8 fixes críticos.
Servidor Node monolito localhost:3000.

Tests:
  FIX 1: toggles cuarto_servicio/aire_acondicionado eliminados de SECTIONS,
         movidos a AMENIDADES, borrados de ghl-field-ids.json (54 fields) y
         step-4-create-custom-object.js.
  FIX 2: normalizeGhlOptionValue case-insensitive + strip acentos + snake→space.
         Se ejecuta el helper via node -e.
  FIX 3: Header 'Precio' (no 'Precio USD'), priceDisplay usa
         moneda_principal + precio_principal cuando raw > 0.
  FIX 4: code review — property.js POST hace upsert propiedades_colecciones con
         onConflict='propiedad_id,coleccion_id', count='exact', log del count.
  FIX 5: share url absoluta https://ficha.<APP_DOMAIN>/:id — live curl.
  FIX 6: HTTPS redirect en prod ficha.mktscaled.com — smoke test 301.
  FIX 7: /app/src/lib/ensure-custom-object.js expone ensureCustomObjectForLocation,
         llamado desde webhook.js y auth.js.
  FIX 8: PUT /api/agent/:id bloquea desactivar/degradar al único admin activo.
         Full workflow con cleanup via supabase.
  Regresión: /api/health, /buscar preview, /p/departamento-en-tziara preview,
             /L4B9TP con Host ficha.mktscaled.com, /api/upload/sign-video con
             bearer, panel/, panel subdomain.
"""
import json
import os
import re
import subprocess
import time
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:3000").rstrip("/")
APP_DIR = Path("/app")
LOCATION_ID = "cNg6MFQcxv8bZnwCppoM"
USER_ID = "pyr7tK7t6wBZMpsL5pFJ"
TENANT_ID = "2079e30e-62f5-4e2f-b976-d099535410e8"
JAHIR_AGENT_ID = "20792b2f-49fb-4d5d-bf67-2ad9e9e7ca72"   # admin activo
PYR_AGENT_ID = "d2522af1-e1fd-48c3-83bc-5c78bce037c4"    # admin activo (SSO)
PROPERTY_ID = "6a43eeec2f3969c31fb1999a"
FICHA_SLUG = "L4B9TP"
PORTAL_SLUG = "departamento-en-tziara"
SUPABASE_URL = "https://mmyxtmkzggpjyufqpgth.supabase.co"


@pytest.fixture(scope="session")
def sso_token():
    r = requests.get(
        f"{BASE_URL}/api/auth/sso",
        params={"locationId": LOCATION_ID, "userId": USER_ID},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def supabase_key():
    env = (APP_DIR / ".env").read_text()
    m = re.search(r"^SUPABASE_SERVICE_KEY=(.+)$", env, flags=re.M)
    assert m, "SUPABASE_SERVICE_KEY missing in /app/.env"
    return m.group(1).strip()


# =====================================================================
# FIX 1 — toggles removidos, movidos a AMENIDADES
# =====================================================================
class TestFix1TogglesRemoved:
    def test_app_js_no_toggle_keys(self):
        js = (APP_DIR / "public/panel/app.js").read_text()
        # ninguna definición { key: 'cuarto_servicio' ... } o similar
        for key in ("cuarto_servicio", "aire_acondicionado"):
            assert f"key: '{key}'" not in js, f"toggle {key} sigue en SECTIONS"
            assert f'key: "{key}"' not in js, f"toggle {key} sigue en SECTIONS"

    def test_amenidades_has_both(self):
        js = (APP_DIR / "public/panel/app.js").read_text()
        m = re.search(r"const AMENIDADES\s*=\s*\[([^\]]+)\];", js)
        assert m, "AMENIDADES array no encontrado"
        arr = m.group(1)
        assert "Cuarto de servicio" in arr
        assert "Aire acondicionado" in arr

    def test_ghl_field_ids_json_54_no_removed(self):
        data = json.loads((APP_DIR / "ghl-field-ids.json").read_text())
        # el archivo puede tener {fields:{...}} o ser {...} directo
        fields = data.get("fields", data)
        keys = list(fields.keys()) if isinstance(fields, dict) else [f.get("fieldKey") or f.get("key") for f in fields]
        assert len(keys) == 54, f"esperaba 54 fields, hay {len(keys)}"
        assert "cuarto_servicio" not in keys
        assert "aire_acondicionado" not in keys

    def test_step4_script_no_removed_keys(self):
        js = (APP_DIR / "scripts/step-4-create-custom-object.js").read_text()
        # las definiciones tenían fieldKey: 'cuarto_servicio'
        assert "fieldKey: 'cuarto_servicio'" not in js
        assert "fieldKey: 'aire_acondicionado'" not in js
        assert 'fieldKey: "cuarto_servicio"' not in js
        assert 'fieldKey: "aire_acondicionado"' not in js

    def test_ensure_custom_object_no_removed(self):
        js = (APP_DIR / "src/lib/ensure-custom-object.js").read_text()
        assert "fieldKey: 'cuarto_servicio'" not in js
        assert "fieldKey: 'aire_acondicionado'" not in js


# =====================================================================
# FIX 2 — normalizeGhlOptionValue case-insensitive
# =====================================================================
class TestFix2NormalizeSelect:
    def test_function_exists_and_called_only_for_select(self):
        js = (APP_DIR / "public/panel/app.js").read_text()
        assert "function normalizeGhlOptionValue" in js
        # el switch por f.type === 'select' debe llamar normalizeGhlOptionValue
        # buscamos la línea: state[f.key] = normalizeGhlOptionValue(v, f.options);
        idx = js.find("normalizeGhlOptionValue(v, f.options)")
        assert idx > 0, "normalizeGhlOptionValue no está siendo llamada en deserializeFromRecord"
        # antes de esa línea debe haber f.type === 'select'
        preceding = js[max(0, idx - 300):idx]
        assert "f.type === 'select'" in preceding, "normalizeGhlOptionValue debe llamarse SOLO dentro de la rama select"

    @pytest.mark.parametrize(
        "raw, options, expected",
        [
            # snake_case → capitalized
            ("departamento", ["Casa", "Departamento"], "Departamento"),
            # multi-word snake_case → space
            ("libre_de_gravamen", ["Libre de gravamen", "Otro (consultar)"], "Libre de gravamen"),
            # diacríticos: raw sin acento, option con acento
            ("necesita_remodelacion", ["Nuevo", "Necesita remodelación"], "Necesita remodelación"),
            # ya match exacto
            ("MXN", ["USD", "MXN", "CAD"], "MXN"),
            # lowercase → uppercase option
            ("mxn", ["USD", "MXN", "CAD"], "MXN"),
            # empty string → devuelve como vino
            ("", ["A", "B"], ""),
            # sin match → devuelve raw
            ("desconocido_valor", ["Nuevo"], "desconocido_valor"),
        ],
    )
    def test_normalize_unit(self, raw, options, expected, tmp_path):
        """Ejecuta la función real vía node -e extrayendo su código del app.js."""
        js = (APP_DIR / "public/panel/app.js").read_text()
        m = re.search(
            r"function normalizeGhlOptionValue\([^)]*\)\s*\{.*?\n  \}",
            js,
            flags=re.S,
        )
        assert m, "no pude extraer la función normalizeGhlOptionValue"
        fn = m.group(0)
        script = (
            fn
            + f"\nconst r = normalizeGhlOptionValue({json.dumps(raw)}, {json.dumps(options)});"
            + "\nprocess.stdout.write(String(r));"
        )
        p = subprocess.run(
            ["node", "-e", script],
            capture_output=True,
            text=True,
            timeout=10,
        )
        assert p.returncode == 0, p.stderr
        assert p.stdout == expected, f"got={p.stdout!r} expected={expected!r}"


# =====================================================================
# FIX 3 — header 'Precio' y priceDisplay
# =====================================================================
class TestFix3PriceDisplay:
    def test_header_says_precio_not_usd(self):
        js = (APP_DIR / "public/panel/app.js").read_text()
        assert "<th>Precio</th>" in js
        assert "<th>Precio USD</th>" not in js
        assert ">Precio USD<" not in js

    def test_price_display_uses_moneda_principal(self):
        js = (APP_DIR / "public/panel/app.js").read_text()
        # bloque priceDisplay debe usar moneda_principal cuando rawPrincipal > 0
        # y caer a precio_usd legacy si es lo único
        assert "moneda_principal" in js
        assert "rawPrincipal > 0" in js
        assert "precio_usd" in js
        assert "listing-price" in js


# =====================================================================
# FIX 4 — colecciones upsert al crear (code review)
# =====================================================================
class TestFix4CollectionsUpsert:
    def test_property_post_upsert_block(self):
        js = (APP_DIR / "src/routes/property.js").read_text()
        # bloque if collections en POST
        assert "Array.isArray(body._collections)" in js
        # lee record.id o record._id
        assert "record?.id || record?._id" in js
        # console.error si sin recordId
        assert "sin recordId" in js
        # upsert con onConflict y count exact
        assert "onConflict: 'propiedad_id,coleccion_id'" in js
        assert "count: 'exact'" in js
        # log de éxito
        assert "colecciones asignadas" in js
        assert "recordId=" in js


# =====================================================================
# FIX 5 — share url absoluta (live curl)
# =====================================================================
class TestFix5ShareUrlAbsolute:
    def test_get_share_returns_absolute_urls(self, sso_token):
        r = requests.get(
            f"{BASE_URL}/api/share/{PROPERTY_ID}",
            headers={"Authorization": f"Bearer {sso_token}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("cname_target") == "ficha.mktscaled.com"
        ficha = body.get("ficha") or {}
        url = ficha.get("url", "")
        portal_path = ficha.get("portal_path", "")
        assert url.startswith("https://ficha.mktscaled.com/"), f"url no absoluta: {url}"
        assert portal_path.startswith("https://ficha.mktscaled.com/"), f"portal_path no absoluta: {portal_path}"
        assert url == portal_path, "url y portal_path deben ser idénticos"
        # id embebido en la URL
        fid = ficha.get("id")
        assert fid and url.endswith(f"/{fid}")

    def test_post_share_returns_absolute_urls(self, sso_token):
        r = requests.post(
            f"{BASE_URL}/api/share/{PROPERTY_ID}",
            headers={"Authorization": f"Bearer {sso_token}", "Content-Type": "application/json"},
            json={},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        ficha = r.json().get("ficha") or {}
        assert ficha.get("url", "").startswith("https://ficha.mktscaled.com/")
        assert ficha.get("portal_path", "").startswith("https://ficha.mktscaled.com/")
        assert ficha["url"] == ficha["portal_path"]


# =====================================================================
# FIX 6 — HTTPS redirect en prod (smoke test)
# =====================================================================
class TestFix6HttpsRedirectProd:
    def test_prod_http_to_https_redirect(self):
        try:
            r = requests.head(
                f"http://ficha.mktscaled.com/{FICHA_SLUG}",
                allow_redirects=False,
                timeout=10,
            )
        except requests.exceptions.RequestException as e:
            pytest.skip(f"prod unreachable: {e}")
        assert r.status_code == 301, f"esperaba 301, got {r.status_code}"
        loc = r.headers.get("location", "")
        assert loc == f"https://ficha.mktscaled.com/{FICHA_SLUG}", f"location incorrecta: {loc}"


# =====================================================================
# FIX 7 — auto-provision Custom Object (code review)
# =====================================================================
class TestFix7EnsureCustomObject:
    def test_ensure_custom_object_lib_exports_fn(self):
        js = (APP_DIR / "src/lib/ensure-custom-object.js").read_text()
        assert "export async function ensureCustomObjectForLocation" in js
        # debe retornar { objectKey, created, skipped, failed }
        assert "objectKey" in js
        assert "created" in js
        assert "skipped" in js
        assert "failed" in js

    def test_ensure_lib_no_removed_fields(self):
        js = (APP_DIR / "src/lib/ensure-custom-object.js").read_text()
        # la lista FIELDS no debe incluir cuarto_servicio ni aire_acondicionado
        assert "'cuarto_servicio'" not in js
        assert '"cuarto_servicio"' not in js
        assert "'aire_acondicionado'" not in js
        assert '"aire_acondicionado"' not in js

    def test_webhook_imports_and_calls_ensure(self):
        js = (APP_DIR / "src/routes/webhook.js").read_text()
        assert "import { ensureCustomObjectForLocation }" in js or \
               "from '../lib/ensure-custom-object.js'" in js
        assert "ensureCustomObjectForLocation" in js
        # debe estar tras ensureFirstAdmin en handleInstall
        idx_first_admin = js.find("ensureFirstAdmin({")
        idx_ensure = js.find("ensureCustomObjectForLocation", idx_first_admin if idx_first_admin > 0 else 0)
        assert idx_first_admin > 0 and idx_ensure > idx_first_admin, \
            "ensureCustomObjectForLocation debe llamarse tras ensureFirstAdmin"
        # dentro de try/catch (log pero no propaga)
        # simple heuristica: hay un try y catch que rodea la llamada
        surroundings = js[max(0, idx_ensure - 200):idx_ensure + 400]
        assert "try {" in surroundings
        assert "catch" in surroundings

    def test_auth_calls_ensure_after_provision(self):
        js = (APP_DIR / "src/routes/auth.js").read_text()
        assert "ensureCustomObjectForLocation" in js
        # dentro de tryProvisionFromAgency, tras upsertTenantFromOAuth
        idx_upsert = js.find("upsertTenantFromOAuth({")
        idx_ensure = js.find("ensureCustomObjectForLocation", idx_upsert if idx_upsert > 0 else 0)
        assert idx_upsert > 0 and idx_ensure > idx_upsert, \
            "ensureCustomObjectForLocation debe llamarse tras upsertTenantFromOAuth"


# =====================================================================
# FIX 8 — último admin protegido
# =====================================================================
def _sb_patch(supabase_key, table, filter_col, filter_val, patch):
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}?{filter_col}=eq.{filter_val}",
        headers={
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        json=patch,
        timeout=15,
    )
    return r


class TestFix8LastAdminProtected:
    """
    Estado inicial: tenant 2079e30e-... con 2 admins activos:
      - 20792b2f-... (Jahir)
      - d2522af1-... (Agente-Pyr)
    """

    def _get_agents(self, sso_token):
        r = requests.get(
            f"{BASE_URL}/api/agent",
            headers={"Authorization": f"Bearer {sso_token}"},
            params={"team": "1"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        return {a["id"]: a for a in r.json()["agentes"]}

    def test_precondition_two_admins_active(self, sso_token, supabase_key):
        # Aseguramos por DB que ambos admins estén activos ANTES de correr los tests
        _sb_patch(supabase_key, "agentes", "id", JAHIR_AGENT_ID, {"rol": "admin", "activo": True})
        _sb_patch(supabase_key, "agentes", "id", PYR_AGENT_ID, {"rol": "admin", "activo": True})
        agents = self._get_agents(sso_token)
        admins_active = [a for a in agents.values() if a["rol"] == "admin" and a["activo"]]
        assert len(admins_active) >= 2, f"esperaba 2+ admins activos: {admins_active}"

    def test_d_edit_nombre_only_on_admin_ok(self, sso_token):
        """(d) Editar sólo nombre/telefono sin tocar activo/rol → 200 OK."""
        r = requests.put(
            f"{BASE_URL}/api/agent/{PYR_AGENT_ID}",
            headers={"Authorization": f"Bearer {sso_token}", "Content-Type": "application/json"},
            json={"nombre": "Agente"},  # mismo nombre
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["agente"]["nombre"] == "Agente"

    def test_c_two_admins_can_deactivate_one(self, sso_token, supabase_key):
        """(c) Con 2 admins activos, PUT activo=false sobre uno → 200 OK."""
        # nos aseguramos que están 2 activos
        _sb_patch(supabase_key, "agentes", "id", JAHIR_AGENT_ID, {"rol": "admin", "activo": True})
        _sb_patch(supabase_key, "agentes", "id", PYR_AGENT_ID, {"rol": "admin", "activo": True})
        r = requests.put(
            f"{BASE_URL}/api/agent/{JAHIR_AGENT_ID}",
            headers={"Authorization": f"Bearer {sso_token}", "Content-Type": "application/json"},
            json={"activo": False},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["agente"]["activo"] is False

    def test_a_last_admin_cannot_be_deactivated(self, sso_token, supabase_key):
        """(a) Con sólo 1 admin activo, PUT activo=false → 400 last_admin_protected."""
        # forzamos estado: Jahir=inactive, Pyr=admin+activo
        _sb_patch(supabase_key, "agentes", "id", JAHIR_AGENT_ID, {"activo": False, "rol": "admin"})
        _sb_patch(supabase_key, "agentes", "id", PYR_AGENT_ID, {"rol": "admin", "activo": True})
        r = requests.put(
            f"{BASE_URL}/api/agent/{PYR_AGENT_ID}",
            headers={"Authorization": f"Bearer {sso_token}", "Content-Type": "application/json"},
            json={"activo": False},
            timeout=15,
        )
        assert r.status_code == 400, r.text
        body = r.json()
        assert body["error"] == "last_admin_protected"
        assert "único administrador activo" in body.get("message", "")

    def test_b_last_admin_cannot_be_demoted(self, sso_token, supabase_key):
        """(b) Con sólo 1 admin activo, PUT rol='agente' → 400 last_admin_protected."""
        _sb_patch(supabase_key, "agentes", "id", JAHIR_AGENT_ID, {"activo": False, "rol": "admin"})
        _sb_patch(supabase_key, "agentes", "id", PYR_AGENT_ID, {"rol": "admin", "activo": True})
        r = requests.put(
            f"{BASE_URL}/api/agent/{PYR_AGENT_ID}",
            headers={"Authorization": f"Bearer {sso_token}", "Content-Type": "application/json"},
            json={"rol": "agente"},
            timeout=15,
        )
        assert r.status_code == 400, r.text
        assert r.json()["error"] == "last_admin_protected"

    def test_d2_edit_nombre_when_only_admin_ok(self, sso_token, supabase_key):
        """(d) Editar sólo nombre sobre el único admin (sin tocar activo/rol) → 200 OK."""
        _sb_patch(supabase_key, "agentes", "id", JAHIR_AGENT_ID, {"activo": False, "rol": "admin"})
        _sb_patch(supabase_key, "agentes", "id", PYR_AGENT_ID, {"rol": "admin", "activo": True})
        r = requests.put(
            f"{BASE_URL}/api/agent/{PYR_AGENT_ID}",
            headers={"Authorization": f"Bearer {sso_token}", "Content-Type": "application/json"},
            json={"nombre": "Agente", "telefono": None},
            timeout=15,
        )
        assert r.status_code == 200, r.text

    def test_zz_cleanup_restore_two_admins(self, supabase_key):
        """Cleanup: dejamos el tenant con 2 admins activos (vía DB directa,
        porque la API bloquea por plan_limit_reached en starter)."""
        r1 = _sb_patch(supabase_key, "agentes", "id", JAHIR_AGENT_ID, {"rol": "admin", "activo": True})
        r2 = _sb_patch(supabase_key, "agentes", "id", PYR_AGENT_ID, {"rol": "admin", "activo": True})
        assert r1.status_code < 400, r1.text
        assert r2.status_code < 400, r2.text


# =====================================================================
# Regresión Bloques 6-18
# =====================================================================
class TestRegresion:
    def test_api_health(self):
        r = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_buscar_preview(self):
        r = requests.get(
            f"{BASE_URL}/buscar",
            params={"preview": TENANT_ID},
            timeout=15,
        )
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "")

    def test_portal_slug_preview(self):
        r = requests.get(
            f"{BASE_URL}/p/{PORTAL_SLUG}",
            params={"preview": TENANT_ID},
            timeout=15,
        )
        assert r.status_code == 200
        html = r.text
        assert "text/html" in r.headers.get("content-type", "")

    def test_ficha_by_slug_host(self, sso_token):
        # obtenemos el id ficha activo actual (L4B9TP en el request es stale)
        rs = requests.get(
            f"{BASE_URL}/api/share/{PROPERTY_ID}",
            headers={"Authorization": f"Bearer {sso_token}"},
            timeout=15,
        )
        assert rs.status_code == 200
        ficha_id = rs.json()["ficha"]["id"]
        r = requests.get(
            f"{BASE_URL}/{ficha_id}",
            headers={"Host": "ficha.mktscaled.com"},
            timeout=15,
        )
        assert r.status_code == 200, r.text[:300]

    def test_sign_video_with_bearer(self, sso_token):
        r = requests.post(
            f"{BASE_URL}/api/upload/sign-video",
            headers={"Authorization": f"Bearer {sso_token}", "Content-Type": "application/json"},
            json={},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "signature" in body
        assert "timestamp" in body

    def test_panel_legacy_path(self):
        r = requests.get(
            f"{BASE_URL}/panel/",
            params={"locationId": LOCATION_ID, "userId": USER_ID},
            timeout=15,
        )
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "")

    def test_panel_subdomain_root(self):
        r = requests.get(
            f"{BASE_URL}/",
            headers={"Host": "panel.mktscaled.com"},
            params={"locationId": LOCATION_ID, "userId": USER_ID},
            timeout=15,
        )
        # panel subdomain sirve el HTML del panel
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "")
