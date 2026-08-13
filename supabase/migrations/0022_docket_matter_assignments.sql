-- Magistrate Wizard — Docket Matter Assignments (retained/part-heard access)
-- NOT the ordinary Docket access mechanism — that remains
-- magistrate_courts / can_access_court(). This table is an exceptional,
-- matter-specific access grant: a magistrate preserving access to a
-- specific matter they are ALREADY legitimately handling, after their
-- broader Court assignment ends (or in anticipation of it ending), so
-- they can finish that one matter. It does not turn docket_matters into
-- magistrate-owned records, and it is never a mechanism for one
-- magistrate to grant judicial access to another.
--
-- AUTHORIZATION MODEL (resolved this turn — the FINAL spec originally
-- left this open, flagged rather than guessed at in the prior readiness
-- review): a magistrate may create a retained assignment ONLY for
-- themselves, and ONLY while they currently satisfy can_access_court()
-- for the parent matter's court. There is NO admin bypass anywhere on
-- this table — not for creation, not for ending. This is deliberately
-- stricter than magistrate_courts (0017), which does have an admin
-- roster-management carve-out: magistrate_courts is classified as
-- administrative/roster data, while docket_matter_assignments gates
-- access to private judicial content, per the architecture's ownership
-- table (§3) — the same self-service pattern cannot be copied across
-- that boundary.
--
-- MAGISTRATE OFFBOARDING (retirement/resignation/promotion/departure):
-- the Court's Docket is never owned by any magistrate, retained
-- assignment included. A departing magistrate's live retained access
-- must end as part of offboarding — before their profile is ever
-- deleted, by ordinary means (self-service ending, or a future
-- offboarding workflow that is NOT built here). But the historical
-- RECORD of who once held a retained assignment must survive even if
-- their profile is later deleted entirely: profile_id and granted_by
-- are therefore both ON DELETE SET NULL, not CASCADE (which would
-- destroy the row) and not RESTRICT (which would permanently block
-- deleting a retired magistrate's profile). A NULL profile_id can only
-- ever mean "the profile that once held this historical row has since
-- been removed" — it can never represent a live, currently-usable
-- grant: has_retained_assignment() requires profile_id = auth.uid(),
-- which a NULL can never satisfy, and the history-protection trigger
-- below additionally guarantees a row can never be left in the state
-- profile_id IS NULL AND ended_at IS NULL — see section 4.

-- 1. docket_matter_assignments table ------------------------------------------

create table public.docket_matter_assignments (
  id uuid primary key default gen_random_uuid(),
  docket_matter_id uuid not null references public.docket_matters (id) on delete restrict,
  profile_id uuid default auth.uid() references public.profiles (id) on delete set null,
    -- the magistrate who holds the retained access. Nullable at the
    -- schema level ONLY so a historical row can survive deletion of a
    -- former magistrate's profile — NOT to permit a NULL value at
    -- creation. Column default is a convenience; RLS WITH CHECK
    -- independently requires this equal the authenticated user
    -- (profile_id = auth.uid()) at creation, which a NULL can never
    -- satisfy. Once a row exists, only the profile_id FK's ON DELETE
    -- SET NULL action can ever null this column — see the
    -- history-protection trigger below for how that's safely handled
  reason text not null default 'retained_part_heard'
    check (reason in ('retained_part_heard')),
    -- constrained text, not an enum, so additional legitimate reasons
    -- can be added later without a type change. Only one value is
    -- approved today — none invented here
  granted_by uuid default auth.uid() references public.profiles (id) on delete set null,
    -- who created this grant. Per the authorization model, this must
    -- always equal profile_id in practice (self-grant only) — RLS WITH
    -- CHECK enforces granted_by = auth.uid() at creation. Nullable for
    -- the same offboarding reason as profile_id: this is provenance,
    -- not an access determinant, and must not block deleting a
    -- profile years later, nor destroy the historical record
  started_at timestamptz not null default now(),
  ended_at timestamptz,
    -- NULL = current/active — same ended_at-only model as
    -- magistrate_courts, no separate boolean
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint docket_matter_assignments_ended_after_started
    check (ended_at is null or ended_at >= started_at)
);

comment on table public.docket_matter_assignments is 'Exceptional, matter-specific Docket access: a magistrate preserving access to one specific Docket Matter they are already legitimately handling, typically after their broader Court assignment ends. NOT the ordinary access mechanism (that is magistrate_courts/can_access_court()), and NOT a way to grant access to another person — profile_id and granted_by must always be the creating magistrate themselves at creation time. No admin bypass anywhere on this table. profile_id/granted_by may later become NULL only via profile deletion (ON DELETE SET NULL), preserving the historical record — see the history-protection trigger.';
comment on column public.docket_matter_assignments.profile_id is 'The magistrate holding the retained access. RLS requires this equal auth.uid() at creation — self-grant only, never on behalf of another magistrate. NULL after creation means only that the referenced profile was later deleted (offboarding); a NULL profile_id can never represent a live grant — see has_retained_assignment().';
comment on column public.docket_matter_assignments.reason is 'Constrained to retained_part_heard only, for now. Constrained text (not an enum) so future legitimate reasons can be added without a type change — none are invented here.';
comment on column public.docket_matter_assignments.granted_by is 'Provenance only. Per the authorization model, always equals profile_id in practice (self-grant only) — enforced by RLS at creation, not by this FK.';
comment on column public.docket_matter_assignments.ended_at is 'NULL = current/active. Sole source of truth for assignment state, matching magistrate_courts. A magistrate may end their own current row (set ended_at) but never reactivate one (clear ended_at) or touch a historical row — see the history-protection trigger below.';

-- 2. updated_at trigger -----------------------------------------------------
-- Reuses the existing public.set_updated_at() from migration 0001.

create trigger set_docket_matter_assignments_updated_at
  before update on public.docket_matter_assignments
  for each row
  execute function public.set_updated_at();

-- 3. Indexes ------------------------------------------------------------------
-- At most one CURRENT retained assignment per magistrate/matter pair;
-- unlimited historical (ended) rows for the same pair over time.

create unique index docket_matter_assignments_current_pair_idx
  on public.docket_matter_assignments (docket_matter_id, profile_id)
  where ended_at is null;

create index docket_matter_assignments_docket_matter_id_idx on public.docket_matter_assignments (docket_matter_id);
create index docket_matter_assignments_profile_id_idx on public.docket_matter_assignments (profile_id);
create index docket_matter_assignments_current_idx on public.docket_matter_assignments (docket_matter_id) where ended_at is null;

-- 4. Assignment-history integrity, including profile-deletion handling ---------
-- Unlike magistrate_courts' equivalent trigger (0017), there is NO
-- is_admin() exception here at all — no one, including admins, may
-- correct or rewrite a docket_matter_assignments row's identity once
-- created, or reactivate an ended one. Only the row's own profile_id
-- (enforced separately by RLS — see below) may ever touch it, and even
-- then only to set ended_at once.
--
-- This trigger also has to correctly handle a second, distinct kind of
-- UPDATE it will see: the profile_id/granted_by FK's own ON DELETE SET
-- NULL action, which fires when a referenced profile is deleted.
-- PostgreSQL implements FK SET NULL as a genuine UPDATE executed
-- internally, and that UPDATE DOES fire this table's ordinary row
-- triggers (FK actions are documented to bypass Row Level Security, to
-- protect referential integrity — but they are NOT exempt from
-- BEFORE/AFTER triggers, which still run normally). Without a special
-- case, the checks above would incorrectly reject that legitimate
-- system operation: the "historical rows are immutable" check would
-- block it outright for already-ended rows (defeating the entire point
-- of using SET NULL to preserve history), and the "no other field may
-- change" check would block it for still-current rows.
--
-- A client-initiated UPDATE can never itself produce new.profile_id IS
-- NULL: the RLS policy below requires WITH CHECK profile_id =
-- auth.uid(), and NULL can never equal a real auth.uid(). So any UPDATE
-- this trigger observes with old.profile_id NOT NULL and new.profile_id
-- NULL can only have originated from the FK's SET NULL action (or an
-- equivalently privileged, RLS-bypassing context such as a superuser —
-- an accepted, out-of-scope trust boundary, the same one this whole
-- project's own verification queries already rely on). The identical
-- reasoning applies to granted_by.
--
-- Safeguard against the impossible state "profile_id IS NULL AND
-- ended_at IS NULL": if a still-current row's profile_id is being
-- nulled by the FK action, this trigger also stamps ended_at := now()
-- in the same operation, so the row can never sit — even momentarily —
-- as a current-but-orphaned assignment. Note a partial unique index on
-- (docket_matter_id, profile_id) WHERE ended_at IS NULL could NOT have
-- enforced this on its own: NULL is never considered equal to NULL for
-- uniqueness purposes, so multiple orphaned "current" rows could
-- otherwise coexist. The trigger is the only layer that can actually
-- close this gap. has_retained_assignment() independently can never be
-- satisfied by a NULL profile_id regardless, so this is defense in
-- depth, not the only protection.

create or replace function public.protect_docket_matter_assignment_history()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_profile_nulled boolean;
  v_granted_by_nulled boolean;
begin
  v_profile_nulled := old.profile_id is not null and new.profile_id is null;
  v_granted_by_nulled := old.granted_by is not null and new.granted_by is null;

  if v_profile_nulled or v_granted_by_nulled then
    -- The profile-deletion path: allow exactly profile_id and/or
    -- granted_by moving to NULL, nothing else (reject if anything else
    -- also changed), and normalize ended_at if the row was still
    -- current. This bypasses the historical-immutability check above
    -- deliberately — preserving the row through a profile deletion is
    -- the entire purpose of SET NULL over CASCADE.
    if new.docket_matter_id is distinct from old.docket_matter_id
       or new.started_at is distinct from old.started_at
       or new.reason is distinct from old.reason
       or (new.profile_id is distinct from old.profile_id and not v_profile_nulled)
       or (new.granted_by is distinct from old.granted_by and not v_granted_by_nulled) then
      raise exception 'Unexpected combined change alongside a profile/grantor removal on a Docket Matter Assignment';
    end if;

    if v_profile_nulled and old.ended_at is null then
      new.ended_at := now();
    end if;

    return new;
  end if;

  -- Ordinary path: no profile/grantor removal in progress. Rules
  -- unchanged from the original design.
  if old.ended_at is not null then
    raise exception 'Cannot modify a historical (already-ended) Docket Matter Assignment';
  end if;

  if new.docket_matter_id is distinct from old.docket_matter_id
     or new.profile_id is distinct from old.profile_id
     or new.granted_by is distinct from old.granted_by
     or new.started_at is distinct from old.started_at
     or new.reason is distinct from old.reason then
    raise exception 'A Docket Matter Assignment may only have ended_at set to end it; no other field may change';
  end if;

  if new.ended_at is null then
    raise exception 'Reactivating an ended Docket Matter Assignment is not permitted; create a new assignment instead, subject to the ordinary creation authorization at that time';
  end if;

  return new;
end;
$$;

comment on function public.protect_docket_matter_assignment_history() is 'No admin exception, unlike the analogous magistrate_courts trigger — docket_matter_assignments gates private judicial content, not administrative roster data. Ordinarily, only ending (ended_at null -> timestamp) is permitted; identity/provenance fields and historical rows are immutable. Separately permits the profile_id/granted_by FK''s own ON DELETE SET NULL action to null those columns (and only those columns), auto-ending the row first if it was still current, so a NULL profile_id can never coincide with a live (ended_at IS NULL) assignment.';

create trigger protect_docket_matter_assignment_history_trigger
  before update on public.docket_matter_assignments
  for each row
  execute function public.protect_docket_matter_assignment_history();

-- 5. Row Level Security --------------------------------------------------------
-- Self-only throughout. No admin bypass on any policy. No DELETE policy
-- at all — assignment history is never deleted, only ended via UPDATE
-- (and even that is restricted to exactly ending, per the trigger above).

alter table public.docket_matter_assignments enable row level security;

create policy "Magistrates can view their own Docket Matter Assignments"
  on public.docket_matter_assignments for select
  using (profile_id = (select auth.uid()));

create policy "Magistrates can create their own Docket Matter Assignments"
  on public.docket_matter_assignments for insert
  with check (
    profile_id = (select auth.uid())
    and granted_by = (select auth.uid())
    and ended_at is null
    and exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_matter_id
        and (select public.can_access_court(dm.court_id))
    )
  );

create policy "Magistrates can end their own Docket Matter Assignments"
  on public.docket_matter_assignments for update
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- 6. has_retained_assignment() -------------------------------------------------
-- The second Docket access path. True if the authenticated user holds a
-- CURRENT (ended_at IS NULL) retained assignment to the given Docket
-- Matter. SECURITY INVOKER: the caller's own RLS on this table already
-- permits them to read their own rows (policy above), so no privilege
-- elevation is needed.

create or replace function public.has_retained_assignment(p_docket_matter_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.docket_matter_assignments dma
    where dma.docket_matter_id = p_docket_matter_id
      and dma.profile_id = auth.uid()
      and dma.ended_at is null
  );
$$;

comment on function public.has_retained_assignment(uuid) is 'True if the authenticated user holds a current (ended_at IS NULL) retained/part-heard assignment to the given Docket Matter. This is the second of the three approved Docket access paths (court assignment, retained assignment, shares) — the shares path remains unimplemented per the approved incremental RLS plan.';

-- 7. Automatic release on matter completion/archival ---------------------------
-- When a Docket Matter's status transitions to completed or archived,
-- any current retained assignments for that matter are automatically
-- ended. NOT triggered by a transition to 'stayed' — a stayed part-heard
-- matter may resume and remain that magistrate's responsibility.
--
-- SECURITY DEFINER is a deliberate, narrow exception: whoever closes a
-- matter (typically the current Court-assigned magistrate, via
-- can_access_court()) is very often NOT the retained magistrate
-- themselves, and the self-only UPDATE policy above would otherwise
-- block this system-maintained side effect. This function does exactly
-- one thing — end current retained assignments for the matter just
-- closed — and does not expose any broader capability.

create or replace function public.release_retained_assignments_on_matter_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('completed', 'archived') and new.status is distinct from old.status then
    update public.docket_matter_assignments
    set ended_at = now()
    where docket_matter_id = new.id
      and ended_at is null;
  end if;
  return new;
end;
$$;

comment on function public.release_retained_assignments_on_matter_close() is 'SECURITY DEFINER by necessity: ends current retained assignments on a matter transitioning to completed/archived, regardless of whether the magistrate closing the matter is the retained magistrate themselves. Never fires on a transition to stayed.';

create trigger release_retained_assignments_on_matter_close_trigger
  after update of status on public.docket_matters
  for each row
  execute function public.release_retained_assignments_on_matter_close();

-- 8. Extend docket_matters RLS (SELECT/UPDATE only) -----------------------------
-- Adds the retained-assignment path to the two policies already created
-- in 0020. INSERT is unchanged (a retained assignment presupposes the
-- matter already exists). DELETE remains unimplemented — no policy, for
-- anyone, ever. The future shares path is NOT added here.

alter policy "Magistrates can view Docket Matters at their current courts"
  on public.docket_matters
  using (
    (select public.can_access_court(court_id))
    or (select public.has_retained_assignment(id))
  );

alter policy "Magistrates can update Docket Matters at their current courts"
  on public.docket_matters
  using (
    (select public.can_access_court(court_id))
    or (select public.has_retained_assignment(id))
  )
  with check (
    (select public.can_access_court(court_id))
    or (select public.has_retained_assignment(id))
  );
