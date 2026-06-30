// Analytics — counts agregados de page_views para Mis listings y Dashboard.
import { Router } from 'express';
import { requireSession } from '../middleware/auth.js';
import { getSupabase } from '../lib/supabase.js';

const r = Router();

// GET /api/analytics/views?ids=id1,id2,id3 → { counts: { id: N } }
// Cuenta page_views por propiedad para el tenant del request.
r.get('/views', requireSession, async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return res.json({ counts: {} });
  const sb = getSupabase();
  const { data, error } = await sb
    .from('page_views')
    .select('property_id')
    .eq('tenant_id', req.tenant.id)
    .in('property_id', ids);
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });
  const counts = {};
  for (const row of data || []) {
    counts[row.property_id] = (counts[row.property_id] || 0) + 1;
  }
  res.json({ counts });
});

// GET /api/analytics/dashboard → top 5 + totales
r.get('/dashboard', requireSession, async (req, res) => {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('page_views')
    .select('property_id, timestamp')
    .eq('tenant_id', req.tenant.id)
    .order('timestamp', { ascending: false })
    .limit(2000);
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });
  const counts = {};
  for (const v of data || []) counts[v.property_id] = (counts[v.property_id] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([property_id, vistas]) => ({ property_id, vistas }));
  res.json({ total_vistas: (data || []).length, top });
});

export default r;
