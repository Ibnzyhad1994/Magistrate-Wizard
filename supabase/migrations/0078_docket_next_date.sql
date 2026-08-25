-- ============================================================================
-- 0078_docket_next_date.sql
--
-- Lets a magistrate set/change a Docket Matter's "Next Date" directly from
-- the Docket working sheet (the board), without opening the matter or the
-- Events tab. "Next Date" has no separate stored column -- it is, and
-- remains, the SAME derived value `list_docket_matters` already computes
-- (0070/0074): `min(scheduled_date) from docket_events where
-- event_status = 'scheduled' and scheduled_date >= current_date`. Setting
-- it therefore means writing to `docket_events`, through the same
-- capacity-aware path `schedule_docket_event_with_capacity` (0076)
-- already established -- this migration adds one more entry point into
-- that same system, not a parallel one.
--
-- SUPERSEDE, DON'T OVERWRITE: migration 0024's own header is explicit that
-- an adjournment creates a NEW docket_events row rather than overwriting
-- the old appearance's scheduled_date -- "this is what keeps derived
-- previous/next-appearance chronology historically accurate". This RPC
-- follows that same convention: if the matter already has a future
-- 'scheduled' event (the one currently driving next_appearance), setting
-- a new Next Date marks that OLD event 'cancelled' (its own scheduled_date
-- column is never touched -- an existing CHECK/RLS-independent guarantee
-- from 0024's docket_events_guard(), unaffected by this migration) and
-- inserts a NEW 'scheduled' event for the new date. This is what makes
-- "old date no longer counts toward capacity, new date does" true without
-- losing the historical fact that the earlier date existed.
-- ============================================================================

-- matter_current_stage_label -- tiny SQL-side mirror of the frontend's
-- currentStage()/PROCEDURE_STAGE_LABELS (src/lib/docket-procedure.ts), used
-- only to default a new event's stage_at_event to the matter's current
-- procedure stage (mirrors what the Hearing Progress dialog already
-- defaults client-side) -- not a new source of truth, just a label lookup
-- for a value set_docket_matter_next_date needs at INSERT time.

create or replace function public.matter_current_stage_label(p_docket_matter_id uuid)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when dm.arraignment_status <> 'done' then 'Arraignment'
    when dm.custody_status = 'unset' then 'Custody'
    when dm.disclosure_status <> 'full' then 'Disclosure'
    when dm.trial_status <> 'completed' then 'Trial'
    when dm.ruling_status <> 'delivered' then 'Ruling'
    when dm.judgment_status <> 'delivered' then 'Judgment'
    when dm.sentence_status <> 'passed' then 'Sentence'
    else 'Appeal'
  end
  from public.docket_matters dm
  where dm.id = p_docket_matter_id;
$$;

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

  -- The event currently driving next_appearance for this matter, exactly
  -- as list_docket_matters computes it (0074) -- earliest 'scheduled'
  -- event on or after today, regardless of who presides or its category.
  select e.id, e.scheduled_date into v_old_event_id, v_old_scheduled_date
  from public.docket_events e
  where e.docket_matter_id = p_docket_matter_id
    and e.event_status = 'scheduled'
    and e.scheduled_date >= current_date
  order by e.scheduled_date
  limit 1;

  -- No-op: the requested date is already the current next date. Nothing
  -- to supersede, nothing to create.
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
        and e.event_status = 'scheduled'
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
      and e.event_status = 'scheduled'
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
    update public.docket_events set event_status = 'cancelled' where id = v_old_event_id;
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
  'Sets/changes a Docket Matter''s Next Date from the Docket working sheet. Supersedes (cancels) the event currently driving next_appearance rather than overwriting its scheduled_date, then inserts a new scheduled event for the requested date -- preserving rescheduling history per 0024''s adjournment convention. Reuses the exact capacity-check/override semantics of schedule_docket_event_with_capacity (0076): returns status=''capacity_reached'' (writing nothing) when the target date/category is already at or over the calling magistrate''s configured capacity and not acknowledged, otherwise writes and records an override if the booking lands at/over capacity.';

revoke execute on function public.set_docket_matter_next_date from public;
grant execute on function public.set_docket_matter_next_date to authenticated;
