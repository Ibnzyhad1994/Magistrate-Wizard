-- ============================================================================
-- 0105_magistrate_primary_exclusivity.sql
--
-- Enforces "only one active primary (assignment_type='regular') magistrate
-- per court" -- the gap the existing magistrate_courts_current_pair_idx
-- (0017, unique on (profile_id, court_id) WHERE ended_at IS NULL) does not
-- close: that index stops the SAME magistrate holding a court twice, but
-- does nothing to stop two DIFFERENT magistrates each holding an active
-- 'regular' row at the same court.
--
-- PRE-EXISTING LIVE CONFLICT, EXPLICITLY NOT TOUCHED HERE:
-- Reconciliation audit (both hosted projects, run before writing this
-- migration) found Georgetown Magistrates' Court 1 already has multiple
-- concurrent active 'regular' assignments -- 2 on production (seed
-- profiles "Local Administrator" and "Local Magistrate"), 3 on dev
-- (adding a test account). Per explicit product decision, this migration
-- does NOT end, delete, or otherwise touch any existing row -- "leave
-- conflicts as-is, add the constraint anyway." That is precisely why
-- this is implemented as a trigger rather than a bare
-- `CREATE UNIQUE INDEX ... WHERE assignment_type = 'regular' AND
-- ended_at IS NULL`: Postgres validates ALL existing rows at index-
-- creation time and would refuse to create such an index at all while
-- Georgetown's conflicting rows exist. A BEFORE INSERT/UPDATE trigger
-- only ever validates the specific write being attempted right now --
-- existing rows already committed are never re-validated merely by
-- sitting there, so this migration applies cleanly today, immediately
-- prevents the situation from recurring or worsening at ANY court
-- (including Georgetown), and leaves the pre-existing conflict exactly
-- where it is for a human to reconcile later via the admin Court
-- Assignments screen (ending one of the duplicate rows there hits no
-- resistance from this trigger, since ending a row is never blocked --
-- only creating/keeping a SECOND active one is).
--
-- Vigilance Magistrates' Court 1 and Kamarang Magistrate's Court each
-- have exactly one active 'regular' assignment (both currently held by
-- the real admin/magistrate account) and are completely unaffected by
-- this migration -- nothing about their existing rows changes, and no
-- new write is being attempted against them.
--
-- RACE SAFETY: two concurrent approvals for the same court (e.g. two
-- admins deciding two different pending requests for the same court at
-- nearly the same instant) must never both succeed. A bare `SELECT
-- EXISTS(...)` check inside a trigger, without locking, is NOT
-- sufficient under READ COMMITTED: two concurrent transactions could
-- both see zero conflicting rows (neither has committed yet) and both
-- proceed. This trigger closes that gap with
-- pg_advisory_xact_lock(hashtextextended(court_id, 0)) BEFORE the
-- existence check -- the second transaction blocks until the first
-- commits or rolls back, then re-evaluates the check against the
-- first's now-committed (or absent, if rolled back) row. The lock is
-- automatically released at transaction end (xact-scoped), requires no
-- explicit unlock, and is scoped per-court (hashed court_id), so
-- concurrent writes to DIFFERENT courts never contend with each other.
--
-- Fires only when a row is being created or kept as
-- assignment_type='regular' AND ended_at IS NULL -- i.e. only on writes
-- that would originate or preserve primary authority. Ending a row
-- (ended_at going non-null) is never blocked by this trigger regardless
-- of assignment_type. Acting/relief/other assignments (0108's
-- admin_assign_magistrate_court()) are entirely exempt by construction
-- -- they may coexist with a 'regular' assignment at the same court,
-- matching "use the existing meaning of assignment_type... acting and
-- relief exceptions cannot be created through ordinary self-service."
-- ============================================================================

create or replace function public.check_primary_magistrate_exclusivity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.assignment_type = 'regular' and new.ended_at is null then
    perform pg_advisory_xact_lock(hashtextextended(new.court_id::text, 0));

    if exists (
      select 1
      from public.magistrate_courts mc
      where mc.court_id = new.court_id
        and mc.assignment_type = 'regular'
        and mc.ended_at is null
        and mc.id is distinct from new.id
        and mc.profile_id is distinct from new.profile_id
    ) then
      raise exception 'This court already has an active primary magistrate assignment'
        using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.check_primary_magistrate_exclusivity() is 'Blocks a second, different-profile active assignment_type=''regular'' magistrate_courts row from being created/kept active at the same court. Takes a per-court advisory transaction lock before checking, so two concurrent approvals for the same court genuinely serialize instead of racing -- this is the actual race-condition protection, not merely a best-effort check. Raises errcode 23505 (unique_violation) so callers (0107/0108 RPCs) can catch it uniformly and return a clean message. Does NOT retroactively validate existing rows -- pre-existing conflicts (see migration header) are left untouched by design; only fires on new writes. Ending an assignment (ended_at set) is never blocked. Acting/relief/other assignment_type rows are exempt entirely.';

create trigger check_primary_magistrate_exclusivity_trigger
  before insert or update of court_id, assignment_type, ended_at, profile_id
  on public.magistrate_courts
  for each row
  execute function public.check_primary_magistrate_exclusivity();

-- Supporting (non-unique) index for the trigger's own lookup and for
-- admin-facing "who else is active at this court" queries. Deliberately
-- NOT unique, for the reasons above.
create index if not exists magistrate_courts_active_regular_by_court_idx
  on public.magistrate_courts (court_id)
  where assignment_type = 'regular' and ended_at is null;
