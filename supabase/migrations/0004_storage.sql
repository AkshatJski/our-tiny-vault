-- ════════════════════════════════════════════════════════════════════════════
-- our tiny vault — 0004_storage.sql
--
-- ONE private bucket, two hard limits, zero video files.
--
--   1 GB total free storage. A 5 MB image ceiling and a 60-second audio ceiling
--   mean the worst case per contribution is small enough to survive a year of
--   enthusiasm. Videos are links — they cost 0 bytes and never expire with us.
--
-- Path convention (enforced below, not just documented):
--     capsule-media/{capsule_id}/{user_id}/{uuid}.{ext}
--
-- Because the first and second folders are parsed out of `name`, the policy is
-- the only thing that decides ownership. A client cannot smuggle a file into
-- someone else's capsule even with a valid session.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- Buckets
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'capsule-media',
  'capsule-media',
  false,                      -- private: reads always go through RLS + signed URLs
  5242880,                    -- 5 MB hard ceiling at the storage layer
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif',
    'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'
  ]
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = 5242880,
      allowed_mime_types = excluded.allowed_mime_types;

-- Weekly text snapshots land here. No client policy exists, so only the service
-- role (the cron) can read or write it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('capsule-backups', 'capsule-backups', false, 1048576, array['application/json'])
on conflict (id) do update
  set public = false, file_size_limit = 1048576, allowed_mime_types = array['application/json'];

-- ─────────────────────────────────────────────────────────────────────────────
-- Upload policy: member + sealed + right path + right type + right size
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
    -- images and audio only. A video/* upload is rejected by the bucket list
    -- above, and this repeats the check so the intent is readable in one place.
    and (
      coalesce(metadata ->> 'mimetype', '') like 'image/%'
      or coalesce(metadata ->> 'mimetype', '') like 'audio/%'
    )
    and coalesce((metadata ->> 'size')::bigint, 0) between 1 and 5242880
  );

-- Read policy: the same lock as `contributions`. Media is unreadable — even by
-- its uploader — until the capsule opens.
drop policy if exists capsule_media_select on storage.objects;
create policy capsule_media_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'capsule-media'
    and public.try_uuid((storage.foldername(name))[1]) is not null
    and public.can_read_capsule_contents(public.try_uuid((storage.foldername(name))[1]))
  );

-- Let someone clean up their own mistake while the capsule is still sealed.
-- Once it opens, history is immutable.
drop policy if exists capsule_media_delete on storage.objects;
create policy capsule_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'capsule-media'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.try_uuid((storage.foldername(name))[1]) is not null
    and public.can_seal_into_capsule(public.try_uuid((storage.foldername(name))[1]))
  );

-- No UPDATE policy: objects are write-once. Overwriting a memory is not a
-- feature, and it would let a sealed capsule's bytes change after the fact.

-- ─────────────────────────────────────────────────────────────────────────────
-- Convenience view for the cron's storage accounting (service role only).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.storage_overview
with (security_invoker = true) as
select
  b.id as bucket_id,
  count(o.id) as object_count,
  coalesce(sum((o.metadata ->> 'size')::bigint), 0) as bytes_used,
  (select public.platform_storage_ceiling()) as ceiling_bytes
from storage.buckets b
left join storage.objects o on o.bucket_id = b.id
group by b.id;

revoke all on public.storage_overview from anon, authenticated;
