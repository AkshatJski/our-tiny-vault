import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { EMAIL_DAILY_CAP } from '@/lib/budget';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getSessionProfile } from '@/lib/supabase/server';
import { dispatchPendingEmails } from '@/lib/email-dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Somebody just walked into the vault — tell everyone."
 *
 * The daily cron can only run once a day on Vercel's free plan, so a vault that
 * opened at 7:48 PM used to stay quiet until 05:30. This route closes that gap:
 * the first member to load an opened capsule pings it, and the letters go out
 * within seconds. The cron remains the backstop for vaults nobody visits.
 *
 * SAFETY — this endpoint can send mail, so it is deliberately narrow:
 *
 *   • the caller must be signed in (session cookie, verified server-side);
 *   • the caller must be a member of THIS capsule;
 *   • `unlock_at` must have passed;
 *   • the announcement is claimed in Postgres with a compare-and-swap
 *     (`unlocked_notified_at is null`), so fifty people opening the page in the
 *     same minute send one round of letters, not fifty;
 *   • the daily budget is still enforced by `dispatchPendingEmails`.
 *
 * Visitors cannot spam it into existence: a sealed capsule matches no row, and a
 * capsule that has already been announced matches no row either.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const profile = await getSessionProfile();
  if (!profile) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }

  if (!env.isCronConfigured) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set' }, { status: 503 });
  }

  const admin = createAdminSupabase();

  // Membership first. The admin client is the only one that can see other
  // members' rows, so it also answers "is this person in this vault?".
  const { data: member } = await admin
    .from('capsule_members')
    .select('user_id')
    .eq('capsule_id', params.id)
    .eq('user_id', profile.id)
    .maybeSingle();

  if (!member) {
    // Same answer for "wrong id" and "not yours": membership is not something to
    // confirm or deny to a stranger.
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const { data: queued, error: queueError } = await admin.rpc('enqueue_unlock_notifications_for', {
    p_capsule_id: params.id,
  });

  if (queueError) {
    return NextResponse.json({ error: queueError.message }, { status: 500 });
  }

  const dailyCap = Number.isFinite(env.emailDailyCap)
    ? Math.min(Math.max(env.emailDailyCap, 1), EMAIL_DAILY_CAP)
    : EMAIL_DAILY_CAP;

  // Always dispatch: this also rescues mail the cron queued but could not afford
  // earlier today, which is exactly when someone is looking at the page.
  const outcome = await dispatchPendingEmails(admin, {
    day: new Date().toISOString().slice(0, 10),
    cap: dailyCap,
    capsuleId: params.id,
  });

  return NextResponse.json({
    queued: typeof queued === 'number' ? queued : 0,
    ...outcome,
  });
}
