-- ============================================================================
-- 0082_docket_report_category.sql
--
-- Adds category_id/category_name to get_daily_docket_report_data (0080) --
-- needed for the Daily Progress Report's per-category summary (e.g.
-- "Trials: 5, Maintenance: 3"). Everything else about the function is
-- unchanged; this is purely an additional output column, so it needs a
-- DROP + CREATE (return signature changed), not a CREATE OR REPLACE.
-- ============================================================================

drop function if exists public.get_daily_docket_report_data(date);

create function public.get_daily_docket_report_data(p_date date)
returns table (
  matter_id uuid,
  case_number text,
  matter_title text,
  charge_or_issue text,
  status docket_matter_status,
  court_name text,
  district_name text,
  custody_status text,
  procedure_stage text,
  appearance_status text,
  appearance_stage text,
  category_id uuid,
  category_name text,
  witnesses_called integer,
  witnesses_completed integer,
  witnesses_partly_heard integer,
  witnesses_remaining integer,
  outcome_at_event text,
  notes text,
  orders_summary text,
  outcome text,
  next_appearance date,
  parties jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    dm.id as matter_id,
    dm.case_number,
    dm.matter_title,
    dm.charge_or_issue,
    dm.status,
    c.name as court_name,
    md.name as district_name,
    dm.custody_status,
    dm.procedure_stage,
    appear.event_status as appearance_status,
    appear.stage_at_event as appearance_stage,
    appear.category_id,
    cat.name as category_name,
    appear.witnesses_called,
    appear.witnesses_completed,
    appear.witnesses_partly_heard,
    appear.witnesses_remaining,
    appear.outcome_at_event,
    appear.notes,
    dm.orders_summary,
    dm.outcome,
    (
      select min(e.scheduled_date)
      from public.docket_events e
      where e.docket_matter_id = dm.id
        and e.event_status = 'scheduled'
        and e.scheduled_date >= current_date
    ) as next_appearance,
    (
      select coalesce(jsonb_agg(jsonb_build_object('full_name', p.full_name, 'role', p.role) order by p.role, p.full_name), '[]'::jsonb)
      from public.docket_matter_parties p
      where p.docket_matter_id = dm.id and p.party_status = 'active'
    ) as parties
  from public.docket_matters dm
  left join public.courts c on c.id = dm.court_id
  left join public.magisterial_districts md on md.id = dm.district_id
  left join lateral (
    select e.event_status, e.stage_at_event, e.category_id, e.witnesses_called, e.witnesses_completed,
           e.witnesses_partly_heard, e.witnesses_remaining, e.outcome_at_event, e.notes
    from public.docket_events e
    where e.docket_matter_id = dm.id
      and e.scheduled_date = p_date
      and e.event_status <> 'entered_in_error'
    order by e.created_at desc
    limit 1
  ) appear on true
  left join public.docket_matter_categories cat on cat.id = appear.category_id
  where exists (
    select 1 from public.docket_events e2
    where e2.docket_matter_id = dm.id
      and e2.scheduled_date = p_date
      and e2.event_status <> 'entered_in_error'
  )
  order by dm.case_number, dm.matter_title;
$$;

revoke execute on function public.get_daily_docket_report_data from public;
grant execute on function public.get_daily_docket_report_data to authenticated;

comment on function public.get_daily_docket_report_data(date) is
  'Single data source for the Daily Docket Progress Report PDF. SECURITY INVOKER -- restricted by the same docket_matters SELECT RLS (current Court assignment OR retained assignment OR active share) every other Docket view already uses; never an admin/service bypass. Matter selection uses the identical "any non-entered_in_error appearance on this exact date" rule as list_docket_matters'' p_exact_date (0080), so the report and the on-screen date-specific Docket always agree on which matters belong to a given day. category_id/category_name (0081) support the report''s per-category summary.';
