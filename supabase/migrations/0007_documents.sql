-- BenchBook — document metadata
-- Files themselves live in the "documents" Storage bucket (created in
-- 0011_storage.sql); this table is the queryable metadata row per file,
-- and `file_path` must equal the object's full path within that bucket
-- (see the storage policies in 0011 for the path convention).

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.cases (id) on delete cascade,
  bench_note_id uuid references public.bench_notes (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id) on delete restrict,
  file_name text not null,
  file_path text not null unique,
  file_size bigint not null check (file_size >= 0),
  mime_type text not null,
  created_at timestamptz not null default now(),
  constraint documents_parent_check check (
    (case_id is not null and bench_note_id is null) or
    (case_id is null and bench_note_id is not null) or
    (case_id is null and bench_note_id is null)
  )
);

comment on table public.documents is 'Metadata for files stored in the "documents" Storage bucket; file_path matches storage.objects.name.';
comment on column public.documents.uploaded_by is 'ON DELETE RESTRICT preserves attachment provenance; deactivate the profile instead of deleting it.';

create index documents_case_id_idx on public.documents (case_id);
create index documents_bench_note_id_idx on public.documents (bench_note_id);
create index documents_uploaded_by_idx on public.documents (uploaded_by);

alter table public.documents enable row level security;

create policy "Users can view documents they have access to"
  on public.documents for select
  using (
    uploaded_by = auth.uid()
    or (case_id is not null and public.user_can_access_case(case_id))
    or (bench_note_id is not null and public.user_can_access_bench_note(bench_note_id))
  );

create policy "Users can attach documents to accessible parents"
  on public.documents for insert
  with check (
    uploaded_by = auth.uid()
    and (
      (case_id is not null and public.user_can_access_case(case_id))
      or (bench_note_id is not null and public.user_can_access_bench_note(bench_note_id))
      or (case_id is null and bench_note_id is null)
    )
  );

create policy "Uploaders and admins can delete documents"
  on public.documents for delete
  using (public.is_admin() or uploaded_by = auth.uid());
