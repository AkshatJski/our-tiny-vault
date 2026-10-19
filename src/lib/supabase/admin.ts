import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

let adminClient: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses RLS *by design* — it exists for exactly two
 * callers: the daily cron and the realtime ticket endpoint's presence check.
 *
 * Rules of engagement:
 *   • never import this into a Client Component (the bundle would ship the key)
 *   • never pass user input straight into a query without an explicit filter
 *   • every route that uses it must verify who is asking first
 */
export function createAdminSupabase(): SupabaseClient {
  if (!env.supabaseServiceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is missing. The cron and realtime ticket routes need it.',
    );
  }
  if (!env.supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is missing.');
  }
  if (!adminClient) {
    adminClient = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { 'x-application-name': 'our-tiny-vault-cron' } },
    });
  }
  return adminClient;
}
