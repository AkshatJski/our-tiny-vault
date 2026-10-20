import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where the magic link lands.
 *
 * Three shapes of link are handled because Supabase can send any of them
 * depending on the email template and auth flow in play:
 *
 *   • implicit → `#access_token=…`      → the *browser* completes this one
 *   • PKCE     → `?code=…`              → exchangeCodeForSession
 *   • OTP      → `?token_hash=…&type=…` → verifyOtp
 *
 * The implicit case is the one to understand, because it looks like nothing
 * happened. Token data after a `#` is a URL fragment, and browsers never send
 * fragments to the server — so this route genuinely sees an empty query string,
 * even though the sign-in is perfectly fine. Erroring here would break the very
 * flow we switched to on purpose (see the note in lib/supabase/client.ts).
 *
 * So: no token at all is not a failure. It means "let the browser look in the
 * fragment." Only a *malformed* or *rejected* token is a real failure.
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

  // No credentials in the query string. With the implicit flow the tokens are
  // waiting in the fragment, which only the browser can read. Send the user on
  // to their destination and let the client pick the session up there.
  if (!code && !tokenHash) {
    return NextResponse.redirect(new URL(next, url.origin));
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
