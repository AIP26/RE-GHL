// Cliente Supabase (service role). Bypassa RLS — usar solo en backend.
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

let _client = null;

export function getSupabase() {
  if (_client) return _client;
  if (!env.supabase.url || !env.supabase.serviceKey) {
    throw new Error('Supabase no configurado (SUPABASE_URL / SUPABASE_SERVICE_KEY).');
  }
  _client = createClient(env.supabase.url, env.supabase.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
