-- 0139_docket_capacity_matches_board.sql
--
-- The Docket week strip's "1/10" and the day list under it used different
-- predicates: capacity counted every personal categorized event across all
-- courts and ignored the bin; the list scoped by court, hid binned matters,
-- and could still AND leftover Next-date chips. Align the snapshot with the
-- board's court + live-matter rules, count distinct files (not event rows),
-- and ignore p_next_date when a calendar day is selected.

-- ----------------------------------------------------------------------------
-- 1. get_docket_capacity_snapshot — court scope, bin, distinct matters
-- ----------------------------------------------------------------------------

drop function if exists public.get_docket_capacity_snapshot(date, uuid);
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
  status text
)
language sql
stable
security invoker
set search_path = public
as $$
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
    end as status
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
  'Per-category capacity for the calling magistrate on one date. 0139: counts distinct live matters (deleted_at is null), optionally scoped to p_court_id so the week strip matches the Docket heading. Still personal — only events you preside, scheduled or completed, in a configured category.';

-- ----------------------------------------------------------------------------
-- 2. list_docket_matters — skip next-date buckets when a day is selected
-- ----------------------------------------------------------------------------

drop function if exists public.list_docket_matters(text, integer, text[], text[], text[], text[], text[], date, uuid);

create function public.list_docket_matters(
  p_query text default '',
  p_limit integer default 100,
  p_procedure_stages text[] default null,
  p_custody text[] default null,
  p_disclosure text[] default null,
  p_trial text[] default null,
  p_next_date text[] default null,
  p_exact_date date default null,
  p_court_id uuid default null
)
returns table (
  id uuid,
  case_number text,
  matter_title text,
  status docket_matter_status,
  charge_or_issue text,
  cover_image_path text,
  court_id uuid,
  district_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  court_name text,
  arraignment_status text,
  custody_status text,
  disclosure_status text,
  trial_status text,
  ruling_status text,
  judgment_status text,
  sentence_status text,
  appeal_status text,
  outcome_status text,
  procedure_stage text,
  next_appearance date,
  can_edit boolean,
  has_ruling_document boolean,
  has_judgment_document boolean,
  appearance_status text,
  appearance_stage text,
  appearance_outcome text,
  category_id uuid,
  category_name text,
  category_other text,
  rank real,
  headline text
)
language sql
stable
security invoker
set search_path = public
as $$
  with board as (
    select
      dm.id,
      dm.case_number,
      dm.matter_title,
      dm.status,
      dm.charge_or_issue,
      dm.cover_image_path,
      dm.court_id,
      dm.district_id,
      dm.created_at,
      dm.updated_at,
      c.name as court_name,
      dm.arraignment_status,
      dm.custody_status,
      dm.disclosure_status,
      dm.trial_status,
      dm.ruling_status,
      dm.judgment_status,
      dm.sentence_status,
      dm.appeal_status,
      dm.outcome_status,
      dm.procedure_stage,
      (
        select min(e.scheduled_date)
        from public.docket_events e
        where e.docket_matter_id = dm.id
          and e.event_status = 'scheduled'
          and e.scheduled_date >= current_date
      ) as next_appearance,
      public.can_edit_docket_matter(dm.id) as can_edit,
      exists (
        select 1 from public.documents d
        where d.entity_type = 'docket_matter' and d.entity_id = dm.id and d.purpose = 'ruling'
      ) as has_ruling_document,
      exists (
        select 1 from public.documents d
        where d.entity_type = 'docket_matter' and d.entity_id = dm.id and d.purpose = 'judgment'
      ) as has_judgment_document,
      appear.event_status as appearance_status,
      appear.stage_at_event as appearance_stage,
      appear.outcome_at_event as appearance_outcome,
      dm.category_id,
      cat.name as category_name,
      dm.category_other,
      case
        when btrim(coalesce(p_query, '')) = '' then 0::real
        else ts_rank(dm.search_vector, websearch_to_tsquery('english', p_query))
      end as rank,
      case
        when btrim(coalesce(p_query, '')) = '' then null::text
        else ts_headline(
          'english',
          coalesce(dm.orders_summary, dm.charge_or_issue, ''),
          websearch_to_tsquery('english', p_query),
          'MaxFragments=2, MaxWords=30, MinWords=10'
        )
      end as headline
    from public.docket_matters dm
    left join public.courts c on c.id = dm.court_id
    left join public.docket_matter_categories cat on cat.id = dm.category_id
    left join lateral (
      select e.event_status, e.stage_at_event, e.outcome_at_event
      from public.docket_events e
      where e.docket_matter_id = dm.id
        and p_exact_date is not null
        and e.scheduled_date = p_exact_date
        and e.event_status <> 'entered_in_error'
      order by e.created_at desc
      limit 1
    ) appear on true
    where dm.deleted_at is null
      and (
        btrim(coalesce(p_query, '')) = ''
        or dm.search_vector @@ websearch_to_tsquery('english', p_query)
      )
      and (p_court_id is null or dm.court_id = p_court_id)
      and (
        p_procedure_stages is null
        or cardinality(p_procedure_stages) = 0
        or dm.procedure_stage = any (p_procedure_stages)
      )
      and (
        p_custody is null
        or cardinality(p_custody) = 0
        or dm.custody_status = any (p_custody)
      )
      and (
        p_disclosure is null
        or cardinality(p_disclosure) = 0
        or dm.disclosure_status = any (p_disclosure)
      )
      and (
        p_trial is null
        or cardinality(p_trial) = 0
        or dm.trial_status = any (p_trial)
      )
      and (
        p_exact_date is null
        or exists (
          select 1 from public.docket_events e2
          where e2.docket_matter_id = dm.id
            and e2.scheduled_date = p_exact_date
            and e2.event_status <> 'entered_in_error'
        )
      )
  )
  select
    board.id, board.case_number, board.matter_title, board.status, board.charge_or_issue,
    board.cover_image_path, board.court_id, board.district_id, board.created_at, board.updated_at,
    board.court_name, board.arraignment_status, board.custody_status, board.disclosure_status,
    board.trial_status, board.ruling_status, board.judgment_status, board.sentence_status,
    board.appeal_status, board.outcome_status, board.procedure_stage, board.next_appearance, board.can_edit,
    board.has_ruling_document, board.has_judgment_document, board.appearance_status,
    board.appearance_stage, board.appearance_outcome, board.category_id, board.category_name,
    board.category_other, board.rank, board.headline
  from board
  where
    -- 0139: a selected calendar day is the date model. Next-date chips
    -- (today / upcoming / no_date) only apply on All Matters.
    p_exact_date is not null
    or p_next_date is null
    or cardinality(p_next_date) = 0
    or (
      ('today' = any (p_next_date) and board.next_appearance = current_date)
      or ('upcoming' = any (p_next_date) and board.next_appearance > current_date)
      or ('no_date' = any (p_next_date) and board.next_appearance is null)
    )
  order by board.rank desc, board.updated_at desc
  limit p_limit;
$$;

grant execute on function public.list_docket_matters(text, integer, text[], text[], text[], text[], text[], date, uuid) to authenticated;
revoke execute on function public.list_docket_matters(text, integer, text[], text[], text[], text[], text[], date, uuid) from public;

comment on function public.list_docket_matters(text, integer, text[], text[], text[], text[], text[], date, uuid) is
  'Docket spreadsheet/tiles list. SECURITY INVOKER. 0120 excludes binned rows; 0131 adds outcome_status; 0139 ignores p_next_date when p_exact_date is set so the calendar day and the list cannot fight.';
