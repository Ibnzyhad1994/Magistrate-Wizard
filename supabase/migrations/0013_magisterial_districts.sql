-- Magistrate Wizard — magisterial districts
-- The top level of Guyana's court structure: a Magisterial District
-- contains one or more Magistrates' Courts. courts.district_id (linking
-- each court to exactly one district) is added in the next migration,
-- 0014_courts_district_link.sql — this migration only introduces the
-- district entity itself.
--
-- This table intentionally supersedes the free-text courts.jurisdiction
-- column from migration 0002 going forward. That column is left in
-- place, untouched, and simply unused by new functionality — the same
-- deprecate-rather-than-drop pattern already used elsewhere in this
-- project (cases, case_parties, profiles.court_id/jurisdiction/court_name).
--
-- Classification: administrative/reference data, not private judicial
-- content. Every authenticated magistrate needs to browse the full list
-- of districts (and, from the next migration onward, courts within them)
-- in order to select their own court assignments during profile setup —
-- so this is read-open, write-admin-only, matching the existing pattern
-- already used for `courts`, `statutes`, and shared `tags`.

-- 1. Table -----------------------------------------------------------------

create table public.magisterial_districts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.magisterial_districts is 'The Magisterial Districts of Guyana (e.g. "East Demerara"). Each Magistrates'' Court belongs to exactly one district via courts.district_id, added in migration 0014. Administrative/reference data — not private judicial content.';

-- 2. updated_at trigger ------------------------------------------------------
-- Reuses the existing public.set_updated_at() from migration 0001.

create trigger set_magisterial_districts_updated_at
  before update on public.magisterial_districts
  for each row
  execute function public.set_updated_at();

-- 3. Indexes / constraints ----------------------------------------------------
-- Case-insensitive uniqueness on name, same pattern as tags_name_idx in
-- migration 0006 — prevents "East Demerara" and "east demerara" existing
-- as two separate districts by accident.

create unique index magisterial_districts_name_idx on public.magisterial_districts (lower(name));

-- 4. Row Level Security ---------------------------------------------------------
-- Read-open to every authenticated user (magistrates must be able to
-- browse the full list when setting up court assignments), write
-- restricted to admins. Written directly in the post-0012 hardened
-- shape (auth.uid()/is_admin() wrapped in (select ...), FOR ALL split
-- into targeted insert/update/delete) rather than needing a later
-- performance/consolidation pass.

alter table public.magisterial_districts enable row level security;

create policy "Magisterial districts are viewable by all authenticated users"
  on public.magisterial_districts for select
  to authenticated
  using (true);

create policy "Admins can insert magisterial districts"
  on public.magisterial_districts for insert
  with check ((select public.is_admin()));

create policy "Admins can update magisterial districts"
  on public.magisterial_districts for update
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins can delete magisterial districts"
  on public.magisterial_districts for delete
  using ((select public.is_admin()));
