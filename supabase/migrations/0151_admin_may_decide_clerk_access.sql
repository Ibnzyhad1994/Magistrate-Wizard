-- ============================================================================
-- 0151_admin_may_decide_clerk_access.sql
--
-- Clerk Access showed every pending request to an administrator (SELECT
-- RLS has an is_admin() branch since 0088) but Approve/Reject called
-- decide_clerk_access_request(), which only allowed a sitting magistrate
-- via can_manage_clerk_access(). Revoke already allowed is_admin(); 0092
-- even described admin action as existing. This makes decide match that.
--
-- court_has_no_clerk_approver() is unchanged: it still means "no sitting
-- magistrate can review", so Unresolved still lists those courts. An
-- administrator may now approve or reject there instead of only seating
-- a magistrate first.
-- ============================================================================

create or replace function public.can_manage_clerk_access(p_court_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select public.is_admin()) or exists (
    select 1 from public.magistrate_courts mc
    where mc.court_id = p_court_id
      and mc.profile_id = auth.uid()
      and mc.ended_at is null
      and (
        mc.can_manage_clerks = true
        or (
          select count(*) from public.magistrate_courts mc2
          where mc2.court_id = p_court_id and mc2.ended_at is null
        ) = 1
        or (
          mc.assignment_type = 'regular'
          and (
            select count(*) from public.magistrate_courts mc3
            where mc3.court_id = p_court_id
              and mc3.ended_at is null
              and mc3.assignment_type = 'regular'
          ) = 1
        )
      )
  );
$$;

comment on function public.can_manage_clerk_access(uuid) is
  'True if the caller may review Clerk access requests for this court: a Court Assignment Administrator (any court), or a currently assigned magistrate who is flagged can_manage_clerks, the sole sitting of any type, or the unique current primary (regular) even when acting/relief also sit. SECURITY DEFINER so inner counts see every current row.';

create or replace function public.decide_clerk_access_request(
  p_request_id uuid,
  p_decision public.clerk_access_decision,
  p_rejection_reason text default null
)
returns public.clerk_access_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.clerk_access_requests;
  v_now timestamptz := now();
begin
  select * into v_request
  from public.clerk_access_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'Access request not found';
  end if;

  if v_request.status in ('approved', 'rejected') then
    return v_request;
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request is no longer pending (status: %)', v_request.status;
  end if;

  if not (
    (select public.can_manage_clerk_access(v_request.court_id))
    or (select public.is_admin())
  ) then
    raise exception 'You are not currently authorized to review access requests for this court';
  end if;

  if p_decision = 'approved' then
    update public.clerk_access_requests
    set status = 'approved',
        reviewed_at = v_now,
        reviewed_by = (select auth.uid()),
        rejection_reason = null
    where id = p_request_id
    returning * into v_request;

    insert into public.clerk_courts (profile_id, court_id, approved_by, started_at)
    values (v_request.profile_id, v_request.court_id, (select auth.uid()), v_now)
    on conflict (profile_id, court_id) where ended_at is null do nothing;
  else
    update public.clerk_access_requests
    set status = 'rejected',
        reviewed_at = v_now,
        reviewed_by = (select auth.uid()),
        rejection_reason = nullif(trim(coalesce(p_rejection_reason, '')), '')
    where id = p_request_id
    returning * into v_request;
  end if;

  return v_request;
end;
$$;

comment on function public.decide_clerk_access_request(uuid, public.clerk_access_decision, text) is
  'Atomically approves or rejects a pending clerk_access_requests row. Approval also creates the active clerk_courts assignment in the same transaction. Authorized sitting magistrate (can_manage_clerk_access) or Court Assignment Administrator. Idempotent on already-decided rows.';

revoke all on function public.decide_clerk_access_request(uuid, public.clerk_access_decision, text) from public, anon;
grant execute on function public.decide_clerk_access_request(uuid, public.clerk_access_decision, text) to authenticated;
