-- Magistrate Wizard — storage buckets & policies
-- Two buckets:
--   documents — private; case/bench-note attachments. Path convention is
--     {uploader_user_id}/{case_id-or-bench_note_id}/{filename}. Storage
--     grants only enforce the "own folder" write rule; actual read access
--     is governed by the public.documents metadata row (see below).
--   avatars — public read; profile pictures. Path convention is
--     {user_id}/{filename}.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  26214400, -- 25 MB
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880, -- 5 MB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- documents bucket -----------------------------------------------------

create policy "Uploaders can write into their own documents folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can read documents they have access to"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1
      from public.documents d
      where d.file_path = storage.objects.name
        and (
          d.uploaded_by = auth.uid()
          or (d.case_id is not null and public.user_can_access_case(d.case_id))
          or (d.bench_note_id is not null and public.user_can_access_bench_note(d.bench_note_id))
        )
    )
  );

create policy "Uploaders and admins can delete documents from storage"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'documents'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );

-- avatars bucket ---------------------------------------------------------

create policy "Avatar images are publicly viewable"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "Users can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update their own avatar"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own avatar"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
