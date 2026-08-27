-- ============================================================================
-- 0087_clerk_courts.sql
--
-- The clerk-to-court assignment table -- the actual mechanism that grants
-- an approved clerk operational Docket access at a specific court. Mirrors
-- magistrate_courts (0017) deliberately closely: ended_at IS NULL is the
-- sole "current" signal (no separate is_active boolean), history is never
-- deleted (UPDATE-only, no DELETE policy), and only one current row per
-- (clerk, court) pair is permitted.
--
-- Ordinary rows are created ONLY by decide_clerk_access_request() (0089),
-- a SECURITY DEFINER RPC -- there is deliberately no INSERT policy
-- permitting self-service or magistrate-direct inserts here, so approval
-- is the only ordinary path to a clerk gaining Court access. Admins retain
-- a narrow direct-management capability for the exceptional/orphaned
-- cases described in the feature's "Administrator fallback" section.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table
-- ----------------------------------------------------------------------------

create table public.clerk_courts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  court_id uuid not null references public.courts (id) on delete restrict,
  approved_by uuid not null references public.profiles (id) on delete restrict,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references public.profiles (id) on delete set null,
  end_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clerk_courts_ended_after_started
    check (ended_at is null or ended_at >= started_at),
  constraint clerk_courts_end_fields_consistent
    check (ended_at is not null or (ended_by is null and end_reason is null))
);

comment on table public.clerk_courts is
  'Which clerks currently have, or historically had, approved operational Docket access at which courts. ended_at IS NULL means the assignment is current -- the sole source of truth, mirroring magistrate_courts (0017). Rows are created only by decide_clerk_access_request() (0089) on approval, or directly by an admin for exceptional correction. Never deleted -- only ended.';
comment on column public.clerk_courts.approved_by is 'The magistrate (or admin, in an exceptional/fallback case) who approved this specific court access.';
comment on column public.clerk_courts.ended_at is 'NULL = current assignment. Revoking access is an UPDATE (ended_at set), never a DELETE.';
comment on column public.clerk_courts.ended_by is 'Who revoked/ended this assignment. NULL while the assignment is current.';
comment on column public.clerk_courts.end_reason is 'Optional free-text reason for revocation. NULL while the assignment is current.';

create trigger set_clerk_courts_updated_at
  before update on public.clerk_courts
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Indexes -- one current assignment per (clerk, court); unlimited history
-- ----------------------------------------------------------------------------

create unique index clerk_courts_current_pair_idx
  on public.clerk_courts (profile_id, court_id)
  where ended_at is null;

create index clerk_courts_profile_id_idx on public.clerk_courts (profile_id);
create index clerk_courts_court_id_idx on public.clerk_courts (court_id);
create index clerk_courts_current_idx on public.clerk_courts (court_id) where ended_at is null;

-- ----------------------------------------------------------------------------
-- 3. History-integrity trigger -- mirrors protect_magistrate_court_history()
--    (0017). Admins bypass entirely (exceptional correction capability);
--    everyone else may only end a current row (set ended_at/ended_by/
--    end_reason), never reactivate one or alter profile_id/court_id/
--    approved_by/started_at.
-- ----------------------------------------------------------------------------

create or replace function public.protect_clerk_court_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Provenance: whenever a row transitions from current to ended, force
  -- ended_by to the authenticated caller regardless of what the client
  -- sent -- never trusted from client input, mirroring how
  -- docket_matters_guard() (0020) forces created_by/last_updated_by.
  -- Applies to admins too (an admin's correction is still their own act).
  if old.ended_at is null and new.ended_at is not null then
    new.ended_by := (select auth.uid());
  end if;

  if (select public.is_admin()) then
    return new;
  end if;

  if old.ended_at is not null then
    raise exception 'Cannot modify a historical (already-ended) clerk court assignment';
  end if;

  if new.profile_id is distinct from old.profile_id
     or new.court_id is distinct from old.court_id
     or new.approved_by is distinct from old.approved_by
     or new.started_at is distinct from old.started_at then
    raise exception 'A clerk court assignment may only be ended (ended_at/ended_by/end_reason); no other field may change outside admin correction';
  end if;

  if new.ended_at is null then
    raise exception 'Reactivating an ended clerk court assignment is not permitted; approve a new access request instead';
  end if;

  return new;
end;
$$;

create trigger protect_clerk_court_history_trigger
  before update on public.clerk_courts
  for each row
  execute function public.protect_clerk_court_history();

-- ----------------------------------------------------------------------------
-- 4. has_active_clerk_assignment(court_id) -- the clerk Docket-access path
--
-- SECURITY INVOKER (like can_access_court(), 0020): only ever checks the
-- CALLER's own rows (profile_id = auth.uid()), which the SELECT policy
-- below already permits them to read -- no privilege elevation needed,
-- unlike can_manage_clerk_access() (0086), which must see OTHER
-- magistrates' rows and is therefore SECURITY DEFINER for that reason.
-- ----------------------------------------------------------------------------

create or replace function public.has_active_clerk_assignment(p_court_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.clerk_courts cc
    where cc.court_id = p_court_id
      and cc.profile_id = auth.uid()
      and cc.ended_at is null
  );
$$;

comment on function public.has_active_clerk_assignment(uuid) is
  'True if the authenticated user has a CURRENT (ended_at IS NULL) clerk_courts assignment to the given court -- the clerk analogue of can_access_court() (0020). This is the ONLY Docket access path a clerk role can ever satisfy; case_law/judgment/statute policies never call this function.';

grant execute on function public.has_active_clerk_assignment(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Row Level Security
--
-- SELECT: the clerk sees their own rows; the magistrate authorized to
-- manage clerk access at a court sees that court's roster; admin sees
-- everything (fallback/correction visibility).
--
-- INSERT: admin-only via RLS. Ordinary approval-driven creation happens
-- inside decide_clerk_access_request() (0089), a SECURITY DEFINER
-- function that inserts as the function owner and is therefore not
-- subject to this INSERT policy at all -- exactly the same mechanism
-- handle_new_user() (0001) already relies on to insert into profiles
-- despite profiles having no open self-service INSERT policy.
--
-- UPDATE (ending/revoking): the authorized magistrate for that court, or
-- admin. No DELETE policy -- history is never deleted.
-- ----------------------------------------------------------------------------

alter table public.clerk_courts enable row level security;

create policy "Clerks can view their own court assignments"
  on public.clerk_courts for select
  using (
    profile_id = (select auth.uid())
    or (select public.can_manage_clerk_access(court_id))
    or (select public.is_admin())
  );

create policy "Admins can create clerk court assignments"
  on public.clerk_courts for insert
  with check ((select public.is_admin()));

create policy "Authorized magistrates and admins can end clerk court assignmen"
  on public.clerk_courts for update
  using ((select public.can_manage_clerk_access(court_id)) or (select public.is_admin()))
  with check ((select public.can_manage_clerk_access(court_id)) or (select public.is_admin()));

-- ----------------------------------------------------------------------------
-- 6. Audit trigger -- reuses the existing generic, immutable audit_log
--    writer (0009/0048). Fully unredacted -- an institutional roster
--    record, not private judicial work product, matching magistrate_courts'
--    own audit_magistrate_courts trigger (0048).
-- ----------------------------------------------------------------------------

create trigger audit_clerk_courts
  after insert or update or delete on public.clerk_courts
  for each row
  execute function public.audit_trigger_fn();
