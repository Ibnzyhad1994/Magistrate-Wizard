-- ============================================================================
-- 0131_docket_arraignment_not_found_and_outcome.sql
--
-- Two related additions to the Docket procedure board:
--
--   1. Arraignment gains a third state, 'not_found' -- the accused was
--      not found and needs to be (re-)summoned. Previously a matter
--      stuck on failed service was indistinguishable from one never
--      attempted; both just sat at 'not_started'. procedure_stage (0070)
--      needs no change: its rule is `arraignment_status <> 'done' ->
--      'arraignment'`, so 'not_found' correctly keeps the matter at the
--      Arraignment stage.
--
--   2. A new outcome_status column -- 'dismissed' or 'completed',
--      settable at any stage, not only when arraignment is stuck. This
--      is the close-out for a matter wasting court time (repeated failed
--      service being the motivating case, but not the only one).
--      Setting it forces the matter's overall `status` to match, so
--      reports/filters that already key off status stay meaningful.
--
-- Deliberately named outcome_status, not `outcome` -- docket_matters
-- already has an unrelated free-text `outcome` column (Overview tab /
-- Daily Progress Report narrative), and docket_callover_items has its
-- own, differently-scoped `outcome` (0129, a callover appearance's
-- result). Three different things; three different names.
-- ============================================================================

-- 1. Arraignment: widen the CHECK -------------------------------------------

alter table public.docket_matters
  drop constraint docket_matters_arraignment_status_check;

alter table public.docket_matters
  add constraint docket_matters_arraignment_status_check
    check (arraignment_status in ('not_started', 'done', 'not_found'));

comment on column public.docket_matters.arraignment_status is
  'not_started / done / not_found. not_found (0131): the accused was not found and needs to be (re-)summoned -- still counts as arraignment not done for procedure_stage purposes.';

-- 2. docket_matter_status: widen the enum ------------------------------------
-- Not used elsewhere in this migration -- Postgres restricts using a
-- brand-new enum value within the same transaction that added it in some
-- contexts. The trigger function below only references the string in its
-- body text, evaluated later at call time, well after this migration has
-- committed -- safe regardless.

alter type public.docket_matter_status add value 'dismissed';

-- 3. New column ---------------------------------------------------------

alter table public.docket_matters
  add column if not exists outcome_status text,
  add constraint docket_matters_outcome_status_check
    check (outcome_status in ('dismissed', 'completed'));

comment on column public.docket_matters.outcome_status is
  'dismissed / completed / NULL. Board-visible disposition, settable at any procedure stage. Setting it forces status to match (docket_matters_outcome_sync trigger, below); clearing it does NOT auto-revert status -- that stays a free edit on the Overview tab. Distinct from the free-text `outcome` narrative column and from docket_callover_items.outcome (0129).';

-- 4. Sync trigger ---------------------------------------------------------
-- A separate, dedicated trigger rather than folding into the existing
-- docket_matters_guard() (0020/0097/0120) -- that function is
-- well-established and untouched here; this one owns exactly one concern.

create or replace function public.docket_matters_outcome_sync()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.outcome_status is not null
     and (tg_op = 'INSERT' or new.outcome_status is distinct from old.outcome_status)
  then
    new.status := new.outcome_status::docket_matter_status;
  end if;
  return new;
end;
$$;

comment on function public.docket_matters_outcome_sync() is
  'Forces docket_matters.status to match outcome_status whenever the latter is set to a non-null value. One-directional by design (0131): clearing outcome_status does not revert status, and changing status directly does not back-fill outcome_status.';

drop trigger if exists docket_matters_outcome_sync_trigger on public.docket_matters;
create trigger docket_matters_outcome_sync_trigger
  before insert or update on public.docket_matters
  for each row execute function public.docket_matters_outcome_sync();

-- 5. Extend list_docket_matters (the board RPC) ------------------------------
-- Everything below is byte-identical to the live definition except the
-- addition of outcome_status in three places (RETURNS TABLE, the board
-- CTE's SELECT, and the outer SELECT).

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

grant execute on function public.list_docket_matters(text, integer, text[], text[], text[], text[], text[], date, uuid) to authenticated;
revoke execute on function public.list_docket_matters(text, integer, text[], text[], text[], text[], text[], date, uuid) from public;

comment on function public.list_docket_matters(text, integer, text[], text[], text[], text[], text[], date, uuid) is
  'Docket spreadsheet/tiles list. SECURITY INVOKER. 0120 excludes binned rows; 0131 adds outcome_status.';
