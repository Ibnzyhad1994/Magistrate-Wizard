-- ============================================================================
-- 0107_magistrate_court_request_rpcs.sql
--
-- submit/cancel/decide/bootstrap-self-approve for magistrate_court_requests,
-- mirroring decide_clerk_access_request() (0089) in structure: SELECT ...
-- FOR UPDATE row locking, idempotent on already-decided requests, approval
-- and the resulting magistrate_courts row created in the SAME transaction
-- so the two can never drift out of sync.
-- ============================================================================

create type public.magistrate_court_decision as enum ('approved', 'rejected');

-- ----------------------------------------------------------------------------
-- 0. court_has_active_primary_magistrate(court_id) -- the one shared
--    boolean primitive behind "derived availability": true if the court
--    currently has an active assignment_type='regular' magistrate,
--    without ever disclosing WHO. SECURITY DEFINER: callers (including
--    anon signup callers, via 0109's list_active_courts_for_magistrate_signup())
--    must be able to evaluate this regardless of their own visibility
--    into magistrate_courts, which is self-or-admin under ordinary RLS.
--    Defined here, ahead of 0109, because submit_magistrate_court_request()
--    below needs it immediately.
-- ----------------------------------------------------------------------------

create or replace function public.court_has_active_primary_magistrate(p_court_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.magistrate_courts
    where court_id = p_court_id
      and assignment_type = 'regular'
      and ended_at is null
  );
$$;

comment on function public.court_has_active_primary_magistrate(uuid) is
  'True if the given court currently has an active (ended_at IS NULL) assignment_type=''regular'' magistrate_courts row, for ANY magistrate -- never discloses identity, only occupancy. The shared boolean primitive behind "derived availability" for both signup-time and self-service court pickers (0109) and the request/approval RPCs in this migration. SECURITY DEFINER: magistrate_courts SELECT RLS is self-or-admin, so a SECURITY INVOKER version would incorrectly return false for any court the caller doesn''t already have visibility into.';

grant execute on function public.court_has_active_primary_magistrate(uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1. submit_magistrate_court_request(court_id, staff_id, note)
-- ----------------------------------------------------------------------------

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
  if not (select public.is_magistrate()) then
    raise exception 'Only a magistrate account may request a court assignment';
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
  'Lets an authenticated magistrate request a primary court assignment. Rejects an inactive court, a court the caller already holds, a court with an existing active primary magistrate, and a duplicate pending request (partial unique index, caught and re-raised as a clear message).';

grant execute on function public.submit_magistrate_court_request(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. cancel_magistrate_court_request(request_id)
-- ----------------------------------------------------------------------------

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
    and profile_id = (select auth.uid())
    and status = 'pending'
  returning * into v_result;

  if v_result.id is null then
    raise exception 'This request cannot be cancelled (not found, not yours, or no longer pending)';
  end if;

  return v_result;
end;
$$;

comment on function public.cancel_magistrate_court_request(uuid) is
  'Lets an authenticated magistrate cancel exactly one of their OWN still-pending requests. No effect on any other request or on any already-approved assignment.';

grant execute on function public.cancel_magistrate_court_request(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. decide_magistrate_court_request(request_id, decision, rejection_reason)
--
-- The ordinary Court Assignment Administrator decision path.
-- UNCONDITIONALLY blocks self-approval -- this function is never the
-- bootstrap path, regardless of how many administrators exist. Approval
-- inserts into magistrate_courts FIRST; only marks the request 'approved'
-- if that insert actually succeeds (the 0105 exclusivity trigger is the
-- final race-safe authority -- a concurrent conflict surfaces here as a
-- caught unique_violation, re-raised as a clean message, and the request
-- is left exactly as it was: still pending, never falsely marked approved).
-- ----------------------------------------------------------------------------

create or replace function public.decide_magistrate_court_request(
  p_request_id uuid,
  p_decision public.magistrate_court_decision,
  p_rejection_reason text default null
)
returns public.magistrate_court_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.magistrate_court_requests;
  v_now timestamptz := now();
begin
  select * into v_request
  from public.magistrate_court_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'Court assignment request not found';
  end if;

  if v_request.status in ('approved', 'rejected') then
    return v_request;
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request is no longer pending (status: %)', v_request.status;
  end if;

  if not (select public.is_admin()) then
    raise exception 'You are not currently authorized to review court assignment requests';
  end if;

  if v_request.profile_id = (select auth.uid()) then
    raise exception 'An administrator may not approve their own court assignment request. Ask another Court Assignment Administrator to review it, or -- only if you are the sole active administrator -- use the explicit bootstrap self-approval exception.';
  end if;

  if p_decision = 'approved' then
    begin
      insert into public.magistrate_courts (profile_id, court_id, assignment_type, started_at)
      values (v_request.profile_id, v_request.court_id, 'regular', v_now)
      on conflict (profile_id, court_id) where ended_at is null do nothing;
    exception when unique_violation then
      raise exception 'This court already has an active primary magistrate assignment -- cannot approve.';
    end;
    -- ON CONFLICT (profile_id, court_id) WHERE ended_at IS NULL DO NOTHING
    -- above (same-profile duplicate, should not normally happen given the
    -- pending-request uniqueness index) simply leaves the existing
    -- assignment as current -- treated as success, matching
    -- decide_clerk_access_request()'s equivalent idempotency guard.

    update public.magistrate_court_requests
    set status = 'approved',
        reviewed_at = v_now,
        reviewed_by = (select auth.uid()),
        rejection_reason = null,
        approval_kind = 'ordinary'
    where id = p_request_id
    returning * into v_request;
  else
    update public.magistrate_court_requests
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

comment on function public.decide_magistrate_court_request(uuid, public.magistrate_court_decision, text) is
  'Atomically approves or rejects a pending magistrate_court_requests row. Requires is_admin() (Court Assignment Administrator). UNCONDITIONALLY rejects self-approval (profile_id = auth.uid()) -- this is never the bootstrap path; see admin_bootstrap_self_approve_magistrate_court_request() for that explicit, separately-audited exception. Approval creates the active magistrate_courts assignment in the SAME transaction, only marking the request approved if that insert actually succeeds -- a concurrent exclusivity conflict (0105) is caught and re-raised as a clean message, leaving the request genuinely still pending. Idempotent: a call against an already-decided request returns that decision unchanged.';

grant execute on function public.decide_magistrate_court_request(uuid, public.magistrate_court_decision, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. admin_bootstrap_self_approve_magistrate_court_request(request_id, reason)
--
-- The sole-administrator self-approval exception. Structurally separate
-- from decide_magistrate_court_request() (never a flag/parameter on it) --
-- misuse requires deliberately calling this differently-named function.
-- Never automatic: requires a caller-supplied, non-empty reason, and a
-- recent-authentication proxy (JWT iat within the last 5 minutes -- the
-- client re-authenticates via signInWithPassword immediately before
-- calling this, which reissues the token with a fresh iat; this is the
-- practical equivalent of "recent auth confirmation" available in a
-- Supabase-JWT context).
-- ----------------------------------------------------------------------------

create or replace function public.admin_bootstrap_self_approve_magistrate_court_request(
  p_request_id uuid,
  p_reason text
)
returns public.magistrate_court_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.magistrate_court_requests;
  v_now timestamptz := now();
  v_active_admin_count int;
  v_reason text;
  v_token_age_seconds numeric;
begin
  if not (select public.is_admin()) then
    raise exception 'Only a Court Assignment Administrator may use this exception';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'A reason is required to use the sole-administrator self-approval exception';
  end if;

  v_token_age_seconds := extract(epoch from now()) - (select (auth.jwt() ->> 'iat')::numeric);
  if v_token_age_seconds is null or v_token_age_seconds > 300 then
    raise exception 'This action requires a recent sign-in. Please re-enter your password and try again.';
  end if;

  select * into v_request
  from public.magistrate_court_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'Court assignment request not found';
  end if;

  if v_request.status in ('approved', 'rejected') then
    return v_request;
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request is no longer pending (status: %)', v_request.status;
  end if;

  if v_request.profile_id <> (select auth.uid()) then
    raise exception 'This exception is only for approving your own request -- use decide_magistrate_court_request() for other requests';
  end if;

  select count(*) into v_active_admin_count
  from public.profiles
  where role = 'admin' and is_active = true;

  if v_active_admin_count <> 1 then
    raise exception 'The sole-administrator exception is unavailable: % active administrators currently exist. Ask another administrator to review this request.', v_active_admin_count;
  end if;

  begin
    insert into public.magistrate_courts (profile_id, court_id, assignment_type, started_at)
    values (v_request.profile_id, v_request.court_id, 'regular', v_now)
    on conflict (profile_id, court_id) where ended_at is null do nothing;
  exception when unique_violation then
    raise exception 'This court already has an active primary magistrate assignment -- cannot approve.';
  end;

  update public.magistrate_court_requests
  set status = 'approved',
      reviewed_at = v_now,
      reviewed_by = (select auth.uid()),
      rejection_reason = null,
      approval_kind = 'bootstrap_self_approval'
  where id = p_request_id
  returning * into v_request;

  return v_request;
end;
$$;

comment on function public.admin_bootstrap_self_approve_magistrate_court_request(uuid, text) is
  'The explicit sole-administrator self-approval exception -- never automatic. Requires: caller is_admin(); the request belongs to the caller; exactly ONE active administrator exists system-wide; a non-empty reason; and a JWT issued within the last 5 minutes (recent-reauthentication proxy -- the client must call signInWithPassword again immediately before this RPC). Sets approval_kind=''bootstrap_self_approval'', permanently distinguishing it from an ordinary approval in both magistrate_court_requests and audit_log. Once a second active administrator exists, this exception is unreachable for anyone (the count check fails) -- ordinary self-approval is never permitted regardless.';

grant execute on function public.admin_bootstrap_self_approve_magistrate_court_request(uuid, text) to authenticated;
