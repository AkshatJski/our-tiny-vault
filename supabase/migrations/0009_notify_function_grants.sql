-- 0009_notify_function_grants.sql — close a hole 0008 left open.
--
-- 0008 did the obvious thing and revoked EXECUTE from PUBLIC. It wasn't enough:
-- Supabase sets ALTER DEFAULT PRIVILEGES so that every new function in `public`
-- is also granted to `anon` and `authenticated` *by name*. Revoking from PUBLIC
-- removes neither of those, so an anonymous request could still call it:

--   POST /rest/v1/rpc/enqueue_unlock_notifications_for   (anon key)  → 200
--
-- The damage was bounded — it only ever acts on a capsule whose unlock date has
-- already passed, and `unlocked_notified_at is null` makes it a one-shot — but it
-- is still an unauthenticated write that causes mail from a verified sender.
-- Grants by name have to be revoked by name.
--
-- Safe to run more than once.

revoke all on function public.enqueue_unlock_notifications_for(uuid) from public;
revoke all on function public.enqueue_unlock_notifications_for(uuid) from anon;
revoke all on function public.enqueue_unlock_notifications_for(uuid) from authenticated;

grant execute on function public.enqueue_unlock_notifications_for(uuid) to service_role;
