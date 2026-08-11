-- BenchBook — tags
-- A single shared `tags` vocabulary with per-entity join tables (rather
-- than a polymorphic tags-to-anything table) so each association keeps a
-- real foreign key and can carry its own RLS policy.

-- 1. Tags -----------------------------------------------------------------

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#64748b',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.tags is 'User-defined labels applied to cases, bench notes, statutes, and case law.';

create unique index tags_name_idx on public.tags (lower(name));

alter table public.tags enable row level security;

create policy "Tags are viewable by all authenticated users"
  on public.tags for select
  to authenticated
  using (true);

create policy "Authenticated users can create tags"
  on public.tags for insert
  with check (created_by = auth.uid());

create policy "Creators and admins can update tags"
  on public.tags for update
  using (public.is_admin() or created_by = auth.uid())
  with check (public.is_admin() or created_by = auth.uid());

create policy "Creators and admins can delete tags"
  on public.tags for delete
  using (public.is_admin() or created_by = auth.uid());

-- 2. Join tables --------------------------------------------------------

create table public.case_tags (
  case_id uuid not null references public.cases (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (case_id, tag_id)
);
create index case_tags_tag_id_idx on public.case_tags (tag_id);

create table public.bench_note_tags (
  bench_note_id uuid not null references public.bench_notes (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (bench_note_id, tag_id)
);
create index bench_note_tags_tag_id_idx on public.bench_note_tags (tag_id);

create table public.statute_tags (
  statute_id uuid not null references public.statutes (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (statute_id, tag_id)
);
create index statute_tags_tag_id_idx on public.statute_tags (tag_id);

create table public.case_law_tags (
  case_law_id uuid not null references public.case_law (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (case_law_id, tag_id)
);
create index case_law_tags_tag_id_idx on public.case_law_tags (tag_id);

-- 3. Row Level Security ---------------------------------------------------

alter table public.case_tags enable row level security;
alter table public.bench_note_tags enable row level security;
alter table public.statute_tags enable row level security;
alter table public.case_law_tags enable row level security;

create policy "Users can view case tags for accessible cases"
  on public.case_tags for select
  using (public.user_can_access_case(case_id));

create policy "Users can tag accessible cases"
  on public.case_tags for insert
  with check (public.user_can_access_case(case_id));

create policy "Users can untag accessible cases"
  on public.case_tags for delete
  using (public.user_can_access_case(case_id));

create policy "Users can view bench note tags for accessible notes"
  on public.bench_note_tags for select
  using (public.user_can_access_bench_note(bench_note_id));

create policy "Users can tag accessible bench notes"
  on public.bench_note_tags for insert
  with check (public.user_can_access_bench_note(bench_note_id));

create policy "Users can untag accessible bench notes"
  on public.bench_note_tags for delete
  using (public.user_can_access_bench_note(bench_note_id));

create policy "Statute tags are viewable by all authenticated users"
  on public.statute_tags for select
  to authenticated
  using (true);

create policy "Admins can tag statutes"
  on public.statute_tags for insert
  with check (public.is_admin());

create policy "Admins can untag statutes"
  on public.statute_tags for delete
  using (public.is_admin());

create policy "Case law tags are viewable by all authenticated users"
  on public.case_law_tags for select
  to authenticated
  using (true);

create policy "Admins can tag case law"
  on public.case_law_tags for insert
  with check (public.is_admin());

create policy "Admins can untag case law"
  on public.case_law_tags for delete
  using (public.is_admin());
