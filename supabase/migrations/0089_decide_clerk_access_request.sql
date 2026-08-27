-- ============================================================================
-- 0089_decide_clerk_access_request.sql
--
-- The single, atomic, idempotent decision point for a clerk access
-- request. Approval creates the clerk_courts assignment and rejection
-- does not -- both are recorded in the SAME transaction as the request's
-- own status change, so the two can never drift out of sync (the
-- specific failure mode the feature spec calls out explicitly).
--
-- Idempotent by construction: a request already in a terminal state
-- ('approved'/'rejected') is returned UNCHANGED on a repeat call rather
-- than re-processed or errored -- "the first valid completed decision
-- controls the request" (only revoke_clerk_court_access, a separate
-- explicit action, can undo an approval afterward). `select ... for
-- update` locks the row for the duration of the transaction, so two
-- concurrent decide calls on the same request serialize: the second
-- always observes the first's completed decision and takes the
-- idempotent early-return path, never a duplicate assignment.
-- ============================================================================

create type public.clerk_access_decision as enum ('approved', 'rejected');

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

  -- Idempotency: already decided -- return the existing decision as-is.
  if v_request.status in ('approved', 'rejected') then
    return v_request;
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request is no longer pending (status: %)', v_request.status;
  end if;

  -- Re-verify authorization here, using auth.uid() directly -- never a
  -- caller-supplied magistrate id -- even though the request was only
  -- ever visible to an authorized magistrate via RLS (0088). A magistrate
  -- whose court authorization changed between viewing and deciding must
  -- not be able to complete a decision they are no longer authorized for.
  if not (select public.can_manage_clerk_access(v_request.court_id)) then
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

    -- Defensive: if a current assignment already exists for this exact
    -- (clerk, court) pair (should not normally happen given the pending-
    -- request uniqueness index, but this keeps the operation genuinely
    -- idempotent under any concurrent-approval edge case), do not error
    -- or duplicate -- just leave the existing assignment as the current one.
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
  'Atomically approves or rejects a pending clerk_access_requests row. Approval also creates the active clerk_courts assignment in the same transaction; rejection creates no assignment. Re-verifies can_manage_clerk_access(court_id) against auth.uid() at decision time (not merely at the time the request became visible). Idempotent: a call against an already-decided request returns that existing decision unchanged, so a duplicate submission (double-click, retry, concurrent call) can never create a duplicate clerk_courts row or overwrite a completed decision. Only a subsequent, separate revoke_clerk_court_access() call can end an approval afterward.';

grant execute on function public.decide_clerk_access_request(uuid, public.clerk_access_decision, text) to authenticated;

-- ----------------------------------------------------------------------------
-- revoke_clerk_court_access(assignment_id, reason) -- ends one specific,
-- currently-active clerk court assignment. Idempotent (ending an already-
-- ended assignment is a no-op, not an error) so a retried/duplicate
-- revoke click cannot raise a confusing error. Authorized magistrate for
-- that exact court, or admin (exceptional correction).
-- ----------------------------------------------------------------------------

create or replace function public.revoke_clerk_court_access(
  p_assignment_id uuid,
  p_reason text default null
)
returns public.clerk_courts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.clerk_courts;
begin
  select * into v_row
  from public.clerk_courts
  where id = p_assignment_id
  for update;

  if v_row.id is null then
    raise exception 'Clerk court assignment not found';
  end if;

  if v_row.ended_at is not null then
    return v_row;
  end if;

  if not ((select public.can_manage_clerk_access(v_row.court_id)) or (select public.is_admin())) then
    raise exception 'You are not currently authorized to revoke clerk access for this court';
  end if;

  update public.clerk_courts
  set ended_at = now(),
      end_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_assignment_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.revoke_clerk_court_access(uuid, text) is
  'Ends exactly one clerk''s active court assignment (ended_at set; ended_by is force-set by protect_clerk_court_history()''s trigger, 0087, not trusted from any input here). Never deletes the row. Idempotent: revoking an already-ended assignment returns it unchanged. Revoking one court has no effect on any other court the same clerk is separately approved for.';

grant execute on function public.revoke_clerk_court_access(uuid, text) to authenticated;
