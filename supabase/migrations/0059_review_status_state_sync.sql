-- ============================================================================
-- 0059_review_status_state_sync.sql
--
-- Completes the §5 "audit all transitions, create a coherent state
-- machine" repair started in 0058. 0058 already made publish/reject
-- atomic (publish_case_law_import/publish_legislation_import,
-- reject_case_law_import/reject_legislation_import). This migration adds
-- the remaining non-terminal transitions (draft <-> needs_review <-> ready)
-- so a curator moving a draft through the review workflow keeps the
-- parent record and its linked import_jobs row in the SAME vocabulary in
-- lockstep, rather than only synchronizing at the two terminal states.
--
-- 'published' and reject/delete are deliberately NOT accepted by these
-- functions -- those already have dedicated, more specific RPCs (0058)
-- and routing them through two different code paths that could both set
-- 'published' would itself be a coherence risk.
-- ============================================================================
create or replace function public.set_case_law_review_status(p_case_law_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may change Case Law review status.';
  end if;

  if p_status not in ('draft', 'needs_review', 'ready') then
    raise exception 'set_case_law_review_status only accepts draft/needs_review/ready -- use publish_case_law_import or reject_case_law_import for other transitions.';
  end if;

  if not exists (select 1 from public.case_law where id = p_case_law_id) then
    raise exception 'Case Law record % not found.', p_case_law_id;
  end if;

  select import_job_id into v_job_id from public.case_law where id = p_case_law_id;

  update public.case_law set review_status = p_status where id = p_case_law_id;

  -- import_jobs.status has no 'draft' value (0055) -- only sync the job
  -- when the target status exists in both vocabularies.
  if v_job_id is not null and p_status in ('needs_review', 'ready') then
    update public.import_jobs set status = p_status where id = v_job_id;
  end if;
end;
$$;

create or replace function public.set_legislation_review_status(p_statute_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may change Legislation review status.';
  end if;

  if p_status not in ('draft', 'needs_review', 'ready') then
    raise exception 'set_legislation_review_status only accepts draft/needs_review/ready -- use publish_legislation_import or reject_legislation_import for other transitions.';
  end if;

  if not exists (select 1 from public.statutes where id = p_statute_id) then
    raise exception 'Legislation record % not found.', p_statute_id;
  end if;

  select import_job_id into v_job_id from public.statutes where id = p_statute_id;

  update public.statutes set review_status = p_status where id = p_statute_id;

  if v_job_id is not null and p_status in ('needs_review', 'ready') then
    update public.import_jobs set status = p_status where id = v_job_id;
  end if;
end;
$$;

revoke execute on function public.set_case_law_review_status from public;
revoke execute on function public.set_legislation_review_status from public;
grant execute on function public.set_case_law_review_status to authenticated;
grant execute on function public.set_legislation_review_status to authenticated;
