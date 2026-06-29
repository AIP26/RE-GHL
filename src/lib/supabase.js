// Cliente Supabase (service role). Bypassa RLS — usar solo en backend.
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { env } from '../config/env.js';

let _client = null;

export function getSupabase() {
  if (_client) return _client;
  if (!env.supabase.url || !env.supabase.serviceKey) {
    throw new Error('Supabase no configurado (SUPABASE_URL / SUPABASE_SERVICE_KEY).');
  }
  _client = createClient(env.supabase.url, env.supabase.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Node < 22 no tiene WebSocket nativo; el cliente lo necesita aunque
    // no usemos realtime. Le damos `ws` como transport.
    realtime: { transport: ws },
  });
  return _client;
}
