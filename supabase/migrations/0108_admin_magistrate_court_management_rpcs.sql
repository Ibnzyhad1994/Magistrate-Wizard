-- ============================================================================
-- 0108_admin_magistrate_court_management_rpcs.sql
--
-- admin_assign_magistrate_court() -- replaces the admin Court Assignments
-- page's raw `insert` with clean conflict handling, and is the sole path
-- for acting/relief/other assignments (exempt from the 0105 exclusivity
-- trigger by construction, since it only fires for assignment_type=
-- 'regular' -- so an acting/relief row can coexist with a regular one at
-- the same court, matching "acting and relief exceptions cannot be
-- created through ordinary self-service... require explicit
-- administrative authorization").
--
-- relinquish_magistrate_court() -- the single, audited path for BOTH
-- "magistrate relinquishes their own court" (self-service) and
-- "administrator ends an incorrect assignment" (admin-authorized),
-- exactly mirroring how revoke_clerk_court_access() (0089) already
-- serves both cases for clerks. Never touches docket_matters,
-- docket_matter_assignments, or clerk_courts -- by construction, nothing
-- here can copy, delete, or reassign Docket content or the clerk roster.
-- This is also the entire mechanism behind succession: once relinquished,
-- the court is available again (court_has_active_primary_magistrate()
-- returns false), and a successor's request going through the ordinary
-- decide_magistrate_court_request() (0107) creates a NEW magistrate_courts
-- row while the predecessor's ended row is preserved untouched. No
-- separate "succeed" RPC exists or is needed.
-- ============================================================================

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
  'Admin-only (Court Assignment Administrator). Creates a magistrate_courts assignment for any profile at any active court (check_court_active_for_assignment(), 0017, still enforces the active-court gate, including for admins). The sole path for assignment_type IN (''acting'',''relief'',''other'') -- these are exempt from the 0105 primary-exclusivity trigger by construction, so they may coexist with an existing ''regular'' assignment at the same court. Catches both the pre-existing same-(profile,court) unique index (0017) and the 0105 exclusivity trigger''s conflict as a single clean unique_violation, rather than a raw Postgres error reaching the client.';

grant execute on function public.admin_assign_magistrate_court(uuid, uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- relinquish_magistrate_court(assignment_id, reason)
-- ----------------------------------------------------------------------------

create or replace function public.relinquish_magistrate_court(
  p_assignment_id uuid,
  p_reason text default null
)
returns public.magistrate_courts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.magistrate_courts;
begin
  select * into v_row
  from public.magistrate_courts
  where id = p_assignment_id
  for update;

  if v_row.id is null then
    raise exception 'Court assignment not found';
  end if;

  if v_row.ended_at is not null then
    return v_row;
  end if;

  if not (v_row.profile_id = (select auth.uid()) or (select public.is_admin())) then
    raise exception 'You are not authorized to end this court assignment';
  end if;

  update public.magistrate_courts
  set ended_at = now(),
      end_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_assignment_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.relinquish_magistrate_court(uuid, text) is
  'Ends exactly one magistrate''s active court assignment (ended_at set; ended_by force-set by protect_magistrate_court_history()''s trigger, 0104, never trusted from any input here). Serves both "magistrate relinquishes their own court" (profile_id = auth.uid()) and "administrator ends an incorrect assignment" (is_admin()) -- the same function, distinguished only by who is calling, mirroring revoke_clerk_court_access() (0089). Never deletes the row, never touches docket_matters/docket_matter_assignments/clerk_courts -- the institutional Docket, retained/part-heard access, and the clerk roster are all completely untouched by this call. Idempotent: relinquishing an already-ended assignment returns it unchanged. Ending one court has no effect on any other court the same magistrate holds. The court becomes available for a successor the instant this commits (court_has_active_primary_magistrate() re-evaluates live) -- this IS how succession works; there is no separate succession RPC.';

grant execute on function public.relinquish_magistrate_court(uuid, text) to authenticated;
