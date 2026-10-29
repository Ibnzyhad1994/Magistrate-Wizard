-- Magistrate Wizard -- 0231: the documents bucket takes HTML only as a
-- DOCX preview, and each person's folder has a storage quota
--
-- Problem (backend sweep, low priority)
--   0083 added 'text/html' to the documents bucket's allowed types so the
--   DOCX preview (docx-page-preview.ts) could be cached as an HTML snapshot.
--   The bucket's only upload rule (0011, 0012) is "your own folder", and an
--   upload needs no `documents` row. So any signed-in user could store any
--   HTML file under any name, served from the project's Storage domain
--   through a signed URL, and store as many files of any allowed type as
--   they liked: nothing bounded a person's total.
--
-- Change
--   1. preview_derivative_source_id(name) reads the source document id out
--      of the one path the app writes a preview to,
--      `<uid>/preview-derivatives/<source document id>.html`, and is null
--      for every other name.
--   2. documents_storage_quota_bytes(profile) is the quota: 5 GiB for a
--      magistrate or clerk, 50 GiB for an administrator, who curates the
--      shared legal library from their own folder. These are the
--      recommended defaults; a later migration may change them.
--      documents_storage_used_bytes(profile) sums the sizes Storage records
--      for that person's folder. my_documents_storage() returns both for the
--      caller, for a usage display.
--   3. documents_upload_within_quota(metadata) is true when the caller's
--      usage plus the incoming file's size (the size or contentLength
--      Storage passes with the upload) stays within the quota. The bound
--      holds to within one file (25 MB, the bucket's file size limit).
--   4. A restrictive INSERT policy on storage.objects in the documents
--      bucket: an object whose content type is text/html must
--      sit at a preview-derivative path whose source document the caller
--      can see and that is not itself a preview; and every object must keep
--      the caller within their quota. It narrows the existing own-folder
--      policy (it is ANDed with it) and changes nothing outside the
--      documents bucket. The bucket has no UPDATE policy, so an upload
--      cannot overwrite or move an object onto another name either.
--
-- Existing objects are untouched: nothing is deleted or moved, and a person
-- already over their quota keeps every file but cannot add another until
-- they delete some. The bucket still allows text/html, for previews.
--
-- Threat model
--   documents_storage_used_bytes, documents_storage_quota_bytes and
--   documents_upload_within_quota are SECURITY DEFINER because they read
--   storage.objects rows the caller's own read policy hides (a file with no
--   documents row) and the caller's role. They take no client SQL, return
--   only byte counts or a boolean, and are executable only by authenticated
--   (the policy evaluates documents_upload_within_quota as the caller);
--   the two that take a profile id are executable by no client role, so a
--   user learns only their own usage. preview_derivative_source_id is a
--   pure function of the name. The source-document check runs as the
--   caller, under the documents SELECT policy, so a preview can be stored
--   only for a document the caller could already open. No admin path is
--   added: an administrator's larger quota grants no access to anyone's
--   files.
-- ============================================================================

-- ==================== 1. the preview path ====================

create or replace function public.preview_derivative_source_id(p_name text)
returns uuid
language sql
immutable
set search_path = public
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/preview-derivatives/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.html$'
    then substring(p_name from '/preview-derivatives/([0-9a-f-]{36})\.html$')::uuid
  end;
$$;

comment on function public.preview_derivative_source_id(text) is
  'The source document id in a DOCX preview path, `<uid>/preview-derivatives/<source document id>.html` (the path generateAndCacheDocxPreview writes); null for any other object name (0231).';

revoke all on function public.preview_derivative_source_id(text) from public, anon;
grant execute on function public.preview_derivative_source_id(text) to authenticated;

-- ==================== 2. quota and usage ====================

create or replace function public.documents_storage_quota_bytes(p_profile_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.profiles p
      where p.id = p_profile_id
        and p.role = 'admin'
    ) then 53687091200::bigint -- 50 GiB
    else 5368709120::bigint -- 5 GiB
  end;
$$;

comment on function public.documents_storage_quota_bytes(uuid) is
  'Storage quota for one person''s folder in the documents bucket (0231): 5 GiB, or 50 GiB for an administrator, who curates the legal library from their own folder. Recommended defaults; change them with a migration. SECURITY DEFINER; executable by no client role.';

revoke all on function public.documents_storage_quota_bytes(uuid) from public, anon, authenticated;

create or replace function public.documents_storage_used_bytes(p_profile_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(
    case when o.metadata ->> 'size' ~ '^[0-9]{1,18}$' then (o.metadata ->> 'size')::bigint else 0 end
  ), 0)::bigint
  from storage.objects o
  where o.bucket_id = 'documents'
    and o.name like p_profile_id::text || '/%';
$$;

comment on function public.documents_storage_used_bytes(uuid) is
  'Bytes stored in one person''s folder of the documents bucket, from the sizes Storage records (0231). Counts every object there, with or without a documents row. SECURITY DEFINER: reads storage.objects past the caller''s read policy; executable by no client role.';

revoke all on function public.documents_storage_used_bytes(uuid) from public, anon, authenticated;

create or replace function public.my_documents_storage()
returns table (used_bytes bigint, quota_bytes bigint)
language sql
stable
security definer
set search_path = public
as $$
  select public.documents_storage_used_bytes(auth.uid()),
         public.documents_storage_quota_bytes(auth.uid())
  where auth.uid() is not null;
$$;

comment on function public.my_documents_storage() is
  'The caller''s own documents-bucket usage and quota in bytes (0231). No row without a signed-in caller.';

revoke all on function public.my_documents_storage() from public, anon;
grant execute on function public.my_documents_storage() to authenticated;

-- ==================== 3. the upload check ====================

create or replace function public.documents_upload_within_quota(p_metadata jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_incoming bigint;
begin
  if v_uid is null then
    return false;
  end if;

  v_incoming := case
    when p_metadata ->> 'size' ~ '^[0-9]{1,18}$' then (p_metadata ->> 'size')::bigint
    when p_metadata ->> 'contentLength' ~ '^[0-9]{1,18}$' then (p_metadata ->> 'contentLength')::bigint
    else 0
  end;

  return public.documents_storage_used_bytes(v_uid) + v_incoming
    <= public.documents_storage_quota_bytes(v_uid);
end;
$$;

comment on function public.documents_upload_within_quota(jsonb) is
  'True when the caller''s documents-bucket usage plus the incoming object''s size (metadata size or contentLength, as Storage passes them) stays within their quota (0231). Evaluated by the documents upload policy as the caller. SECURITY DEFINER: reads storage.objects and the caller''s role.';

revoke all on function public.documents_upload_within_quota(jsonb) from public, anon;
grant execute on function public.documents_upload_within_quota(jsonb) to authenticated;

-- ==================== 4. the policy ====================

create policy "Documents uploads keep HTML to previews and stay within quota"
  on storage.objects
  as restrictive
  for insert
  to authenticated
  with check (
    bucket_id <> 'documents'
    or (
      (
        lower(coalesce(metadata ->> 'mimetype', '')) not like 'text/html%'
        or exists (
          select 1
          from public.documents d
          where d.id = public.preview_derivative_source_id(name)
            and d.purpose <> 'preview_derivative'
        )
      )
      and public.documents_upload_within_quota(metadata)
    )
  );
