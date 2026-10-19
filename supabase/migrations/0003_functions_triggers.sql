-- ════════════════════════════════════════════════════════════════════════════
-- our tiny vault — 0003_functions_triggers.sql
--
-- Every rule that must hold even if the client is malicious lives here:
--   * new user -> profile
--   * capsule -> owner auto-joins, member cap, unlock date can only move later
--   * contribution -> storage budget accounting + platform-wide ceiling
--   * prediction -> resolution fields are the only mutable ones
--   * realtime -> presence cap (20) and no party chatter before unlock
--   * cron -> due detection, notification queueing, quota accounting
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- Platform-wide storage ceiling. Supabase free = 1 GB. We stop at 900 MB so a
-- single oversized write can never tip the whole project into a read-only state.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.platform_storage_ceiling()
returns bigint language sql immutable as $$ select 943718400::bigint $$; -- 900 MB

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Signup -> profile (+ contact email in a service-only table)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base text;
  v_handle text;
  v_n int := 0;
begin
  v_base := coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'friend');
  v_base := regexp_replace(lower(v_base), '[^a-z0-9_]+', '', 'g');
  if char_length(v_base) < 3 then
    v_base := v_base || 'friend';
  end if;
  v_base := left(v_base, 22);

  v_handle := v_base;
  while exists (select 1 from public.profiles p where p.handle = v_handle) loop
    v_n := v_n + 1;
    v_handle := left(v_base, 22) || v_n::text;
  end loop;

  insert into public.profiles (id, handle, display_name, avatar_emoji)
  values (
    new.id,
    v_handle,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''),
             initcap(replace(v_handle, '_', ' '))),
    '🫧'
  )
  on conflict (id) do nothing;

  if new.email is not null then
    insert into public.profile_contacts (user_id, email)
    values (new.id, lower(new.email))
    on conflict (user_id) do update set email = excluded.email;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Generic updated_at
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists capsules_touch on public.capsules;
create trigger capsules_touch before update on public.capsules
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Capsules: owner auto-joins; the unlock date is a promise.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.capsule_after_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.capsule_members (capsule_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists capsules_after_insert on public.capsules;
create trigger capsules_after_insert after insert on public.capsules
  for each row execute function public.capsule_after_insert();

create or replace function public.capsule_guard_update()
returns trigger language plpgsql as $$
begin
  -- Never earlier. A vault you can open on a whim is not a vault.
  if new.unlock_at < old.unlock_at then
    raise exception 'promise: unlock_at may only be moved later, never earlier'
      using errcode = 'check_violation';
  end if;

  -- Shrinking capacity below the current roster would strand people.
  if new.max_members < old.member_count then
    raise exception 'capacity: max_members cannot drop below the current member count'
      using errcode = 'check_violation';
  end if;

  -- ── WHY THE DERIVED COLUMNS ARE *NOT* FROZEN HERE ────────────────────────
  -- An earlier draft reset storage_bytes / contribution_count / status to their
  -- old values in this trigger. That was wrong twice over:
  --   • the counter triggers in this same file update `capsules` from inside a
  --     contribution INSERT, so the reset silently undid every counter bump
  --   • the daily cron sets `status` and `unlocked_notified_at`, and the reset
  --     made a capsule "never notified" — i.e. daily duplicate emails
  -- The right tool for "clients cannot write these" is a column-level grant
  -- (see 0002_rls.sql), not a row trigger guessing at intent.

  return new;
end;
$$;

drop trigger if exists capsules_guard_update on public.capsules;
create trigger capsules_guard_update before update on public.capsules
  for each row execute function public.capsule_guard_update();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Membership: capacity is a hard wall (also protects the 200-conn realtime
--    global limit, since every member could open one channel).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.member_capacity_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cap smallint;
  v_count smallint;
begin
  select max_members, member_count into v_cap, v_count
  from public.capsules where id = new.capsule_id for update;

  if v_count >= v_cap then
    raise exception 'capacity: this capsule is full (% of %)', v_count, v_cap
      using errcode = 'check_violation';
  end if;

  update public.capsules
     set member_count = member_count + 1
   where id = new.capsule_id;

  return new;
end;
$$;

drop trigger if exists capsule_members_capacity on public.capsule_members;
create trigger capsule_members_capacity before insert on public.capsule_members
  for each row execute function public.member_capacity_guard();

create or replace function public.member_removed()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.capsules
     set member_count = greatest(member_count - 1, 0)
   where id = old.capsule_id;
  return old;
end;
$$;

drop trigger if exists capsule_members_removed on public.capsule_members;
create trigger capsule_members_removed after delete on public.capsule_members
  for each row execute function public.member_removed();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Contributions: the storage budget, enforced before the row exists.
--
--    Two ceilings:
--      * per-capsule quota (default 60 MB) — keeps one loud friend from eating
--        the whole free tier
--      * platform ceiling (900 MB) — keeps the project writable forever
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.contribution_budget_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_quota   bigint;
  v_used    bigint;
  v_global  bigint;
  v_ceiling bigint := public.platform_storage_ceiling();
begin
  if new.byte_size > 0 then
    select storage_quota_bytes, storage_bytes into v_quota, v_used
    from public.capsules where id = new.capsule_id for update;

    if not found then
      raise exception 'budget: capsule not found' using errcode = 'check_violation';
    end if;

    if v_used + new.byte_size > v_quota then
      raise exception 'budget: this capsule is full (% MB of % MB used). Try a smaller photo or a video link instead.',
        round(v_used / 1048576.0, 1), round(v_quota / 1048576.0, 1)
        using errcode = 'check_violation';
    end if;

    select coalesce(sum(storage_bytes), 0) into v_global from public.capsules;
    if v_global + new.byte_size > v_ceiling then
      raise exception 'budget: the shared vault is full. A video link costs 0 MB — use one.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists contributions_budget on public.contributions;
create trigger contributions_budget before insert on public.contributions
  for each row execute function public.contribution_budget_guard();

create or replace function public.contribution_counters()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    update public.capsules
       set contribution_count = contribution_count + 1,
           storage_bytes      = storage_bytes + new.byte_size
     where id = new.capsule_id;
    return new;
  else
    update public.capsules
       set contribution_count = greatest(contribution_count - 1, 0),
           storage_bytes      = greatest(storage_bytes - old.byte_size, 0)
     where id = old.capsule_id;
    return old;
  end if;
end;
$$;

drop trigger if exists contributions_counters on public.contributions;
create trigger contributions_counters after insert or delete on public.contributions
  for each row execute function public.contribution_counters();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Predictions: sealed guesses stay sealed; resolution is the only edit.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.prediction_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    -- A guess cannot arrive pre-resolved.
    if new.resolved_guess is not null or new.is_correct is not null then
      raise exception 'guess: a guess cannot be resolved on arrival'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE: only the resolution columns may move, and only after unlock.
  if not public.is_capsule_unlocked(old.capsule_id) then
    raise exception 'sealed: guesses cannot be edited before the capsule opens'
      using errcode = 'check_violation';
  end if;

  if new.guess <> old.guess
     or new.prompt_key <> old.prompt_key
     or new.prompt_text <> old.prompt_text
     or new.author_id <> old.author_id
     or new.capsule_id <> old.capsule_id then
    raise exception 'guess: the original guess is immutable, only the resolution may change'
      using errcode = 'check_violation';
  end if;

  new.resolved_at := coalesce(new.resolved_at, now());
  new.resolved_by := coalesce(new.resolved_by, auth.uid());

  return new;
end;
$$;

drop trigger if exists predictions_guard on public.prediction_responses;
create trigger predictions_guard before insert or update on public.prediction_responses
  for each row execute function public.prediction_guard();

create or replace function public.prediction_counter()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.capsules
     set prediction_count = greatest(prediction_count + case when tg_op = 'INSERT' then 1 else -1 end, 0)
   where id = case when tg_op = 'INSERT' then new.capsule_id else old.capsule_id end;
  return null;
end;
$$;

drop trigger if exists predictions_counter on public.prediction_responses;
create trigger predictions_counter after insert or delete on public.prediction_responses
  for each row execute function public.prediction_counter();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Realtime events: nothing but presence before the capsule opens.
--    Otherwise a sealed capsule leaks its contents through the event log.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.realtime_event_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.actor_id is distinct from auth.uid() then
    new.actor_id := auth.uid();
  end if;

  if not public.is_capsule_unlocked(new.capsule_id)
     and new.event_type not in ('presence_join', 'presence_leave') then
    raise exception 'sealed: the party starts when the capsule opens'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists realtime_events_guard on public.realtime_events;
create trigger realtime_events_guard before insert on public.realtime_events
  for each row execute function public.realtime_event_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Join by invite code (the only way into a capsule you do not own)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.join_capsule_by_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_capsule public.capsules;
begin
  if auth.uid() is null then
    raise exception 'auth: sign in first' using errcode = '42501';
  end if;

  select * into v_capsule
  from public.capsules
  where upper(trim(p_code)) = invite_code;

  if not found then
    raise exception 'invite: that code does not match any capsule'
      using errcode = 'no_data_found';
  end if;

  if exists (
    select 1 from public.capsule_members m
    where m.capsule_id = v_capsule.id and m.user_id = auth.uid()
  ) then
    return v_capsule.id;
  end if;

  insert into public.capsule_members (capsule_id, user_id, role)
  values (v_capsule.id, auth.uid(), 'member');

  return v_capsule.id;
end;
$$;

-- Public preview of a capsule for the "you've been invited" screen. Returns only
-- harmless metadata — never contents, never the member list.
create or replace function public.preview_invite(p_code text)
returns table (id uuid, title text, subtitle text, cover_emoji text,
               unlock_at timestamptz, member_count smallint, max_members smallint)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select c.id, c.title, c.subtitle, c.cover_emoji, c.unlock_at, c.member_count, c.max_members
  from public.capsules c
  where upper(trim(p_code)) = c.invite_code;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Presence slots — the 20-concurrent-user cap, counted server-side.
--
--    Supabase free tier allows 200 concurrent realtime connections globally.
--    With a 20-per-capsule cap, ten simultaneous parties is the worst case.
--    A "presence" is a distinct member who joined a channel in the last 3
--    minutes. Slot 21+ is granted=false and the client downgrades to
--    read-only spectator mode instead of opening a presence channel.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.claim_presence_slot(p_capsule_id uuid)
returns table (granted boolean, slot integer, present integer, capacity integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cap     smallint;
  v_present integer;
  v_mine    integer;
begin
  if not public.is_capsule_member(p_capsule_id) then
    raise exception 'auth: not a member of this capsule' using errcode = '42501';
  end if;

  select max_members into v_cap from public.capsules where id = p_capsule_id;
  if v_cap is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;

  select count(distinct e.actor_id), count(distinct e.actor_id) filter (where e.actor_id = auth.uid())
    into v_present, v_mine
  from public.realtime_events e
  where e.capsule_id = p_capsule_id
    and e.event_type = 'presence_join'
    and e.created_at > now() - interval '3 minutes';

  if v_mine > 0 then
    -- Already holding a slot: keep it, do not double count.
    return query select true, 0, v_present, v_cap::integer;
    return;
  end if;

  if v_present >= v_cap then
    return query select false, 0, v_present, v_cap::integer;
    return;
  end if;

  insert into public.realtime_events (capsule_id, actor_id, event_type, payload)
  values (p_capsule_id, auth.uid(), 'presence_join',
          jsonb_build_object('at', now(), 'source', 'claim_presence_slot'));

  return query select true, v_present + 1, v_present + 1, v_cap::integer;
end;
$$;

create or replace function public.release_presence_slot(p_capsule_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_capsule_member(p_capsule_id) then
    return;
  end if;
  insert into public.realtime_events (capsule_id, actor_id, event_type, payload)
  values (p_capsule_id, auth.uid(), 'presence_leave',
          jsonb_build_object('at', now()));
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Cron internals (service role only — executed by /api/cron/check-unlocks)
-- ─────────────────────────────────────────────────────────────────────────────

-- How many Resend emails have already gone out today? The batcher reads this so
-- it can never exceed the free 100/day cap.
create or replace function public.emails_sent_on(p_day date)
returns integer language sql security definer stable set search_path = public, pg_temp as $$
  select coalesce(count(*), 0)::integer
  from public.notification_queue q
  where q.state = 'sent'
    and (q.sent_at at time zone 'utc')::date = p_day;
$$;

-- Find capsules whose unlock date is today (UTC) and stamp them open.
-- Idempotent: the `unlocked_notified_at is null` filter means a re-run is a no-op.
create or replace function public.unlock_due_capsules(p_day date)
returns table (capsule_id uuid, title text, unlock_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select c.id
    from public.capsules c
    where (c.unlock_at at time zone 'utc')::date <= p_day
      and c.unlocked_notified_at is null
    order by c.unlock_at
    limit 25
    for update skip locked
  )
  update public.capsules c
     set status = 'unlocked',
         unlocked_notified_at = now()
    from due
   where c.id = due.id
  returning c.id, c.title, c.unlock_at;
end;
$$;

-- Queue one email per member per unlocked capsule. ON CONFLICT makes replays safe.
create or replace function public.enqueue_unlock_notifications(p_day date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  with target as (
    select c.id as capsule_id, m.user_id, pc.email
    from public.capsules c
    join public.capsule_members m on m.capsule_id = c.id
    join public.profile_contacts pc on pc.user_id = m.user_id
    where (c.unlocked_notified_at at time zone 'utc')::date = p_day
  )
  insert into public.notification_queue (capsule_id, user_id, email, kind, scheduled_for)
  select t.capsule_id, t.user_id, t.email, 'capsule_unlocked', p_day
  from target t
  on conflict (capsule_id, user_id, kind, scheduled_for) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Retention: keep the DB under 500 MB forever. The party log is ephemeral.
create or replace function public.prune_realtime_events(p_keep_days integer default 7)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  delete from public.realtime_events
  where created_at < now() - make_interval(days => greatest(p_keep_days, 1));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Grants: definer RPCs are the public surface; cron internals are not.
-- ─────────────────────────────────────────────────────────────────────────────
grant execute on function public.join_capsule_by_code(text) to authenticated;
grant execute on function public.preview_invite(text) to anon, authenticated;
grant execute on function public.claim_presence_slot(uuid) to authenticated;
grant execute on function public.release_presence_slot(uuid) to authenticated;

revoke execute on function public.unlock_due_capsules(date) from public, anon, authenticated;
revoke execute on function public.enqueue_unlock_notifications(date) from public, anon, authenticated;
revoke execute on function public.prune_realtime_events(integer) from public, anon, authenticated;
revoke execute on function public.emails_sent_on(date) from public, anon, authenticated;
revoke execute on function public.platform_storage_ceiling() from public, anon, authenticated;

grant execute on function public.unlock_due_capsules(date) to service_role;
grant execute on function public.enqueue_unlock_notifications(date) to service_role;
grant execute on function public.prune_realtime_events(integer) to service_role;
grant execute on function public.emails_sent_on(date) to service_role;
