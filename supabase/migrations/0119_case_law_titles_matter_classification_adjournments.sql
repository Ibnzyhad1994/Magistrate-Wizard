-- ============================================================================
-- 0119_case_law_titles_matter_classification_adjournments.sql
--
-- Three product fixes in one migration because they share write-path RPCs:
--
--   1. Case Law titles: persist Proper Case on case_law.case_name only
--      (never citations). SQL format_case_law_title matches
--      src/lib/case-law-title.ts. A BEFORE INSERT/UPDATE trigger enforces
--      it on every write (harvest, ingest RPCs, personal create, admin
--      edit). Existing rows are backfilled.
--
--   2. Matter classification: docket_matters.category_id (nullable FK to
--      the existing docket_matter_categories lookup) plus category_other
--      for the Other free-text escape hatch. Lookup labels are renamed to
--      the magistrate-facing vocabulary (IDs unchanged so capacity
--      settings survive). New creates require a category in the UI;
--      existing rows stay null. set_docket_matter_next_date falls back to
--      the matter's category when p_category_id is null so Liability
--      files actually occupy the Liability capacity bucket.
--
--   3. Adjournments keep the original date filled: set_docket_matter_next_date
--      always marks the superseded sitting 'completed' (not 'cancelled'
--      for future dates) and stamps outcome_at_event 'Adjourned to …'
--      when empty. schedule_docket_event_with_capacity no longer moves
--      scheduled_date in place for a still-scheduled event — it completes
--      the old row and inserts a new one (0024 insert-not-overwrite).
--      True cancels remain event_status = cancelled / entered_in_error
--      and still do not occupy capacity.
--
-- list_docket_matters is dropped and recreated (return type grows) to
-- expose category_id/name/other and appearance_outcome for the date sheet.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Case Law Proper Case
-- ----------------------------------------------------------------------------

create or replace function public.format_case_law_title_atom(p_word text, p_force_cap boolean)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_lower text;
begin
  if p_word is null or p_word = '' then
    return p_word;
  end if;
  v_lower := lower(p_word);

  if v_lower in ('v', 'vs', 'v.', 'vs.') then
    return v_lower;
  end if;

  if not p_force_cap and v_lower in ('of', 'the', 'and', 'in', 'for', 'ex', 'p', 'parte') then
    return v_lower;
  end if;

  if v_lower = 'a-g' then
    return 'A-G';
  end if;
  if v_lower in ('r', 'dpp', 'ag', 'ccj', 'cj') then
    return upper(p_word);
  end if;

  if v_lower ~ '^mc[a-z]{2,}$' then
    return 'Mc' || upper(substr(p_word, 3, 1)) || lower(substr(p_word, 4));
  end if;

  if v_lower ~ '^o''[a-z]+$' then
    return 'O''' || upper(substr(p_word, 3, 1)) || lower(substr(p_word, 4));
  end if;

  return upper(substr(p_word, 1, 1)) || lower(substr(p_word, 2));
end;
$$;

create or replace function public.format_case_law_title_word(p_word text, p_force_cap boolean)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_parts text[];
  v_out text[] := '{}';
  v_i integer;
begin
  if p_word is null then
    return p_word;
  end if;
  v_parts := string_to_array(p_word, '-');
  for v_i in 1..coalesce(array_length(v_parts, 1), 0) loop
    v_out := array_append(
      v_out,
      public.format_case_law_title_atom(v_parts[v_i], case when v_i = 1 then p_force_cap else true end)
    );
  end loop;
  return array_to_string(v_out, '-');
end;
$$;

create or replace function public.format_case_law_title(p_input text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_placeholder constant text := 'Untitled (pending review)';
  v_trimmed text;
  v_parts text[];
  v_i integer;
  v_prev_connector boolean := false;
  v_out text[] := '{}';
  v_word text;
begin
  if p_input is null then
    return p_input;
  end if;
  v_trimmed := btrim(regexp_replace(p_input, '\s+', ' ', 'g'));
  if v_trimmed = '' then
    return v_trimmed;
  end if;
  if lower(v_trimmed) = lower(v_placeholder) then
    return v_placeholder;
  end if;

  v_parts := regexp_split_to_array(v_trimmed, ' ');
  for v_i in 1..coalesce(array_length(v_parts, 1), 0) loop
    v_word := v_parts[v_i];
    v_out := array_append(
      v_out,
      public.format_case_law_title_word(v_word, v_i = 1 or v_prev_connector)
    );
    v_prev_connector := lower(v_word) in ('v', 'vs', 'v.', 'vs.');
  end loop;
  return array_to_string(v_out, ' ');
end;
$$;

comment on function public.format_case_law_title(text) is
  'Legal-aware Proper Case for case_law.case_name only. Keep in lockstep with src/lib/case-law-title.ts.';

create or replace function public.case_law_title_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.case_name := public.format_case_law_title(new.case_name);
  return new;
end;
$$;

drop trigger if exists case_law_title_guard_trigger on public.case_law;
create trigger case_law_title_guard_trigger
  before insert or update of case_name on public.case_law
  for each row execute function public.case_law_title_guard();

update public.case_law
set case_name = public.format_case_law_title(case_name)
where case_name is distinct from public.format_case_law_title(case_name);

-- ----------------------------------------------------------------------------
-- 2. Matter classification
-- ----------------------------------------------------------------------------

update public.docket_matter_categories set name = 'Criminal trial', sort_order = 1
  where name = 'Trials';
update public.docket_matter_categories set name = 'Maintenance matter', sort_order = 2
  where name = 'Maintenance';
update public.docket_matter_categories set name = 'Liability matter', sort_order = 3
  where name = 'Liability';
update public.docket_matter_categories set name = 'Protection order matter', sort_order = 4
  where name = 'Protection Order / Family Violence';

insert into public.docket_matter_categories (name, sort_order)
values ('Other', 5)
on conflict (name) do update set sort_order = excluded.sort_order;

alter table public.docket_matters
  add column if not exists category_id uuid references public.docket_matter_categories(id) on delete set null,
  add column if not exists category_other text;

create index if not exists docket_matters_category_id_idx
  on public.docket_matters (category_id);

comment on column public.docket_matters.category_id is
  'Matter classification (Criminal trial, Maintenance matter, Liability matter, Protection order matter, Other). Distinct from docket_events.category_id, which is the hearing-level capacity bucket and defaults from this column. Nullable so pre-0119 rows are not rewritten.';
comment on column public.docket_matters.category_other is
  'Free-text type when category_id points at the Other lookup row. Null for every other classification.';

create or replace function public.docket_matters_category_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_name text;
begin
  new.category_other := nullif(btrim(coalesce(new.category_other, '')), '');
  if new.category_id is null then
    new.category_other := null;
    return new;
  end if;
  select c.name into v_name from public.docket_matter_categories c where c.id = new.category_id;
  if v_name is null then
    raise exception 'Unknown docket matter category.';
  end if;
  if v_name = 'Other' then
    if new.category_other is null then
      raise exception 'Describe the matter type when classification is Other.';
    end if;
  else
    new.category_other := null;
  end if;
  return new;
end;
$$;

drop trigger if exists docket_matters_category_guard_trigger on public.docket_matters;
create trigger docket_matters_category_guard_trigger
  before insert or update of category_id, category_other on public.docket_matters
  for each row execute function public.docket_matters_category_guard();

-- ----------------------------------------------------------------------------
-- 3. Adjournments: complete the old sitting, never cancel a future one
--    just because the next date moved; never overwrite scheduled_date.
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
  v_old_date date;
  v_old_status text;
  v_old_outcome text;
  v_is_adjournment boolean := false;
  v_adjourn_label text;
begin
  if p_event_id is not null then
    select ev0.docket_matter_id, ev0.scheduled_date, ev0.event_status, ev0.outcome_at_event
      into v_matter_id, v_old_date, v_old_status, v_old_outcome
    from public.docket_events ev0
    where ev0.id = p_event_id;
    if v_matter_id is null then
      raise exception 'Docket Event % not found.', p_event_id;
    end if;
    if p_docket_matter_id is not null and p_docket_matter_id <> v_matter_id then
      raise exception 'A Docket Event''s docket_matter_id is immutable; it cannot be moved to another Docket Matter.';
    end if;
    v_is_adjournment := v_old_status = 'scheduled' and v_old_date is distinct from p_scheduled_date;
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
      and (p_event_id is null or v_is_adjournment or e.id <> p_event_id);

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

  if v_is_adjournment then
    v_adjourn_label := 'Adjourned to ' || to_char(p_scheduled_date, 'FMDD Mon YYYY');
    update public.docket_events set
      event_status = 'completed',
      outcome_at_event = coalesce(nullif(btrim(coalesce(v_old_outcome, '')), ''), v_adjourn_label)
    where id = p_event_id;

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
  elsif p_event_id is not null then
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
  'Atomic, capacity-aware create/update for a single Docket Event. Changing the date of a still-scheduled event is an adjournment (0119): the original row stays on its date as completed with outcome_at_event stamped Adjourned to …, and a new row is inserted for the new date. Same-date edits still UPDATE in place. Capacity counts event_status in (scheduled, completed).';

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
  v_old_outcome text;
  v_stage text;
  v_capacity integer;
  v_category_id uuid;
  v_category_name text;
  v_count integer;
  v_event_id uuid;
  v_will_count boolean;
  v_adjourn_label text;
begin
  select
    (public.can_access_court(dm.court_id)) or (public.has_retained_assignment(dm.id))
    into v_can_access
  from public.docket_matters dm
  where dm.id = p_docket_matter_id;

  if v_can_access is not true then
    raise exception 'Not authorized to schedule Docket Events on this matter.';
  end if;

  v_category_id := p_category_id;
  if v_category_id is null then
    select dm.category_id into v_category_id
    from public.docket_matters dm
    where dm.id = p_docket_matter_id;
  end if;

  select e.id, e.scheduled_date, e.outcome_at_event
    into v_old_event_id, v_old_scheduled_date, v_old_outcome
  from public.docket_events e
  where e.docket_matter_id = p_docket_matter_id
    and e.event_status = 'scheduled'
    and e.scheduled_date >= current_date
  order by e.scheduled_date
  limit 1;

  if v_old_event_id is not null and v_old_scheduled_date = p_scheduled_date then
    v_will_count := v_category_id is not null;
    if v_will_count then
      select s.daily_capacity into v_capacity
      from public.docket_capacity_settings s
      where s.owner_id = (select auth.uid()) and s.category_id = v_category_id;
      select c.name into v_category_name from public.docket_matter_categories c where c.id = v_category_id;
      select count(*) into v_count
      from public.docket_events e
      where e.category_id = v_category_id
        and e.scheduled_date = p_scheduled_date
        and e.event_status in ('scheduled', 'completed')
        and e.presiding_magistrate_id = (select auth.uid());
    end if;
    return query select
      'created'::text, v_old_event_id, v_category_id, v_category_name, v_capacity,
      coalesce(v_count, 0), (v_capacity is not null and coalesce(v_count, 0) > v_capacity);
    return;
  end if;

  v_will_count := v_category_id is not null;

  if v_will_count then
    select s.daily_capacity into v_capacity
    from public.docket_capacity_settings s
    where s.owner_id = (select auth.uid()) and s.category_id = v_category_id;

    select c.name into v_category_name from public.docket_matter_categories c where c.id = v_category_id;

    select count(*) into v_count
    from public.docket_events e
    where e.category_id = v_category_id
      and e.scheduled_date = p_scheduled_date
      and e.event_status in ('scheduled', 'completed')
      and e.presiding_magistrate_id = (select auth.uid())
      and (v_old_event_id is null or e.id <> v_old_event_id);

    if v_capacity is not null and v_count >= v_capacity and not p_acknowledge_override then
      return query select
        'capacity_reached'::text, null::uuid, v_category_id, v_category_name, v_capacity, v_count,
        (v_count >= v_capacity);
      return;
    end if;
  end if;

  if v_old_event_id is not null then
    -- 0119: a Next Date change is an adjournment. The original sitting
    -- stays on its date as completed so that date remains filled and
    -- counted. True cancellations go through event_status = cancelled.
    v_adjourn_label := 'Adjourned to ' || to_char(p_scheduled_date, 'FMDD Mon YYYY');
    update public.docket_events set
      event_status = 'completed',
      outcome_at_event = coalesce(nullif(btrim(coalesce(v_old_outcome, '')), ''), v_adjourn_label)
    where id = v_old_event_id;
  end if;

  select public.matter_current_stage_label(p_docket_matter_id) into v_stage;

  insert into public.docket_events (
    docket_matter_id, scheduled_date, event_status, stage_at_event, category_id,
    created_by, presiding_magistrate_id
  ) values (
    p_docket_matter_id, p_scheduled_date, 'scheduled', v_stage, v_category_id,
    (select auth.uid()), (select auth.uid())
  )
  returning id into v_event_id;

  if v_will_count and v_capacity is not null and v_count >= v_capacity then
    insert into public.docket_capacity_overrides (
      docket_event_id, docket_matter_id, category_id, magistrate_profile_id,
      scheduled_date, configured_capacity, scheduled_count_at_override, reason
    ) values (
      v_event_id, p_docket_matter_id, v_category_id, (select auth.uid()),
      p_scheduled_date, v_capacity, v_count + 1, nullif(btrim(coalesce(p_override_reason, '')), '')
    );
  end if;

  return query select
    'created'::text,
    v_event_id,
    v_category_id,
    v_category_name,
    v_capacity,
    case when v_will_count then v_count + 1 else v_count end,
    (v_will_count and v_capacity is not null and (v_count + 1) > v_capacity);
end;
$$;

comment on function public.set_docket_matter_next_date is
  'Sets/changes a Docket Matter''s Next Date. Supersedes the event currently driving next_appearance by marking it completed (0119 adjournment — including future dates) and stamping outcome_at_event Adjourned to … when empty. scheduled_date on the superseded row is never touched. When p_category_id is null, the matter''s own category_id is used so capacity buckets follow classification. Capacity counts event_status in (scheduled, completed). True cancellations remain event_status cancelled / entered_in_error.';

-- ----------------------------------------------------------------------------
-- 4. list_docket_matters — expose classification + adjournment outcome
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
  'Docket spreadsheet/tiles list. SECURITY INVOKER -- docket_matters SELECT RLS is the real authorization boundary. 0119 adds category_id/name/other and appearance_outcome so a date-filtered row can show classification and Adjourned to … on the original sitting.';
