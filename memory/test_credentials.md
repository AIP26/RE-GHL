# Test Credentials — mktscaled-listings

## Auth
Este proyecto usa SSO con GHL vía URL params (locationId + userId). NO hay
usuarios/contraseñas — el JWT del panel se firma con `SESSION_JWT_SECRET`
después de resolver ambos IDs contra la BD.

## Tenant de prueba
- `ghl_location_id`: `cNg6MFQcxv8bZnwCppoM`
- `tenant_id (Supabase)`: `2079e30e-62f5-4e2f-b976-d099535410e8`
- `subdominio`: `propiedades.thebrokers.info`
- `plan`: agency

## Admin agent de prueba
- `ghl_user_id`: `pyr7tK7t6wBZMpsL5pFJ`
- `nombre`: Jahir Hutchinson
- `rol`: admin
- `email`: jahir@thebrokers.mx

## Panel URL con SSO automático
```
https://eb5bd729-2833-4599-9985-8f2a208e577f.preview.emergentagent.com/panel/?locationId=cNg6MFQcxv8bZnwCppoM&userId=pyr7tK7t6wBZMpsL5pFJ
```

## Propiedad de prueba (con 11 fotos)
- `id (GHL record)`: `6a43eeec2f3969c31fb1999a`
- `slug_url`: `departamento-en-tziara`
- `titulo`: Departamento en Tziara

## Portal público
```
http://localhost:3000/p/departamento-en-tziara?preview=2079e30e-62f5-4e2f-b976-d099535410e8
```
(el `?preview=<tenant_id>` bypasea la resolución por Host header)
