'use client';

import { useEffect } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { env } from '@/lib/env';

/**
 * Picks up an implicit-flow sign-in sitting in the URL fragment.
 *
 * Why this has to exist: with `flowType: 'implicit'` Supabase returns the
 * session as `#access_token=…&refresh_token=…`, and browsers never send the
 * fragment to the server. So /auth/callback cannot see it, and the server
 * components render as if nobody is signed in.
 *
 * The Supabase browser client would normally do this for us, but this app only
 * creates that client lazily (on a form submit, on opening the party). Nothing
 * asks for it on a plain page load, so without this component the token would
 * sit unread in the address bar and the user would appear logged out — the
 * exact "signed in but bounced back to /login" symptom, just for a new reason.
 *
 * Once the session is stored we strip the fragment from the URL and do one hard
 * refresh, so the server components re-render with the new cookie. `replace`
 * rather than `push` keeps the tokenised URL out of your back-button history.
 */
export function AuthFragmentHandler() {
  useEffect(() => {
    if (!env.isSupabaseConfigured) return;
    if (typeof window === 'undefined') return;

    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;
    // Only act on a real auth payload — never touch unrelated fragments.
    if (!/(access_token|refresh_token|error_description)=/.test(hash)) return;

    let cancelled = false;

    void (async () => {
      try {
        const supabase = getBrowserSupabase();
        // Creating the client is what triggers detectSessionInUrl's parse of
        // the fragment, but getSession() guarantees it has been persisted
        // before we reload — otherwise we could refresh too early and loop.
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;

        // Clean the address bar first, then reload so the server sees the
        // freshly written session cookie.
        const clean = window.location.pathname + window.location.search;
        window.history.replaceState({}, '', clean);

        if (data.session) {
          window.location.replace(clean);
        }
      } catch {
        // A malformed fragment is not worth an error screen. Drop it and let
        // the normal signed-out experience take over.
        const clean = window.location.pathname + window.location.search;
        window.history.replaceState({}, '', clean);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
