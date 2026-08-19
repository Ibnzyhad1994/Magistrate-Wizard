-- Criminal-procedure board on docket_matters: live stage snapshot for the
-- Docket spreadsheet. Events remain the dated appearance ledger — these
-- columns are not derived from hearings.
--
-- Keep CHECK values in sync with src/lib/docket-procedure.ts.

alter table public.docket_matters
  add column arraignment_status text not null default 'not_started',
  add column custody_status text not null default 'unset',
  add column disclosure_status text not null default 'none',
  add column trial_status text not null default 'not_commenced',
  add column ruling_status text not null default 'not_started',
  add column judgment_status text not null default 'not_started',
  add column sentence_status text not null default 'not_started',
  add column appeal_status text not null default 'not_started';

alter table public.docket_matters
  add constraint docket_matters_arraignment_status_check
    check (arraignment_status in ('not_started', 'done')),
  add constraint docket_matters_custody_status_check
    check (custody_status in ('unset', 'on_bail', 'remanded')),
  add constraint docket_matters_disclosure_status_check
    check (disclosure_status in ('none', 'partial', 'full')),
  add constraint docket_matters_trial_status_check
    check (trial_status in ('not_commenced', 'partial', 'completed')),
  add constraint docket_matters_ruling_status_check
    check (ruling_status in ('not_started', 'reserved', 'delivered')),
  add constraint docket_matters_judgment_status_check
    check (judgment_status in ('not_started', 'reserved', 'delivered')),
  add constraint docket_matters_sentence_status_check
    check (sentence_status in ('not_started', 'passed')),
  add constraint docket_matters_appeal_status_check
    check (appeal_status in ('not_started', 'noted', 'disposed'));

comment on column public.docket_matters.arraignment_status is
  'Procedure board: not_started | done. First appearance / plea taken.';
comment on column public.docket_matters.custody_status is
  'Procedure board: unset | on_bail | remanded. Fork after arraignment; persists through later stages.';
comment on column public.docket_matters.disclosure_status is
  'Procedure board: none | partial | full. Prosecution papers.';
comment on column public.docket_matters.trial_status is
  'Procedure board: not_commenced | partial | completed. partial = part-heard.';
comment on column public.docket_matters.ruling_status is
  'Procedure board: not_started | reserved | delivered. Oral decision.';
comment on column public.docket_matters.judgment_status is
  'Procedure board: not_started | reserved | delivered. Written reasons — pinning a Judgment document is separate.';
comment on column public.docket_matters.sentence_status is
  'Procedure board: not_started | passed.';
comment on column public.docket_matters.appeal_status is
  'Procedure board: not_started | noted | disposed.';

alter table public.docket_matters
  add column procedure_stage text generated always as (
    case
      when arraignment_status <> 'done' then 'arraignment'
      when custody_status = 'unset' then 'custody'
      when disclosure_status <> 'full' then 'disclosure'
      when trial_status <> 'completed' then 'trial'
      when ruling_status <> 'delivered' then 'ruling'
      when judgment_status <> 'delivered' then 'judgment'
      when sentence_status <> 'passed' then 'sentence'
      else 'appeal'
    end
  ) stored;

alter table public.docket_matters
  add constraint docket_matters_procedure_stage_check
    check (procedure_stage in (
      'arraignment', 'custody', 'disclosure', 'trial',
      'ruling', 'judgment', 'sentence', 'appeal'
    ));

comment on column public.docket_matters.procedure_stage is
  'Generated current stage for list filters. Walks left-to-right; matches src/lib/docket-procedure.ts currentStage(). Completing the board does not change docket_matter_status.';

create index docket_matters_procedure_stage_idx
  on public.docket_matters (procedure_stage);

-- Filtered Docket list (spreadsheet + tiles). next_appearance is derived
-- from scheduled events on or after today — never stored on the matter.
create function public.list_docket_matters(
  p_query text default '',
  p_limit integer default 100,
  p_procedure_stages text[] default null,
  p_custody text[] default null,
  p_disclosure text[] default null,
  p_trial text[] default null,
  p_next_date text[] default null
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
    board.rank,
    board.headline
  from board
  where
    p_next_date is null
    or cardinality(p_next_date) = 0
    or (
      ('today' = any (p_next_date) and board.next_appearance = current_date)
      or ('upcoming' = any (p_next_date) and board.next_appearance > current_date)
      or ('no_date' = any (p_next_date) and board.next_appearance is null)
    )
  order by board.rank desc, board.updated_at desc
  limit p_limit;
$$;

grant execute on function public.list_docket_matters(text, integer, text[], text[], text[], text[], text[]) to authenticated;

comment on function public.list_docket_matters(text, integer, text[], text[], text[], text[], text[]) is
  'Docket spreadsheet/tiles list. SECURITY INVOKER — docket_matters SELECT RLS. Filter groups AND together; values inside a group OR. next_appearance is min(scheduled event on or after today).';

-- Widen FTS helper so other callers still get board columns if they switch later.
drop function if exists public.search_docket_matters(text, integer);

create function public.search_docket_matters(p_query text, p_limit integer default 20)
returns table (
  id uuid,
  case_number text,
  matter_title text,
  status docket_matter_status,
  rank real,
  headline text,
  cover_image_path text,
  charge_or_issue text,
  arraignment_status text,
  custody_status text,
  disclosure_status text,
  trial_status text,
  ruling_status text,
  judgment_status text,
  sentence_status text,
  appeal_status text,
  procedure_stage text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    dm.id, dm.case_number, dm.matter_title, dm.status,
    ts_rank(dm.search_vector, websearch_to_tsquery('english', p_query)) as rank,
    ts_headline('english', coalesce(dm.orders_summary, dm.charge_or_issue, ''),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10') as headline,
    dm.cover_image_path,
    dm.charge_or_issue,
    dm.arraignment_status,
    dm.custody_status,
    dm.disclosure_status,
    dm.trial_status,
    dm.ruling_status,
    dm.judgment_status,
    dm.sentence_status,
    dm.appeal_status,
    dm.procedure_stage
  from public.docket_matters dm
  where dm.search_vector @@ websearch_to_tsquery('english', p_query)
  order by rank desc
  limit p_limit;
$$;

grant execute on function public.search_docket_matters(text, integer) to authenticated;

comment on function public.search_docket_matters(text, integer) is
  'Full-text search over docket_matters. SECURITY INVOKER. Includes procedure board columns.';
