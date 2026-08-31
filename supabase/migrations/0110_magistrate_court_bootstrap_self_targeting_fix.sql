-- ============================================================================
-- 0110_magistrate_court_bootstrap_self_targeting_fix.sql
--
-- Two forward fixes discovered by live rollback-only testing against dev
-- immediately after 0107/0108 were applied, before any production
-- application or frontend work began. Applied migrations are immutable,
-- so both are CREATE OR REPLACE forward modifications, same precedent as
-- 0046/0048/0104.
--
-- GAP 1: submit_magistrate_court_request() (0107) required is_magistrate()
-- to submit a request. But the sole-administrator bootstrap exception
-- (0107's admin_bootstrap_self_approve_magistrate_court_request()) can
-- only ever act on an EXISTING pending request -- and profiles.role is a
-- single value, so a role='admin' profile could never pass is_magistrate()
-- to create one for themselves in the first place. This is exactly the
-- real scenario the spec names explicitly: "that person may also be a
-- sitting magistrate" -- an Admin's platform role does not mean they
-- cannot also legitimately hold Docket-access court assignments (0052's
-- own commentary already establishes this: "An Admin who is also a
-- sitting magistrate needs an ordinary magistrate_courts row... created
-- the same way anyone else's is"). Fix: allow is_admin() callers to also
-- submit a request, not only is_magistrate() ones. This does NOT weaken
-- self-approval in any way -- decide_magistrate_court_request() still
-- unconditionally blocks self-approval regardless of who submitted the
-- request, and admin_bootstrap_self_approve_magistrate_court_request()
-- still independently re-verifies the sole-administrator condition,
-- ownership, reason, and recent-auth every time it is called.
--
-- GAP 2: admin_assign_magistrate_court() (0108) let ANY admin directly
-- self-assign a 'regular' court to themselves with zero reason, zero
-- recent-auth check, and none of the bootstrap exception's audit marking
-- -- a much weaker, effectively silent backdoor around the entire
-- carefully-gated bootstrap flow. Fix: block p_assignment_type='regular'
-- when p_profile_id = auth.uid() -- an admin must go through the request
-- + (ordinary or bootstrap) approval path to acquire their OWN primary
-- court, exactly like anyone else. Assigning a DIFFERENT profile a
-- 'regular' court, and self-assigning acting/relief/other to themselves,
-- are both unaffected -- neither is the self-approval scenario the
-- bootstrap exception exists to gate.
-- ============================================================================

create or replace function public.submit_magistrate_court_request(
  p_court_id uuid,
  p_staff_id text default null,
  p_note text default null
)
returns public.magistrate_court_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.magistrate_court_requests;
  v_court_active boolean;
begin
  if not (select public.is_magistrate() or public.is_admin()) then
    raise exception 'Only a magistrate or administrator account may request a court assignment';
  end if;

  select is_active into v_court_active from public.courts where id = p_court_id;
  if not coalesce(v_court_active, false) then
    raise exception 'This court is not currently active';
  end if;

  if exists (
    select 1 from public.magistrate_courts
    where profile_id = (select auth.uid())
      and court_id = p_court_id
      and ended_at is null
  ) then
    raise exception 'You already hold an active assignment to this court';
  end if;

  if (select public.court_has_active_primary_magistrate(p_court_id)) then
    raise exception 'This court already has an active primary magistrate assigned';
  end if;

  begin
    insert into public.magistrate_court_requests (profile_id, court_id, staff_id, note)
    values (auth.uid(), p_court_id, nullif(trim(p_staff_id), ''), nullif(trim(p_note), ''))
    returning * into v_result;
  exception when unique_violation then
    raise exception 'You already have a pending request for this court';
  end;

  return v_result;
end;
$$;

comment on function public.submit_magistrate_court_request(uuid, text, text) is
  'Lets an authenticated magistrate OR administrator (an Admin may also be a sitting magistrate -- 0052''s own precedent) request a primary court assignment. Rejects an inactive court, a court the caller already holds, a court with an existing active primary magistrate, and a duplicate pending request. Submitting a request never itself grants approval -- decide_magistrate_court_request() unconditionally blocks self-approval regardless of who submitted; only the separately-gated bootstrap exception (0107) can approve an administrator''s own request, and only under its own independent conditions.';

-- ----------------------------------------------------------------------------
-- admin_assign_magistrate_court() -- close the self-assign-'regular'
-- backdoor described above.
-- ----------------------------------------------------------------------------

create or replace function public.admin_assign_magistrate_court(
  p_profile_id uuid,
  p_court_id uuid,
  p_assignment_type text default 'regular'
)
returns public.magistrate_courts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.magistrate_courts;
begin
  if not (select public.is_admin()) then
    raise exception 'Only a Court Assignment Administrator may create a court assignment';
  end if;

  if p_assignment_type not in ('regular', 'acting', 'relief', 'other') then
    raise exception 'Invalid assignment type: %', p_assignment_type;
  end if;

  if p_assignment_type = 'regular' and p_profile_id = (select auth.uid()) then
    raise exception 'An administrator cannot directly self-assign a primary court. Submit a court assignment request and have another administrator approve it, or -- only if you are the sole active administrator -- use the explicit bootstrap self-approval exception.';
  end if;

  begin
    insert into public.magistrate_courts (profile_id, court_id, assignment_type)
    values (p_profile_id, p_court_id, p_assignment_type)
    returning * into v_result;
  exception
    when unique_violation then
      raise exception 'This profile already has an active assignment to this court, or this court already has an active primary magistrate assignment.';
  end;

  return v_result;
end;
$$;

comment on function public.admin_assign_magistrate_court(uuid, uuid, text) is
  'Admin-only (Court Assignment Administrator). Creates a magistrate_courts assignment for any profile at any active court. Blocks a ''regular'' assignment where p_profile_id equals the caller (0110) -- an administrator must go through the request/approval path (ordinary or the explicit sole-administrator bootstrap exception) to acquire their OWN primary court, never a silent direct self-assignment. Assigning a DIFFERENT profile a ''regular'' court, and self-assigning acting/relief/other, are both unaffected. The sole path for assignment_type IN (''acting'',''relief'',''other'') -- exempt from the 0105 primary-exclusivity trigger by construction.';
