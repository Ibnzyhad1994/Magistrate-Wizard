-- 0147_docket_calendar_total_matters.sql
--
-- Docket calendar tiles already show per-classification capacity (the
-- visible 1/10 is the busiest configured bucket, often Criminal trial).
-- Magistrates also need the full day's load at a glance: distinct live
-- files they preside that day, any classification, any workflow stage,
-- including uncategorized sittings. Add total_matters_count to the
-- existing snapshot so each tile can show that figure beside the
-- unchanged category fraction. Not a new capacity cap.

drop function if exists public.get_docket_capacity_snapshot(date, uuid, uuid);

create function public.get_docket_capacity_snapshot(
  p_scheduled_date date,
  p_category_id uuid default null,
  p_court_id uuid default null
)
returns table(
  category_id uuid,
  category_name text,
  daily_capacity integer,
  scheduled_count bigint,
  status text,
  total_matters_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with day_total as (
    select count(distinct e.docket_matter_id) as total_matters_count
    from public.docket_events e
    join public.docket_matters dm on dm.id = e.docket_matter_id
    where e.scheduled_date = p_scheduled_date
      and e.event_status in ('scheduled', 'completed')
      and e.presiding_magistrate_id = (select auth.uid())
      and dm.deleted_at is null
      and (p_court_id is null or dm.court_id = p_court_id)
  )
  select
    c.id as category_id,
    c.name as category_name,
    s.daily_capacity,
    coalesce(ev.scheduled_count, 0) as scheduled_count,
    case
      when s.daily_capacity is null then 'not_set'
      when coalesce(ev.scheduled_count, 0) > s.daily_capacity then 'over_capacity'
      when coalesce(ev.scheduled_count, 0) = s.daily_capacity then 'full'
      else 'available'
    end as status,
    coalesce((select dt.total_matters_count from day_total dt), 0) as total_matters_count
  from public.docket_matter_categories c
  left join public.docket_capacity_settings s
    on s.category_id = c.id and s.owner_id = (select auth.uid())
  left join lateral (
    select count(distinct e.docket_matter_id) as scheduled_count
    from public.docket_events e
    join public.docket_matters dm on dm.id = e.docket_matter_id
    where e.category_id = c.id
      and e.scheduled_date = p_scheduled_date
      and e.event_status in ('scheduled', 'completed')
      and e.presiding_magistrate_id = (select auth.uid())
      and dm.deleted_at is null
      and (p_court_id is null or dm.court_id = p_court_id)
  ) ev on true
  where p_category_id is null or c.id = p_category_id
  order by c.sort_order;
$$;

grant execute on function public.get_docket_capacity_snapshot(date, uuid, uuid) to authenticated;
revoke execute on function public.get_docket_capacity_snapshot(date, uuid, uuid) from public;

comment on function public.get_docket_capacity_snapshot(date, uuid, uuid) is
  'Per-category capacity for the calling magistrate on one date, plus total_matters_count: distinct live files they preside that day (scheduled or completed), any classification including none, any workflow stage. Optional p_court_id applies to both counts. Tiles omit p_court_id so they span every court the caller sits.';
