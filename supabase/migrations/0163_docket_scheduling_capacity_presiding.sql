-- ============================================================================
-- 0163_docket_scheduling_capacity_presiding.sql
--
-- Closes the six scheduling, capacity and presiding gaps found by the
-- 2026-10-15 multi-user audit (theme T2). Every function below is restated
-- in full; the two scheduling RPCs replace whatever body each environment
-- carries (0141 patched them textually because staging and production had
-- drifted), so after this migration every environment runs the same body.
--
--   B-03  set_docket_matter_next_date and schedule_docket_event_with_capacity
--         lock the matter row before reading its current next date. Two
--         adjournments of one matter now run one after the other: the
--         second supersedes the first's new date, so exactly one live
--         next date remains (0078/0119 "supersede, never overwrite").
--
--   B-05  Both RPCs take a transaction-scoped advisory lock on
--         (presiding magistrate, category, date) before counting, so two
--         bookings for the last slot cannot both see it free. The second
--         gets capacity_reached, or, when acknowledged, an override row.
--
--   B-06  A hearing a clerk lists no longer records the clerk as presiding
--         magistrate (0090: "a clerk is never presiding over anything").
--         It goes to the matter's sitting magistrate,
--         new_docket_event_presiding_magistrate(): the magistrate of the
--         sitting it supersedes (or the matter's latest sitting) while they
--         can still hear the matter, else the court's only sitting
--         magistrate, else nobody (unassigned). Capacity is counted and
--         enforced against that magistrate, and a clerk's acknowledged
--         override is recorded against their capacity with the clerk as
--         overridden_by. A magistrate who sits at the court (or holds the
--         matter) can take an unassigned hearing for themselves; the old
--         guard silently ignored that write. Existing hearings that
--         recorded a clerk as presiding are corrected to unassigned.
--
--   B-07  docket_events_guard() refuses any client write that removes or
--         reassigns a hearing's presiding magistrate (the old guard let a
--         clerk null it, after which the UPDATE policy refused every
--         magistrate's edit with 42501). The UPDATE policy no longer
--         requires a presiding magistrate, so unassigned hearings stay
--         editable by everyone who can edit the matter. The profile's own
--         ON DELETE SET NULL still works: it runs as the table owner, not
--         as a client role.
--
--   B-11  One shared count, docket_booked_count(): distinct live (not
--         binned) matters with a scheduled or completed hearing in the
--         category on the date, presided by the magistrate. The booking
--         RPCs, the calendar snapshot and find_next_available_docket_date
--         all use it, so a suggested free day is one the booking accepts,
--         and the calendar says full when the booking says full.
--         find_next_available_docket_date takes an optional matter so a
--         clerk is offered a day the sitting magistrate has free.
--
--   B-12  schedule_docket_event_with_capacity takes p_expected_updated_at.
--         When it no longer matches the hearing, nothing is written and
--         the RPC returns status 'conflict' (the same optimistic guard
--         docket_matters edits use), instead of overwriting the orders
--         someone else recorded meanwhile. Omitting it keeps today's
--         unconditional edit, so older callers still work.
--
-- Overlap with 0161 (theme T1, docket bin): docket_events_guard() is
-- restated here with 0161's binned-matter refusal carried over verbatim, so
-- whichever of the two migrations is applied last keeps both behaviours.
-- Nothing else here is redefined by 0160, 0161 or 0162.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Who presides over a new hearing
-- ----------------------------------------------------------------------------

create or replace function public.docket_magistrate_can_hear(
  p_profile_id uuid,
  p_docket_matter_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.docket_matters dm on dm.id = p_docket_matter_id
    where p.id = p_profile_id
      and p.role <> 'clerk'
      and (
        exists (
          select 1 from public.magistrate_courts mc
          where mc.profile_id = p.id
            and mc.court_id = dm.court_id
            and mc.ended_at is null
        )
        or exists (
          select 1 from public.docket_matter_assignments dma
          where dma.profile_id = p.id
            and dma.docket_matter_id = dm.id
            and dma.ended_at is null
        )
      )
  );
$$;

revoke all on function public.docket_magistrate_can_hear(uuid, uuid) from public, anon, authenticated;

comment on function public.docket_magistrate_can_hear(uuid, uuid) is
  'Internal (0163): true when the profile is not a clerk and currently sits at the matter''s court or holds a retained assignment on it. Used only by new_docket_event_presiding_magistrate().';

create or replace function public.new_docket_event_presiding_magistrate(
  p_docket_matter_id uuid,
  p_prior_event_id uuid default null
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  if not public.is_clerk() then
    return (select auth.uid());
  end if;

  if not public.can_edit_docket_matter(p_docket_matter_id) then
    return null;
  end if;

  -- The magistrate of the sitting being superseded, while they can still
  -- hear the matter: an adjourned matter returns before the same bench.
  if p_prior_event_id is not null then
    select e.presiding_magistrate_id into v_profile_id
    from public.docket_events e
    where e.id = p_prior_event_id
      and e.docket_matter_id = p_docket_matter_id;
    if v_profile_id is not null
      and public.docket_magistrate_can_hear(v_profile_id, p_docket_matter_id)
    then
      return v_profile_id;
    end if;
  end if;

  -- Otherwise the magistrate of the matter's latest sitting.
  select e.presiding_magistrate_id into v_profile_id
  from public.docket_events e
  where e.docket_matter_id = p_docket_matter_id
    and e.event_status <> 'entered_in_error'
    and e.presiding_magistrate_id is not null
    and public.docket_magistrate_can_hear(e.presiding_magistrate_id, p_docket_matter_id)
  order by e.scheduled_date desc, e.created_at desc
  limit 1;
  if v_profile_id is not null then
    return v_profile_id;
  end if;

  -- Otherwise the court's only sitting magistrate; with several, nobody
  -- is guessed and the hearing waits, unassigned, for one to take it.
  select (array_agg(distinct mc.profile_id))[1] into v_profile_id
  from public.docket_matters dm
  join public.magistrate_courts mc on mc.court_id = dm.court_id and mc.ended_at is null
  join public.profiles p on p.id = mc.profile_id and p.role <> 'clerk'
  where dm.id = p_docket_matter_id
  having count(distinct mc.profile_id) = 1;

  return v_profile_id;
end;
$$;

revoke all on function public.new_docket_event_presiding_magistrate(uuid, uuid) from public, anon;
grant execute on function public.new_docket_event_presiding_magistrate(uuid, uuid) to authenticated;

comment on function public.new_docket_event_presiding_magistrate(uuid, uuid) is
  'The presiding magistrate a new hearing on this matter gets when the caller lists it (0163). A magistrate presides over what they list. A clerk never presides: their hearing goes to the magistrate of p_prior_event_id (the sitting it supersedes), else of the matter''s latest sitting, while that magistrate still sits at the court or holds the matter; else to the court''s only sitting magistrate; else null (unassigned, claimable). Returns null when the caller cannot edit the matter. Used by docket_events_guard() and both scheduling RPCs, so the guard and the capacity check agree.';

-- ----------------------------------------------------------------------------
-- 2. One booked count for enforcement, the calendar and suggestions
-- ----------------------------------------------------------------------------

create or replace function public.docket_booked_count(
  p_magistrate_id uuid,
  p_category_id uuid,
  p_scheduled_date date,
  p_exclude_matter_id uuid default null,
  p_court_id uuid default null
)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(distinct e.docket_matter_id)::integer
  from public.docket_events e
  join public.docket_matters dm on dm.id = e.docket_matter_id
  where e.presiding_magistrate_id = p_magistrate_id
    and e.category_id = p_category_id
    and e.scheduled_date = p_scheduled_date
    and e.event_status in ('scheduled', 'completed')
    and dm.deleted_at is null
    and (p_exclude_matter_id is null or e.docket_matter_id <> p_exclude_matter_id)
    and (p_court_id is null or dm.court_id = p_court_id);
$$;

revoke all on function public.docket_booked_count(uuid, uuid, date, uuid, uuid) from public, anon;
grant execute on function public.docket_booked_count(uuid, uuid, date, uuid, uuid) to authenticated;

comment on function public.docket_booked_count(uuid, uuid, date, uuid, uuid) is
  'The one capacity count (0163): distinct live (not binned) matters with a scheduled or completed hearing in the category on the date presided by the magistrate. A completed sitting still fills its day (0119). p_exclude_matter_id leaves out the matter being booked; p_court_id narrows to one court for display only (enforcement never passes it). SECURITY INVOKER: callers see only rows their RLS allows; the SECURITY DEFINER booking RPCs see every row.';

-- ----------------------------------------------------------------------------
-- 3. docket_events_guard(): presiding provenance that holds
-- ----------------------------------------------------------------------------

create or replace function public.docket_events_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_client boolean := current_user in ('anon', 'authenticated');
begin
  if tg_op = 'UPDATE' and new.docket_matter_id is distinct from old.docket_matter_id then
    raise exception 'A Docket Event''s docket_matter_id is immutable; it cannot be moved to another Docket Matter. Create a new event on the correct matter instead.';
  end if;

  -- 0161 (B-10), carried over unchanged.
  if exists (
    select 1 from public.docket_matters dm
    where dm.id = new.docket_matter_id
      and dm.deleted_at is not null
  ) then
    raise exception 'A binned Docket Matter cannot be edited. Restore it first.';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  else
    new.created_by := old.created_by;
  end if;

  -- A client never chooses who presides. The scheduling RPCs (SECURITY
  -- DEFINER, so not a client role here) write the value they computed
  -- with the same function, because only they know which sitting the new
  -- hearing supersedes.
  if tg_op = 'INSERT' and v_client then
    new.presiding_magistrate_id := public.new_docket_event_presiding_magistrate(new.docket_matter_id);
  end if;

  -- The FK's ON DELETE SET NULL runs as the table owner, so it passes.
  if tg_op = 'UPDATE'
    and v_client
    and new.presiding_magistrate_id is distinct from old.presiding_magistrate_id
  then
    if new.presiding_magistrate_id is null then
      raise exception 'A hearing''s presiding magistrate cannot be removed.';
    end if;
    if old.presiding_magistrate_id is not null then
      raise exception 'This hearing already has a presiding magistrate and cannot be reassigned.';
    end if;
    if new.presiding_magistrate_id is distinct from (select auth.uid())
      or public.is_clerk()
      or not public.has_docket_matter_authority(new.docket_matter_id)
    then
      raise exception 'Only a magistrate who sits at this court, or holds this matter, can take an unassigned hearing, and only for themselves.';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    new.last_updated_by := (select auth.uid());
  end if;

  return new;
end;
$$;

comment on function public.docket_events_guard() is
  'BEFORE INSERT OR UPDATE guard: docket_matter_id immutability; no new or changed event on a binned matter (0161); created_by forced at creation and preserved after; presiding_magistrate_id (0163) set on a client insert by new_docket_event_presiding_magistrate() (a clerk never presides), written as computed by the SECURITY DEFINER scheduling RPCs, never removed or reassigned by a client, and taken from unassigned only by a magistrate with court or retained authority, for themselves. The profile''s own ON DELETE SET NULL runs as the table owner and passes. last_updated_by forced on UPDATE.';

comment on column public.docket_events.presiding_magistrate_id is
  'Judicial provenance only, never access control. Set by docket_events_guard() (0163): the lister when a magistrate lists, the sitting magistrate (new_docket_event_presiding_magistrate) when a clerk does, null when no single magistrate can be determined. Never removed or reassigned by a client; an unassigned hearing can be taken by a magistrate with court or retained authority, for themselves. The profile''s own ON DELETE SET NULL is permitted.';

-- Insert: the guard sets the value, so the check only restates who may
-- end up unassigned. Update: no presiding requirement, so an unassigned
-- hearing (clerk-listed at a court with several magistrates) is editable
-- by everyone who can edit the matter.
alter policy "Magistrates can create Docket Events for accessible Docket Matt"
  on public.docket_events
  with check (
    public.can_edit_docket_matter(docket_matter_id)
    and created_by = (select auth.uid())
    and (
      presiding_magistrate_id = (select auth.uid())
      or (select public.is_clerk())
    )
  );

alter policy "Magistrates can update Docket Events for accessible Docket Matt"
  on public.docket_events
  using (public.can_edit_docket_matter(docket_matter_id))
  with check (public.can_edit_docket_matter(docket_matter_id));

-- Hearings that recorded a clerk as presiding magistrate (every clerk
-- listing before this migration) become unassigned, so the right
-- magistrate can take them. A one-off correction of wrong provenance:
-- the guard is set aside so binned matters are corrected too, and
-- updated_at is left alone so no open dialog or queued offline edit sees
-- a spurious conflict. audit_log still records each row.
alter table public.docket_events disable trigger docket_events_guard_trigger;
alter table public.docket_events disable trigger set_docket_events_updated_at;

update public.docket_events e
set presiding_magistrate_id = null
from public.profiles p
where p.id = e.presiding_magistrate_id
  and p.role = 'clerk';

alter table public.docket_events enable trigger set_docket_events_updated_at;
alter table public.docket_events enable trigger docket_events_guard_trigger;

-- ----------------------------------------------------------------------------
-- 4. Overrides record who acknowledged them
-- ----------------------------------------------------------------------------

alter table public.docket_capacity_overrides
  add column overridden_by uuid references public.profiles (id) on delete set null;

update public.docket_capacity_overrides
set overridden_by = magistrate_profile_id
where overridden_by is null;

create index docket_capacity_overrides_overridden_by_idx
  on public.docket_capacity_overrides (overridden_by);

comment on column public.docket_capacity_overrides.magistrate_profile_id is
  'The magistrate whose capacity was exceeded: the hearing''s presiding magistrate.';
comment on column public.docket_capacity_overrides.overridden_by is
  'Who acknowledged the override (0163): the magistrate themselves, or the clerk who listed the hearing for them. Backfilled from magistrate_profile_id for earlier rows, which only magistrates could make.';

alter policy "Magistrates can view their own Docket Capacity Overrides"
  on public.docket_capacity_overrides
  using (
    magistrate_profile_id = (select auth.uid())
    or overridden_by = (select auth.uid())
    or (select public.is_admin())
  );

-- ----------------------------------------------------------------------------
-- 5. schedule_docket_event_with_capacity
-- ----------------------------------------------------------------------------

drop function if exists public.schedule_docket_event_with_capacity(
  uuid, date, uuid, time, text, text, text, text, text, text, text, uuid, boolean, text
);

create function public.schedule_docket_event_with_capacity(
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
  p_override_reason text default null,
  p_expected_updated_at timestamptz default null
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
  v_capacity integer;
  v_category_name text;
  v_count integer;
  v_event_id uuid;
  v_will_count boolean;
  v_presiding uuid;
  v_old_date date;
  v_old_status text;
  v_old_outcome text;
  v_old_presiding uuid;
  v_old_updated_at timestamptz;
  v_is_adjournment boolean := false;
  v_adjourn_label text;
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

  if not public.can_edit_docket_matter(v_matter_id) then
    raise exception 'Not authorized to schedule Docket Events on this matter.';
  end if;

  -- B-03: one scheduling write per matter at a time.
  perform 1 from public.docket_matters dm where dm.id = v_matter_id for no key update;

  if p_event_id is not null then
    select ev.scheduled_date, ev.event_status, ev.outcome_at_event,
           ev.presiding_magistrate_id, ev.updated_at
      into v_old_date, v_old_status, v_old_outcome, v_old_presiding, v_old_updated_at
    from public.docket_events ev
    where ev.id = p_event_id
    for update;

    -- B-12: the hearing changed since the caller read it.
    if p_expected_updated_at is not null and v_old_updated_at is distinct from p_expected_updated_at then
      return query select
        'conflict'::text, p_event_id, p_category_id, null::text, null::integer, null::integer, false;
      return;
    end if;

    v_is_adjournment := v_old_status = 'scheduled' and v_old_date is distinct from p_scheduled_date;
  end if;

  -- An in-place edit keeps its presiding magistrate; a new row gets the
  -- one docket_events_guard() would give it.
  if p_event_id is not null and not v_is_adjournment then
    v_presiding := v_old_presiding;
  else
    v_presiding := public.new_docket_event_presiding_magistrate(v_matter_id, p_event_id);
  end if;

  v_will_count := p_category_id is not null and p_event_status = 'scheduled' and v_presiding is not null;

  if v_will_count then
    -- B-05: one capacity decision per magistrate, category and day at a time.
    perform pg_advisory_xact_lock(hashtextextended(
      format('docket_capacity:%s:%s:%s', v_presiding, p_category_id, p_scheduled_date), 0));

    select s.daily_capacity into v_capacity
    from public.docket_capacity_settings s
    where s.owner_id = v_presiding and s.category_id = p_category_id;

    select c.name into v_category_name from public.docket_matter_categories c where c.id = p_category_id;

    v_count := public.docket_booked_count(v_presiding, p_category_id, p_scheduled_date, v_matter_id);

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
      p_location, p_event_status, p_category_id, (select auth.uid()), v_presiding
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
      p_location, p_event_status, p_category_id, (select auth.uid()), v_presiding
    )
    returning id into v_event_id;
  end if;

  if v_will_count and v_capacity is not null and v_count >= v_capacity then
    insert into public.docket_capacity_overrides (
      docket_event_id, docket_matter_id, category_id, magistrate_profile_id, overridden_by,
      scheduled_date, configured_capacity, scheduled_count_at_override, reason
    ) values (
      v_event_id, v_matter_id, p_category_id, v_presiding, (select auth.uid()),
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

revoke all on function public.schedule_docket_event_with_capacity(
  uuid, date, uuid, time, text, text, text, text, text, text, text, uuid, boolean, text, timestamptz
) from public, anon;
grant execute on function public.schedule_docket_event_with_capacity(
  uuid, date, uuid, time, text, text, text, text, text, text, text, uuid, boolean, text, timestamptz
) to authenticated;

comment on function public.schedule_docket_event_with_capacity(
  uuid, date, uuid, time, text, text, text, text, text, text, text, uuid, boolean, text, timestamptz
) is
  'Capacity-aware create/update for a single Docket Event. Requires can_edit_docket_matter (0141). Locks the matter, then takes an advisory lock per presiding magistrate, category and date before counting with docket_booked_count (0163), so concurrent bookings cannot overbook. Capacity belongs to the hearing''s presiding magistrate: the existing one for an in-place edit, new_docket_event_presiding_magistrate() for a new row. With p_expected_updated_at, an edit of a hearing changed since it was read returns status conflict and writes nothing (0163). Changing the date of a still-scheduled event is an adjournment (0119): the original row stays on its date as completed with outcome_at_event stamped Adjourned to …, and a new row is inserted for the new date.';

-- ----------------------------------------------------------------------------
-- 6. set_docket_matter_next_date
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
  v_old_event_id uuid;
  v_old_scheduled_date date;
  v_old_outcome text;
  v_old_presiding uuid;
  v_presiding uuid;
  v_stage text;
  v_capacity integer;
  v_category_id uuid;
  v_category_name text;
  v_count integer;
  v_event_id uuid;
  v_will_count boolean;
  v_adjourn_label text;
begin
  if not public.can_edit_docket_matter(p_docket_matter_id) then
    raise exception 'Not authorized to schedule Docket Events on this matter.';
  end if;

  -- B-03: lock before reading the current next date, so a concurrent
  -- adjournment is seen and superseded rather than left live beside ours.
  select dm.category_id into v_category_id
  from public.docket_matters dm
  where dm.id = p_docket_matter_id
  for no key update;

  if p_category_id is not null then
    v_category_id := p_category_id;
  end if;

  select e.id, e.scheduled_date, e.outcome_at_event, e.presiding_magistrate_id
    into v_old_event_id, v_old_scheduled_date, v_old_outcome, v_old_presiding
  from public.docket_events e
  where e.docket_matter_id = p_docket_matter_id
    and e.event_status = 'scheduled'
    and e.scheduled_date >= current_date
  order by e.scheduled_date
  limit 1;

  if v_old_event_id is not null and v_old_scheduled_date = p_scheduled_date then
    v_will_count := v_category_id is not null and v_old_presiding is not null;
    if v_will_count then
      select s.daily_capacity into v_capacity
      from public.docket_capacity_settings s
      where s.owner_id = v_old_presiding and s.category_id = v_category_id;
      select c.name into v_category_name from public.docket_matter_categories c where c.id = v_category_id;
      v_count := public.docket_booked_count(v_old_presiding, v_category_id, p_scheduled_date);
    end if;
    return query select
      'created'::text, v_old_event_id, v_category_id, v_category_name, v_capacity,
      coalesce(v_count, 0), (v_capacity is not null and coalesce(v_count, 0) > v_capacity);
    return;
  end if;

  v_presiding := public.new_docket_event_presiding_magistrate(p_docket_matter_id, v_old_event_id);
  v_will_count := v_category_id is not null and v_presiding is not null;

  if v_will_count then
    -- B-05: one capacity decision per magistrate, category and day at a time.
    perform pg_advisory_xact_lock(hashtextextended(
      format('docket_capacity:%s:%s:%s', v_presiding, v_category_id, p_scheduled_date), 0));

    select s.daily_capacity into v_capacity
    from public.docket_capacity_settings s
    where s.owner_id = v_presiding and s.category_id = v_category_id;

    select c.name into v_category_name from public.docket_matter_categories c where c.id = v_category_id;

    v_count := public.docket_booked_count(v_presiding, v_category_id, p_scheduled_date, p_docket_matter_id);

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
    (select auth.uid()), v_presiding
  )
  returning id into v_event_id;

  if v_will_count and v_capacity is not null and v_count >= v_capacity then
    insert into public.docket_capacity_overrides (
      docket_event_id, docket_matter_id, category_id, magistrate_profile_id, overridden_by,
      scheduled_date, configured_capacity, scheduled_count_at_override, reason
    ) values (
      v_event_id, p_docket_matter_id, v_category_id, v_presiding, (select auth.uid()),
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

comment on function public.set_docket_matter_next_date(uuid, date, uuid, boolean, text) is
  'Sets/changes a Docket Matter''s Next Date. Requires can_edit_docket_matter (0141). Locks the matter first, so concurrent adjournments run in turn and one live next date remains (0163). Supersedes the event currently driving next_appearance by marking it completed (0119 adjournment, including future dates) and stamping outcome_at_event Adjourned to … when empty. The new hearing''s presiding magistrate, and so the capacity it counts against, is new_docket_event_presiding_magistrate(); the count is docket_booked_count under an advisory lock per magistrate, category and date (0163). When p_category_id is null, the matter''s own category_id is used.';

-- ----------------------------------------------------------------------------
-- 7. Calendar snapshot and next free day, on the same count
-- ----------------------------------------------------------------------------

create or replace function public.get_docket_capacity_snapshot(
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
      and e.event_status <> 'entered_in_error'
      and dm.deleted_at is null
      and (p_court_id is null or dm.court_id = p_court_id)
  )
  select
    c.id as category_id,
    c.name as category_name,
    s.daily_capacity,
    ev.scheduled_count,
    case
      when s.daily_capacity is null then 'not_set'
      when ev.scheduled_count > s.daily_capacity then 'over_capacity'
      when ev.scheduled_count = s.daily_capacity then 'full'
      else 'available'
    end as status,
    coalesce((select dt.total_matters_count from day_total dt), 0) as total_matters_count
  from public.docket_matter_categories c
  left join public.docket_capacity_settings s
    on s.category_id = c.id and s.owner_id = (select auth.uid())
  cross join lateral (
    select public.docket_booked_count(
      (select auth.uid()), c.id, p_scheduled_date, null, p_court_id
    )::bigint as scheduled_count
  ) ev
  where p_category_id is null or c.id = p_category_id
  order by c.sort_order;
$$;

comment on function public.get_docket_capacity_snapshot(date, uuid, uuid) is
  'Per-category capacity for the calling magistrate on one date, counted by docket_booked_count (0163), the same count the booking RPCs enforce, plus total_matters_count: distinct live files listed that day under the same membership as list_docket_matters(p_exact_date), any non-entered_in_error appearance, any classification, not restricted to the caller as presiding magistrate. Optional p_court_id narrows both counts to one court for display; tiles omit it, so their status matches enforcement.';

drop function if exists public.find_next_available_docket_date(uuid, date, integer);

create function public.find_next_available_docket_date(
  p_category_id uuid,
  p_start_date date,
  p_max_days_ahead integer default 60,
  p_docket_matter_id uuid default null
)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_capacity integer;
  v_date date := p_start_date;
  v_days integer := 0;
begin
  if p_docket_matter_id is null then
    v_owner := (select auth.uid());
  else
    v_owner := public.new_docket_event_presiding_magistrate(p_docket_matter_id);
  end if;

  select daily_capacity into v_capacity
  from public.docket_capacity_settings
  where owner_id = v_owner and category_id = p_category_id;

  if v_owner is null or v_capacity is null then
    return p_start_date;
  end if;

  loop
    if public.docket_booked_count(v_owner, p_category_id, v_date, p_docket_matter_id) < v_capacity then
      return v_date;
    end if;

    v_date := v_date + 1;
    v_days := v_days + 1;
    exit when v_days >= p_max_days_ahead;
  end loop;

  return null;
end;
$$;

revoke all on function public.find_next_available_docket_date(uuid, date, integer, uuid) from public, anon;
grant execute on function public.find_next_available_docket_date(uuid, date, integer, uuid) to authenticated;

comment on function public.find_next_available_docket_date(uuid, date, integer, uuid) is
  'Assistive only: the first date on/after p_start_date where the capacity owner is under their configured capacity for p_category_id, by docket_booked_count (0163), the count the booking enforces; p_start_date itself when no capacity is configured; null if none within p_max_days_ahead. The owner is the caller, or with p_docket_matter_id the magistrate a hearing the caller lists on that matter would go to (new_docket_event_presiding_magistrate), so a clerk is offered a day the sitting magistrate has free. SECURITY DEFINER to read that magistrate''s setting; returns only a date. Never writes anything.';

notify pgrst, 'reload schema';
