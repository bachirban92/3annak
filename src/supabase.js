import { createClient } from '@supabase/supabase-js';

const env = import.meta.env || {};
const url = env.VITE_SUPABASE_URL || 'https://runerfftltmjlzvacjua.supabase.co';
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_AOCNlgJnP7v4NYCiGk7RSg_SlOHDVNf';

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
