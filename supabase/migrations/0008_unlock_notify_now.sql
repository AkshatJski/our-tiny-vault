-- 0008_unlock_notify_now.sql — announce a vault the moment someone walks into it.
--
-- The daily cron is the only thing that ever announced an opening, and Vercel's
-- free plan allows exactly one cron run per day. So a vault that opened at 7:48
-- PM sat silent until 05:30 the next morning.
--
-- This function lets the app do the same job for ONE capsule, on demand, the
-- first time a member loads it. The daily cron stays as the backstop for vaults
-- nobody visits.
--
-- Idempotency is the whole safety story: `unlocked_notified_at is null` in the
-- UPDATE is a compare-and-swap. Two members opening the page in the same second
-- produce exactly one stamp, and only the statement that actually changed a row
-- queues mail. Vercel has nothing to do with it — if this guard were missing, the
-- app would mail everyone on every page view.

create or replace function public.enqueue_unlock_notifications_for(p_capsule_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_stamped uuid;
  v_count integer;
begin
  -- Claim the announcement. If the cron already claimed it (or the vault is not
  -- due yet) this matches no row and we queue nothing.
  update public.capsules
     set status = 'unlocked',
         unlocked_notified_at = now()
   where id = p_capsule_id
     and unlocked_notified_at is null
     and unlock_at <= now()
  returning id into v_stamped;

  if v_stamped is null then
    return 0;
  end if;

  insert into public.notification_queue (capsule_id, user_id, email, kind, scheduled_for)
  select m.capsule_id, m.user_id, pc.email, 'capsule_unlocked', v_day
  from public.capsule_members m
  join public.profile_contacts pc on pc.user_id = m.user_id
  where m.capsule_id = v_stamped
  on conflict (capsule_id, user_id, kind, scheduled_for) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Functions are executable by PUBLIC by default in Postgres, and this one can
-- make the project send mail. Keep it for the server only.
--
-- Revoking from PUBLIC is NOT enough on Supabase: default privileges also grant
-- EXECUTE to `anon` and `authenticated` by name, and those survive a PUBLIC
-- revoke. All three have to go. (0009 re-applies this for projects that ran an
-- earlier version of this file.)
revoke all on function public.enqueue_unlock_notifications_for(uuid) from public;
revoke all on function public.enqueue_unlock_notifications_for(uuid) from anon;
revoke all on function public.enqueue_unlock_notifications_for(uuid) from authenticated;
grant execute on function public.enqueue_unlock_notifications_for(uuid) to service_role;
