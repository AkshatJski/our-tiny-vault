'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase/server';
import { env } from '@/lib/env';

/**
 * Sign out.
 *
 * Why this is a server action and not `supabase.auth.signOut()` in the browser:
 * sessions live in httpOnly cookies written by `@supabase/ssr`. A browser-side
 * signOut only clears the copy in localStorage, leaving a perfectly valid
 * session cookie behind — the user "logs out" and stays logged in on refresh.
 *
 * Inside a server action `cookies()` is writable, so the client's `setAll` runs
 * for real and the session is genuinely gone. Nothing here is privileged; it is
 * the same call the browser would make, just in the one place that can also
 * delete the cookie.
 *
 * The caller still has to navigate away and refresh — see SignOutButton.
 */
export async function signOut(): Promise<{ ok: boolean; error?: string }> {
  if (!env.isSupabaseConfigured) return { ok: true };

  const supabase = createServerSupabase();
  const { error } = await supabase.auth.signOut();

  if (error) return { ok: false, error: error.message };

  // Every page reads the session, so the whole layout is stale now.
  revalidatePath('/', 'layout');
  return { ok: true };
}
