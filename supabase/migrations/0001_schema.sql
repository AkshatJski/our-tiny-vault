-- ════════════════════════════════════════════════════════════════════════════
-- our tiny vault — 0001_schema.sql
-- Core relational schema. Applied first, nothing here depends on RLS.
--
-- $0-budget notes baked into the schema itself:
--   * max_members <= 20  -> the realtime presence cap (200 conn global / 20 per)
--   * byte_size + quota  -> per-capsule + platform-wide storage ceiling
--   * CHECK constraints  -> the DB refuses oversized media, not just the client
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────
do $$ begin
  create type public.capsule_status as enum ('sealed', 'unlocked', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.contribution_kind as enum
    ('note', 'photo', 'audio', 'video_link', 'doodle', 'playlist_link');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.member_role as enum ('owner', 'keeper', 'member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_kind as enum
    ('unlock_reminder', 'capsule_unlocked', 'weekly_digest');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_state as enum
    ('pending', 'sent', 'skipped', 'failed');
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- profiles — 1:1 with auth.users, created by trigger on signup
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  handle        text not null unique check (handle ~ '^[a-z0-9_]{3,32}$'),
  display_name  text not null check (char_length(display_name) between 1 and 60),
  avatar_emoji  text not null default '🫧' check (char_length(avatar_emoji) <= 8),
  accent_color  text not null default '#F4C7C3' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- profile_contacts — email addresses live OUTSIDE `profiles`.
--
-- Why a separate table: every signed-in member can read `profiles` (they need
-- names and avatars). Nobody should be able to enumerate everyone's email.
-- This table has RLS enabled and zero policies, so only the service role (the
-- daily cron) can ever read it.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.profile_contacts (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  email      text not null check (position('@' in email) > 1),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- capsules
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.capsules (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references public.profiles (id) on delete restrict,
  title               text not null check (char_length(title) between 1 and 120),
  subtitle            text check (char_length(subtitle) <= 200),
  theme               text not null default 'cream'
                        check (theme in ('cream', 'blush', 'butter', 'sage', 'cardboard')),
  cover_emoji         text not null default '🕰️' check (char_length(cover_emoji) <= 8),
  invite_code         text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),

  seal_at             timestamptz not null default now(),
  unlock_at           timestamptz not null,

  -- Free-tier caps, enforced at the data layer
  max_members         smallint not null default 12 check (max_members between 2 and 20),
  member_count        smallint not null default 0 check (member_count >= 0),
  storage_quota_bytes bigint not null default 62914560, -- 60 MB per capsule
  storage_bytes       bigint not null default 0 check (storage_bytes >= 0),
  contribution_count  integer not null default 0 check (contribution_count >= 0),
  prediction_count    integer not null default 0 check (prediction_count >= 0),

  -- Bookkeeping for the daily cron determinism (never notified twice)
  unlocked_notified_at timestamptz,
  status              public.capsule_status not null default 'sealed',

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint capsule_unlock_after_seal check (unlock_at > seal_at),
  -- A capsule further than 50 years out outlives every free tier on earth.
  constraint capsule_horizon_check check (unlock_at < seal_at + interval '50 years'),
  constraint capsule_quota_sane check (storage_quota_bytes between 1048576 and 262144000)
);

create index if not exists capsules_unlock_at_idx on public.capsules (unlock_at);
create index if not exists capsules_owner_idx     on public.capsules (owner_id);
-- Partial on purpose: only capsules that still need an unlock notification are
-- indexed, which is exactly the cron's candidate set — and it stays tiny as old
-- capsules unlock and get stamped. `unlock_at` is indexed rather than the
-- expression `(unlock_at at time zone 'utc')::date` because an index expression
-- must be IMMUTABLE, and timezone-dependent casts are not reliably so. The
-- planner uses this via the matching `unlocked_notified_at is null` predicate
-- plus the index's natural `unlock_at` ordering, which is what the cron sorts by.
create index if not exists capsules_due_idx
  on public.capsules (unlock_at)
  where unlocked_notified_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- capsule_members
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.capsule_members (
  capsule_id   uuid not null references public.capsules (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         public.member_role not null default 'member',
  joined_at    timestamptz not null default now(),
  last_seen_at timestamptz,
  primary key (capsule_id, user_id)
);

create index if not exists capsule_members_user_idx on public.capsule_members (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- contributions — the actual contents of the capsule
--
-- Immutable by design: nothing in this table is ever updated. The only way a
-- contribution stops existing is (a) its author deletes it while the capsule is
-- still sealed, or (b) the capsule is deleted.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.contributions (
  id                uuid primary key default gen_random_uuid(),
  capsule_id        uuid not null references public.capsules (id) on delete cascade,
  author_id         uuid not null references public.profiles (id) on delete cascade,
  kind              public.contribution_kind not null,

  body              text check (body is null or char_length(body) <= 4000),
  -- Caption / note text. Also the only home for 'note' and 'doodle' payloads.

  storage_path      text,          -- photo + audio only, bucket 'capsule-media'
  mime_type         text,
  byte_size         integer not null default 0 check (byte_size between 0 and 5242880),
  duration_seconds  smallint check (duration_seconds is null or duration_seconds between 1 and 60),

  external_url      text check (external_url is null or char_length(external_url) <= 500),
  external_provider text check (external_provider is null
                                or external_provider in ('youtube','tiktok','instagram','spotify')),

  created_at        timestamptz not null default now(),

  -- ── the $0-budget guard rail, in the DB ──────────────────────────────────
  -- NO VIDEO FILES. Ever. `video_link` can only carry a URL.
  constraint contribution_payload_valid check (
    case kind
      when 'note' then body is not null
      when 'doodle' then body is not null
      when 'photo' then
        storage_path is not null and mime_type like 'image/%'
        and byte_size between 1 and 5242880                  -- 5 MB hard ceiling
      when 'audio' then
        storage_path is not null and mime_type like 'audio/%'
        and duration_seconds between 1 and 60                -- 60 s hard ceiling
        and byte_size between 1 and 2097152                  -- ~2 MB safety net
      when 'video_link' then
        external_url is not null and external_provider is not null
      when 'playlist_link' then
        external_url is not null and external_provider = 'spotify'
    end
  ),

  -- A file-backed contribution must carry a path, a link-backed one must not.
  constraint contribution_no_stray_files check (
    (kind in ('photo','audio')) = (storage_path is not null)
  )
);

create index if not exists contributions_capsule_idx
  on public.contributions (capsule_id, created_at desc);
create index if not exists contributions_author_idx
  on public.contributions (author_id, capsule_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- prediction_responses — the "Dear Future Us" board
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.prediction_responses (
  id             uuid primary key default gen_random_uuid(),
  capsule_id     uuid not null references public.capsules (id) on delete cascade,
  author_id      uuid not null references public.profiles (id) on delete cascade,

  prompt_key     text not null check (prompt_key ~ '^[a-z0-9_]{2,48}$'),
  prompt_text    text not null check (char_length(prompt_text) between 1 and 200),
  guess          text not null check (char_length(guess) between 1 and 280),

  -- Filled in during the unlock party by the scratch-off screen.
  resolved_guess text check (resolved_guess is null or char_length(resolved_guess) <= 280),
  is_correct     boolean,
  resolved_at    timestamptz,
  resolved_by    uuid references public.profiles (id) on delete set null,

  created_at     timestamptz not null default now(),

  -- One guess per person per prompt keeps the pinboard readable.
  constraint prediction_one_per_prompt unique (capsule_id, author_id, prompt_key),
  -- Resolution fields travel together or not at all.
  constraint prediction_resolution_coherent check (
    (resolved_at is null and resolved_by is null and is_correct is null)
    or (resolved_at is not null and resolved_by is not null and is_correct is not null)
  )
);

create index if not exists predictions_capsule_idx
  on public.prediction_responses (capsule_id, prompt_key);

-- ─────────────────────────────────────────────────────────────────────────────
-- realtime_events — audit/fallback log for the live opening party.
--
-- Realtime *broadcast* is the hot path (it never touches Postgres). This table
-- exists so that (a) the 20-user presence cap is countable server-side, and
-- (b) a dropped connection can replay what it missed.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.realtime_events (
  id          bigserial primary key,
  capsule_id  uuid not null references public.capsules (id) on delete cascade,
  actor_id    uuid references public.profiles (id) on delete set null,
  event_type  text not null check (event_type in (
                'presence_join', 'presence_leave', 'unwrap_progress',
                'unwrap_seal_broken', 'reaction_scratch_off',
                'contribution_sealed', 'party_opened'
              )),
  payload     jsonb not null default '{}'::jsonb
                check (pg_column_size(payload) < 2048),
  created_at  timestamptz not null default now()
);

create index if not exists realtime_events_capsule_idx
  on public.realtime_events (capsule_id, created_at desc);
-- the presence-cap counter needs exactly this shape
create index if not exists realtime_events_presence_idx
  on public.realtime_events (capsule_id, event_type, created_at desc)
  where event_type in ('presence_join', 'presence_leave');

-- ─────────────────────────────────────────────────────────────────────────────
-- notification_queue — the Resend failsafe, made durable.
--
-- Dedupe key (capsule, user, kind, day) means a re-run of the cron can never
-- double-send. `state` lets us mark rows 'skipped' once the 90/day cap is hit,
-- so tomorrow's run picks them up instead of losing them.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.notification_queue (
  id            uuid primary key default gen_random_uuid(),
  capsule_id    uuid not null references public.capsules (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  email         text not null check (position('@' in email) > 1),
  kind          public.notification_kind not null,
  state         public.notification_state not null default 'pending',
  scheduled_for date not null default ((now() at time zone 'utc')::date),
  attempts      smallint not null default 0 check (attempts between 0 and 5),
  error         text,
  resend_id     text,
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  constraint notification_once_per_day unique (capsule_id, user_id, kind, scheduled_for)
);

create index if not exists notification_queue_dispatch_idx
  on public.notification_queue (state, scheduled_for, created_at)
  where state = 'pending';
-- the daily quota counter reads this
create index if not exists notification_queue_sent_idx
  on public.notification_queue (sent_at) where state = 'sent';

-- ─────────────────────────────────────────────────────────────────────────────
-- system_heartbeats — the anti-pause paper trail.
--
-- Supabase pauses free projects after 7 days without API activity. A capsule
-- sealed for two years would be dead long before it opens. The daily Vercel
-- cron writes one row here, which *is* the keep-alive, and gives us a visible
-- record that the vault stayed awake the whole time.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.system_heartbeats (
  id          bigserial primary key,
  beat_date   date not null default ((now() at time zone 'utc')::date),
  source      text not null check (source in ('vercel_cron', 'health_check', 'manual', 'client')),
  note        text,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  constraint heartbeat_once_per_source_per_day unique (beat_date, source)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- cron_runs — observability for a job you only see once a day
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.cron_runs (
  id                bigserial primary key,
  run_at            timestamptz not null default now(),
  capsules_due      integer not null default 0,
  capsules_unlocked integer not null default 0,
  emails_queued     integer not null default 0,
  emails_sent       integer not null default 0,
  emails_deferred   integer not null default 0,
  quota_remaining   integer,
  ok                boolean not null default true,
  detail            jsonb not null default '{}'::jsonb
);

create index if not exists cron_runs_run_at_idx on public.cron_runs (run_at desc);
