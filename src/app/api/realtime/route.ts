import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { partyChannelName } from '@/lib/realtime';
import { PRESENCE_CAP } from '@/lib/budget';
import type { PresenceSlot, RealtimeTicket } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/realtime — get a ticket for a capsule's party channel.
 *
 * ── WHY THIS IS NOT A WEBSOCKET ROUTE ───────────────────────────────────────
 * Vercel Hobby cannot host a long-lived socket: serverless functions are
 * request-scoped and capped (10s default, 60s max). So the socket itself is
 * Supabase Realtime, which is already inside our free tier — no Fly.io, no
 * Render, no extra account that can disappear in two years. That decision is the
 * single biggest longevity win in this codebase.
 *
 * What this endpoint *is* for:
 *   1. authorising the join (you must be a member — RLS on Realtime is not
 *      expressive enough to know that on its own)
 *   2. claiming one of twenty presence slots, counted server-side from the event
 *      log rather than trusted from the client
 *   3. handing the client everything it needs to open the channel
 *
 * Slot 21 gets `granted: false` and the lobby downgrades that person to
 * spectator mode: they still receive broadcasts (watch the unwrap, see the
 * reactions) but do not appear in presence. That keeps us at ten concurrent
 * parties before we approach the 200-connection free ceiling.
 */
export async function POST(request: Request) {
  const body = (await safeJson(request)) as { capsuleId?: string } | null;
  const capsuleId = body?.capsuleId;

  if (!capsuleId) {
    return NextResponse.json({ error: 'capsuleId is required.' }, { status: 400 });
  }

  if (!env.isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 });
  }

  // The USER's client, not the service role — so is_capsule_member() in the RPC
  // evaluates against the caller's own JWT. RLS does the authorization, as it
  // should, even inside a SECURITY DEFINER function.
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  }

  const { data, error } = await supabase.rpc('claim_presence_slot', {
    p_capsule_id: capsuleId,
  });

  if (error) {
    const status = /not a member|42501/i.test(error.message) ? 403 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  // `returns table(...)` comes back as an array with one row.
  const row = (Array.isArray(data) ? data[0] : data) as PresenceSlot | undefined;
  const presence: PresenceSlot = row ?? {
    granted: false,
    slot: 0,
    present: 0,
    capacity: PRESENCE_CAP,
  };

  const ticket: RealtimeTicket = {
    channel: partyChannelName(capsuleId),
    capsuleId,
    userId: user.id,
    presenceCap: presence.capacity || PRESENCE_CAP,
    presence,
    canWrite: presence.granted,
    // The client re-derives nothing: the ticket says how long it is good for.
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    supabaseUrl: env.supabaseUrl,
    supabaseAnonKey: env.supabaseAnonKey,
  };

  return NextResponse.json(ticket, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

/** DELETE /api/realtime — best-effort slot release when the tab goes away. */
export async function DELETE(request: Request) {
  const body = (await safeJson(request)) as { capsuleId?: string } | null;
  if (!body?.capsuleId || !env.isSupabaseConfigured) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  await supabase.rpc('release_presence_slot', { p_capsule_id: body.capsuleId });
  return NextResponse.json({ ok: true });
}

/**
 * GET /api/realtime?capsuleId=… — channel info, no slot claimed.
 * GET /api/realtime?ping=1        — external keep-alive heartbeat.
 *
 * The ping exists for one reason: Vercel Hobby cron timing is not guaranteed to
 * the minute, and a free Supabase project pauses after seven days of silence. If
 * you ever want belt-and-braces, point a free uptime pinger (cron-job.org,
 * UptimeRobot) at this URL daily and the vault stays awake even if a deploy
 * breaks the cron.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);

  if (url.searchParams.get('ping') === '1') {
    if (!env.isCronConfigured) {
      return NextResponse.json({ ok: false, error: 'service key missing' }, { status: 503 });
    }
    try {
      const admin = createAdminSupabase();
      const day = new Date().toISOString().slice(0, 10);
      const { error } = await admin.from('system_heartbeats').upsert(
        {
          beat_date: day,
          source: 'health_check',
          note: 'external ping',
          payload: { at: new Date().toISOString() },
        },
        { onConflict: 'beat_date,source', ignoreDuplicates: true },
      );
      return NextResponse.json({ ok: !error, day, source: 'health_check' });
    } catch (error) {
      return NextResponse.json(
        { ok: false, error: error instanceof Error ? error.message : 'ping failed' },
        { status: 500 },
      );
    }
  }

  const capsuleId = url.searchParams.get('capsuleId');
  if (!capsuleId) {
    return NextResponse.json({ error: 'capsuleId or ping=1 is required.' }, { status: 400 });
  }

  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  // One cheap query: does this person belong here, and is the party open?
  const { data: capsule } = await supabase
    .from('capsules')
    .select('id, title, unlock_at, max_members, member_count')
    .eq('id', capsuleId)
    .maybeSingle<{
      id: string;
      title: string;
      unlock_at: string;
      max_members: number;
      member_count: number;
    }>();

  if (!capsule) {
    return NextResponse.json({ error: 'Not a member of this capsule.' }, { status: 403 });
  }

  return NextResponse.json({
    channel: partyChannelName(capsuleId),
    capsuleId,
    userId: user.id,
    presenceCap: Math.min(capsule.max_members, PRESENCE_CAP),
    unlocked: new Date(capsule.unlock_at).getTime() <= Date.now(),
    supabaseUrl: env.supabaseUrl,
    supabaseAnonKey: env.supabaseAnonKey,
  });
}

async function safeJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
