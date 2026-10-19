'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/**
 * One browser client for the whole tab.
 *
 * Creating a second client means a second realtime socket, and the free tier
 * counts *concurrent connections* (200 global). A singleton is not just
 * tidiness here, it is budget discipline.
 */
let browserClient: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient {
  if (!env.isSupabaseConfigured) {
    throw new Error('Supabase env vars are missing. See .env.example.');
  }
  if (!browserClient) {
    browserClient = createBrowserClient(env.supabaseUrl, env.supabaseAnonKey, {
      realtime: {
        // Party chat is tiny; a bigger buffer just holds RAM it does not need.
        params: { eventsPerSecond: 8 },
      },
      global: {
        headers: { 'x-application-name': 'our-tiny-vault' },
      },
    });
  }
  return browserClient;
}

/** Realtime needs a live JWT, so make sure this tab is actually signed in. */
export async function ensureRealtimeAuth(client: SupabaseClient): Promise<void> {
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (token) {
    client.realtime.setAuth(token);
  }
}
