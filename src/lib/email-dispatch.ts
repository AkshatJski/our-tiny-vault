import { createAdminSupabase } from '@/lib/supabase/admin';
import { activeEmailProvider, sendUnlockEmail } from '@/lib/mail';
import { env } from '@/lib/env';

/**
 * Sending the queued letters — shared by the daily cron and by the "somebody
 * just walked in" endpoint.
 *
 * These two callers want the same thing and must not drift apart: a hard daily
 * budget, one recipient per request, `pending` never silently dropped, and
 * failures recorded with the provider's exact words. The only difference is the
 * `capsuleId` filter, so that an on-demand run touches one vault, not the world.
 *
 * The budget is counted from `notification_queue` itself (`emails_sent_on`), not
 * from an in-memory counter, so a manual re-run cannot overshoot: if the day's
 * allowance is gone, rows stay `pending` and tomorrow's cron picks them up.
 */

type AdminClient = ReturnType<typeof createAdminSupabase>;

export interface DispatchOutcome {
  sent: number;
  deferred: number;
  remaining: number;
  errors: string[];
}

export async function dispatchPendingEmails(
  supabase: AdminClient,
  options: { day: string; cap: number; capsuleId?: string },
): Promise<DispatchOutcome> {
  const errors: string[] = [];
  const { day, cap, capsuleId } = options;

  const { data: usedToday, error: quotaError } = await supabase.rpc('emails_sent_on', { p_day: day });
  if (quotaError) errors.push(`emails_sent_on: ${quotaError.message}`);

  const alreadySent = typeof usedToday === 'number' ? usedToday : 0;
  const remaining = Math.max(0, cap - alreadySent);

  if (remaining === 0) {
    // Out of budget for today: everything stays pending and is picked up
    // tomorrow — deferred, never dropped.
    let countQuery = supabase
      .from('notification_queue')
      .select('id', { count: 'exact', head: true })
      .eq('state', 'pending');
    if (capsuleId) countQuery = countQuery.eq('capsule_id', capsuleId);

    const { count } = await countQuery;
    return { sent: 0, deferred: count ?? 0, remaining: 0, errors };
  }

  let pendingQuery = supabase
    .from('notification_queue')
    .select('id, capsule_id, user_id, email, kind')
    .eq('state', 'pending')
    .lte('scheduled_for', day)
    .order('created_at', { ascending: true })
    .limit(remaining);
  if (capsuleId) pendingQuery = pendingQuery.eq('capsule_id', capsuleId);

  const { data: pending, error: pendingError } = await pendingQuery;
  if (pendingError) errors.push(`load pending: ${pendingError.message}`);

  const rows = (pending ?? []) as Array<{
    id: string;
    capsule_id: string;
    user_id: string;
    email: string;
    kind: string;
  }>;

  if (rows.length === 0) {
    return { sent: 0, deferred: 0, remaining, errors };
  }

  // Two small lookups, not N+1: names for the greeting, titles for the letter.
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

  let sent = 0;
  let deferred = 0;

  // Concurrency 4: every free provider rate-limits gently, and a burst of 90
  // parallel requests is a reliable way to get throttled.
  await mapWithConcurrency(rows, 4, async (row) => {
    const capsule = capsuleById.get(row.capsule_id);
    const result = await sendUnlockEmail({
      to: row.email,
      displayName: nameById.get(row.user_id) ?? 'friend',
      capsuleTitle: capsule?.title ?? 'our capsule',
      unlockAt: capsule?.unlock_at ?? new Date().toISOString(),
      partyUrl: `${env.siteUrl}/capsules/${row.capsule_id}/party`,
      capsuleId: row.capsule_id,
    });

    if (result.ok) {
      sent += 1;
      // `resend_id` is a leftover column name; it stores whichever id the active
      // provider handed back (Resend id or Brevo messageId).
      const { error } = await supabase
        .from('notification_queue')
        .update({ state: 'sent', sent_at: new Date().toISOString(), resend_id: result.id })
        .eq('id', row.id);
      if (error) errors.push(`mark sent ${row.id}: ${error.message}`);
      return;
    }

    deferred += 1;

    if (result.skipped === 'not_configured') {
      // No provider: leave it pending and say so loudly rather than marking it
      // sent and losing the notification forever.
      errors.push(
        `email (${activeEmailProvider()}): ${env.emailConfigProblem ?? 'provider not configured'} — notifications deferred`,
      );
      return;
    }

    const { error } = await supabase
      .from('notification_queue')
      .update({ state: 'failed', error: result.error ?? 'unknown', attempts: 1 })
      .eq('id', row.id);
    if (error) errors.push(`mark failed ${row.id}: ${error.message}`);
  });

  return { sent, deferred, remaining: Math.max(0, remaining - sent), errors };
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
