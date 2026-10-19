-- ════════════════════════════════════════════════════════════════════════════
-- our tiny vault — 0002_rls.sql
--
-- THE ONE RULE:
--   NO ONE — not even the person who wrote it, not even the capsule owner —
--   can SELECT a row from `contributions` or `prediction_responses` before
--   that capsule's `unlock_at`. Full stop. There is no "preview my own" path,
--   because such a path would be an RLS hole by definition.
--
-- TWO TRAPS THIS FILE EXISTS TO AVOID
--
--   1. POLICY RECURSION. A policy on `contributions` that says
--      `exists (select 1 from capsules ...)` makes Postgres evaluate the
--      `capsules` policy, which checks membership in `capsule_members`, whose
--      policy checks membership again -> "infinite recursion detected in policy".
--      Fix: every cross-table authorization question goes through a
--      SECURITY DEFINER function below. Definer functions run as the table owner
--      and therefore do not re-enter RLS. Never inline a join in a policy.
--
--   2. INSERT .. RETURNING. In Postgres, RETURNING requires SELECT permission on
--      the produced row. While a capsule is sealed the SELECT policy is false, so
--      a client that does `insert(...).select()` gets `42501`. That is *correct*.
--      Clients must insert with `Prefer: return=minimal` (supabase-js:
--      `.insert(x)` with no `.select()`), and show a local optimistic "sealed"
--      placeholder instead of a server echo. See src/lib/contributions.ts.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Helper: a non-throwing uuid cast (storage paths are attacker-controlled)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.try_uuid(p_text text)
returns uuid
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if p_text is null or p_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return p_text::uuid;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Authorization primitives (SECURITY DEFINER — the recursion firebreak)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_capsule_member(p_capsule_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.capsule_members m
    where m.capsule_id = p_capsule_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_capsule_owner(p_capsule_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.capsules c
    where c.id = p_capsule_id
      and c.owner_id = auth.uid()
  );
$$;

-- The single source of truth for "is this capsule open yet".
-- `now()` is the database clock, not the client's — a user who changes their
-- system time cannot open a sealed capsule early.
create or replace function public.is_capsule_unlocked(p_capsule_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.capsules c
    where c.id = p_capsule_id
      and c.unlock_at <= now()
  );
$$;

-- Read access to *contents* (contributions / predictions / media) combines
-- both conditions. Used everywhere so the rule can never drift.
create or replace function public.can_read_capsule_contents(p_capsule_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.is_capsule_member(p_capsule_id)
     and public.is_capsule_unlocked(p_capsule_id);
$$;

-- Write access to contents: membership *and* still sealed. A time capsule is
-- frozen the second it opens — the party is for reading, not editing history.
create or replace function public.can_seal_into_capsule(p_capsule_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.is_capsule_member(p_capsule_id)
     and not public.is_capsule_unlocked(p_capsule_id);
$$;

revoke execute on function public.try_uuid(text) from public;
grant execute on function public.try_uuid(text) to anon, authenticated, service_role;
grant execute on function public.is_capsule_member(uuid) to anon, authenticated, service_role;
grant execute on function public.is_capsule_owner(uuid) to anon, authenticated, service_role;
grant execute on function public.is_capsule_unlocked(uuid) to anon, authenticated, service_role;
grant execute on function public.can_read_capsule_contents(uuid) to anon, authenticated, service_role;
grant execute on function public.can_seal_into_capsule(uuid) to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Turn RLS on for everything. Default = deny.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles              enable row level security;
alter table public.profile_contacts      enable row level security;
alter table public.capsules              enable row level security;
alter table public.capsule_members       enable row level security;
alter table public.contributions         enable row level security;
alter table public.prediction_responses  enable row level security;
alter table public.realtime_events       enable row level security;
alter table public.notification_queue    enable row level security;
alter table public.system_heartbeats     enable row level security;
alter table public.cron_runs             enable row level security;

-- =============================================================================
-- profiles
-- =============================================================================
drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and handle ~ '^[a-z0-9_]{3,32}$');

-- =============================================================================
-- capsules
--   Metadata is readable by members while sealed (the Hub needs title + the
--   countdown). Non-members join only through join_capsule_by_code().
-- =============================================================================
drop policy if exists capsules_select_member on public.capsules;
create policy capsules_select_member on public.capsules
  for select to authenticated
  using (owner_id = auth.uid() or public.is_capsule_member(id));

drop policy if exists capsules_insert_self_owner on public.capsules;
create policy capsules_insert_self_owner on public.capsules
  for insert to authenticated
  with check (owner_id = auth.uid());

-- A title/emoji can be tidied while sealed; the unlock date can never be moved
-- earlier (guarded by trigger in 0003).
drop policy if exists capsules_update_owner on public.capsules;
create policy capsules_update_owner on public.capsules
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists capsules_delete_owner on public.capsules;
create policy capsules_delete_owner on public.capsules
  for delete to authenticated using (owner_id = auth.uid());

-- =============================================================================
-- capsule_members
--   No insert policy on purpose: adding a member means proving an invite code
--   or ownership, and that logic lives in SECURITY DEFINER RPCs so it cannot
--   be spoofed by a direct PostgREST insert.
-- =============================================================================
drop policy if exists capsule_members_select_peers on public.capsule_members;
create policy capsule_members_select_peers on public.capsule_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_capsule_member(capsule_id));

-- Leave a capsule yourself, or be removed by its owner.
drop policy if exists capsule_members_delete_self_or_owner on public.capsule_members;
create policy capsule_members_delete_self_or_owner on public.capsule_members
  for delete to authenticated
  using (
    (user_id = auth.uid() and role <> 'owner')
    or public.is_capsule_owner(capsule_id)
  );

-- Presence bookkeeping: a member may stamp their own last_seen_at.
drop policy if exists capsule_members_touch_self on public.capsule_members;
create policy capsule_members_touch_self on public.capsule_members
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =============================================================================
-- contributions  ← THE LOCK
-- =============================================================================
drop policy if exists contributions_select_after_unlock on public.contributions;
create policy contributions_select_after_unlock on public.contributions
  for select to authenticated
  using (public.can_read_capsule_contents(capsule_id));

drop policy if exists contributions_insert_while_sealed on public.contributions;
create policy contributions_insert_while_sealed on public.contributions
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.can_seal_into_capsule(capsule_id)
  );

-- Note there is deliberately NO update policy: contributions are immutable.
-- A sealed slip can only be removed by the person who sealed it.
drop policy if exists contributions_delete_own_while_sealed on public.contributions;
create policy contributions_delete_own_while_sealed on public.contributions
  for delete to authenticated
  using (author_id = auth.uid() and public.can_seal_into_capsule(capsule_id));

-- =============================================================================
-- prediction_responses  ← THE OTHER LOCK
-- =============================================================================
drop policy if exists predictions_select_after_unlock on public.prediction_responses;
create policy predictions_select_after_unlock on public.prediction_responses
  for select to authenticated
  using (public.can_read_capsule_contents(capsule_id));

drop policy if exists predictions_insert_while_sealed on public.prediction_responses;
create policy predictions_insert_while_sealed on public.prediction_responses
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.can_seal_into_capsule(capsule_id)
    and resolved_guess is null and is_correct is null
  );

-- Resolution happens *during* the party, so this one is post-unlock. It can
-- only ever touch the resolution columns (enforced by trigger in 0003).
drop policy if exists predictions_resolve_after_unlock on public.prediction_responses;
create policy predictions_resolve_after_unlock on public.prediction_responses
  for update to authenticated
  using (public.can_read_capsule_contents(capsule_id))
  with check (public.can_read_capsule_contents(capsule_id));

drop policy if exists predictions_delete_own_while_sealed on public.prediction_responses;
create policy predictions_delete_own_while_sealed on public.prediction_responses
  for delete to authenticated
  using (author_id = auth.uid() and public.can_seal_into_capsule(capsule_id));

-- =============================================================================
-- realtime_events
--   Party-only table. Readable by members once the capsule is open; while it is
--   sealed, only presence pings are allowed through (trigger-enforced in 0003).
-- =============================================================================
drop policy if exists realtime_events_select on public.realtime_events;
create policy realtime_events_select on public.realtime_events
  for select to authenticated
  using (public.can_read_capsule_contents(capsule_id));

drop policy if exists realtime_events_insert on public.realtime_events;
create policy realtime_events_insert on public.realtime_events
  for insert to authenticated
  with check (
    public.is_capsule_member(capsule_id)
    and (actor_id = auth.uid() or actor_id is null)
  );

-- =============================================================================
-- notification_queue — you may see your own outgoing mail, nothing else.
--   Rows are created and dispatched by the cron with the service role.
-- =============================================================================
drop policy if exists notification_queue_select_own on public.notification_queue;
create policy notification_queue_select_own on public.notification_queue
  for select to authenticated using (user_id = auth.uid());

-- =============================================================================
-- system_heartbeats / cron_runs — service role only.
--   RLS is enabled with zero policies, which denies every client. These tables
--   are infra telemetry and must never be visible to the browser.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Table privileges. RLS narrows this further; privileges stop the client from
--    even attempting an operation it has no business sending.
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on public.profiles, public.profile_contacts, public.capsules, public.capsule_members,
              public.contributions, public.prediction_responses,
              public.realtime_events, public.notification_queue,
              public.system_heartbeats, public.cron_runs
  from anon, authenticated;

grant select, insert, update on public.profiles             to authenticated;
grant select, insert, update, delete on public.capsules      to authenticated;
grant select, update, delete on public.capsule_members       to authenticated;
grant select, insert, delete on public.contributions         to authenticated;
grant select, insert, update, delete on public.prediction_responses to authenticated;
grant select, insert on public.realtime_events               to authenticated;
grant select on public.notification_queue                    to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Column-level tightening on `capsules`. This is where "clients cannot write
-- derived data" actually gets enforced.
--
-- The row trigger in 0003 guards *rules* (the unlock date may only move later),
-- but derived columns and lifecycle flags must not be writable at all. A
-- column-level grant says that precisely, with no guessing:
--
--   not granted  → storage_bytes, storage_quota_bytes, member_count,
--                  contribution_count, prediction_count, status,
--                  owner_id, invite_code, seal_at, unlocked_notified_at
--   granted      → the six fields a person is actually allowed to edit
--
-- A client attempting `update({ status: 'unlocked' })` now fails with
-- "permission denied for column status" instead of quietly succeeding and
-- thereby opening a capsule early. Privileges are the wall; the trigger is the
-- signpost.
-- ─────────────────────────────────────────────────────────────────────────────
revoke insert, update on public.capsules from authenticated;
grant insert (owner_id, title, subtitle, theme, cover_emoji, max_members, unlock_at, seal_at)
  on public.capsules to authenticated;
grant update (title, subtitle, theme, cover_emoji, max_members, unlock_at)
  on public.capsules to authenticated;

-- `profile_contacts`, `system_heartbeats` and `cron_runs` are NEVER granted to a
-- client role. They are service-role (cron) territory only.
