// Helpers de acceso a la tabla `agentes` en Supabase.
// `findOrCreate` es idempotente vía UNIQUE(tenant_id, ghl_user_id) del schema.
import { getSupabase } from './supabase.js';

const TABLE = 'agentes';

const SELECT_PUBLIC = 'id, tenant_id, ghl_user_id, nombre, telefono, whatsapp, email, foto_url, rol, activo, created_at';

/** Devuelve el agente o null. */
export async function findAgentByGhlUser(tenantId, ghlUserId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from(TABLE)
    .select(SELECT_PUBLIC)
    .eq('tenant_id', tenantId)
    .eq('ghl_user_id', ghlUserId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Upsert idempotente del agente.
 * - Si ya existe (tenant_id + ghl_user_id), actualiza solo campos no-null pasados.
 * - Si no existe, lo crea con los valores recibidos.
 * No degrada de admin -> agente: si ya es admin, conserva su rol salvo que
 * se pase explícitamente `rol`.
 */
export async function upsertAgent({
  tenantId,
  ghlUserId,
  nombre,
  email,
  telefono,
  whatsapp,
  foto_url,
  rol,
}) {
  const sb = getSupabase();

  const existing = await findAgentByGhlUser(tenantId, ghlUserId);
  if (existing) {
    const update = {};
    if (nombre != null) update.nombre = nombre;
    if (email != null) update.email = email;
    if (telefono != null) update.telefono = telefono;
    if (whatsapp != null) update.whatsapp = whatsapp;
    if (foto_url != null) update.foto_url = foto_url;
    if (rol != null) update.rol = rol;
    if (Object.keys(update).length === 0) return existing;
    const { data, error } = await sb
      .from(TABLE)
      .update(update)
      .eq('id', existing.id)
      .select(SELECT_PUBLIC)
      .single();
    if (error) throw error;
    return data;
  }

  const insert = {
    tenant_id: tenantId,
    ghl_user_id: ghlUserId,
    nombre: nombre || 'Agente',
    email: email || null,
    telefono: telefono || null,
    whatsapp: whatsapp || null,
    foto_url: foto_url || null,
    rol: rol || 'agente',
    activo: true,
  };
  const { data, error } = await sb.from(TABLE).insert(insert).select(SELECT_PUBLIC).single();
  if (error) throw error;
  return data;
}

/** Asegura que exista al menos un admin del tenant. Si ya existía como agente,
 * lo eleva a admin. Si no existe, lo crea como admin. Idempotente. */
export async function ensureFirstAdmin(args) {
  return upsertAgent({ ...args, rol: 'admin' });
}
