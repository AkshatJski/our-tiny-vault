-- ─────────────────────────────────────────────────────────────────────────────
-- 0006 — let a capsule's OWNER clear its media when they delete the vault
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY THIS EXISTS
--
-- `deleteCapsule` deletes a row in `public.capsules`. Postgres cascades the
-- contributions, the memberships and the notification rows. Storage objects are
-- NOT part of that graph: they live in `storage.objects`, keyed by the path
-- `{capsule_id}/{user_id}/{uuid}.{ext}`, with no foreign key back to `capsules`.
-- So every deleted vault used to leave its photos and voice notes in the bucket
-- forever — silent, unbounded, and counted against the 900 MB ceiling.
--
-- The old delete policy could not help:
--
--     and (storage.foldername(name))[2] = auth.uid()::text
--     and public.can_seal_into_capsule(...)          -- "member AND still sealed"
--
-- An author may only delete *their own* file, and only while the capsule is
-- sealed. But a vault may only be deleted once it has OPENED, at which point
-- `can_seal_into_capsule` is false for everyone. So the one moment cleanup is
-- needed is the one moment the policy forbids it. Dead lock, by construction.
--
-- WHAT THIS POLICY ALLOWS
--
-- Delete an object in `capsule-media` when ALL of these hold:
--   * the path is exactly `{capsule}/{author}/{file}`
--   * the capsule has opened          -> can_read_capsule_contents()
--   * the caller owns that capsule    -> capsules.owner_id = auth.uid()
--
-- That is deliberately narrower than "members may delete": an ordinary member
-- still cannot remove anything, and while the vault is sealed nobody can. The
-- only new capability is the one the owner already has in the UI (delete the
-- vault), extended to the bytes that belong to it.
--
-- It is permissive alongside `capsule_media_delete` (policies OR together), so
-- the original author-while-sealed rule keeps working untouched.
--
-- NOTE ON ORDERING: app code removes storage FIRST, then the row. If it were the
-- other way round this policy would stop matching (the capsule is gone, so
-- `can_read_capsule_contents` is false) and the media would be unreachable but
-- permanent — exactly the leak this file is fixing.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists capsule_media_owner_delete on storage.objects;

create policy capsule_media_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'capsule-media'
    and array_length(storage.foldername(name), 1) = 2
    and public.try_uuid((storage.foldername(name))[1]) is not null
    -- the vault is open (this is also the gate on deleting the vault itself)
    and public.can_read_capsule_contents(public.try_uuid((storage.foldername(name))[1]))
    -- and I am its owner, not merely a member
    and exists (
      select 1
      from public.capsules c
      where c.id = public.try_uuid((storage.foldername(name))[1])
        and c.owner_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Self-check. All four lines must come back `true`. If `try_uuid` is missing,
-- run 0002_rls.sql first.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_policy int;
  v_helpers int;
begin
  select count(*) into v_policy from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'capsule_media_owner_delete';

  select count(*) into v_helpers from pg_proc
   where proname in ('can_read_capsule_contents', 'try_uuid');

  if v_policy <> 1 then
    raise exception 'capsule_media_owner_delete policy was not created (found %)', v_policy;
  end if;
  if v_helpers < 2 then
    raise exception 'helper functions missing (% found) — run 0002_rls.sql first', v_helpers;
  end if;

  raise notice '0006 ok: owner delete policy in place, helpers present';
end $$;
