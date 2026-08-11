-- BenchBook — cases & case parties
-- Core case tracking, scoped to a court. `user_can_access_case()` is the
-- shared authorization primitive reused by case_parties, documents,
-- comments, tags, and the search RPCs added in later migrations.

-- 1. Enums -------------------------------------------------------------

create type public.case_status as enum ('open', 'pending', 'closed', 'archived');

create type public.party_role as enum (
  'plaintiff', 'defendant', 'petitioner', 'respondent',
  'appellant', 'appellee', 'witness', 'other'
);

-- 2. Cases ---------------------------------------------------------------

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts (id) on delete restrict,
  case_number text not null,
  title text not null,
  case_type text,
  status public.case_status not null default 'open',
  description text,
  filed_date date,
  closed_date date,
  assigned_magistrate_id uuid references public.profiles (id) on delete set null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector('english',
      coalesce(case_number, '') || ' ' ||
      coalesce(title, '') || ' ' ||
      coalesce(case_type, '') || ' ' ||
      coalesce(description, '')
    )
  ) stored,
  constraint cases_dates_check check (
    closed_date is null or filed_date is null or closed_date >= filed_date
  )
);

comment on table public.cases is 'Court cases tracked within BenchBook, scoped to a court for RLS.';
comment on column public.cases.created_by is 'References the profile that filed the case record; ON DELETE RESTRICT preserves accountability for judicial records.';

create unique index cases_court_case_number_idx on public.cases (court_id, case_number);
create index cases_status_idx on public.cases (status);
create index cases_assigned_magistrate_idx on public.cases (assigned_magistrate_id);
create index cases_created_by_idx on public.cases (created_by);
create index cases_court_id_idx on public.cases (court_id);
create index cases_search_vector_idx on public.cases using gin (search_vector);

create trigger set_cases_updated_at
  before update on public.cases
  for each row
  execute function public.set_updated_at();

-- 3. Case parties -----------------------------------------------------------

create table public.case_parties (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  full_name text not null,
  role public.party_role not null default 'other',
  attorney_name text,
  contact_info text,
  created_at timestamptz not null default now()
);

comment on table public.case_parties is 'Parties (plaintiffs, defendants, counsel, witnesses, etc.) associated with a case.';

create index case_parties_case_id_idx on public.case_parties (case_id);
create index case_parties_role_idx on public.case_parties (role);

-- 4. Access helper, reused by later migrations -------------------------------

create or replace function public.user_can_access_case(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.cases c
    where c.id = p_case_id
      and (public.is_admin() or c.court_id = public.my_court_id())
  );
$$;

-- 5. Row Level Security -------------------------------------------------------

alter table public.cases enable row level security;
alter table public.case_parties enable row level security;

create policy "Users can view cases in their court"
  on public.cases for select
  using (public.is_admin() or court_id = public.my_court_id());

create policy "Users can create cases in their own court"
  on public.cases for insert
  with check (
    public.is_admin()
    or (court_id = public.my_court_id() and created_by = auth.uid())
  );

create policy "Users can update cases in their court"
  on public.cases for update
  using (public.is_admin() or court_id = public.my_court_id())
  with check (public.is_admin() or court_id = public.my_court_id());

create policy "Admins can delete cases"
  on public.cases for delete
  using (public.is_admin());

create policy "Users can view case parties for accessible cases"
  on public.case_parties for select
  using (public.user_can_access_case(case_id));

create policy "Users can add case parties to accessible cases"
  on public.case_parties for insert
  with check (public.user_can_access_case(case_id));

create policy "Users can update case parties on accessible cases"
  on public.case_parties for update
  using (public.user_can_access_case(case_id))
  with check (public.user_can_access_case(case_id));

create policy "Users can remove case parties from accessible cases"
  on public.case_parties for delete
  using (public.user_can_access_case(case_id));
