# API pública v1 — mktscaled listings

Documentación de la API REST pública (Paso 14 del Master Context v2.6).
Permite a sitios externos, CRMs, MLS u otras automatizaciones leer el
inventario inmobiliario de un tenant.

> **Versión:** v1 (estable)
> **Formato:** JSON
> **Auth:** API key per-tenant (header)

---

## 1. Generar tu API key

1. Entra al panel GHL → **Configuración** → pestaña **API**.
2. Dale un nombre a la key (ej. *"Web pública 2026"* o *"Zapier"*) y haz clic en **Generar API key**.
3. **Copia la key inmediatamente** — la mostramos una sola vez en texto plano. Si la pierdes, deberás generar una nueva.
4. Guárdala en un gestor seguro (1Password, Bitwarden, Doppler, etc.). Nunca la subas a Git.

Cada key:

- Está vinculada a tu tenant (no permite acceso a propiedades de otros).
- Es revocable y reactivable en cualquier momento desde el panel.
- Se identifica visualmente por su prefix (primeros 12 chars, ej. `mks_AbCd1234`).
- Se hashea con SHA-256 en la base de datos — **el plain nunca se almacena**.

---

## 2. Autenticación

Envía la key en uno de estos dos headers:

```http
X-API-Key: mks_AbCd1234efGh5678…
```

o bien:

```http
Authorization: Bearer mks_AbCd1234efGh5678…
```

Sin key o con key inválida la API responde **401 Unauthorized**.

---

## 3. Base URL

```
https://<tu-dominio-mktscaled>/api/v1
```

> Sustituye `<tu-dominio-mktscaled>` por el dominio donde tienes desplegado
> el backend (ej. `panel.mktscaled.com` o tu instancia self-hosted).

La documentación viva se sirve en:

```
GET /api/v1/docs
```

(sin auth — Markdown plano para humanos).

---

## 4. Endpoints

### 4.1 `GET /properties`

Lista propiedades del tenant. Soporta filtros y búsqueda.

**Query params:**

| Param        | Tipo    | Descripción                                                     |
|--------------|---------|-----------------------------------------------------------------|
| `limit`      | int     | Máx 50 (default 50)                                             |
| `collection` | string  | Slug de colección — filtra solo propiedades de esa colección    |
| `operacion`  | string  | `venta` \| `renta`                                              |
| `tipo`       | string  | `casa` \| `departamento` \| `terreno` \| …                      |
| `q`          | string  | Búsqueda full-text en título / descripción / ubicación          |

**Ejemplo curl:**

```bash
KEY="mks_AbCd1234…"
BASE="https://panel.mktscaled.com/api/v1"

curl -H "X-API-Key: $KEY" \
  "$BASE/properties?tipo=casa&operacion=venta&limit=10"
```

**Respuesta 200:**

```json
{
  "data": [
    {
      "id": "6a431a1df7d1f2b4480b5374",
      "slug": "casa-zona-hotelera-cancun",
      "titulo": "Casa Zona Hotelera 3 recámaras",
      "descripcion": "Hermosa casa frente al mar…",
      "operacion": "venta",
      "tipo": "casa",
      "estado": "disponible",
      "etiqueta": "destacado",
      "precio_usd": 450000,
      "precio_mxn": null,
      "precio_a_consultar": false,
      "ubicacion": {
        "colonia": "Zona Hotelera",
        "ciudad": "Cancún",
        "estado": "Quintana Roo",
        "codigo_postal": "77500",
        "latitud": 21.1619,
        "longitud": -86.8515
      },
      "medidas": {
        "m2_construccion": 220,
        "m2_terreno": 300,
        "recamaras": 3,
        "banos_completos": 3,
        "medios_banos": 1,
        "estacionamientos": 2
      },
      "amenidades": ["Alberca", "Vigilancia 24h", "Gym"],
      "fotos": [
        "https://res.cloudinary.com/<cloud>/image/upload/.../1.webp",
        "https://res.cloudinary.com/<cloud>/image/upload/.../2.webp"
      ],
      "video_url": null,
      "tour_virtual_url": "https://my.matterport.com/show/?m=…",
      "agente_id": "ghl_user_id_aqui",
      "fecha_publicacion": "2026-02-15"
    }
  ],
  "count": 1
}
```

### 4.2 `GET /properties/:id`

Detalle de una propiedad por su GHL record ID.

```bash
curl -H "X-API-Key: $KEY" \
  "$BASE/properties/6a431a1df7d1f2b4480b5374"
```

**Respuesta 200:** mismo shape que un elemento de `/properties`, dentro de
`{ "data": { … } }`.

**404 not_found** si el ID no existe o pertenece a otro tenant.

### 4.3 `GET /collections`

Lista las colecciones del tenant.

```bash
curl -H "X-API-Key: $KEY" "$BASE/collections"
```

**Respuesta 200:**

```json
{
  "data": [
    {
      "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "nombre": "Inversión Cancún",
      "slug": "inversion-cancun",
      "foto_url": "https://res.cloudinary.com/<cloud>/...",
      "created_at": "2026-01-30T18:22:00Z"
    }
  ],
  "count": 1
}
```

Para listar las propiedades de una colección concreta:

```bash
curl -H "X-API-Key: $KEY" \
  "$BASE/properties?collection=inversion-cancun"
```

### 4.4 `GET /docs`

Devuelve esta misma documentación en Markdown (sin auth — público).

---

## 5. Errores

| HTTP | `error`             | Causa                                              |
|------|---------------------|----------------------------------------------------|
| 401  | `api_key_required`  | No enviaste header                                 |
| 401  | `invalid_api_key`   | Key no existe, está desactivada o fue eliminada    |
| 404  | `not_found`         | ID/slug no existe en tu tenant                     |
| 500  | `db_error`          | Error de base de datos (raro — reporta el caso)    |
| 500  | `server_error`      | Error inesperado del servidor                      |

Todos los errores devuelven JSON:

```json
{ "error": "invalid_api_key" }
```

---

## 6. Límites

- **Sin rate-limit** en Fase 1. Si abusas (>30 req/s sostenidos), agregaremos
  throttling per-key sin previo aviso.
- `limit` máximo de `/properties` es 50 (clamp del backend).
- El payload sanitiza la respuesta — no exponemos campos raw de GHL ni
  identificadores internos de Supabase.

---

## 7. Buenas prácticas

- **No** uses esta API desde JavaScript en el navegador del cliente final
  con la key en claro — expondrías tu key. Llama desde tu backend o
  cachea la respuesta server-side.
- Para sitios estáticos (Next.js, Astro, Hugo), genera el JSON en build
  time y publícalo como assets.
- Si necesitas exponer datos en el navegador, considera publicar el JSON
  ya filtrado en tu CDN.

---

## 8. Roadmap

Próximas funciones planificadas (Fase 2):

- Endpoint `POST /properties` (crear desde fuentes externas tipo MLS).
- Webhooks salientes `property.created`, `property.updated`, `property.sold`.
- Rate-limit configurable por plan.
- API key scopes (read-only vs read-write).

¿Necesitas algo que no está acá? Abre un issue o escríbenos.
