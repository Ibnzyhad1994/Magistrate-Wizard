-- ============================================================================
-- 0104_magistrate_courts_end_provenance.sql
--
-- Part of the court selection/assignment/exclusivity/relinquishment/
-- succession system. Adds `ended_by`/`end_reason` to `magistrate_courts`,
-- mirroring `clerk_courts` (0087) exactly -- that table already needed
-- this provenance for clerk revocation; magistrate_courts needs the same
-- for admin-ended assignments and, starting with 0108's
-- relinquish_magistrate_court(), self-service relinquishment.
--
-- RLS itself is NOT reopened here -- UPDATE on magistrate_courts remains
-- is_admin()-only (0052), unchanged. Self-relinquishment does not need a
-- self-service RLS policy: 0108 adds relinquish_magistrate_court(), a
-- SECURITY DEFINER RPC that is the sole sanctioned path for a magistrate
-- to end their own row, exactly the same pattern already used for every
-- other ordinary write against this AUTHORITY-ORIGINATING table
-- (decide_magistrate_court_request() et al. in 0107/0108 all write here
-- as SECURITY DEFINER despite RLS being admin-only). Keeping RLS closed
-- and routing exclusively through audited RPCs is deliberately more
-- conservative than reopening a self-service UPDATE policy that 0052
-- closed for a documented reason.
-- ============================================================================

alter table public.magistrate_courts
  add column ended_by uuid references public.profiles (id) on delete set null,
  add column end_reason text;

comment on column public.magistrate_courts.ended_by is 'Who ended this assignment (relinquishment or admin correction). Force-set by protect_magistrate_court_history() below whenever ended_at transitions from NULL -- never trusted from any RPC parameter or client input. NULL while the assignment is current.';
comment on column public.magistrate_courts.end_reason is 'Optional free-text reason recorded at relinquishment/administrative ending. NULL while the assignment is current.';

alter table public.magistrate_courts
  add constraint magistrate_courts_end_fields_consistent
    check (ended_at is not null or (ended_by is null and end_reason is null));

-- ----------------------------------------------------------------------------
-- protect_magistrate_court_history() -- CREATE OR REPLACE (forward
-- modification of the 0017 function body, same precedent as 0046/0048).
-- Adds exactly two things relative to the 0017 version: (1) force
-- ended_by := auth.uid() whenever ended_at transitions from NULL to a
-- real timestamp, mirroring protect_clerk_court_history() (0087)
-- byte-for-byte in intent; (2) permit end_reason to change alongside
-- that same transition (previously not a column at all, so the old
-- "no other field may change" check would have rejected it outright).
-- Every other rule (admin bypass, historical immutability, no
-- reactivation, profile_id/court_id/started_at/assignment_type frozen)
-- is unchanged from 0017.
-- ----------------------------------------------------------------------------

create or replace function public.protect_magistrate_court_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.ended_at is null and new.ended_at is not null then
    new.ended_by := (select auth.uid());
  end if;

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
    raise exception 'Ordinary self-service may only set ended_at/end_reason to end a current assignment; no other field may change';
  end if;

  if new.ended_at is null then
    raise exception 'Reactivating an ended assignment is not permitted via self-service; create a new assignment instead';
  end if;

  return new;
end;
$$;

comment on function public.protect_magistrate_court_history() is 'As of 0104: also force-sets ended_by := auth.uid() (never trusted from input) whenever ended_at transitions from NULL, and permits end_reason to change in that same transition. All other rules unchanged from 0017: admin bypass, historical rows immutable, no reactivation, profile_id/court_id/started_at/assignment_type frozen for ordinary self-service. Reached today only via SECURITY DEFINER RPCs (0107/0108), since ordinary RLS on this table remains admin-only (0052).';
