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
      auth: {
        /*
         * Implicit, not PKCE — deliberately.
         *
         * With PKCE the magic link carries a `?code=` that must be exchanged
         * using a verifier stored in the browser that *requested* the link.
         * Click the email on a phone, or in a different browser, and the
         * verifier is simply not there: "PKCE code verifier not found in
         * storage", straight back to /login.
         *
         * Customising the email template to send `token_hash` instead would fix
         * it properly, but Supabase gates template editing behind custom SMTP,
         * which needs a paid domain. We are on the free tier by choice.
         *
         * The implicit flow returns the session in the URL fragment, which the
         * browser client reads and persists itself. No verifier, so no missing
         * verifier — sign-in works from any device or mail client.
         *
         * Tradeoff accepted: the access token is briefly visible in the address
         * bar, and /auth/callback becomes a fallback rather than the main path.
         * See decision.md.
         */
        flowType: 'implicit',
      },
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
