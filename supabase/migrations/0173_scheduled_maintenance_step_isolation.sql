-- ============================================================================
-- 0173_scheduled_maintenance_step_isolation.sql
--
-- BE-16: one failing step skipped the whole day's maintenance, silently.
--
-- run_scheduled_maintenance() (0124) ran mark_past_hearings,
-- flag_stale_drafts, notify_tomorrows_hearings, apply_data_retention and
-- dispatch_pending_webhooks in one transaction with no exception handling.
-- One bad row or a missing dependency in any step rolled back every step:
-- no "Hearing tomorrow" notices, no past hearings marked, no retention for
-- that day, and the only trace was cron.job_run_details, which no admin
-- reads.
--
-- Now each step runs in its own subtransaction. A failing step is rolled
-- back on its own and the others still run and commit. Each failure is
-- recorded where it lasts and where an admin already looks:
--
--   * an in-app notification to every active admin (type
--     maintenance_failed, naming the step and the error, linking to the
--     Operations page); recipients can mark it read but not delete it;
--   * an audit_log row (table_name 'scheduled_maintenance', new_data with
--     the step, SQLSTATE, message and time), the append-only trail.
--
-- No email or push: an outbound channel is a separate decision. The cron job
-- itself still succeeds, so one bad step does not hide the others' work; a
-- WARNING names the failed steps in the job's log as well.
-- ============================================================================

-- 1. New notification kind --------------------------------------------------

alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (type in (
    'share_granted',
    'share_revoked',
    'judgment_final',
    'court_assigned',
    'court_ended',
    'clerk_request',
    'clerk_request_decided',
    'court_request',
    'court_request_decided',
    'account_type_corrected',
    'hearing_tomorrow',
    'stale_draft',
    'issue_report_decided',
    'docket_matter_binned',
    'docket_matter_purged',
    'maintenance_failed'
  ));

-- 2. Recording a failed step ---------------------------------------------------

create or replace function public.record_maintenance_failure(
  p_step text,
  p_sqlstate text,
  p_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
  values (
    null,
    'insert',
    'scheduled_maintenance',
    null,
    jsonb_build_object(
      'step', p_step,
      'ok', false,
      'sqlstate', p_sqlstate,
      'error', left(p_message, 2000),
      'failed_at', now()
    )
  );

  perform public.notify_admins(
    'maintenance_failed',
    'Scheduled maintenance step failed',
    'The daily step ' || p_step || ' failed and was skipped; the other steps still ran. Error: '
      || left(p_message, 500),
    -- One link per step: notify_user collapses same-type, same-link notices
    -- within 20 hours, and two steps failing in one run are two problems.
    '/admin/operations?maintenance=' || p_step
  );
end;
$$;

comment on function public.record_maintenance_failure(text, text, text) is
  'Records one failed run_scheduled_maintenance step (0173): an append-only audit_log row (table_name scheduled_maintenance) and a maintenance_failed notification to every active admin. Executable by no client role.';

revoke all on function public.record_maintenance_failure(text, text, text) from public, anon, authenticated;

-- 3. Each step on its own -------------------------------------------------------

create or replace function public.run_scheduled_maintenance()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  -- In run order. The last two are skipped when their migration is absent,
  -- as in 0124; a missing required step is a failure like any other.
  v_steps constant text[] := array[
    'mark_past_hearings',
    'flag_stale_drafts',
    'notify_tomorrows_hearings',
    'apply_data_retention',
    'dispatch_pending_webhooks'
  ];
  v_optional constant text[] := array['apply_data_retention', 'dispatch_pending_webhooks'];
  v_step text;
  v_sqlstate text;
  v_message text;
  v_failed text[] := array[]::text[];
begin
  foreach v_step in array v_steps loop
    if v_step = any (v_optional)
      and to_regprocedure('public.' || v_step || '()') is null then
      continue;
    end if;

    begin
      execute format('select public.%I()', v_step);
    exception when others then
      get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_message = message_text;
      v_failed := v_failed || v_step;
      -- Recording must never stop the remaining steps either.
      begin
        perform public.record_maintenance_failure(v_step, v_sqlstate, v_message);
      exception when others then
        raise warning 'run_scheduled_maintenance: could not record the failure of %: %',
          v_step, sqlerrm;
      end;
    end;
  end loop;

  if cardinality(v_failed) > 0 then
    raise warning 'run_scheduled_maintenance: step(s) failed and were skipped: %',
      array_to_string(v_failed, ', ');
  end if;
end;
$$;

comment on function public.run_scheduled_maintenance() is
  'Daily in-app maintenance: past hearings, stale-draft notices, tomorrow hearing notices, data retention, webhook dispatch. 0173: each step runs in its own subtransaction, so one failure no longer skips the rest; each failure is recorded by record_maintenance_failure (audit_log row and a notification to every active admin). Email is not sent.';

revoke all on function public.run_scheduled_maintenance() from public, anon, authenticated;
