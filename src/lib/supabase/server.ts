import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { assertSupabaseConfigured, env } from '@/lib/env';
import type { Profile } from '@/lib/types';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Server-side Supabase client bound to the current request's cookies.
 *
 * `setAll` throws inside a Server Component because RSCs cannot mutate cookies.
 * That is expected and harmless — middleware.ts is what actually refreshes the
 * session — so we swallow it rather than logging noise on every render.
 */
export function createServerSupabase(): SupabaseClient {
  assertSupabaseConfigured();
  const cookieStore = cookies();

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet: CookieToSet[]) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component. Middleware handles the refresh.
        }
      },
    },
  });
}

export async function getSessionUser(): Promise<User | null> {
  if (!env.isSupabaseConfigured) return null;
  const supabase = createServerSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function getSessionProfile(): Promise<Profile | null> {
  if (!env.isSupabaseConfigured) return null;
  const supabase = createServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  const { data } = await supabase
    .from('profiles')
    .select('id, handle, display_name, avatar_emoji, accent_color, created_at, updated_at')
    .eq('id', userData.user.id)
    .maybeSingle<Profile>();

  return data ?? null;
}

/**
 * True when the signed-in user may read this capsule's metadata at all.
 * Mirrors the `capsules_select_member` policy — if these ever drift, that is a
 * bug in one of the two places, so keep the comment.
 */
export async function isMemberOf(capsuleId: string): Promise<boolean> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('capsule_members')
    .select('capsule_id')
    .eq('capsule_id', capsuleId)
    .maybeSingle<{ capsule_id: string }>();
  return Boolean(data);
}
