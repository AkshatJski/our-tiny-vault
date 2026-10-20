import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { CONTRIBUTIONS_SELECT } from '@/lib/contributions-select';
import { parseExternalLink } from '@/lib/video-link';
import type { ContributionWithAuthor, ContributionKind } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /api/contributions — a server-side door to the same room the browser uses.
 *
 * The browser normally writes contributions directly with its own session (which
 * is what keeps us off Vercel's 4.5 MB request-body limit). This route exists for
 * three cases where a server hop is genuinely useful:
 *
 *   • a client that cannot reach Supabase Storage (locked-down network)
 *   • integrations and scripts that hold a session cookie
 *   • demonstrating, in one place, the exact rule the whole app is built on
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * POST returns `{ sealed: true }` — never the created row. We do not call
 * `.select()` after `.insert()`, because before unlock the SELECT policy is
 * false and Postgres would reject the RETURNING clause with 42501. There is no
 * "read it back to be sure" path, by design. Ids are generated client-side for
 * the optimistic UI and the real id is simply not known until unlock.
 *
 * Note this route uses the *user's* session client, not the service role. RLS is
 * still the thing enforcing the rules — the server hop is convenience, not a
 * privilege escalation.
 */

interface SealBody {
  capsuleId?: string;
  kind?: ContributionKind;
  body?: string | null;
  storagePath?: string | null;
  mimeType?: string | null;
  byteSize?: number;
  durationSeconds?: number | null;
  externalUrl?: string | null;
}

const ALLOWED_KINDS: ContributionKind[] = ['note', 'doodle', 'photo', 'audio', 'video_link', 'playlist_link'];

/** GET — readable only after unlock. Before that, RLS returns an empty array. */
export async function GET(request: Request) {
  if (!env.isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 });
  }

  const capsuleId = new URL(request.url).searchParams.get('capsuleId');
  if (!capsuleId) {
    return NextResponse.json({ error: 'capsuleId is required.' }, { status: 400 });
  }

  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const { data, error } = await supabase
    .from('contributions')
    .select(CONTRIBUTIONS_SELECT)
    .eq('capsule_id', capsuleId)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    items: (data ?? []) as unknown as ContributionWithAuthor[],
    // Honest signalling for the client: an empty array here might mean "sealed".
    readable: true,
    note: 'An empty list while the capsule is still sealed is the policy working, not a bug.',
  });
}

/** POST — seal one contribution. Returns no row, on purpose. */
export async function POST(request: Request) {
  if (!env.isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 });
  }

  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  let body: SealBody;
  try {
    body = (await request.json()) as SealBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body.capsuleId || !body.kind || !ALLOWED_KINDS.includes(body.kind)) {
    return NextResponse.json({ error: 'capsuleId and a valid kind are required.' }, { status: 400 });
  }

  const row = {
    capsule_id: body.capsuleId,
    author_id: user.id, // never trusted from the body
    kind: body.kind,
    body: body.body?.slice(0, 4000) ?? null,
    storage_path: body.storagePath ?? null,
    mime_type: body.mimeType ?? null,
    byte_size: Number.isFinite(body.byteSize) ? Number(body.byteSize) : 0,
    duration_seconds:
      body.kind === 'audio' ? Math.min(60, Math.max(1, Number(body.durationSeconds) || 1)) : null,
    external_url: null as string | null,
    external_provider: null as string | null,
  };

  // Link contributions are re-parsed here. The client's parse is a UI nicety;
  // this is the one that decides what gets stored.
  if (body.kind === 'video_link' || body.kind === 'playlist_link') {
    const parsed = body.externalUrl ? parseExternalLink(body.externalUrl) : null;
    if (!parsed) {
      return NextResponse.json(
        { error: 'Only YouTube, TikTok, Instagram Reel and Spotify links can be sealed.' },
        { status: 422 },
      );
    }
    if (body.kind === 'video_link' && parsed.provider === 'spotify') {
      return NextResponse.json({ error: 'Use the playlist kind for Spotify.' }, { status: 422 });
    }
    row.external_url = parsed.canonicalUrl;
    row.external_provider = parsed.provider;
  }

  // No `.select()` — see the file header.
  const { error } = await supabase.from('contributions').insert(row);

  if (error) {
    // Budget and capacity refusals are 400s, not 500s: the client caused them
    // and the message is meant to be read by a human.
    const status = /budget:|capacity:|sealed:|check_violation/i.test(error.message) ? 400 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json(
    {
      sealed: true,
      kind: body.kind,
      note: 'Sealed. It cannot be read back — not by you, not by the owner — until the capsule opens.',
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}
