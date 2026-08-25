-- ============================================================================
-- 0081_docket_appearance_history.sql
--
-- Fixes the actual architectural bug behind "capacity shows 0/3 while
-- three matters visibly appear for that date", and makes adjournment
-- preserve historical Docket dates instead of erasing them.
--
-- ROOT CAUSE (traced, not guessed): `docket_events` (0024) already IS a
-- persistent, never-hard-deleted, per-appearance ledger -- exactly the
-- "appearance/sitting record" this feature needs. No new appearance table
-- is required; the bug was in how it was being READ and WRITTEN:
--
--   1. list_docket_matters' p_exact_date filter (0079) compared against
--      next_appearance -- a SINGLE derived "earliest still-upcoming
--      scheduled date" value. Once an appearance is superseded by a later
--      one, it stops being next_appearance for ANYTHING, so filtering by
--      next_appearance = <a past or superseded date> always returned
--      nothing for that matter, even though a real appearance genuinely
--      existed on that date. Fixed here: p_exact_date now checks for the
--      EXISTENCE of any non-entered_in_error docket_events row on that
--      exact date, independent of which one currently happens to be
--      "next" -- so a date-specific Docket now correctly shows every
--      matter that was ever scheduled/heard on that date, past or future.
--
--   2. set_docket_matter_next_date (0078) always marked the superseded
--      appearance 'cancelled' when adjourning. 'cancelled' means
--      "scheduled appearance did NOT proceed" (0024's own definition) --
--      correct for a purely administrative pre-hearing reschedule, but
--      WRONG for a genuine adjournment after the matter was actually
--      before the court (it DID proceed; the outcome was "adjourned to a
--      later date"). Fixed here with a date-based rule requiring no new
--      status value: if the superseded appearance's own date is today or
--      earlier, it must already have been dealt with, so it becomes
--      'completed'; if it's still in the future, nothing has happened
--      yet, so it becomes 'cancelled' exactly as before. This is what
--      distinguishes Test 3-5 (adjournment) from Test 8 (pre-hearing
--      administrative correction) using only the four status values that
--      already exist.
--
--   3. get_docket_capacity_snapshot and schedule_docket_event_with_capacity
--      (0076) only counted event_status = 'scheduled'. Once (2) starts
--      marking genuinely-heard appearances 'completed' instead of leaving
--      them 'scheduled' forever, a past date's historical workload count
--      would silently drop to 0 unless 'completed' is also counted.
--      Broadened to event_status in ('scheduled', 'completed') --
--      'cancelled'/'entered_in_error' still never count, matching the
--      existing "did not consume capacity" semantics.
--
-- Also adds get_daily_docket_report_data(), the single query source for
-- the Daily Progress Report -- SECURITY INVOKER, so it is automatically
-- restricted by the exact same docket_matters/docket_events RLS every
-- other Docket view already uses. No admin bypass, no separate access
-- path.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. get_docket_capacity_snapshot -- count 'completed' appearances too
-- ----------------------------------------------------------------------------

create or replace function public.get_docket_capacity_snapshot(
  p_scheduled_date date,
  p_category_id uuid default null
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
    select count(*) as scheduled_count
    from public.docket_events e
    where e.category_id = c.id
      and e.scheduled_date = p_scheduled_date
      and e.event_status in ('scheduled', 'completed')
      and e.presiding_magistrate_id = (select auth.uid())
  ) ev on true
  where p_category_id is null or c.id = p_category_id
  order by c.sort_order;
$$;

comment on function public.get_docket_capacity_snapshot(date, uuid) is
  'Per-category capacity utilisation snapshot for the CALLING magistrate on one date. Counts event_status in (scheduled, completed) (0080) -- a past date''s genuinely-dealt-with appearances still count toward its historical workload once adjournment marks them completed rather than leaving everything scheduled forever; cancelled/entered_in_error never count. Personal by design -- counts are scoped to presiding_magistrate_id = auth.uid().';

-- ----------------------------------------------------------------------------
-- 2. schedule_docket_event_with_capacity -- same status-filter broadening
-- ----------------------------------------------------------------------------

create or replace function public.schedule_docket_event_with_capacity(
  p_docket_matter_id uuid,
  p_scheduled_date date,
  p_event_id uuid default null,
  p_scheduled_time time default null,
  p_event_type text default null,
  p_stage_at_event text default null,
  p_outcome_at_event text default null,
  p_orders_made_at_event text default null,
  p_notes text default null,
  p_location text default null,
  p_event_status text default 'scheduled',
  p_category_id uuid default null,
  p_acknowledge_override boolean default false,
  p_override_reason text default null
)
returns table(
  status text,
  event_id uuid,
  category_id uuid,
  category_name text,
  configured_capacity integer,
  scheduled_count integer,
  is_over_capacity boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_matter_id uuid;
  v_can_access boolean;
  v_capacity integer;
  v_category_name text;
  v_count integer;
  v_event_id uuid;
  v_will_count boolean;
begin
  if p_event_id is not null then
    select ev0.docket_matter_id into v_matter_id
    from public.docket_events ev0
    where ev0.id = p_event_id;
    if v_matter_id is null then
      raise exception 'Docket Event % not found.', p_event_id;
    end if;
    if p_docket_matter_id is not null and p_docket_matter_id <> v_matter_id then
      raise exception 'A Docket Event''s docket_matter_id is immutable; it cannot be moved to another Docket Matter.';
    end if;
  else
    v_matter_id := p_docket_matter_id;
    if v_matter_id is null then
      raise exception 'p_docket_matter_id is required when creating a new Docket Event.';
    end if;
  end if;

  select
    (public.can_access_court(dm.court_id)) or (public.has_retained_assignment(dm.id))
    into v_can_access
  from public.docket_matters dm
  where dm.id = v_matter_id;

  if v_can_access is not true then
    raise exception 'Not authorized to schedule Docket Events on this matter.';
  end if;

  v_will_count := p_category_id is not null and p_event_status = 'scheduled';

  if v_will_count then
    select s.daily_capacity into v_capacity
    from public.docket_capacity_settings s
    where s.owner_id = (select auth.uid()) and s.category_id = p_category_id;

    select c.name into v_category_name from public.docket_matter_categories c where c.id = p_category_id;

    select count(*) into v_count
    from public.docket_events e
    where e.category_id = p_category_id
      and e.scheduled_date = p_scheduled_date
      and e.event_status in ('scheduled', 'completed')
      and e.presiding_magistrate_id = (select auth.uid())
      and (p_event_id is null or e.id <> p_event_id);

    if v_capacity is not null and v_count >= v_capacity and not p_acknowledge_override then
      return query select
        'capacity_reached'::text,
        null::uuid,
        p_category_id,
        v_category_name,
        v_capacity,
        v_count,
        (v_count >= v_capacity);
      return;
    end if;
  end if;

  if p_event_id is not null then
    update public.docket_events set
      scheduled_date = p_scheduled_date,
      scheduled_time = p_scheduled_time,
      event_type = p_event_type,
      stage_at_event = p_stage_at_event,
      outcome_at_event = p_outcome_at_event,
      orders_made_at_event = p_orders_made_at_event,
      notes = p_notes,
      location = p_location,
      event_status = p_event_status,
      category_id = p_category_id
    where id = p_event_id
    returning id into v_event_id;
  else
    insert into public.docket_events (
      docket_matter_id, scheduled_date, scheduled_time, event_type,
      stage_at_event, outcome_at_event, orders_made_at_event, notes,
      location, event_status, category_id, created_by, presiding_magistrate_id
    ) values (
      v_matter_id, p_scheduled_date, p_scheduled_time, p_event_type,
      p_stage_at_event, p_outcome_at_event, p_orders_made_at_event, p_notes,
      p_location, p_event_status, p_category_id, (select auth.uid()), (select auth.uid())
    )
    returning id into v_event_id;
  end if;

  if v_will_count and v_capacity is not null and v_count >= v_capacity then
    insert into public.docket_capacity_overrides (
      docket_event_id, docket_matter_id, category_id, magistrate_profile_id,
      scheduled_date, configured_capacity, scheduled_count_at_override, reason
    ) values (
      v_event_id, v_matter_id, p_category_id, (select auth.uid()),
      p_scheduled_date, v_capacity, v_count + 1, nullif(btrim(coalesce(p_override_reason, '')), '')
    );
  end if;

  return query select
    'created'::text,
    v_event_id,
    p_category_id,
    v_category_name,
    v_capacity,
    case when v_will_count then v_count + 1 else v_count end,
    (v_will_count and v_capacity is not null and (v_count + 1) > v_capacity);
end;
$$;

comment on function public.schedule_docket_event_with_capacity is
  'Atomic, capacity-aware create/update for a single Docket Event. Counts event_status in (scheduled, completed) toward capacity (0080) -- see get_docket_capacity_snapshot comment. Otherwise unchanged from 0076.';

-- ----------------------------------------------------------------------------
-- 3. set_docket_matter_next_date -- completed-vs-cancelled adjournment rule
-- ----------------------------------------------------------------------------

create or replace function public.set_docket_matter_next_date(
  p_docket_matter_id uuid,
  p_scheduled_date date,
  p_category_id uuid default null,
  p_acknowledge_override boolean default false,
  p_override_reason text default null
)
returns table(
  status text,
  event_id uuid,
  category_id uuid,
  category_name text,
  configured_capacity integer,
  scheduled_count integer,
  is_over_capacity boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_can_access boolean;
  v_old_event_id uuid;
  v_old_scheduled_date date;
  v_old_new_status text;
  v_stage text;
  v_capacity integer;
  v_category_name text;
  v_count integer;
  v_event_id uuid;
  v_will_count boolean;
begin
  select
    (public.can_access_court(dm.court_id)) or (public.has_retained_assignment(dm.id))
    into v_can_access
  from public.docket_matters dm
  where dm.id = p_docket_matter_id;

  if v_can_access is not true then
    raise exception 'Not authorized to schedule Docket Events on this matter.';
  end if;

  select e.id, e.scheduled_date into v_old_event_id, v_old_scheduled_date
  from public.docket_events e
  where e.docket_matter_id = p_docket_matter_id
    and e.event_status = 'scheduled'
    and e.scheduled_date >= current_date
  order by e.scheduled_date
  limit 1;

  if v_old_event_id is not null and v_old_scheduled_date = p_scheduled_date then
    v_will_count := p_category_id is not null;
    if v_will_count then
      select s.daily_capacity into v_capacity
      from public.docket_capacity_settings s
      where s.owner_id = (select auth.uid()) and s.category_id = p_category_id;
      select c.name into v_category_name from public.docket_matter_categories c where c.id = p_category_id;
      select count(*) into v_count
      from public.docket_events e
      where e.category_id = p_category_id
        and e.scheduled_date = p_scheduled_date
        and e.event_status in ('scheduled', 'completed')
        and e.presiding_magistrate_id = (select auth.uid());
    end if;
    return query select
      'created'::text, v_old_event_id, p_category_id, v_category_name, v_capacity,
      coalesce(v_count, 0), (v_capacity is not null and coalesce(v_count, 0) > v_capacity);
    return;
  end if;

  v_will_count := p_category_id is not null;

  if v_will_count then
    select s.daily_capacity into v_capacity
    from public.docket_capacity_settings s
    where s.owner_id = (select auth.uid()) and s.category_id = p_category_id;

    select c.name into v_category_name from public.docket_matter_categories c where c.id = p_category_id;

    select count(*) into v_count
    from public.docket_events e
    where e.category_id = p_category_id
      and e.scheduled_date = p_scheduled_date
      and e.event_status in ('scheduled', 'completed')
      and e.presiding_magistrate_id = (select auth.uid())
      and (v_old_event_id is null or e.id <> v_old_event_id);

    if v_capacity is not null and v_count >= v_capacity and not p_acknowledge_override then
      return query select
        'capacity_reached'::text, null::uuid, p_category_id, v_category_name, v_capacity, v_count,
        (v_count >= v_capacity);
      return;
    end if;
  end if;

  if v_old_event_id is not null then
    -- The appearance being superseded already happened (its own date is
    -- today or earlier) -> it was genuinely dealt with, so it becomes
    -- 'completed' (adjourned), preserving it as historical workload for
    -- ITS OWN date. Still in the future -> nothing has happened yet, so
    -- it's a purely administrative reschedule -> 'cancelled', exactly the
    -- prior behaviour. Either way scheduled_date itself is never touched.
    v_old_new_status := case when v_old_scheduled_date <= current_date then 'completed' else 'cancelled' end;
    update public.docket_events set event_status = v_old_new_status where id = v_old_event_id;
  end if;

  select public.matter_current_stage_label(p_docket_matter_id) into v_stage;

  insert into public.docket_events (
    docket_matter_id, scheduled_date, event_status, stage_at_event, category_id,
    created_by, presiding_magistrate_id
  ) values (
    p_docket_matter_id, p_scheduled_date, 'scheduled', v_stage, p_category_id,
    (select auth.uid()), (select auth.uid())
  )
  returning id into v_event_id;

  if v_will_count and v_capacity is not null and v_count >= v_capacity then
    insert into public.docket_capacity_overrides (
      docket_event_id, docket_matter_id, category_id, magistrate_profile_id,
      scheduled_date, configured_capacity, scheduled_count_at_override, reason
    ) values (
      v_event_id, p_docket_matter_id, p_category_id, (select auth.uid()),
      p_scheduled_date, v_capacity, v_count + 1, nullif(btrim(coalesce(p_override_reason, '')), '')
    );
  end if;

  return query select
    'created'::text,
    v_event_id,
    p_category_id,
    v_category_name,
    v_capacity,
    case when v_will_count then v_count + 1 else v_count end,
    (v_will_count and v_capacity is not null and (v_count + 1) > v_capacity);
end;
$$;

comment on function public.set_docket_matter_next_date is
  'Sets/changes a Docket Matter''s Next Date. Supersedes the event currently driving next_appearance: if its own date is today or earlier it becomes ''completed'' (a real adjournment -- it was dealt with), otherwise ''cancelled'' (a pre-hearing administrative correction -- nothing happened yet) (0080). scheduled_date on the superseded row is never touched, so it remains discoverable on ITS OWN historical date via list_docket_matters'' p_exact_date (0080). Capacity counts event_status in (scheduled, completed).';

-- ----------------------------------------------------------------------------
-- 4. list_docket_matters -- p_exact_date now matches ANY appearance on that
--    date, not just the current single next_appearance
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
      -- Only meaningful/populated when p_exact_date is set -- the specific
      -- appearance's own status/stage on that exact date, distinct from
      -- the matter's overall CURRENT next_appearance above.
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
    board.appearance_status,
    board.appearance_stage,
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

grant execute on function public.list_docket_matters(text, integer, text[], text[], text[], text[], text[], date) to authenticated;

comment on function public.list_docket_matters(text, integer, text[], text[], text[], text[], text[], date) is
  'Docket spreadsheet/tiles list. SECURITY INVOKER -- docket_matters SELECT RLS. p_exact_date (0080, corrected from 0079) matches ANY non-entered_in_error appearance on that exact date -- past, present, or future -- independent of the matter''s current single next_appearance, so a historical date''s Docket survives the matter later being adjourned elsewhere. appearance_status/appearance_stage (0080) surface that specific date''s own appearance record when p_exact_date is set (most recently created if more than one on the same date), distinct from next_appearance which is always the matter''s current upcoming date regardless of which date is being viewed.';

-- ----------------------------------------------------------------------------
-- 5. get_daily_docket_report_data -- single source for the Daily Progress
--    Report PDF. SECURITY INVOKER: restricted by the exact same
--    docket_matters/docket_events RLS as every other Docket view -- a
--    report can never include a matter the caller isn't authorised to see.
-- ----------------------------------------------------------------------------

create or replace function public.get_daily_docket_report_data(p_date date)
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
    select e.event_status, e.stage_at_event, e.witnesses_called, e.witnesses_completed,
           e.witnesses_partly_heard, e.witnesses_remaining, e.outcome_at_event, e.notes
    from public.docket_events e
    where e.docket_matter_id = dm.id
      and e.scheduled_date = p_date
      and e.event_status <> 'entered_in_error'
    order by e.created_at desc
    limit 1
  ) appear on true
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
  'Single data source for the Daily Docket Progress Report PDF. SECURITY INVOKER -- restricted by the same docket_matters SELECT RLS (current Court assignment OR retained assignment OR active share) every other Docket view already uses; never an admin/service bypass. Matter selection uses the identical "any non-entered_in_error appearance on this exact date" rule as list_docket_matters'' p_exact_date (0080), so the report and the on-screen date-specific Docket always agree on which matters belong to a given day.';
