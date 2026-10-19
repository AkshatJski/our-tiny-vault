import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { sendUnlockEmail } from '@/lib/resend';
import { EMAIL_DAILY_CAP, REALTIME_EVENT_RETENTION_DAYS } from '@/lib/budget';
import type { CronReport } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The daily cron. Runs once at 00:00 UTC (Vercel Hobby allows one run per day).
 *
 * It does FOUR jobs, and the first one is the one that actually keeps this
 * project alive:
 *
 *   1. KEEP-ALIVE HEARTBEAT. Supabase pauses free projects after seven days
 *      without API activity. A capsule sealed until 2028 would be an empty
 *      database long before it opened. This single daily request is the
 *      heartbeat that keeps it awake, and it is logged so the history is visible.
 *   2. UNLOCK. Find capsules whose unlock date has arrived, flip them to
 *      'unlocked' (which changes nothing for RLS — RLS compares timestamps, not
 *      this column — it is for reporting), and queue one email per member.
 *   3. DISPATCH EMAILS inside a hard 90/day budget, deferring the rest to
 *      tomorrow rather than dropping them.
 *   4. HOUSEKEEPING. Prune the party event log so the 500 MB database stays
 *      flat forever.
 *
 * Idempotent by construction: every write is keyed on (capsule, user, kind, day)
 * or filtered on `is null`, so a manual re-run — or Vercel firing it twice —
 * is harmless.
 */
export async function POST(request: Request) {
  return runCron(request);
}

/** GET is a convenience for manual pokes in development only. */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Use POST in production.' }, { status: 405 });
  }
  return runCron(request);
}

async function runCron(request: Request): Promise<NextResponse<CronReport | { error: string }>> {
  const auth = authorize(request);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });

  if (!env.isCronConfigured) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set.' }, { status: 503 });
  }

  const supabase = createAdminSupabase();
  const day = new Date().toISOString().slice(0, 10);
  const errors: string[] = [];

  const report: CronReport = {
    ok: true,
    ranAt: new Date().toISOString(),
    day,
    heartbeat: false,
    capsulesDue: 0,
    capsulesUnlocked: 0,
    emailsQueued: 0,
    emailsSent: 0,
    emailsDeferred: 0,
    quotaRemaining: EMAIL_DAILY_CAP,
    pruned: 0,
    backup: 'skipped',
    errors,
  };

  // ── 1. keep-alive ─────────────────────────────────────────────────────────
  if (env.enableKeepalive) {
    const { error } = await supabase.from('system_heartbeats').upsert(
      {
        beat_date: day,
        source: 'vercel_cron',
        note: 'daily cron ping — keeps the free project from auto-pausing',
        payload: { at: new Date().toISOString() },
      },
      { onConflict: 'beat_date,source', ignoreDuplicates: true },
    );
    if (error) errors.push(`heartbeat: ${error.message}`);
    else report.heartbeat = true;
  }

  // ── 2. unlock whatever has come due ───────────────────────────────────────
  const { data: due, error: dueError } = await supabase.rpc('unlock_due_capsules', { p_day: day });
  if (dueError) errors.push(`unlock_due_capsules: ${dueError.message}`);

  const unlocked = (due ?? []) as Array<{ capsule_id: string; title: string; unlock_at: string }>;
  report.capsulesDue = unlocked.length;
  report.capsulesUnlocked = unlocked.length;

  const { data: queued, error: queueError } = await supabase.rpc('enqueue_unlock_notifications', {
    p_day: day,
  });
  if (queueError) errors.push(`enqueue_unlock_notifications: ${queueError.message}`);
  report.emailsQueued = typeof queued === 'number' ? queued : 0;

  // ── 3. dispatch inside the 90/day budget ──────────────────────────────────
  const { data: usedToday, error: quotaError } = await supabase.rpc('emails_sent_on', {
    p_day: day,
  });
  if (quotaError) errors.push(`emails_sent_on: ${quotaError.message}`);

  const alreadySent = typeof usedToday === 'number' ? usedToday : 0;
  const remaining = Math.max(0, EMAIL_DAILY_CAP - alreadySent);
  report.quotaRemaining = remaining;

  if (remaining === 0) {
    // We are out of budget for today. Everything stays 'pending' and is picked
    // up tomorrow — deferred, never dropped.
    const { count } = await supabase
      .from('notification_queue')
      .select('id', { count: 'exact', head: true })
      .eq('state', 'pending');
    report.emailsDeferred = count ?? 0;
  } else {
    const { data: pending, error: pendingError } = await supabase
      .from('notification_queue')
      .select('id, capsule_id, user_id, email, kind')
      .eq('state', 'pending')
      .lte('scheduled_for', day)
      .order('created_at', { ascending: true })
      .limit(remaining);

    if (pendingError) errors.push(`load pending: ${pendingError.message}`);

    const rows = (pending ?? []) as Array<{
      id: string;
      capsule_id: string;
      user_id: string;
      email: string;
      kind: string;
    }>;

    if (rows.length > 0) {
      // Two small lookups, not N+1: names for the greeting, titles for the mail.
      const userIds = Array.from(new Set(rows.map((row) => row.user_id)));
      const capsuleIds = Array.from(new Set(rows.map((row) => row.capsule_id)));

      const [{ data: profiles }, { data: capsules }] = await Promise.all([
        supabase.from('profiles').select('id, display_name').in('id', userIds),
        supabase.from('capsules').select('id, title, unlock_at').in('id', capsuleIds),
      ]);

      const nameById = new Map(
        ((profiles ?? []) as Array<{ id: string; display_name: string }>).map((p) => [p.id, p.display_name]),
      );
      const capsuleById = new Map(
        ((capsules ?? []) as Array<{ id: string; title: string; unlock_at: string }>).map((c) => [c.id, c]),
      );

      // Concurrency 4: Resend's free tier rate limit is gentle, and a burst of
      // 90 parallel requests is a good way to get throttled.
      const results = await mapWithConcurrency(rows, 4, async (row) => {
        const capsule = capsuleById.get(row.capsule_id);
        const result = await sendUnlockEmail({
          to: row.email,
          displayName: nameById.get(row.user_id) ?? 'friend',
          capsuleTitle: capsule?.title ?? 'our capsule',
          unlockAt: capsule?.unlock_at ?? new Date().toISOString(),
          partyUrl: `${env.siteUrl}/capsules/${row.capsule_id}/party`,
          capsuleId: row.capsule_id,
        });
        return { row, result };
      });

      for (const { row, result } of results) {
        if (result.ok) {
          report.emailsSent += 1;
          const { error } = await supabase
            .from('notification_queue')
            .update({ state: 'sent', sent_at: new Date().toISOString(), resend_id: result.id })
            .eq('id', row.id);
          if (error) errors.push(`mark sent ${row.id}: ${error.message}`);
        } else if (result.skipped === 'not_configured') {
          // No Resend key: leave it pending and say so loudly rather than
          // marking it sent and losing the notification forever.
          report.emailsDeferred += 1;
          errors.push('resend: RESEND_API_KEY is not configured — notifications deferred');
        } else {
          report.emailsDeferred += 1;
          const { error } = await supabase
            .from('notification_queue')
            .update({ state: 'failed', error: result.error ?? 'unknown', attempts: 1 })
            .eq('id', row.id);
          if (error) errors.push(`mark failed ${row.id}: ${error.message}`);
        }
      }

      report.quotaRemaining = Math.max(0, remaining - report.emailsSent);
    }
  }

  // ── 4. housekeeping ──────────────────────────────────────────────────────
  const { data: pruned, error: pruneError } = await supabase.rpc('prune_realtime_events', {
    p_keep_days: REALTIME_EVENT_RETENTION_DAYS,
  });
  if (pruneError) errors.push(`prune_realtime_events: ${pruneError.message}`);
  report.pruned = typeof pruned === 'number' ? pruned : 0;

  if (env.enableWeeklyBackup && new Date().getUTCDay() === 0) {
    report.backup = await writeWeeklyBackup(supabase, day);
  }

  report.ok = errors.length === 0 || report.emailsSent > 0;

  await supabase.from('cron_runs').insert({
    capsules_due: report.capsulesDue,
    capsules_unlocked: report.capsulesUnlocked,
    emails_queued: report.emailsQueued,
    emails_sent: report.emailsSent,
    emails_deferred: report.emailsDeferred,
    quota_remaining: report.quotaRemaining,
    ok: report.ok,
    detail: report as unknown as Record<string, unknown>,
  });

  return NextResponse.json(report, { status: report.ok ? 200 : 500 });
}

function authorize(request: Request): { ok: true } | { ok: false; reason: string; status: number } {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  // In development, allow a bare local call so the route is testable.
  if (process.env.NODE_ENV !== 'production' && !token) return { ok: true };

  if (!env.cronSecret || env.cronSecret === 'dev-secret') {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, reason: 'CRON_SECRET is not configured.', status: 503 };
    }
    return { ok: true };
  }

  if (token !== env.cronSecret) {
    return { ok: false, reason: 'Unauthorized.', status: 401 };
  }
  return { ok: true };
}

/**
 * Optional weekly snapshot: METADATA ONLY.
 *
 * We deliberately do not export sealed contents. The whole promise of this app is
 * that nobody reads the capsule early, and "the cron has a copy" is exactly the
 * kind of loophole that ruins the promise. What we do keep is the shape of the
 * vault — titles, dates, member counts — so a catastrophic loss leaves you with
 * a list of what to rebuild.
 */
async function writeWeeklyBackup(
  supabase: ReturnType<typeof createAdminSupabase>,
  day: string,
): Promise<'skipped' | 'written' | 'failed'> {
  try {
    const [{ data: capsules }, { data: members }, { count: contributions }] = await Promise.all([
      supabase.from('capsules').select('id, title, subtitle, unlock_at, status, created_at'),
      supabase.from('capsule_members').select('capsule_id, role'),
      supabase.from('contributions').select('id', { count: 'exact', head: true }),
    ]);

    const snapshot = {
      kind: 'our-tiny-vault/metadata-snapshot',
      generatedAt: new Date().toISOString(),
      day,
      note: 'Metadata only. Sealed contents are intentionally NOT included.',
      capsules: capsules ?? [],
      membershipCounts: (members ?? []).reduce<Record<string, number>>((acc, row) => {
        const key = (row as { capsule_id: string }).capsule_id;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
      contributionCount: contributions ?? 0,
    };

    const { error } = await supabase.storage
      .from('capsule-backups')
      .upload(`snapshots/${day}.json`, JSON.stringify(snapshot, null, 2), {
        contentType: 'application/json',
        upsert: true,
      });

    return error ? 'failed' : 'written';
  } catch {
    return 'failed';
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  });

  await Promise.all(runners);
  return results;
}
