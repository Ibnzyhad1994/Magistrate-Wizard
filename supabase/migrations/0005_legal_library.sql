-- BenchBook — legal reference library
-- `statutes` and `case_law` are canonical, curated reference data shared
-- across every court: readable by any authenticated user, writable only
-- by admins (the platform's librarian role for this project's role set).

-- 1. Statutes ----------------------------------------------------------

create table public.statutes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  title text not null,
  jurisdiction text not null,
  summary text,
  full_text text,
  source_url text,
  effective_date date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector('english',
      coalesce(code, '') || ' ' ||
      coalesce(title, '') || ' ' ||
      coalesce(jurisdiction, '') || ' ' ||
      coalesce(summary, '') || ' ' ||
      coalesce(full_text, '')
    )
  ) stored
);

comment on table public.statutes is 'Canonical statute/law reference library shared across all courts.';

create unique index statutes_code_jurisdiction_idx on public.statutes (code, jurisdiction);
create index statutes_jurisdiction_idx on public.statutes (jurisdiction);
create index statutes_search_vector_idx on public.statutes using gin (search_vector);

create trigger set_statutes_updated_at
  before update on public.statutes
  for each row
  execute function public.set_updated_at();

-- 2. Case law / precedents ---------------------------------------------

create table public.case_law (
  id uuid primary key default gen_random_uuid(),
  case_name text not null,
  citation text not null,
  court text not null,
  jurisdiction text not null,
  decided_date date,
  summary text,
  full_text text,
  source_url text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector('english',
      coalesce(case_name, '') || ' ' ||
      coalesce(citation, '') || ' ' ||
      coalesce(court, '') || ' ' ||
      coalesce(jurisdiction, '') || ' ' ||
      coalesce(summary, '') || ' ' ||
      coalesce(full_text, '')
    )
  ) stored
);

comment on table public.case_law is 'Precedent / case law reference library shared across all courts.';

create unique index case_law_citation_idx on public.case_law (citation);
create index case_law_jurisdiction_idx on public.case_law (jurisdiction);
create index case_law_search_vector_idx on public.case_law using gin (search_vector);

create trigger set_case_law_updated_at
  before update on public.case_law
  for each row
  execute function public.set_updated_at();

-- 3. Row Level Security ---------------------------------------------------

alter table public.statutes enable row level security;
alter table public.case_law enable row level security;

create policy "Statutes are viewable by all authenticated users"
  on public.statutes for select
  to authenticated
  using (true);

create policy "Admins can manage statutes"
  on public.statutes for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "Case law is viewable by all authenticated users"
  on public.case_law for select
  to authenticated
  using (true);

create policy "Admins can manage case law"
  on public.case_law for all
  using (public.is_admin())
  with check (public.is_admin());
