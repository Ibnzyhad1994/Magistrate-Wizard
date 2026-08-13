-- Magistrate Wizard — bench notes
-- Judicial/clerk notes, optionally tied to a case. `content` holds the
-- TipTap JSON document as produced by `editor.getJSON()`; `content_text`
-- is the plain-text extraction the client sends alongside it (e.g. from
-- `editor.getText()`) so full-text search doesn't have to parse rich-text
-- JSON in SQL.

-- 1. Enum -----------------------------------------------------------------

create type public.note_status as enum ('draft', 'published');

-- 2. Table ------------------------------------------------------------------

create table public.bench_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.cases (id) on delete set null,
  author_id uuid not null references public.profiles (id) on delete restrict,
  title text not null,
  content jsonb not null default '{}'::jsonb,
  content_text text not null default '',
  status public.note_status not null default 'draft',
  is_private boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content_text, ''))
  ) stored
);

comment on table public.bench_notes is 'Magistrate/clerk notes, optionally tied to a case; content is TipTap JSON, content_text is its plain-text extraction used for search.';
comment on column public.bench_notes.author_id is 'ON DELETE RESTRICT preserves judicial notes; deactivate the profile (is_active = false) instead of deleting it.';
comment on column public.bench_notes.is_private is 'Private notes are visible only to their author (and admins); non-private notes are visible to anyone with access to the parent case/court.';

create index bench_notes_case_id_idx on public.bench_notes (case_id);
create index bench_notes_author_id_idx on public.bench_notes (author_id);
create index bench_notes_status_idx on public.bench_notes (status);
create index bench_notes_search_vector_idx on public.bench_notes using gin (search_vector);

create trigger set_bench_notes_updated_at
  before update on public.bench_notes
  for each row
  execute function public.set_updated_at();

-- 3. Access helper, reused by later migrations -------------------------------

create or replace function public.user_can_access_bench_note(p_note_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.bench_notes n
    left join public.cases c on c.id = n.case_id
    left join public.profiles author on author.id = n.author_id
    where n.id = p_note_id
      and (
        public.is_admin()
        or n.author_id = auth.uid()
        or (
          n.is_private = false
          and (
            (c.id is not null and c.court_id = public.my_court_id())
            or (c.id is null and author.court_id = public.my_court_id())
          )
        )
      )
  );
$$;

-- 4. Row Level Security -------------------------------------------------------

alter table public.bench_notes enable row level security;

create policy "Users can view accessible bench notes"
  on public.bench_notes for select
  using (public.user_can_access_bench_note(id));

create policy "Users can create their own bench notes"
  on public.bench_notes for insert
  with check (author_id = auth.uid());

create policy "Authors and admins can update bench notes"
  on public.bench_notes for update
  using (public.is_admin() or author_id = auth.uid())
  with check (public.is_admin() or author_id = auth.uid());

create policy "Authors and admins can delete bench notes"
  on public.bench_notes for delete
  using (public.is_admin() or author_id = auth.uid());
