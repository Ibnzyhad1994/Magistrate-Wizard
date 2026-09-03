-- 0124_scheduled_jobs.sql
--
-- Daily maintenance that does not send email:
--   * scheduled hearings whose Guyana date has passed become 'past'
--   * owners of stale judgment / personal case-law drafts are notified
--   * court staff are notified of tomorrow's scheduled hearings
-- Bin purge remains the 0120 hourly job.

do $$
declare
  cname text;
begin
  select con.conname
    into cname
  from pg_constraint con
  where con.conrelid = 'public.docket_events'::regclass
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%event_status%'
    and pg_get_constraintdef(con.oid) ilike '%scheduled%'
    and pg_get_constraintdef(con.oid) not ilike '%past%';
  if cname is not null then
    execute format('alter table public.docket_events drop constraint %I', cname);
  end if;
end $$;

alter table public.docket_events
  add constraint docket_events_event_status_check
  check (event_status in ('scheduled', 'completed', 'cancelled', 'entered_in_error', 'past'));

comment on column public.docket_events.event_status is
  'scheduled/completed/cancelled/entered_in_error/past. past means the Guyana sitting date elapsed while still scheduled; it is not a finding that the appearance occurred.';

create or replace function public.guyana_today()
returns date
language sql
stable
set search_path = public
as $$
  select (timezone('America/Guyana', now()))::date;
$$;

create or replace function public.mark_past_hearings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.docket_events
     set event_status = 'past'
   where event_status = 'scheduled'
     and scheduled_date < public.guyana_today();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.mark_past_hearings() is
  'Marks still-scheduled docket_events as past once the Guyana calendar date has elapsed.';

revoke all on function public.mark_past_hearings() from public, anon, authenticated;

create or replace function public.flag_stale_drafts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select id, owner_id, title
    from public.judgments
    where status = 'draft'
      and updated_at < now() - interval '90 days'
      and owner_id is not null
  loop
    perform public.notify_user(
      r.owner_id,
      'stale_draft',
      'A judgment draft is stale',
      coalesce(r.title, 'This draft has not been edited in 90 days.'),
      '/judgments/' || r.id::text
    );
    v_count := v_count + 1;
  end loop;

  for r in
    select id, owner_id, case_name
    from public.case_law
    where owner_id is not null
      and review_status in ('draft', 'needs_review')
      and updated_at < now() - interval '90 days'
  loop
    perform public.notify_user(
      r.owner_id,
      'stale_draft',
      'Case law research is stale',
      coalesce(r.case_name, 'This draft has not been edited in 90 days.'),
      '/case-law/' || r.id::text
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.flag_stale_drafts() from public, anon, authenticated;

create or replace function public.notify_tomorrows_hearings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  r record;
  v_tomorrow date := public.guyana_today() + 1;
begin
  for r in
    select
      de.id,
      de.docket_matter_id,
      dm.court_id,
      dm.case_number,
      dm.matter_title
    from public.docket_events de
    join public.docket_matters dm on dm.id = de.docket_matter_id
    where de.event_status = 'scheduled'
      and de.scheduled_date = v_tomorrow
      and dm.deleted_at is null
  loop
    perform public.notify_court_staff(
      r.court_id,
      'hearing_tomorrow',
      'Hearing tomorrow',
      coalesce(r.case_number || ' — ', '') || coalesce(r.matter_title, 'A matter is listed tomorrow.'),
      '/docket/' || r.docket_matter_id::text
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.notify_tomorrows_hearings() from public, anon, authenticated;

create or replace function public.run_scheduled_maintenance()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.mark_past_hearings();
  perform public.flag_stale_drafts();
  perform public.notify_tomorrows_hearings();
  if to_regprocedure('public.apply_data_retention()') is not null then
    perform public.apply_data_retention();
  end if;
  if to_regprocedure('public.dispatch_pending_webhooks()') is not null then
    perform public.dispatch_pending_webhooks();
  end if;
end;
$$;

comment on function public.run_scheduled_maintenance() is
  'Daily in-app maintenance: past hearings, stale-draft notices, tomorrow hearing notices. Email is not sent.';

revoke all on function public.run_scheduled_maintenance() from public, anon, authenticated;

do $cron$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'magistrate-wizard-daily-maintenance';
  perform cron.schedule(
    'magistrate-wizard-daily-maintenance',
    '0 6 * * *',
    'select public.run_scheduled_maintenance()'
  );
exception
  when others then
    raise notice 'pg_cron not scheduled for daily maintenance: %', sqlerrm;
end;
$cron$;
