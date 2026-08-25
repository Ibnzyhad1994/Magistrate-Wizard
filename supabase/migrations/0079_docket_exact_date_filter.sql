-- ============================================================================
-- 0079_docket_exact_date_filter.sql
--
-- Fixes the root cause of the Docket-vs-capacity-calendar mismatch: the
-- Docket board (list_docket_matters, 0070/0074) and the capacity calendar
-- (get_docket_capacity_snapshot, 0076) were two entirely disconnected
-- queries. Selecting a date on the calendar changed nothing about which
-- matters the board showed -- it always showed the magistrate's whole
-- accessible caseload, filtered only by search/procedure-stage/next_date-
-- BUCKET (today/upcoming/no_date), never by one exact date. So clicking
-- August 27, 28, 29... kept showing the same list, and a low capacity
-- count (matters missing a category) sat next to a full, date-unfiltered
-- table that looked like it disagreed with it.
--
-- This adds ONE new optional filter, p_exact_date, so the SAME
-- next_appearance value (0074: min(scheduled_date) from docket_events
-- where event_status='scheduled' and scheduled_date >= current_date) the
-- Next Date column already displays is now also filterable against --
-- no new date concept, no duplicate scheduling field. The frontend lifts
-- "selected calendar date" out of the capacity strip and passes it into
-- this same RPC the board already calls, so the list and the calendar
-- are finally reading the same underlying data for the same date.
-- ============================================================================

drop function if exists public.list_docket_matters(text, integer, text[], text[], text[], text[], text[]);

create function public.list_docket_matters(
  p_query text default '',
  p_limit integer default 100,
  p_procedure_stages text[] default null,
  p_custody text[] default null,
  p_disclosure text[] default null,
  p_trial text[] default null,
  p_next_date text[] default null,
  p_exact_date date default null
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
  procedure_stage text,
  next_appearance date,
  can_edit boolean,
  has_ruling_document boolean,
  has_judgment_document boolean,
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
    where (
        btrim(coalesce(p_query, '')) = ''
        or dm.search_vector @@ websearch_to_tsquery('english', p_query)
      )
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
  )
  select
    board.id,
    board.case_number,
    board.matter_title,
    board.status,
    board.charge_or_issue,
    board.cover_image_path,
    board.court_id,
    board.district_id,
    board.created_at,
    board.updated_at,
    board.court_name,
    board.arraignment_status,
    board.custody_status,
    board.disclosure_status,
    board.trial_status,
    board.ruling_status,
    board.judgment_status,
    board.sentence_status,
    board.appeal_status,
    board.procedure_stage,
    board.next_appearance,
    board.can_edit,
    board.has_ruling_document,
    board.has_judgment_document,
    board.rank,
    board.headline
  from board
  where
    (
      p_next_date is null
      or cardinality(p_next_date) = 0
      or (
        ('today' = any (p_next_date) and board.next_appearance = current_date)
        or ('upcoming' = any (p_next_date) and board.next_appearance > current_date)
        or ('no_date' = any (p_next_date) and board.next_appearance is null)
      )
    )
    and (p_exact_date is null or board.next_appearance = p_exact_date)
  order by board.rank desc, board.updated_at desc
  limit p_limit;
$$;

grant execute on function public.list_docket_matters(text, integer, text[], text[], text[], text[], text[], date) to authenticated;

comment on function public.list_docket_matters(text, integer, text[], text[], text[], text[], text[], date) is
  'Docket spreadsheet/tiles list. SECURITY INVOKER -- docket_matters SELECT RLS. Filter groups AND together; values inside a group OR. next_appearance is min(scheduled event on or after today). p_exact_date (0079) restricts to next_appearance = that exact date -- this is what makes the monthly capacity calendar''s selected date actually control which matters the board shows; previously nothing connected the two. has_ruling_document/has_judgment_document (0074) flag whether a purpose=''ruling''/''judgment'' document is attached.';
