# 🏠 mktscaled-listings

Real Estate SaaS construido sobre **GoHighLevel**, distribuido vía Marketplace de GHL.
Un agente sube una propiedad en GHL y aparece automáticamente una página pública
profesional en el dominio del cliente. Master Context v2.6.

> Estado actual: **Paso 1 + estructura base** del orden de construcción (14 pasos).

## Stack

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js 20 + Express 4 |
| DB | Supabase (PostgreSQL) — 8 tablas |
| Storage fotos | Cloudinary |
| PDF | PDFKit (bajo demanda, sin almacenar) |
| Auth GHL | OAuth 2.0 + session tokens propios (JWT) |
| Mapas | Google Places + Maps Embed + Maps Static |
| Hosting | Railway **Pro** |
| Jobs | node-cron (refresh tokens cada 23h, verificación CNAME 60s) |

## Estructura del proyecto

```
.
├── sql/
│   ├── schema.sql              # Paso 1: schema completo de Supabase
│   └── README.md
├── src/
│   ├── server.js               # Entrada Express
│   ├── config/
│   │   └── env.js              # Carga + valida variables de entorno
│   ├── lib/
│   │   ├── supabase.js         # Cliente Supabase (service role)
│   │   ├── ghl.js              # Helper API de GHL (stub)
│   │   ├── cloudinary.js       # Helper Cloudinary (stub)
│   │   ├── encryption.js       # AES-256-GCM para tokens OAuth
│   │   └── jwt.js              # Session tokens del iframe
│   ├── middleware/
│   │   ├── tenant.js           # Detecta tenant por header Host
│   │   └── auth.js             # Verifica session token
│   ├── routes/
│   │   ├── index.js            # Registrador central
│   │   ├── health.js           # Health check
│   │   ├── auth.js             # OAuth GHL (Paso 2)
│   │   ├── webhook.js          # Install/uninstall (Paso 3)
│   │   ├── property.js         # CRUD propiedades (Paso 5)
│   │   ├── collection.js       # CRUD colecciones (Paso 7)
│   │   ├── upload.js           # Cloudinary (Paso 6)
│   │   ├── pdf.js              # PDFKit (Paso 12)
│   │   ├── share.js            # fichas_url (Paso 13)
│   │   ├── agent.js            # CRUD agentes (Paso 8)
│   │   ├── analytics.js        # page_views (Paso 9)
│   │   ├── domain.js           # CNAME verify (Paso 10)
│   │   └── public.js           # 5 páginas públicas (Paso 9)
│   └── jobs/
│       └── index.js            # node-cron scheduler (stub)
├── .env.example
├── .gitignore
├── package.json
├── railway.json
└── README.md
```

## Arranque local

```bash
# 1) Instala dependencias
yarn install   # o npm install

# 2) Copia las variables y rellena con tus credenciales
cp .env.example .env

# 3) Genera las claves criptográficas
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"

# 4) Aplica el schema en tu proyecto Supabase
#    Supabase → SQL Editor → pega sql/schema.sql → Run
#    O con psql:
#    psql "$DATABASE_URL" -f sql/schema.sql

# 5) Levanta el servidor en modo dev
yarn dev
# → http://localhost:8001/api/health
```

## Deploy a Railway Pro

1. Crea un proyecto nuevo en Railway → conecta este repo de GitHub.
2. Configura **todas** las variables de `.env.example` desde el dashboard.
3. Railway expone el puerto definido en `PORT` (default `8001`).
4. Agrega los **3 dominios** custom en el dashboard de Railway:
   - `listings.mktscaled.com`
   - `ficha.mktscaled.com`
   - `panel.mktscaled.com`
5. En el DNS de **mktscaled.com** (gestionado en GHL) crea los CNAMEs apuntando
   al dominio que Railway te asigna.
6. **Importante:** SSL para dominios custom de clientes (ej. `propiedades.thebrokers.mx`)
   requiere agregar cada dominio manualmente en Railway. No hay API. Documentado
   como tarea operativa del creador en el Master Context (decisión #4).

## Orden de construcción (14 pasos)

| # | Paso | Estado |
|---|------|--------|
| 1 | Schema Supabase (8 tablas) | ✅ |
| 2 | OAuth GHL + refresh tokens 23h | ✅ |
| 3 | Webhook instalar/desinstalar + primer agente admin + SSO iframe | ✅ |
| 4 | Custom Object "Propiedad" + `ghl-field-ids.json` | ⏳ |
| 5 | Menú lateral React (formulario completo) | ⏳ |
| 6 | Upload fotos → Cloudinary | ⏳ |
| 7 | CRUD Colecciones | ⏳ |
| 8 | Gestión de agentes + límites por plan | ⏳ |
| 9 | Portal público (5 páginas) + page_views | ⏳ |
| 10 | Configuración dominio (CNAME verify) | ⏳ |
| 11 | Personalización marca + widget de contacto | ⏳ |
| 12 | Ficha PDF (4 versiones) | ⏳ |
| 13 | URL orgánica (fichas_url) | ⏳ |
| 14 | API pública Fase 2 + Snapshot GHL + Marketplace | ⏳ |

## Reglas críticas del Master Context (resumen)

- Railway **Pro** obligatorio (Hobby hiberna).
- DNS gestionado en GHL — sin Cloudflare.
- GHL pasa `?locationId=xxx&userId=xxx` al iframe (NO JWT) — generamos session token propio.
- Primer agente admin se crea automáticamente en webhook de instalación.
- Amenidades en GHL: texto separado por `,`. Fotos en GHL: URLs separadas por `|`.
- PDF bajo demanda, stream directo, NO se almacena. Imágenes `/f_jpg` desde Cloudinary.
- Refresh tokens GHL cada 23h. Si falla → `status=needs_reauth`.
- Google Maps key SIN restricción de referrer (se usa en dominios de múltiples clientes).
- Slug anti-duplicado por tenant: sufijos `-2`, `-3`, ...
- `propiedades_colecciones` con `UNIQUE(propiedad_id, coleccion_id)`.
- Widget: WhatsApp **O** Live Chat GHL, nunca ambos.

## Licencia

Propietario — © The Brokers / mktscaled.com
