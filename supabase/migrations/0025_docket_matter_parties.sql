-- BenchBook — Docket Matter Parties (structured party/participant identity)
-- One docket_matter_parties row represents a party/participant identity
-- associated with one Docket Matter — structured identification of the
-- persons or entities involved in the proceeding. This does NOT replace
-- docket_matters.matter_title, which remains manually entered and is
-- NOT automatically generated, derived, or synchronized from this table
-- in either direction.
--
-- NO court_id/district_id duplication — obtained exclusively through the
-- parent docket_matters row, same principle as docket_events (0024).
--
-- PARTY IDENTITY: full_name is a plain display/legal name as recorded
-- for this proceeding. No separate persons/contact/entity registry is
-- built here, and no identity matching across different Docket Matters
-- is attempted — two rows with the same full_name on different matters
-- (or even the same matter) are not assumed to be the same real-world
-- person/entity by the database.
--
-- PARTY TYPE vs. PROCEDURAL ROLE — two independent classifications:
--   party_type describes WHAT the party/entity is (individual,
--   organization, government_body, estate, other).
--   role describes their PROCEDURAL position in the proceeding (accused,
--   complainant, applicant, respondent, plaintiff, defendant,
--   petitioner, appellant, appellee, landlord, tenant, child, other).
-- Both are constrained free text (not Postgres enums), matching the
-- established docket_matter_assignments.reason/docket_events.event_status
-- pattern, so future legitimate values can be added without a type
-- change. Deliberately NOT reusing or modifying the legacy party_role
-- enum (case_parties.role) — this is a separate, independent vocabulary
-- for the Court-Anchored Docket model. witness is deliberately NOT
-- included in the role vocabulary: a witness is not ordinarily a party
-- to the proceeding and would be modeled separately if/when BenchBook
-- gains structured witness functionality. No prosecution/police/counsel
-- roles are added here either, merely to fill perceived gaps —
-- representation/prosecution can be designed separately later, not
-- invented now to be thorough.
--
-- MULTIPLE ROLES AND DUPLICATES: no uniqueness is imposed on
-- (docket_matter_id, full_name) or (docket_matter_id, full_name, role).
-- Names are not reliable unique identifiers, and the same real person or
-- entity may legitimately need more than one party record where they
-- hold more than one procedural role on the same matter. Accidental
-- duplicate entries are a data-correction/history concern
-- (party_status = entered_in_error), not a database constraint.
--
-- PARTY-ROW STATUS/HISTORY: party_status is constrained text
-- (active/entered_in_error). entered_in_error means the row was created
-- incorrectly or is a duplicate/bad entry, and is retained for
-- judicial/data history rather than hard-deleted — no DELETE policy
-- exists, for anyone. A party row does NOT become inactive merely
-- because the parent Docket Matter is completed or archived (unlike
-- docket_matter_assignments' automatic release) — party rows remain
-- historical components of the matter regardless of the matter's own
-- lifecycle state.
--
-- CORRECTIONS: full_name, party_type, role, attorney_name, contact_info,
-- and party_status may all be corrected by ordinary UPDATE, by anyone
-- with lawful access to the parent matter — this is deliberately NOT a
-- full immutable change ledger. A spelling correction or a corrected
-- procedural role is simply an UPDATE. If a party's legal name genuinely
-- changes over time (as opposed to a data-entry correction), this
-- migration does not attempt to preserve a separate historical-name
-- timeline — that richer identity/history model is explicitly deferred.
--
-- PARENT IMMUTABILITY: docket_matter_id is immutable after creation —
-- a party row can never be moved from one Docket Matter to another via
-- UPDATE, enforced by an exception-raising trigger, matching the
-- identical protection already established for docket_events.docket_matter_id
-- (0024) and docket_matter_assignments' identity fields (0022). No other
-- immutability is imposed — this is deliberately narrower than a full
-- ledger, per the approved design.
--
-- PROVENANCE: created_by/last_updated_by follow the exact pattern
-- established for docket_matters and docket_events — forced from
-- auth.uid() at creation (created_by) and on every UPDATE
-- (last_updated_by), never client-writable, never an access-control
-- factor. FK behavior matches docket_matters.created_by/last_updated_by
-- and docket_events.created_by/last_updated_by exactly: created_by is
-- ON DELETE RESTRICT (same semantic role — who authored this row — as
-- every other created_by column in this schema), last_updated_by is
-- ON DELETE SET NULL (same incidental, resilience-appropriate role as
-- every other last_updated_by column). Unlike docket_events'
-- presiding_magistrate_id, there is no third provenance column here that
-- requires special FK-nulling-transition handling in the guard trigger
-- — created_by can never be nulled (RESTRICT), and last_updated_by is
-- unconditionally overwritten on every UPDATE, exactly as already
-- accepted for docket_matters/docket_events.
--
-- ACCESS MODEL: fully inherited from the parent Docket Matter, via the
-- same two-path predicate docket_matters/docket_events use —
-- can_access_court(parent.court_id) OR has_retained_assignment(parent.id)
-- — for SELECT, INSERT, and UPDATE. This intentionally permits a
-- retained/part-heard magistrate to correct or add party information on
-- the specific matter they remain responsible for, without extending to
-- any other matter at that Court. No DELETE policy. No admin bypass. The
-- future shares path is intentionally NOT added here, per the
-- incremental RLS staging decision already established for docket_matters.
--
-- LEGACY SEPARATION: cases, case_parties, and the legacy party_role enum
-- are not modified by this migration in any way. docket_matter_parties
-- is a wholly separate Court-Anchored Docket model with its own
-- independent role/type vocabulary.

-- 1. docket_matter_parties table -------------------------------------------

create table public.docket_matter_parties (
  id uuid primary key default gen_random_uuid(),
  docket_matter_id uuid not null references public.docket_matters (id) on delete restrict,
    -- immutable after creation — see the guard trigger below
  full_name text not null,
    -- display/legal name as recorded for this proceeding; no identity
    -- registry, no cross-matter identity matching
  party_type text not null default 'individual'
    check (party_type in ('individual', 'organization', 'government_body', 'estate', 'other')),
    -- what the party/entity IS — independent of their procedural role
  role text not null
    check (role in (
      'accused', 'complainant', 'applicant', 'respondent', 'plaintiff',
      'defendant', 'petitioner', 'appellant', 'appellee', 'landlord',
      'tenant', 'child', 'other'
    )),
    -- their procedural position in the proceeding; no default —
    -- must be explicitly supplied at creation. Deliberately excludes
    -- witness (not ordinarily a party) and any
    -- prosecution/police/counsel role (deferred, not invented here)
  attorney_name text,
    -- nullable, simple free text — no lawyer directory in this migration
  contact_info text,
    -- nullable, simple free text — no structured contact/address model
  party_status text not null default 'active'
    check (party_status in ('active', 'entered_in_error')),
    -- entered_in_error preserves a bad/duplicate entry for history
    -- rather than hard-deleting it. Does NOT change merely because the
    -- parent matter completes/archives — party rows are not subject to
    -- the automatic-release pattern used by docket_matter_assignments
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
    -- trigger-forced at creation; matches docket_matters.created_by and
    -- docket_events.created_by exactly
  last_updated_by uuid references public.profiles (id) on delete set null,
    -- trigger-populated on every UPDATE; matches
    -- docket_matters.last_updated_by and docket_events.last_updated_by
    -- exactly
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.docket_matter_parties is 'Structured party/participant identity for a Docket Matter. Does not replace or generate docket_matters.matter_title. No separate persons/contact registry; no cross-matter identity matching; no uniqueness on (docket_matter_id, full_name[, role]) since names are not reliable unique identifiers and one party may legitimately hold more than one role. Access fully inherited from the parent Docket Matter via can_access_court()/has_retained_assignment(). No hard DELETE — entered_in_error preserves bad/duplicate entries for history.';
comment on column public.docket_matter_parties.docket_matter_id is 'Immutable after creation — a party row can never be moved to another Docket Matter. Enforced by docket_matter_parties_guard().';
comment on column public.docket_matter_parties.party_type is 'What the party/entity is (individual/organization/government_body/estate/other) — independent of role, which describes their procedural position.';
comment on column public.docket_matter_parties.role is 'Procedural role in the proceeding. Deliberately excludes witness (not ordinarily a party) and any prosecution/police/counsel role (deferred, not invented here). No default — must be explicitly supplied.';
comment on column public.docket_matter_parties.party_status is 'active or entered_in_error. entered_in_error retains a bad/duplicate entry for judicial/data history rather than hard-deleting it. Not tied to the parent matter''s own status/lifecycle.';

-- 2. updated_at trigger -----------------------------------------------------
-- Reuses the existing public.set_updated_at() from migration 0001.

create trigger set_docket_matter_parties_updated_at
  before update on public.docket_matter_parties
  for each row
  execute function public.set_updated_at();

-- 3. Indexes ------------------------------------------------------------------
-- Only what the approved access/query model actually justifies: the FK
-- used by the RLS EXISTS lookup, and the two provenance FKs. No
-- speculative search index on full_name/role/party_type is added here.

create index docket_matter_parties_docket_matter_id_idx on public.docket_matter_parties (docket_matter_id);
create index docket_matter_parties_created_by_idx on public.docket_matter_parties (created_by);
create index docket_matter_parties_last_updated_by_idx on public.docket_matter_parties (last_updated_by);

-- 4. docket_matter_parties_guard() — immutability + provenance protection ---
-- Narrower than docket_events_guard() (0024): there is no third
-- provenance column analogous to presiding_magistrate_id here, so no
-- FK-nulling-transition branch is needed. Combines:
--   (a) docket_matter_id is immutable — any attempted change on UPDATE
--       is rejected outright with an exception, matching
--       docket_events.docket_matter_id (0024) and
--       docket_matter_assignments' identity-field protection (0022).
--   (b) created_by is forced to auth.uid() at INSERT and force-preserved
--       on every UPDATE. Safe unconditionally, since created_by is
--       ON DELETE RESTRICT and can never be nulled by a profile
--       deletion.
--   (c) last_updated_by is set to auth.uid() on every UPDATE, never
--       client-writable — matching docket_matters_guard() and
--       docket_events_guard() exactly, including behavior during a
--       profile-deletion cascade (the updater's own auth.uid() is
--       recorded, not NULL, as already accepted elsewhere in this
--       schema).

create or replace function public.docket_matter_parties_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.docket_matter_id is distinct from old.docket_matter_id then
    raise exception 'A Docket Matter Party''s docket_matter_id is immutable; it cannot be moved to another Docket Matter.';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  else
    new.created_by := old.created_by;
  end if;

  if tg_op = 'UPDATE' then
    new.last_updated_by := (select auth.uid());
  end if;

  return new;
end;
$$;

comment on function public.docket_matter_parties_guard() is 'BEFORE INSERT OR UPDATE guard: docket_matter_id immutability (exception on change), created_by provenance (forced at creation, force-preserved after — safe unconditionally since created_by is ON DELETE RESTRICT), last_updated_by provenance (forced to auth.uid() on every UPDATE).';

create trigger docket_matter_parties_guard_trigger
  before insert or update on public.docket_matter_parties
  for each row
  execute function public.docket_matter_parties_guard();

-- 5. Row Level Security -------------------------------------------------------
-- Access is fully inherited from the parent Docket Matter via the same
-- two-path predicate docket_matters/docket_events use. No DELETE policy.
-- No admin bypass. The future shares path is intentionally not added
-- here.

alter table public.docket_matter_parties enable row level security;

create policy "Magistrates can view Docket Matter Parties"
  on public.docket_matter_parties for select
  using (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_matter_parties.docket_matter_id
        and (
          (select public.can_access_court(dm.court_id))
          or (select public.has_retained_assignment(dm.id))
        )
    )
  );

create policy "Magistrates can create Docket Matter Parties"
  on public.docket_matter_parties for insert
  with check (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_matter_parties.docket_matter_id
        and (
          (select public.can_access_court(dm.court_id))
          or (select public.has_retained_assignment(dm.id))
        )
    )
    and created_by = (select auth.uid())
  );

create policy "Magistrates can update Docket Matter Parties"
  on public.docket_matter_parties for update
  using (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_matter_parties.docket_matter_id
        and (
          (select public.can_access_court(dm.court_id))
          or (select public.has_retained_assignment(dm.id))
        )
    )
  )
  with check (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_matter_parties.docket_matter_id
        and (
          (select public.can_access_court(dm.court_id))
          or (select public.has_retained_assignment(dm.id))
        )
    )
  );
