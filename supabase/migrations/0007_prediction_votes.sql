-- 0007_prediction_votes.sql — the reading room becomes a vote, not a race.
--
-- BEFORE: after unlock, any member could set prediction_responses.is_correct
-- *once*. The first click was final, the buttons vanished for everybody else,
-- and nobody could see who decided or how the group actually felt. Two people
-- who disagreed never found out.
--
-- NOW: one row per person per guess. Everyone votes, everyone can change their
-- mind, the tally is visible, and the majority drives the stamp. The guess
-- itself is untouched — 0003's guard still makes it immutable.
--
-- is_correct / resolved_at / resolved_by are left in place as a legacy record of
-- the old single-click model. Nothing writes them any more, and nothing needs to.

create table if not exists public.prediction_votes (
  prediction_id uuid not null
    references public.prediction_responses(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete cascade,
  vote boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (prediction_id, user_id)
);

create index if not exists prediction_votes_prediction_idx
  on public.prediction_votes (prediction_id);

alter table public.prediction_votes enable row level security;

grant select, insert, update, delete on public.prediction_votes to authenticated;

-- ── Read: only once the capsule has opened ───────────────────────────────────
-- The EXISTS subquery is itself filtered by prediction_responses' SELECT policy,
-- so a sealed guess cannot even be probed for votes: no row, no tally.
drop policy if exists prediction_votes_select_after_unlock on public.prediction_votes;
create policy prediction_votes_select_after_unlock on public.prediction_votes
  for select to authenticated
  using (
    exists (
      select 1
      from public.prediction_responses p
      where p.id = prediction_id
        and public.can_read_capsule_contents(p.capsule_id)
    )
  );

-- ── Write: your own vote, after unlock ───────────────────────────────────────
-- postgrest's upsert compiles to INSERT … ON CONFLICT DO UPDATE, so it needs
-- *both* policies. Without the UPDATE one, changing your mind returns 42501.
drop policy if exists prediction_votes_insert_own on public.prediction_votes;
create policy prediction_votes_insert_own on public.prediction_votes
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.prediction_responses p
      where p.id = prediction_id
        and public.can_read_capsule_contents(p.capsule_id)
    )
  );

drop policy if exists prediction_votes_update_own on public.prediction_votes;
create policy prediction_votes_update_own on public.prediction_votes
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.prediction_responses p
      where p.id = prediction_id
        and public.can_read_capsule_contents(p.capsule_id)
    )
  );

drop policy if exists prediction_votes_delete_own on public.prediction_votes;
create policy prediction_votes_delete_own on public.prediction_votes
  for delete to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.prediction_responses p
      where p.id = prediction_id
        and public.can_read_capsule_contents(p.capsule_id)
    )
  );
