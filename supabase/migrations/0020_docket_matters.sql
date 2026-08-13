-- Magistrate Wizard — Docket Matters (court-anchored foundation)
-- The operational Docket itself. Court-anchored, per the approved
-- architecture (Addendum 3 / FINAL spec Revision 3, §4/§14): ordinary
-- access derives from a CURRENT magistrate_courts assignment to the
-- matter's court, not from who created the row. There is deliberately
-- NO owner_id column and NO is_discoverable column — the Docket can
-- never be individually owned or discoverable, by construction.
--
-- SCOPE OF THIS MIGRATION (foundation): this migration implements the
-- columns and mechanisms approved for this step — court_id,
-- database-derived district_id, case_number, matter_title,
-- charge_or_issue, orders_summary, outcome, status, created_by,
-- last_updated_by, timestamps, the district-derivation/guard trigger,
-- the courts district-change-immutability trigger deferred since 0016,
-- and RLS. Two fields from the fuller §4 sketch remain deliberately
-- deferred: matter_type (its enum/categories were never concretely
-- defined — written only as "enum(...)" — and inventing values for it
-- now would violate this project's standing rule against inventing
-- domain content that hasn't been explicitly supplied/approved) and
-- search_vector (the search architecture itself is not yet designed —
-- see spec §11). Both are left for a follow-up migration once their
-- concrete design is specified, not silently added here.
--
-- matter_title (new field, an explicit architecture refinement approved
-- this turn, not something the original §4 sketch contemplated):
-- case_number remains the official registry/case identifier;
-- matter_title is the concise human-readable case style/title displayed
-- in the Docket UI (e.g. party names). It is entered directly, NOT
-- derived or synchronized from docket_matter_parties — that table
-- (structured parties/procedural roles) doesn't exist yet, and when it
-- does, this migration establishes no automatic link between the two.
--
-- INCREMENTAL RLS (per your explicit instruction this turn): the
-- approved end-state Docket SELECT/UPDATE predicate has three OR'd
-- access paths — current Court assignment, current retained/part-heard
-- assignment, and explicit shares. Only the first is implemented here,
-- because the other two depend on docket_matter_assignments and shares,
-- neither of which exists yet. No placeholder tables or functions are
-- created to fake completeness. The migration that creates
-- docket_matter_assignments will extend this table's SELECT/UPDATE
-- policies to add `or has_retained_assignment(id)`; the migration that
-- creates shares will extend them again to add the shares clause.

-- 1. Status enum ---------------------------------------------------------
-- Deliberately a NEW, distinct type — NOT a reuse of the existing
-- `case_status` enum (open/pending/closed/archived), which belongs to
-- the legacy, untouched `cases` table and has different values and
-- different semantics.

create type public.docket_matter_status as enum ('active', 'stayed', 'completed', 'archived');

comment on type public.docket_matter_status is 'Docket Matter lifecycle status. Distinct from the legacy cases.case_status enum — different table, different values, no relationship.';

-- 2. docket_matters table -------------------------------------------------

create table public.docket_matters (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts (id) on delete restrict,
  district_id uuid not null references public.magisterial_districts (id) on delete restrict,
    -- always database-derived from court_id → courts.district_id by the
    -- trigger below — never trusted from the client, unconditionally
    -- overwritten on every insert and on every update, regardless of
    -- what value (if any) the client supplied
  case_number text not null,
    -- Guyana case number. NOT globally unique — see the table-level
    -- constraint below, deliberately scoped to the Magisterial
    -- District's registry sequence
  matter_title text not null,
    -- Concise human-readable case style/title (e.g. party names),
    -- distinct from case_number (the official registry identifier) and
    -- from the future structured docket_matter_parties table. Entered
    -- directly; not derived or synchronized from anything
  charge_or_issue text,
    -- Nullable — this information may not exist at initial Docket
    -- creation. Free text, no enum/vocabulary imposed
  orders_summary text,
    -- Nullable, same rationale as charge_or_issue
  outcome text,
    -- Nullable, same rationale as charge_or_issue
  status public.docket_matter_status not null default 'active',
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
    -- provenance only — never determines access. Column default is a
    -- convenience; the trigger below unconditionally forces this to the
    -- authenticated user on INSERT regardless of client input, and
    -- unconditionally preserves the original value on every UPDATE
  last_updated_by uuid references public.profiles (id) on delete set null,
    -- provenance only — never determines access. NULL until the first
    -- UPDATE; trigger-populated on every UPDATE, never client-writable
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint docket_matters_district_case_number_unique unique (district_id, case_number)
    -- scoped to the district's registry sequence — there is
    -- deliberately NO standalone/global UNIQUE on case_number by itself
);

comment on table public.docket_matters is 'The operational Docket. Court-anchored: ordinary access derives from a current magistrate_courts assignment to court_id, not from created_by. No owner_id, no is_discoverable, no DELETE policy — archive via status only. See can_access_court() and the RLS policies below for the (currently single-path) access predicate.';
comment on column public.docket_matters.district_id is 'Always derived from court_id → courts.district_id by trigger. Never client-writable in practice, regardless of what is sent.';
comment on column public.docket_matters.case_number is 'NOT globally unique. Scoped uniqueness is enforced by docket_matters_district_case_number_unique, matching the Magisterial District''s own registry sequence.';
comment on column public.docket_matters.matter_title is 'Concise human-readable case style/title (e.g. party names), distinct from case_number (official registry identifier) and from the future structured docket_matter_parties table. Entered directly, not derived or synchronized.';
comment on column public.docket_matters.charge_or_issue is 'Nullable free text — may not exist at initial Docket creation. No enum/vocabulary imposed.';
comment on column public.docket_matters.orders_summary is 'Nullable free text — may not exist at initial Docket creation.';
comment on column public.docket_matters.outcome is 'Nullable free text — may not exist at initial Docket creation.';
comment on column public.docket_matters.created_by is 'Provenance only. Never used for access control — see can_access_court(). Immutable after creation (enforced by trigger, not just RLS).';
comment on column public.docket_matters.last_updated_by is 'Provenance only. Never used for access control. Trigger-populated on every UPDATE; NULL until the first update.';

-- 3. updated_at trigger -----------------------------------------------------
-- Reuses the existing public.set_updated_at() from migration 0001.

create trigger set_docket_matters_updated_at
  before update on public.docket_matters
  for each row
  execute function public.set_updated_at();

-- 4. District derivation + provenance protection ----------------------------
-- One combined trigger, firing on every INSERT and every UPDATE
-- (unconditionally, no column scoping), so there is no possible bypass
-- via updating district_id/created_by without also touching court_id.
--
-- District/active-court guard fires whenever a row is inserted, or an
-- existing row's court_id is being changed (reassigned to a different
-- court) — both cases are treated as "assigning this matter to a
-- court" and therefore subject to the same is_active check. An
-- ordinary UPDATE that leaves court_id unchanged never re-checks
-- is_active, so a court going inactive after a matter is created never
-- removes access to or blocks edits on that existing matter, per your
-- explicit requirement. If a design revision later decides Docket
-- Matters should never be reassignable to a different court at all,
-- this is the trigger to revisit.

create or replace function public.docket_matters_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_district_id uuid;
  v_is_active boolean;
begin
  -- District derivation + active-court check: only re-resolved when
  -- creating a row or reassigning its court. Otherwise district_id is
  -- force-preserved from the existing row, closing off any attempt to
  -- set it directly via UPDATE without touching court_id.
  if tg_op = 'INSERT' or new.court_id is distinct from old.court_id then
    select c.district_id, c.is_active into v_district_id, v_is_active
    from public.courts c
    where c.id = new.court_id;

    if v_district_id is null then
      raise exception 'Cannot create or reassign a Docket Matter to court % — that court has no Magisterial District assigned', new.court_id;
    end if;

    if not coalesce(v_is_active, false) then
      raise exception 'Cannot create or reassign a Docket Matter to inactive court % — is_active must be true to accept new Docket entry', new.court_id;
    end if;

    new.district_id := v_district_id;
  else
    new.district_id := old.district_id;
  end if;

  -- Provenance: created_by is set once, at creation, from the
  -- authenticated user, and can never change afterward — not even to
  -- another value the client might attempt to write.
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  else
    new.created_by := old.created_by;
  end if;

  -- Provenance: last_updated_by is set only on UPDATE, always to the
  -- authenticated user, never client-writable.
  if tg_op = 'UPDATE' then
    new.last_updated_by := (select auth.uid());
  end if;

  return new;
end;
$$;

comment on function public.docket_matters_guard() is 'Unconditionally derives district_id from court_id (rejecting courts with no district or, on insert/reassignment only, inactive courts), and unconditionally protects created_by/last_updated_by provenance — none of these three fields are ever trusted from client input.';

create trigger docket_matters_guard_trigger
  before insert or update on public.docket_matters
  for each row
  execute function public.docket_matters_guard();

-- 5. Court district-change immutability (deferred from 0016) ----------------
-- Once a court is referenced by any Docket Matter, its district_id may
-- not be changed — the "restrict once referenced" approach approved
-- when this was originally deferred. Scoped to UPDATE OF district_id
-- only: courts.district_id is admin-only writable via existing RLS, so
-- there is no equivalent client-manipulation surface here to guard
-- against beyond an admin genuinely trying to reassign a referenced
-- court's district, which this trigger correctly blocks regardless of
-- who attempts it (no is_admin() exception — historical Docket
-- district correctness always wins).

create or replace function public.protect_court_district_once_referenced()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.district_id is distinct from old.district_id
     and exists (select 1 from public.docket_matters dm where dm.court_id = old.id) then
    raise exception 'Cannot change district_id for court % — it is already referenced by one or more Docket Matters', old.id;
  end if;
  return new;
end;
$$;

comment on function public.protect_court_district_once_referenced() is 'Blocks changing a court''s district_id once any Docket Matter references that court, preventing silent historical district drift. No admin exception. Deferred from migration 0016 until docket_matters existed.';

create trigger protect_court_district_once_referenced_trigger
  before update of district_id on public.courts
  for each row
  execute function public.protect_court_district_once_referenced();

-- 6. can_access_court() ------------------------------------------------------
-- The single Docket access path implemented at this stage: true if the
-- authenticated user has a CURRENT (ended_at IS NULL) magistrate_courts
-- assignment to the given court. Deliberately does NOT check
-- courts.is_active — that flag governs new-assignment/new-entry
-- availability only, never a historical-access gate (per §14/§9 of the
-- architecture). SECURITY INVOKER: the caller's own RLS on
-- magistrate_courts already permits them to read their own assignment
-- rows, so no privilege elevation is needed here.

create or replace function public.can_access_court(p_court_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.magistrate_courts mc
    where mc.court_id = p_court_id
      and mc.profile_id = auth.uid()
      and mc.ended_at is null
  );
$$;

comment on function public.can_access_court(uuid) is 'True if the authenticated user has a current (ended_at IS NULL) magistrate_courts assignment to the given court. Does not check courts.is_active — new-entry availability only, never a historical-access gate. This is currently the ONLY implemented Docket access path; has_retained_assignment() and the shares-based path are added by later migrations per the approved incremental RLS plan.';

-- 7. Indexes ------------------------------------------------------------------

create index docket_matters_court_id_idx on public.docket_matters (court_id);
create index docket_matters_status_idx on public.docket_matters (status);
create index docket_matters_created_by_idx on public.docket_matters (created_by);
-- docket_matters_district_case_number_unique (from the table constraint
-- above) already serves district_id-leading lookups; no separate
-- single-column district_id index is added.

-- 8. Row Level Security --------------------------------------------------------
-- Single-path predicate at this stage: current Court assignment only.
-- No is_admin() clause anywhere — admin has zero special access to
-- Docket content, per the architecture's explicit no-bypass rule. No
-- DELETE policy at all — hard delete is impossible; status = 'archived'
-- is the only removal mechanism.

alter table public.docket_matters enable row level security;

create policy "Magistrates can view Docket Matters at their current courts"
  on public.docket_matters for select
  using ((select public.can_access_court(court_id)));

create policy "Magistrates can create Docket Matters at their current courts"
  on public.docket_matters for insert
  with check ((select public.can_access_court(court_id)) and created_by = (select auth.uid()));

create policy "Magistrates can update Docket Matters at their current courts"
  on public.docket_matters for update
  using ((select public.can_access_court(court_id)))
  with check ((select public.can_access_court(court_id)));
