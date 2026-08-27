-- ============================================================================
-- 0097_docket_two_level_scope.sql
--
-- Backend support for the two-level Docket (All My Courts / one specific
-- court): closes the one real gap in the existing schema (ordinary UPDATE
-- could silently move a matter between courts) and adds an optional
-- court-scope parameter to the two RPCs the Docket UI already uses for
-- its list/board and its printable/exportable report. RLS remains the
-- actual security boundary in every case — p_court_id here is a pure
-- query-shape convenience; a caller passing a court_id they have no
-- authority over still gets zero rows, exactly as if they'd hand-written
-- the equivalent `.eq("court_id", ...)` themselves.
--
-- Sections:
--   1. docket_matters_guard() -- court_id becomes immutable on ordinary
--      UPDATE (raises, does not silently ignore). No informal transfer
--      workflow is introduced or implied; if one is ever needed, it is a
--      separate, explicit, audited feature built later.
--   2. list_docket_matters() -- add p_court_id.
--   3. get_daily_docket_report_data() -- add p_court_id.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. docket_matters_guard() -- block court reassignment via ordinary UPDATE
--
-- Previously (0020): an UPDATE that changed court_id was treated as a
-- legitimate "reassignment," re-deriving district_id and re-checking the
-- target court's is_active flag. That was never exercised by any actual
-- UI (no form anywhere ever offered a court_id field on edit) but WAS
-- reachable via a direct Supabase call, which is exactly the "silent
-- transfer" this task requires closed. There is no inter-court transfer
-- workflow in this codebase to preserve or adapt -- this migration does
-- not invent one; it simply removes the informal path.
--
-- created_by/last_updated_by provenance-forcing is unchanged from 0020.
-- ----------------------------------------------------------------------------

create or replace function public.docket_matters_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_district_id uuid;
  v_is_active boolean;
begin
  if tg_op = 'UPDATE' and new.court_id is distinct from old.court_id then
    raise exception 'A Docket Matter''s court cannot be changed through an ordinary update. Court reassignment is not supported.';
  end if;

  if tg_op = 'INSERT' then
    select c.district_id, c.is_active into v_district_id, v_is_active
    from public.courts c
    where c.id = new.court_id;

    if v_district_id is null then
      raise exception 'Cannot create a Docket Matter at court % — that court has no Magisterial District assigned', new.court_id;
    end if;

    if not coalesce(v_is_active, false) then
      raise exception 'Cannot create a Docket Matter at inactive court % — is_active must be true to accept new Docket entry', new.court_id;
    end if;

    new.district_id := v_district_id;
  else
    -- court_id cannot change on UPDATE (enforced above), so district_id
    -- never needs re-derivation here — always force-preserved.
    new.district_id := old.district_id;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  else
    new.created_by := old.created_by;
  end if;

  if tg_op = 'UPDATE' then
    new.last_updated_by := (select auth.uid());
  end if;

  return new;
end;
$$;

comment on function public.docket_matters_guard() is
  'Derives district_id from court_id on INSERT only (rejecting a court with no district or is_active=false); force-preserves district_id/created_by on every UPDATE; forces last_updated_by to the authenticated caller on every UPDATE. court_id itself is immutable once a matter exists (0097) -- an ordinary UPDATE attempting to change it is rejected outright, closing the "silent cross-court transfer" gap. No inter-court transfer workflow exists in this schema; this does not introduce one.';

-- ----------------------------------------------------------------------------
-- 2. list_docket_matters() -- add p_court_id (optional exact-court scope)
-- ----------------------------------------------------------------------------

drop function if exists public.list_docket_matters(text, integer, text[], text[], text[], text[], text[], date);

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
  procedure_stage text,
  next_appearance date,
  can_edit boolean,
  has_ruling_document boolean,
  has_judgment_document boolean,
  appearance_status text,
  appearance_stage text,
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
      appear.event_status as appearance_status,
      appear.stage_at_event as appearance_stage,
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
    left join lateral (
      select e.event_status, e.stage_at_event
      from public.docket_events e
      where e.docket_matter_id = dm.id
        and p_exact_date is not null
        and e.scheduled_date = p_exact_date
        and e.event_status <> 'entered_in_error'
      order by e.created_at desc
      limit 1
    ) appear on true
    where (
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
    board.appeal_status, board.procedure_stage, board.next_appearance, board.can_edit,
    board.has_ruling_document, board.has_judgment_document, board.appearance_status,
    board.appearance_stage, board.rank, board.headline
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

comment on function public.list_docket_matters(text, integer, text[], text[], text[], text[], text[], date, uuid) is
  'Docket spreadsheet/tiles list. SECURITY INVOKER -- docket_matters SELECT RLS is the real authorization boundary; p_court_id (0097) is a pure query-scope convenience for the two-level Docket UI (All My Courts = null, one court = its exact id) -- a caller with no authority over p_court_id simply gets zero rows, same as RLS already guarantees for every other column.';

-- ----------------------------------------------------------------------------
-- 3. get_daily_docket_report_data() -- add p_court_id (export scope)
-- ----------------------------------------------------------------------------

drop function if exists public.get_daily_docket_report_data(date);

create function public.get_daily_docket_report_data(p_date date, p_court_id uuid default null)
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
  and (p_court_id is null or dm.court_id = p_court_id)
  order by dm.case_number, dm.matter_title;
$$;

revoke execute on function public.get_daily_docket_report_data from public;
grant execute on function public.get_daily_docket_report_data to authenticated;

comment on function public.get_daily_docket_report_data(date, uuid) is
  'Single data source for the Daily Docket Progress Report PDF. SECURITY INVOKER -- restricted by the same docket_matters SELECT RLS every other Docket view uses. p_court_id (0097) scopes the export to one court when generated from that court''s Docket view; null (All My Courts) exports every authorized court''s matters for that date, each still carrying its own court_name.';
