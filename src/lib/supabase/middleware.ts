import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Session refresh + route protection.
 *
 * This lives in middleware rather than in each page because an expired access
 * token silently degrades the app into "you are logged out" mid-session, and
 * during an unlock party that is the worst possible moment to be logged out.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!env.isSupabaseConfigured) return response;

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet: CookieToSet[]) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Touching getUser() is what performs the refresh. Do not remove it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  // `/api/realtime?ping=1` is the anonymous keep-alive an external uptime pinger
  // calls, so it must stay public — it writes one heartbeat row and returns
  // nothing about any capsule. Every other /api/realtime request hands out a
  // realtime ticket, so it stays members-only.
  const isPing = path === '/api/realtime' && request.nextUrl.searchParams.get('ping') === '1';
  const isProtected =
    path.startsWith('/capsules') ||
    path.startsWith('/api/contributions') ||
    (path.startsWith('/api/realtime') && !isPing);

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  if (user && path === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/capsules';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
