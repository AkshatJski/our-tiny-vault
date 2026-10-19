import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where the magic link lands.
 *
 * Two shapes of link are handled because Supabase can send either depending on
 * the email template and auth flow you have configured:
 *
 *   • PKCE  → `?code=…`            → exchangeCodeForSession
 *   • OTP   → `?token_hash=…&type=email` → verifyOtp
 *
 * Supporting both means changing the email template in the Supabase dashboard
 * does not silently break sign-in — which, for an app nobody touches for two
 * years, is the difference between working and mysteriously dead.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const next = sanitizeNext(url.searchParams.get('next'));

  if (!env.isSupabaseConfigured) {
    return NextResponse.redirect(new URL('/login?error=not_configured', url.origin));
  }

  const supabase = createServerSupabase();
  let failure: string | null = null;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) failure = error.message;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as 'email' | 'magiclink' | 'signup' | 'recovery' | 'email_change',
    });
    if (error) failure = error.message;
  } else {
    failure = 'That link was missing its token.';
  }

  if (failure) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(failure)}`, url.origin),
    );
  }

  // The `profiles` row is created by an `after insert on auth.users` trigger, so
  // by the time we get here the user already has a handle and an emoji.
  return NextResponse.redirect(new URL(next, url.origin));
}

/** Only ever redirect to a path on this site. Never to an attacker's URL. */
function sanitizeNext(value: string | null): string {
  if (!value) return '/capsules';
  if (!value.startsWith('/') || value.startsWith('//')) return '/capsules';
  return value;
}
