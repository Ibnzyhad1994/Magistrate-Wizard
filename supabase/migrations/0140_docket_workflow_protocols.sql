-- 0140_docket_workflow_protocols.sql
--
-- Classification-specific Docket boards (case-workflow-protocol-spec).
-- Criminal Trial walk is unchanged. Paper Committal is a new category.
-- Protection / Maintenance / Liability share a civil summons board.
--
-- procedure_stage cannot stay GENERATED ALWAYS: a generated column cannot
-- join docket_matter_categories. Store a row-local workflow_protocol and
-- maintain procedure_stage in the same BEFORE trigger.
-- Keep in sync with src/lib/docket-procedure.ts and
-- src/lib/docket-protocols.ts currentStageForProtocol().

-- ----------------------------------------------------------------------------
-- 1. Paper Committal lookup row
-- ----------------------------------------------------------------------------

update public.docket_matter_categories
  set sort_order = sort_order + 1
  where sort_order >= 2;

insert into public.docket_matter_categories (name, sort_order)
values ('Paper Committal', 2)
on conflict (name) do update set sort_order = excluded.sort_order;

comment on column public.docket_matters.category_id is
  'Matter classification (Criminal trial, Paper Committal, Maintenance matter, Liability matter, Protection order matter, Other). Distinct from docket_events.category_id, which is the hearing-level capacity bucket and defaults from this column. Nullable so pre-0119 rows are not rewritten.';

-- ----------------------------------------------------------------------------
-- 2. Protocol + Paper Committal + civil columns
-- ----------------------------------------------------------------------------

alter table public.docket_matters
  add column if not exists workflow_protocol text not null default 'criminal_trial',
  add column if not exists paper_committal_status text not null default 'not_commenced',
  add column if not exists information_sworn_status text not null default 'not_started',
  add column if not exists summons_served text not null default 'unset',
  add column if not exists returns_of_summons text not null default 'unset',
  add column if not exists civil_trial_held text not null default 'unset',
  add column if not exists decision_granted text,
  add column if not exists decision_amount numeric,
  add column if not exists stage_adjournments jsonb not null default '{}'::jsonb,
  add column if not exists outcome_adjourned boolean not null default false;

alter table public.docket_matters
  drop constraint if exists docket_matters_workflow_protocol_check,
  drop constraint if exists docket_matters_paper_committal_status_check,
  drop constraint if exists docket_matters_information_sworn_status_check,
  drop constraint if exists docket_matters_summons_served_check,
  drop constraint if exists docket_matters_returns_of_summons_check,
  drop constraint if exists docket_matters_civil_trial_held_check,
  drop constraint if exists docket_matters_decision_granted_check;

alter table public.docket_matters
  add constraint docket_matters_workflow_protocol_check
    check (workflow_protocol in ('criminal_trial', 'paper_committal', 'civil_summons')),
  add constraint docket_matters_paper_committal_status_check
    check (paper_committal_status in ('not_commenced', 'commenced', 'partial', 'completed')),
  add constraint docket_matters_information_sworn_status_check
    check (information_sworn_status in ('not_started', 'done')),
  add constraint docket_matters_summons_served_check
    check (summons_served in ('unset', 'yes', 'no')),
  add constraint docket_matters_returns_of_summons_check
    check (returns_of_summons in ('unset', 'yes', 'no')),
  add constraint docket_matters_civil_trial_held_check
    check (civil_trial_held in ('unset', 'yes', 'no')),
  add constraint docket_matters_decision_granted_check
    check (decision_granted is null or decision_granted in ('granted', 'not_granted'));

comment on column public.docket_matters.workflow_protocol is
  'Row-local board protocol, set from category_id: criminal_trial | paper_committal | civil_summons. Other and null classification keep criminal_trial.';
comment on column public.docket_matters.paper_committal_status is
  'Paper Committal board: not_commenced | commenced | partial | completed. UI: Commenced / Partial / Completed.';
comment on column public.docket_matters.information_sworn_status is
  'Civil summons board: not_started | done.';
comment on column public.docket_matters.summons_served is
  'Civil summons board: unset | yes | no. no keeps the file at this stage.';
comment on column public.docket_matters.returns_of_summons is
  'Civil summons board: unset | yes | no. no keeps the file at this stage.';
comment on column public.docket_matters.civil_trial_held is
  'Civil summons board: unset | yes | no. Either yes or no completes the stage; unset keeps the pointer here.';
comment on column public.docket_matters.decision_granted is
  'Protection order Decision: granted | not_granted | null.';
comment on column public.docket_matters.decision_amount is
  'Maintenance = amount ordered; Liability = amount paid. Null until entered.';
comment on column public.docket_matters.stage_adjournments is
  'Per-stage adjournment map { stage: { adjourned, reason } }. Not a board column. Used by the civil summons protocol.';
comment on column public.docket_matters.outcome_adjourned is
  'Civil Outcome Adjourned. Must not be stored on outcome_status: 0131 would force docket_matters.status to an invalid enum. Completed still uses outcome_status.';

-- ----------------------------------------------------------------------------
-- 3. Drop generated procedure_stage; store it as a maintained column
-- ----------------------------------------------------------------------------

alter table public.docket_matters
  drop constraint if exists docket_matters_procedure_stage_check;

alter table public.docket_matters
  drop column procedure_stage;

alter table public.docket_matters
  add column procedure_stage text not null default 'arraignment';

alter table public.docket_matters
  add constraint docket_matters_procedure_stage_check
    check (procedure_stage in (
      'arraignment', 'custody', 'disclosure', 'trial', 'paper_committal',
      'ruling', 'judgment', 'sentence', 'appeal',
      'information_sworn', 'summons_served', 'returns_of_summons',
      'civil_trial', 'decision'
    ));

create index docket_matters_procedure_stage_idx
  on public.docket_matters (procedure_stage);

create index docket_matters_workflow_protocol_idx
  on public.docket_matters (workflow_protocol);

comment on column public.docket_matters.procedure_stage is
  'Current stage for list filters. Set by docket_matters_set_workflow_protocol from workflow_protocol; matches src/lib/docket-protocols.ts currentStageForProtocol(). Completing the board does not change docket_matter_status.';

-- ----------------------------------------------------------------------------
-- 4. Trigger: protocol from category, then walk that protocol
-- ----------------------------------------------------------------------------

create or replace function public.docket_matters_set_workflow_protocol()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_name text;
begin
  v_name := null;
  if new.category_id is not null then
    select c.name into v_name
    from public.docket_matter_categories c
    where c.id = new.category_id;
  end if;

  if v_name = 'Paper Committal' then
    new.workflow_protocol := 'paper_committal';
  elsif v_name in ('Maintenance matter', 'Liability matter', 'Protection order matter') then
    new.workflow_protocol := 'civil_summons';
  else
    new.workflow_protocol := 'criminal_trial';
  end if;

  if new.workflow_protocol = 'criminal_trial' then
    new.procedure_stage := case
      when new.arraignment_status <> 'done' then 'arraignment'
      when new.custody_status = 'unset' then 'custody'
      when new.disclosure_status <> 'full' then 'disclosure'
      when new.trial_status <> 'completed' then 'trial'
      when new.ruling_status <> 'delivered' then 'ruling'
      when new.judgment_status <> 'delivered' then 'judgment'
      when new.sentence_status <> 'passed' then 'sentence'
      else 'appeal'
    end;
  elsif new.workflow_protocol = 'paper_committal' then
    new.procedure_stage := case
      when new.arraignment_status <> 'done' then 'arraignment'
      when new.custody_status = 'unset' then 'custody'
      when new.disclosure_status <> 'full' then 'disclosure'
      when new.paper_committal_status <> 'completed' then 'paper_committal'
      when new.ruling_status <> 'delivered' then 'ruling'
      when new.judgment_status <> 'delivered' then 'judgment'
      else 'appeal'
    end;
  else
    new.procedure_stage := case
      when new.information_sworn_status is distinct from 'done' then 'information_sworn'
      when new.summons_served is distinct from 'yes' then 'summons_served'
      when new.returns_of_summons is distinct from 'yes' then 'returns_of_summons'
      when coalesce(new.civil_trial_held, 'unset') = 'unset' then 'civil_trial'
      else 'decision'
    end;
  end if;

  return new;
end;
$$;

comment on function public.docket_matters_set_workflow_protocol() is
  'Sets workflow_protocol from classification, then walks that protocol into procedure_stage. Criminal Trial walk is byte-identical to the former 0070 generated column.';

drop trigger if exists docket_matters_workflow_protocol_trigger on public.docket_matters;
create trigger docket_matters_workflow_protocol_trigger
  before insert or update on public.docket_matters
  for each row execute function public.docket_matters_set_workflow_protocol();

-- Fire the trigger so existing rows pick up civil_summons / paper protocol.
update public.docket_matters
  set arraignment_status = arraignment_status;

-- ----------------------------------------------------------------------------
-- 5. Stage label used when logging a Next Date (0079)
-- ----------------------------------------------------------------------------

create or replace function public.matter_current_stage_label(p_docket_matter_id uuid)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select case dm.procedure_stage
    when 'arraignment' then 'Arraignment'
    when 'custody' then 'Custody'
    when 'disclosure' then 'Disclosure'
    when 'trial' then 'Trial'
    when 'paper_committal' then 'Paper Committal'
    when 'ruling' then 'Ruling'
    when 'judgment' then 'Judgment'
    when 'sentence' then 'Sentence'
    when 'appeal' then 'Appeal'
    when 'information_sworn' then 'Information Sworn'
    when 'summons_served' then 'Summons Served'
    when 'returns_of_summons' then 'Returns of Summons'
    when 'civil_trial' then 'Trial'
    when 'decision' then 'Decision'
    else initcap(replace(dm.procedure_stage, '_', ' '))
  end
  from public.docket_matters dm
  where dm.id = p_docket_matter_id;
$$;

-- ----------------------------------------------------------------------------
-- 6. list_docket_matters — protocol columns; custody/disclosure/trial
--    chips only match protocols that own those columns
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
  paper_committal_status text,
  ruling_status text,
  judgment_status text,
  sentence_status text,
  appeal_status text,
  information_sworn_status text,
  summons_served text,
  returns_of_summons text,
  civil_trial_held text,
  decision_granted text,
  decision_amount numeric,
  stage_adjournments jsonb,
  outcome_status text,
  outcome_adjourned boolean,
  workflow_protocol text,
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
      dm.paper_committal_status,
      dm.ruling_status,
      dm.judgment_status,
      dm.sentence_status,
      dm.appeal_status,
      dm.information_sworn_status,
      dm.summons_served,
      dm.returns_of_summons,
      dm.civil_trial_held,
      dm.decision_granted,
      dm.decision_amount,
      dm.stage_adjournments,
      dm.outcome_status,
      dm.outcome_adjourned,
      dm.workflow_protocol,
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
        or (
          dm.workflow_protocol in ('criminal_trial', 'paper_committal')
          and dm.custody_status = any (p_custody)
        )
      )
      and (
        p_disclosure is null
        or cardinality(p_disclosure) = 0
        or (
          dm.workflow_protocol in ('criminal_trial', 'paper_committal')
          and dm.disclosure_status = any (p_disclosure)
        )
      )
      and (
        p_trial is null
        or cardinality(p_trial) = 0
        or (
          dm.workflow_protocol = 'criminal_trial'
          and dm.trial_status = any (p_trial)
        )
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
    board.trial_status, board.paper_committal_status, board.ruling_status, board.judgment_status,
    board.sentence_status, board.appeal_status, board.information_sworn_status, board.summons_served,
    board.returns_of_summons, board.civil_trial_held, board.decision_granted, board.decision_amount,
    board.stage_adjournments, board.outcome_status, board.outcome_adjourned, board.workflow_protocol,
    board.procedure_stage, board.next_appearance, board.can_edit,
    board.has_ruling_document, board.has_judgment_document, board.appearance_status,
    board.appearance_stage, board.appearance_outcome, board.category_id, board.category_name,
    board.category_other, board.rank, board.headline
  from board
  where
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
  'Docket spreadsheet/tiles list. SECURITY INVOKER. 0140 adds workflow_protocol columns; custody/disclosure/trial chips only match protocols that own those columns.';
