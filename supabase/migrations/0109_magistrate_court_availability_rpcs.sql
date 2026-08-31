-- ============================================================================
-- 0109_magistrate_court_availability_rpcs.sql
--
-- Two "derived availability" list RPCs, built on court_has_active_primary_
-- magistrate() (0107). Neither ever discloses WHO holds a court -- only
-- occupancy -- matching "do not unnecessarily disclose the assigned
-- magistrate's personal details to an unapproved signup user."
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. list_active_courts_for_magistrate_signup() -- anon+authenticated,
--    for the PUBLIC registration form's magistrate branch. Mirrors
--    list_active_courts_for_signup() (0095) but adds is_assigned.
-- ----------------------------------------------------------------------------

create or replace function public.list_active_courts_for_magistrate_signup()
returns table (id uuid, name text, district_id uuid, is_assigned boolean)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.name, c.district_id, public.court_has_active_primary_magistrate(c.id)
  from public.courts c
  where c.is_active = true
  order by c.name;
$$;

comment on function public.list_active_courts_for_magistrate_signup() is
  'Anon-callable: id/name/district_id/is_assigned of currently-active courts, for the public magistrate-registration picker. is_assigned discloses occupancy only, never identity (see court_has_active_primary_magistrate(), 0107). Deliberately does not expose jurisdiction/address/created_at/updated_at, and does not alter courts'' own RLS (still authenticated-only).';

grant execute on function public.list_active_courts_for_magistrate_signup() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. list_courts_for_magistrate_request() -- authenticated only,
--    personalized status for the magistrate's own self-service "request
--    another court" picker.
-- ----------------------------------------------------------------------------

create or replace function public.list_courts_for_magistrate_request()
returns table (
  id uuid,
  name text,
  district_id uuid,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.name,
    c.district_id,
    case
      when not c.is_active then 'inactive'
      when exists (
        select 1 from public.magistrate_courts mc
        where mc.court_id = c.id and mc.profile_id = (select auth.uid()) and mc.ended_at is null
      ) then 'assigned_to_you'
      when exists (
        select 1 from public.magistrate_court_requests r
        where r.court_id = c.id and r.profile_id = (select auth.uid()) and r.status = 'pending'
      ) then 'pending'
      when public.court_has_active_primary_magistrate(c.id) then 'assigned'
      else 'available'
    end as status
  from public.courts c
  order by c.name;
$$;

comment on function public.list_courts_for_magistrate_request() is
  'Authenticated-only, personalized: per active-or-inactive court, one of inactive|assigned_to_you|pending|assigned|available, folding in the caller''s own magistrate_courts/magistrate_court_requests rows -- never discloses who else holds a court.';

grant execute on function public.list_courts_for_magistrate_request() to authenticated;

-- ----------------------------------------------------------------------------
-- 3. is_sole_admin_bootstrap_available() -- a single global boolean the
--    admin review UI checks once (not per court, not per request): true
--    only when the caller is_admin() AND exactly one active administrator
--    exists system-wide. Combined client-side with "is this pending
--    request's profile_id my own id?" to decide, per request row, whether
--    to render the bootstrap self-approval control (0107) -- kept
--    separate from list_courts_for_magistrate_request() above because
--    bootstrap eligibility is a property of (admin, request), not of a
--    court, and belongs with the request-review surface, not the
--    court-browsing surface.
-- ----------------------------------------------------------------------------

create or replace function public.is_sole_admin_bootstrap_available()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select public.is_admin())
    and (select count(*) from public.profiles where role = 'admin' and is_active = true) = 1;
$$;

comment on function public.is_sole_admin_bootstrap_available() is
  'True only when the caller is_admin() AND exactly one active administrator profile exists system-wide. A convenience check for the admin review UI to decide whether to render the sole-administrator self-approval control (admin_bootstrap_self_approve_magistrate_court_request(), 0107) at all -- the RPC itself independently re-verifies the same condition (and more) server-side regardless of what this returns, so this is UI guidance only, never the actual authorization boundary.';

grant execute on function public.is_sole_admin_bootstrap_available() to authenticated;
