-- ════════════════════════════════════════════════════════════════════════════
-- our tiny vault — 0005_fix_storage_policies.sql
--
-- WHY THIS EXISTS
--
-- 0004_storage.sql put the mime/size rules *inside* the INSERT policy:
--
--     and coalesce(metadata ->> 'mimetype', '') like 'image/%'
--     and coalesce((metadata ->> 'size')::bigint, 0) between 1 and 5242880
--
-- The storage API does not reliably expose `metadata` at the moment the
-- `WITH CHECK` for an INSERT is evaluated, so both clauses fell through to
-- their `coalesce(..., '')` / `coalesce(..., 0)` defaults and the policy denied
-- EVERY upload with:
--
--     403 new row violates row-level security policy
--
-- ...which the app surfaces as "That door is locked right now." Notes still
-- worked (they are a plain PostgREST insert), so the vault looked like it was
-- "only accepting one type of content".
--
-- THE FIX
--
--   Delete the metadata clauses. They were always redundant: the bucket itself
--   carries `file_size_limit = 5242880` and an `allowed_mime_types` allowlist,
--   and storage-api enforces both *before* RLS is consulted. A client cannot
--   bypass the bucket configuration — it is not a policy, it is the storage
--   layer refusing the bytes.
--
--   So the policy goes back to answering the only question RLS should answer:
--     * is this the right bucket?
--     * is the path shape right, and does it name *me* as the author?
--     * is the capsule still sealed, and am I a member of it?
--
-- Everything else (mime allowlist, 5 MB ceiling) stays where it belongs.
--
-- SAFE TO RE-RUN.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- Bucket: re-assert the hard limits. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'capsule-media',
  'capsule-media',
  false,
  5242880,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif',
    'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'
  ]
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = 5242880,
      allowed_mime_types = excluded.allowed_mime_types;

-- ─────────────────────────────────────────────────────────────────────────────
-- INSERT: member + sealed + path names me. No metadata introspection.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists capsule_media_insert on storage.objects;
create policy capsule_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'capsule-media'
    -- exactly two folders: capsule id / author id
    and array_length(storage.foldername(name), 1) = 2
    and public.try_uuid((storage.foldername(name))[1]) is not null
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.can_seal_into_capsule(public.try_uuid((storage.foldername(name))[1]))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT: unreadable — even to its uploader — until the capsule opens.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists capsule_media_select on storage.objects;
create policy capsule_media_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'capsule-media'
    and public.try_uuid((storage.foldername(name))[1]) is not null
    and public.can_read_capsule_contents(public.try_uuid((storage.foldername(name))[1]))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- DELETE: clean up your own mistake while still sealed. Post-unlock is history.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists capsule_media_delete on storage.objects;
create policy capsule_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'capsule-media'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.try_uuid((storage.foldername(name))[1]) is not null
    and public.can_seal_into_capsule(public.try_uuid((storage.foldername(name))[1]))
  );

-- No UPDATE policy: objects are write-once.

-- ─────────────────────────────────────────────────────────────────────────────
-- Self-check: these must all come back non-null. If `can_seal_into_capsule` is
-- missing, run 0002_rls.sql first.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.can_seal_into_capsule(uuid)') is null then
    raise exception 'public.can_seal_into_capsule(uuid) is missing — apply 0002_rls.sql first';
  end if;
  if to_regprocedure('public.try_uuid(text)') is null then
    raise exception 'public.try_uuid(text) is missing — apply 0002_rls.sql first';
  end if;
end $$;
