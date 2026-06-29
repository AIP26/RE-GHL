# SQL — Schema de Supabase

Este directorio contiene el schema autoritativo de la base de datos.

## Archivos

- `schema.sql` — Paso 1 del Master Context v2.6. **8 tablas** con FKs, UNIQUEs,
  índices, constraints CHECK y RLS habilitado.

## Cómo aplicarlo

### Opción A — Supabase SQL Editor (recomendado para Fase 1)

1. Abre tu proyecto en https://app.supabase.com
2. Menú izquierdo → **SQL Editor**
3. **New query** → pega el contenido completo de `schema.sql`
4. **Run**

### Opción B — psql via CLI

```bash
# Toma la connection string desde Supabase -> Settings -> Database -> Connection string
psql "postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres" -f sql/schema.sql
```

## Verificar

Tras la ejecución, comprueba en **Table Editor**:

| Tabla | Filas iniciales |
|-------|-----------------|
| tenants | 0 |
| agentes | 0 |
| configuracion_marca | 0 |
| dominios | 0 |
| colecciones | 0 |
| propiedades_colecciones | 0 |
| fichas_url | 0 |
| page_views | 0 |

Y en **Database → Indexes** estos índices críticos:

- `idx_page_views_property_tenant`
- `idx_page_views_tenant_timestamp`
- `idx_tenants_status`
- `idx_agentes_tenant_activo`
- `idx_colecciones_tenant_slug`
- `idx_dominios_subdominio`

## Notas

- El schema es **idempotente** (`CREATE TABLE IF NOT EXISTS`). Puedes re-correrlo.
- **RLS está habilitado** en todas las tablas. El backend usa la `SERVICE_ROLE_KEY`
  (que bypassa RLS). NO crear policies abiertas a `anon`.
- `tenants.oauth_token` y `tenants.refresh_token` se guardan **ya cifrados**
  con AES-256-GCM por la app (ver `src/lib/encryption.js`). Supabase nunca
  ve los tokens en claro.
- El `updated_at` de `configuracion_marca` se mantiene vía trigger.
