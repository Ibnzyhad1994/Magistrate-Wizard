-- ============================================================================
-- 0153_admin_may_cancel_pending_court_requests.sql
--
-- Pending clerk and magistrate requests could only be cancelled by the
-- requester. Administrators already reject (decide) and, after 0151,
-- approve clerk access / revoke clerk sittings. They still could not
-- close a pending row as cancelled. This lets is_admin() cancel either
-- kind of still-pending request, matching the rest of the admin roster.
-- ============================================================================

create or replace function public.cancel_clerk_access_request(p_request_id uuid)
returns public.clerk_access_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.clerk_access_requests;
begin
  update public.clerk_access_requests
  set status = 'cancelled', cancelled_at = now()
  where id = p_request_id
    and status = 'pending'
    and (
      profile_id = (select auth.uid())
      or (select public.is_admin())
    )
  returning * into v_result;

  if v_result.id is null then
    raise exception 'This request cannot be cancelled (not found, not yours, or no longer pending)';
  end if;

  return v_result;
end;
$$;

comment on function public.cancel_clerk_access_request(uuid) is
  'Cancels one still-pending clerk access request. The clerk who owns it, or a Court Assignment Administrator, may call this. No effect on any other request or on an already-approved clerk_courts row.';

revoke all on function public.cancel_clerk_access_request(uuid) from public, anon;
grant execute on function public.cancel_clerk_access_request(uuid) to authenticated;

create or replace function public.cancel_magistrate_court_request(p_request_id uuid)
returns public.magistrate_court_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.magistrate_court_requests;
begin
  update public.magistrate_court_requests
  set status = 'cancelled', cancelled_at = now()
  where id = p_request_id
    and status = 'pending'
    and (
      profile_id = (select auth.uid())
      or (select public.is_admin())
    )
  returning * into v_result;

  if v_result.id is null then
    raise exception 'This request cannot be cancelled (not found, not yours, or no longer pending)';
  end if;

  return v_result;
end;
$$;

comment on function public.cancel_magistrate_court_request(uuid) is
  'Cancels one still-pending magistrate court request. The requester, or a Court Assignment Administrator, may call this. No effect on any other request or on an already-approved assignment.';

revoke all on function public.cancel_magistrate_court_request(uuid) from public, anon;
grant execute on function public.cancel_magistrate_court_request(uuid) to authenticated;
