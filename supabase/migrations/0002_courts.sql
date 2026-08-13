-- Magistrate Wizard — courts & jurisdiction scoping
-- Adds the `courts` table and links `profiles` to a court. `my_court_id()`
-- is the scoping primitive most later RLS policies use to keep
-- magistrates/clerks confined to their own court's data.

-- 1. Table -----------------------------------------------------------------

create table public.courts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  jurisdiction text not null,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.courts is 'Courts/jurisdictions. Cases and profiles are scoped to a court for RLS purposes.';

create unique index courts_name_jurisdiction_idx on public.courts (name, jurisdiction);

create trigger set_courts_updated_at
  before update on public.courts
  for each row
  execute function public.set_updated_at();

-- 2. Link profiles to a court -----------------------------------------------

alter table public.profiles
  add column court_id uuid references public.courts (id) on delete set null;

create index profiles_court_id_idx on public.profiles (court_id);

-- 3. Scoping helper, reused by nearly every later RLS policy ----------------

create or replace function public.my_court_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select court_id from public.profiles where id = auth.uid();
$$;

-- 4. Allow signup metadata to set an initial court --------------------------
-- Re-declares handle_new_user() (originally created in 0001_init.sql) now
-- that public.courts exists, so a `court_id` passed in auth signup options
-- (options.data.court_id) provisions the profile with a court already set.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, court_id)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    nullif(new.raw_user_meta_data ->> 'court_id', '')::uuid
  );
  return new;
end;
$$;

-- 5. Row Level Security ------------------------------------------------------

alter table public.courts enable row level security;

create policy "Courts are viewable by all authenticated users"
  on public.courts for select
  to authenticated
  using (true);

create policy "Admins can manage courts"
  on public.courts for all
  using (public.is_admin())
  with check (public.is_admin());
