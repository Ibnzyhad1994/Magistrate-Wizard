-- Magistrate Wizard — magistrate/court assignments
-- Represents which magistrates currently sit, or historically sat, at
-- which Magistrates' Courts. This is the mechanism that grants ordinary
-- operational access to a Court's Docket (see docket_matters, a later
-- migration) — a magistrate gains Docket access at a court because they
-- have a CURRENT assignment here, not because they created any specific
-- record.
--
-- Assignment state uses ended_at IS NULL as the single source of truth
-- for "current" — there is deliberately no separate is_active boolean,
-- eliminating the possibility of the two disagreeing.
--
-- History is never deleted. Ending an assignment is an UPDATE (ended_at
-- set), never a DELETE — there is no DELETE policy on this table at
-- all, matching the historical-preservation principle planned for
-- docket_matters.
--
-- Self-service: a magistrate manages their own assignment rows
-- (selecting/ending the courts they sit at). Admins additionally retain
-- full management, since court-assignment roster data is
-- administrative/system information, not private judicial content —
-- this is the one Docket-adjacent table where the admin carve-out
-- applies, per the architecture specification's ownership table.

-- 1. Table -----------------------------------------------------------------

create table public.magistrate_courts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  court_id uuid not null references public.courts (id) on delete restrict,
  assignment_type text not null default 'regular'
    check (assignment_type in ('regular', 'acting', 'relief', 'other')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint magistrate_courts_ended_after_started
    check (ended_at is null or ended_at >= started_at)
);

comment on table public.magistrate_courts is 'Which magistrates currently sit, or historically sat, at which courts. ended_at IS NULL means the assignment is current; this is the mechanism that grants ordinary operational Docket access (see docket_matters, a later migration). Rows are never deleted — only ended.';
comment on column public.magistrate_courts.assignment_type is 'Descriptive only (regular/acting/relief/other) — does NOT alter Docket permissions. Any current assignment, regardless of type, grants identical operational access.';
comment on column public.magistrate_courts.ended_at is 'NULL = current assignment. The sole source of truth for assignment state; there is no separate is_active column.';
comment on column public.magistrate_courts.court_id is 'ON DELETE RESTRICT: a court with any assignment history, current or ended, cannot be deleted.';

-- 2. updated_at trigger ------------------------------------------------------
-- Reuses the existing public.set_updated_at() from migration 0001.

create trigger set_magistrate_courts_updated_at
  before update on public.magistrate_courts
  for each row
  execute function public.set_updated_at();

-- 3. Indexes / constraints ----------------------------------------------------
-- At most one CURRENT assignment per magistrate/court pair; unlimited
-- historical (ended) rows for the same pair over time (e.g. left and
-- later rejoined the same court).

create unique index magistrate_courts_current_pair_idx
  on public.magistrate_courts (profile_id, court_id)
  where ended_at is null;

create index magistrate_courts_profile_id_idx on public.magistrate_courts (profile_id);
create index magistrate_courts_court_id_idx on public.magistrate_courts (court_id);
create index magistrate_courts_current_idx on public.magistrate_courts (court_id) where ended_at is null;

-- 4. Court-active enforcement for new/current assignments ---------------------
-- Product rule: inactive courts should not normally accept new or
-- reactivated current assignments. Enforced here at the database level
-- as the actual safety net, alongside UI-level filtering of the court
-- picker. Only fires when a row is being left or set as current
-- (ended_at IS NULL) — never blocks recording historical (already-ended)
-- assignments. Applies universally, including to admins — this rule has
-- no admin exception, unlike the self-service protections below.

create or replace function public.check_court_active_for_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_is_active boolean;
begin
  if new.ended_at is null then
    select is_active into v_is_active from public.courts where id = new.court_id;
    if not coalesce(v_is_active, false) then
      raise exception 'Cannot create or maintain a current magistrate_courts assignment to an inactive court (court_id = %)', new.court_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger check_court_active_before_assignment
  before insert or update of court_id, ended_at on public.magistrate_courts
  for each row
  execute function public.check_court_active_for_assignment();

-- 5. Assignment-history integrity for ordinary self-service --------------------
-- Admins retain full correction capability (roster-data fixes). For
-- everyone else, RLS already restricts *which* rows can be targeted
-- (their own); this trigger restricts *what* an UPDATE on an owned row
-- may actually do: historical (already-ended) rows may not be touched
-- at all, and the only field a non-admin may change on a current row is
-- ended_at, moving it from NULL to a real timestamp (ending the
-- assignment). Reactivating an ended row, or changing profile_id,
-- court_id, started_at, or assignment_type, is never permitted via
-- self-service — a magistrate returning to a court later gets a NEW row
-- instead, preserving true history.

create or replace function public.protect_magistrate_court_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select public.is_admin()) then
    return new;
  end if;

  if old.ended_at is not null then
    raise exception 'Cannot modify a historical (already-ended) court assignment';
  end if;

  if new.profile_id is distinct from old.profile_id
     or new.court_id is distinct from old.court_id
     or new.started_at is distinct from old.started_at
     or new.assignment_type is distinct from old.assignment_type then
    raise exception 'Ordinary self-service may only set ended_at to end a current assignment; no other field may change';
  end if;

  if new.ended_at is null then
    raise exception 'Reactivating an ended assignment is not permitted via self-service; create a new assignment instead';
  end if;

  return new;
end;
$$;

create trigger protect_magistrate_court_history_trigger
  before update on public.magistrate_courts
  for each row
  execute function public.protect_magistrate_court_history();

-- 6. Row Level Security ---------------------------------------------------------
-- Self-service (a magistrate manages their own rows, restricted in
-- substance by the trigger above) plus admin roster management. No
-- DELETE policy at all — assignment history is never deleted, only
-- ended via UPDATE.

alter table public.magistrate_courts enable row level security;

create policy "Magistrates can view their own court assignments"
  on public.magistrate_courts for select
  using (profile_id = (select auth.uid()) or (select public.is_admin()));

create policy "Magistrates can create their own court assignments"
  on public.magistrate_courts for insert
  with check (profile_id = (select auth.uid()) or (select public.is_admin()));

create policy "Magistrates can end their own court assignments"
  on public.magistrate_courts for update
  using (profile_id = (select auth.uid()) or (select public.is_admin()))
  with check (profile_id = (select auth.uid()) or (select public.is_admin()));
