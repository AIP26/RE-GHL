// CRUD agentes del tenant — Paso 8 (Mi equipo).
// - GET  /          → lista agentes activos (para dropdown del form propiedad)
// - GET  /?team=1   → lista TODOS los agentes (admin only) + counts + plan info
// - POST /          → crear agente (admin only, valida límite por plan)
// - PUT  /:id       → editar agente (admin only)
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { requireSession, requireAdmin } from '../middleware/auth.js';
import { getSupabase } from '../lib/supabase.js';
import { getTenantWithTokens } from '../lib/tenants.js';
import { listObjectRecords } from '../lib/ghl.js';
import { getFieldIds } from '../lib/field-ids.js';

const r = Router();

// Límite de agentes por plan (Master Context v2.6).
const PLAN_LIMITS = Object.freeze({
  starter: 1,
  pro: 5,
  agency: Infinity,
});

const SELECT_PUBLIC = 'id, ghl_user_id, nombre, telefono, whatsapp, email, foto_url, rol, activo, created_at';

// GET /api/agent
//   - default: solo activos, sin counts (usado por dropdown del form de propiedad)
//   - ?team=1 (admin only): todos + propiedades_count + plan info
r.get('/', requireSession, async (req, res) => {
  const sb = getSupabase();
  const teamMode = req.query.team === '1' || req.query.team === 'true';

  if (teamMode && req.agente?.rol !== 'admin') {
    return res.status(403).json({ error: 'admin_required' });
  }

  let q = sb
    .from('agentes')
    .select(SELECT_PUBLIC)
    .eq('tenant_id', req.tenant.id)
    .order('activo', { ascending: false })
    .order('rol', { ascending: false })
    .order('created_at', { ascending: true });
  if (!teamMode) q = q.eq('activo', true);

  const { data: agentes, error } = await q;
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });

  if (!teamMode) {
    return res.json({ agentes });
  }

  // teamMode: cargar conteo de propiedades por agente vía GHL.
  // Listamos hasta 500 records (suficiente para Starter=50, Pro=200, y la
  // mayoría de Agency en Fase 1). Si el tenant supera 500, los counts vienen
  // truncados — se loguea un warning para enterarse.
  const counts = {};
  try {
    const t = await getTenantWithTokens(req.tenant.id);
    const fieldIds = getFieldIds();
    const data = await listObjectRecords(t.access_token, fieldIds.objectKey, {
      locationId: req.tenant.ghl_location_id,
      limit: 100,
      offset: 0,
    });
    const records = data?.records || data?.data || [];
    for (const rec of records) {
      const userId = rec?.properties?.agente_responsable;
      if (!userId) continue;
      counts[userId] = (counts[userId] || 0) + 1;
    }
    const total = data?.total ?? records.length;
    if (total > records.length) {
      console.warn(`[agent/team] tenant ${req.tenant.id} tiene ${total} props, contamos ${records.length} (counts truncados)`);
    }
  } catch (err) {
    console.warn('[agent/team] count via GHL failed:', err?.response?.status, err?.message);
  }

  const limit = PLAN_LIMITS[req.tenant.plan] ?? 1;
  const activeCount = agentes.filter((a) => a.activo).length;

  res.json({
    agentes: agentes.map((a) => ({
      ...a,
      propiedades_count: counts[a.ghl_user_id] || 0,
      pending_ghl: typeof a.ghl_user_id === 'string' && a.ghl_user_id.startsWith('pending:'),
    })),
    plan: {
      name: req.tenant.plan,
      limit: limit === Infinity ? null : limit,
      activeCount,
      canAdd: activeCount < limit,
    },
  });
});

// POST /api/agent — crear agente manualmente desde "Mi equipo"
// Si no se provee ghl_user_id, se genera uno "pending:<uuid>" que se podrá
// reconciliar manualmente cuando ese agente entre por primera vez vía SSO.
r.post('/', requireSession, requireAdmin, async (req, res) => {
  const sb = getSupabase();
  const body = req.body || {};
  const nombre = String(body.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'nombre_required' });

  // Validar plan limit ANTES de crear.
  const limit = PLAN_LIMITS[req.tenant.plan] ?? 1;
  if (limit !== Infinity) {
    const { count, error: cErr } = await sb
      .from('agentes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', req.tenant.id)
      .eq('activo', true);
    if (cErr) return res.status(500).json({ error: 'db_error', message: cErr.message });
    if ((count || 0) >= limit) {
      return res.status(403).json({
        error: 'plan_limit_reached',
        plan: req.tenant.plan,
        limit,
        currentCount: count || 0,
        message: `Tu plan ${req.tenant.plan.toUpperCase()} permite máximo ${limit} agente${limit === 1 ? '' : 's'} activo${limit === 1 ? '' : 's'}.`,
      });
    }
  }

  const insert = {
    tenant_id: req.tenant.id,
    ghl_user_id: body.ghl_user_id || `pending:${randomUUID()}`,
    nombre,
    telefono: body.telefono || null,
    whatsapp: body.whatsapp || null,
    email: body.email || null,
    foto_url: body.foto_url || null,
    rol: body.rol === 'admin' ? 'admin' : 'agente',
    activo: body.activo !== false,
  };

  const { data, error } = await sb
    .from('agentes')
    .insert(insert)
    .select(SELECT_PUBLIC)
    .single();
  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'agent_already_exists', message: 'Ya existe un agente con ese GHL user ID en este tenant.' });
    }
    return res.status(500).json({ error: 'db_error', message: error.message });
  }
  res.json({ agente: { ...data, propiedades_count: 0, pending_ghl: data.ghl_user_id.startsWith('pending:') } });
});

// PUT /api/agent/:id — editar agente (admin only)
r.put('/:id', requireSession, requireAdmin, async (req, res) => {
  const sb = getSupabase();
  const allowed = ['nombre', 'telefono', 'whatsapp', 'email', 'foto_url', 'rol', 'activo', 'ghl_user_id'];
  const update = {};
  for (const k of allowed) if (k in req.body) update[k] = req.body[k];

  // Si se está reactivando un agente (activo: true), validar plan limit.
  if (update.activo === true) {
    const { data: current } = await sb
      .from('agentes').select('activo').eq('id', req.params.id).eq('tenant_id', req.tenant.id).maybeSingle();
    if (current && !current.activo) {
      const limit = PLAN_LIMITS[req.tenant.plan] ?? 1;
      if (limit !== Infinity) {
        const { count } = await sb
          .from('agentes').select('id', { count: 'exact', head: true })
          .eq('tenant_id', req.tenant.id).eq('activo', true);
        if ((count || 0) >= limit) {
          return res.status(403).json({
            error: 'plan_limit_reached',
            plan: req.tenant.plan,
            limit,
            currentCount: count || 0,
            message: `No puedes reactivar: tu plan ${req.tenant.plan.toUpperCase()} permite máximo ${limit} agente${limit === 1 ? '' : 's'} activo${limit === 1 ? '' : 's'}.`,
          });
        }
      }
    }
  }

  const { data, error } = await sb
    .from('agentes')
    .update(update)
    .eq('id', req.params.id)
    .eq('tenant_id', req.tenant.id)
    .select(SELECT_PUBLIC)
    .single();
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });
  res.json({ agente: data });
});

export default r;
