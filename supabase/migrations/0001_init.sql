-- Magistrate Wizard — initial schema
-- Creates the `profiles` table (1:1 with auth.users), the `user_role`
-- enum, row-level security policies, and the trigger that provisions a
-- profile automatically whenever a new auth user is created.

-- 1. Enum -------------------------------------------------------------

create type public.user_role as enum ('magistrate', 'clerk', 'admin');

-- 2. Table ------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  role public.user_role not null default 'magistrate',
  jurisdiction text,
  court_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per authenticated user; holds role and court metadata used for authorization throughout Magistrate Wizard.';

-- 3. updated_at trigger -------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- 4. Auto-provision a profile on signup ---------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- 5. Row Level Security ---------------------------------------------------

alter table public.profiles enable row level security;

-- Helper: is the current user an admin? Marked stable + security definer
-- so it can be reused inside policies without recursive RLS evaluation.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create policy "Profiles are viewable by their owner"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Admins can view all profiles"
  on public.profiles for select
  using (public.is_admin());

create policy "Profiles are editable by their owner"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id and role = (select role from public.profiles where id = auth.uid()));

create policy "Admins can update any profile"
  on public.profiles for update
  using (public.is_admin())
  with check (public.is_admin());

-- 6. Indexes ---------------------------------------------------------------

create index profiles_role_idx on public.profiles (role);
create index profiles_jurisdiction_idx on public.profiles (jurisdiction);
