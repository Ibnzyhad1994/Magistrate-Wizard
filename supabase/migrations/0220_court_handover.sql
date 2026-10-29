-- Magistrate Wizard -- 0220: court hand-over (pre-flight, orphan pins, judgment transfer)
--
-- Problem (backend sweep BE-26)
--   1. relinquish_magistrate_court never touches part-heard matters (by
--      design, 0108), but nothing tells the magistrate or an administrator,
--      before the assignment ends, which open matters the magistrate has
--      heard evidence in and not retained.
--   2. A judgment pin (docket_matter_judgments) is visible only to someone
--      who can see both the matter and the judgment. When the judgment's
--      owner leaves the court, a pin of a private judgment is visible to
--      nobody, and the owner can no longer unlink it (system audit §7.3).
--   3. judgments.owner_id is immutable and ON DELETE RESTRICT, so a
--      departing magistrate's judgments can never reach a successor.
--
-- Change (ADR 0011)
--   1. relinquish_preflight(p_assignment_id) is read-only. For the
--      assignment's magistrate or an administrator it lists:
--        * the open matters at that court the magistrate has heard and not
--          retained (part_heard_unretained). A matter counts when it is
--          active or stayed, not in the bin, and the magistrate presided
--          at a held sitting of it (not cancelled or entered in error, on
--          or before today) that took evidence (a witness completed or
--          partly heard, or the outcome "Part-heard"), or presided at its
--          latest held sitting while its trial or paper committal is part
--          way;
--        * the magistrate's judgments pinned to that court's matters, each
--          with will_unlink: true when ending this assignment leaves the
--          pin visible to nobody but its owner (see 2).
--      Only the magistrate themselves sees case numbers, matter titles and
--      judgment titles. An administrator gets ids, statuses and dates.
--   2. A pin of a judgment that is not discoverable and has no active
--      share is visible only to its owner. When the owner loses the last
--      access path to the matter (court assignment, retained assignment or
--      docket share), the pin is unlinked: ending a court assignment, by
--      any path, and ending a retained assignment both do it, by trigger.
--      Each unlink writes an audit_log row with the pin's ids.
--      unlink_my_orphaned_judgment_pins(p_dry_run) lets an owner count or
--      clear such pins left by earlier hand-overs; this migration deletes
--      none of them itself.
--   3. transfer_judgment_ownership(p_judgment_id, p_to_profile_id,
--      p_court_id, p_reason) moves a judgment to another active magistrate
--      who sits at p_court_id, where its current owner sits or sat.
--      Administrators only, with a reason. It keeps the judgment's content,
--      status, finalisation, versions, tags, shares, pins and documents as
--      they are and deletes nothing; it records the transfer, with the
--      original author, in judgment_ownership_transfers, writes an
--      audit_log event and notifies both magistrates (judgment_transferred).
--      owner_id still cannot change from any client role or the service
--      role: only this function changes it.
--
-- Threat model
--   ADR 0007 is kept: no function here returns judgment or matter content
--   to an administrator. transfer_judgment_ownership returns ids; the
--   pre-flight returns ids, statuses and dates to an administrator.
--   ADR 0011 records the one narrowing of ADR 0002 / 0027: an
--   administrator may decide who owns a judgment, never read it, and only
--   towards an active magistrate of a court its owner sat at.
--   Every new SECURITY DEFINER function has a fixed search_path, trusts only
--   auth.uid() for the caller, and is not executable by anon; the trigger
--   and internal functions are executable by no client role.
--   judgment_ownership_transfers has RLS: the parties to a transfer and
--   administrators read it (ids and the reason only); no client writes it.
-- ============================================================================

-- 1. Notification kind ---------------------------------------------------------

alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (type in (
    'share_granted',
    'share_revoked',
    'judgment_final',
    'court_assigned',
    'court_ended',
    'clerk_request',
    'clerk_request_decided',
    'court_request',
    'court_request_decided',
    'account_type_corrected',
    'hearing_tomorrow',
    'stale_draft',
    'issue_report_decided',
    'docket_matter_binned',
    'docket_matter_purged',
    'maintenance_failed',
    'judgment_transferred'
  ));

-- 2. judgment_ownership_transfers ----------------------------------------------

create table public.judgment_ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  judgment_id uuid not null references public.judgments (id) on delete cascade,
  from_owner_id uuid not null references public.profiles (id) on delete restrict,
  to_owner_id uuid not null references public.profiles (id) on delete restrict,
  original_author_id uuid not null references public.profiles (id) on delete restrict,
  transferred_by uuid not null references public.profiles (id) on delete restrict,
  court_id uuid not null references public.courts (id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint judgment_ownership_transfers_other_owner check (from_owner_id <> to_owner_id),
  constraint judgment_ownership_transfers_reason_length
    check (char_length(btrim(reason)) between 1 and 500)
);

comment on table public.judgment_ownership_transfers is
  'Append-only record of judgment ownership transfers (0220, BE-26, ADR 0011). Written only by transfer_judgment_ownership. original_author_id is the judgment''s first owner, carried on every transfer, so authorship survives any number of hand-overs. Ids and the administrator''s reason only, never judgment content. A judgment''s owner may still delete it while it is a draft; its transfer rows go with it, and audit_log keeps the event.';

create index judgment_ownership_transfers_judgment_id_idx
  on public.judgment_ownership_transfers (judgment_id, created_at);
create index judgment_ownership_transfers_from_owner_id_idx
  on public.judgment_ownership_transfers (from_owner_id);
create index judgment_ownership_transfers_to_owner_id_idx
  on public.judgment_ownership_transfers (to_owner_id);
create index judgment_ownership_transfers_original_author_id_idx
  on public.judgment_ownership_transfers (original_author_id);
create index judgment_ownership_transfers_transferred_by_idx
  on public.judgment_ownership_transfers (transferred_by);
create index judgment_ownership_transfers_court_id_idx
  on public.judgment_ownership_transfers (court_id);

alter table public.judgment_ownership_transfers enable row level security;

create policy "Parties to a transfer and administrators can view it"
  on public.judgment_ownership_transfers
  for select
  to authenticated
  using (
    (select auth.uid()) in (from_owner_id, to_owner_id, original_author_id)
    or (select public.is_admin())
  );

create policy "Deactivated accounts have no access"
  on public.judgment_ownership_transfers
  as restrictive
  to authenticated
  using ((select public.active_account_id()) is not null)
  with check ((select public.active_account_id()) is not null);

revoke all on table public.judgment_ownership_transfers from public, anon, authenticated;
grant select on table public.judgment_ownership_transfers to authenticated;

-- 3. owner_id changes only through transfer_judgment_ownership ----------------

create or replace function public.judgments_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := (select auth.uid());
  elsif tg_op = 'UPDATE' then
    -- transfer_judgment_ownership is SECURITY DEFINER, so a client or the
    -- service role here means the change did not come through it.
    if new.owner_id is distinct from old.owner_id
      and current_user in ('anon', 'authenticated', 'service_role')
    then
      raise exception 'A Judgment''s owner changes only through an administrator''s transfer (transfer_judgment_ownership).'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.judgments_guard() is
  'BEFORE INSERT OR UPDATE on judgments: forces owner_id to auth.uid() at creation, and refuses an owner_id change from anon, authenticated or the service role, so it changes only through transfer_judgment_ownership (0220, ADR 0011), which records it.';

comment on table public.judgments is
  'Individually owned Judgment records. Never Court-owned. Private to owner by default; is_discoverable (owner-controlled) grants other magistrates read-only access, never edit. No admin bypass: an administrator can transfer ownership (transfer_judgment_ownership, 0220, ADR 0011) but never read the content. Fully independent from Docket/Court access -- linking to a Docket Matter (docket_matter_judgments) is association only and never confers access.';

comment on column public.judgments.owner_id is
  'The current owner. Forced to auth.uid() at creation by a guard trigger (cannot be forged). Changes only through transfer_judgment_ownership (0220, ADR 0011): an administrator moves it to an active magistrate of a court the owner sat at, and judgment_ownership_transfers keeps the original author. ON DELETE RESTRICT matches the docket_matters.created_by provenance convention.';

-- 4. Orphaned judgment pins -----------------------------------------------------

create or replace function public.unlink_orphaned_judgment_pins(
  p_owner_id uuid,
  p_court_id uuid default null,
  p_docket_matter_id uuid default null,
  p_reason text default null,
  p_dry_run boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_count integer;
begin
  if p_owner_id is null then
    return 0;
  end if;

  -- A pin is visible to someone who can see both its matter and its
  -- judgment. A judgment that is not discoverable and has no active share
  -- is visible only to its owner, so once the owner cannot see the matter
  -- either, nobody can see the pin.
  select coalesce(array_agg(dmj.id order by dmj.created_at, dmj.id), '{}')
  into v_ids
  from public.docket_matter_judgments dmj
  join public.judgments j on j.id = dmj.judgment_id
  join public.docket_matters dm on dm.id = dmj.docket_matter_id
  where j.owner_id = p_owner_id
    and (p_court_id is null or dm.court_id = p_court_id)
    and (p_docket_matter_id is null or dm.id = p_docket_matter_id)
    and not j.is_discoverable
    and not exists (
      select 1 from public.shares s
      where s.item_type = 'judgment'
        and s.item_id = j.id
        and s.recipient_id is not null
        and s.revoked_at is null
    )
    and not exists (
      select 1 from public.magistrate_courts mc
      where mc.profile_id = p_owner_id
        and mc.court_id = dm.court_id
        and mc.ended_at is null
    )
    and not exists (
      select 1 from public.docket_matter_assignments a
      where a.profile_id = p_owner_id
        and a.docket_matter_id = dm.id
        and a.ended_at is null
    )
    and not exists (
      select 1 from public.shares s
      where s.item_type = 'docket_matter'
        and s.item_id = dm.id
        and s.recipient_id = p_owner_id
        and s.revoked_at is null
    );

  if p_dry_run or cardinality(v_ids) = 0 then
    return cardinality(v_ids);
  end if;

  with gone as (
    delete from public.docket_matter_judgments dmj
    where dmj.id = any (v_ids)
    returning dmj.id, dmj.docket_matter_id, dmj.judgment_id, dmj.created_by, dmj.created_at
  ),
  logged as (
    insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    select
      (select auth.uid()),
      'delete',
      'docket_matter_judgments',
      g.id,
      jsonb_build_object(
        'id', g.id,
        'docket_matter_id', g.docket_matter_id,
        'judgment_id', g.judgment_id,
        'created_by', g.created_by,
        'created_at', g.created_at
      ),
      jsonb_build_object(
        'event', 'judgment_pin_unlinked',
        'owner_id', p_owner_id,
        'reason', p_reason
      )
    from gone g
    returning 1
  )
  select count(*) into v_count from logged;

  return v_count;
end;
$$;

comment on function public.unlink_orphaned_judgment_pins(uuid, uuid, uuid, text, boolean) is
  'Internal (0220, BE-26). Unlinks, or with p_dry_run counts, the pins of p_owner_id''s judgments that nobody else can see (not discoverable, no active share) on matters p_owner_id can no longer see (no current court or retained assignment, no docket share), optionally within one court or one matter. Writes one audit_log row per unlinked pin (ids only). Executable by no client role.';

revoke all on function public.unlink_orphaned_judgment_pins(uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated;

create or replace function public.unlink_judgment_pins_on_court_end()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.unlink_orphaned_judgment_pins(
    new.profile_id, new.court_id, null, 'court_assignment_ended'
  );
  return null;
end;
$$;

comment on function public.unlink_judgment_pins_on_court_end() is
  'AFTER UPDATE OF ended_at on magistrate_courts (0220, BE-26): when an assignment ends, by relinquish, an administrator or the first-sign-in rule, unlinks that magistrate''s judgment pins at that court that are now visible to nobody (unlink_orphaned_judgment_pins). Executable by no client role.';

revoke all on function public.unlink_judgment_pins_on_court_end() from public, anon, authenticated;

create trigger magistrate_courts_unlink_orphaned_judgment_pins
  after update of ended_at on public.magistrate_courts
  for each row
  when (old.ended_at is null and new.ended_at is not null)
  execute function public.unlink_judgment_pins_on_court_end();

create or replace function public.unlink_judgment_pins_on_retained_end()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.unlink_orphaned_judgment_pins(
    new.profile_id, null, new.docket_matter_id, 'retained_assignment_ended'
  );
  return null;
end;
$$;

comment on function public.unlink_judgment_pins_on_retained_end() is
  'AFTER UPDATE OF ended_at on docket_matter_assignments (0220, BE-26): when a retained assignment ends, unlinks that magistrate''s judgment pins on that matter that are now visible to nobody (unlink_orphaned_judgment_pins). A profile already removed (profile_id null) has nothing to unlink. Executable by no client role.';

revoke all on function public.unlink_judgment_pins_on_retained_end() from public, anon, authenticated;

create trigger docket_matter_assignments_unlink_orphaned_judgment_pins
  after update of ended_at on public.docket_matter_assignments
  for each row
  when (old.ended_at is null and new.ended_at is not null)
  execute function public.unlink_judgment_pins_on_retained_end();

create or replace function public.unlink_my_orphaned_judgment_pins(p_dry_run boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or not (select public.is_active_account()) then
    raise exception 'Not authenticated'
      using errcode = '42501';
  end if;

  return public.unlink_orphaned_judgment_pins(
    (select auth.uid()), null, null, 'owner_unlinked', coalesce(p_dry_run, false)
  );
end;
$$;

comment on function public.unlink_my_orphaned_judgment_pins(boolean) is
  'The caller''s own judgment pins that nobody else can see, on matters the caller can no longer see (0220, BE-26): p_dry_run counts them, otherwise they are unlinked and audited. For pins left by hand-overs before 0220; since 0220 ending an assignment unlinks them itself.';

revoke all on function public.unlink_my_orphaned_judgment_pins(boolean) from public, anon;
grant execute on function public.unlink_my_orphaned_judgment_pins(boolean) to authenticated;

-- 5. Relinquish pre-flight ------------------------------------------------------

create or replace function public.relinquish_preflight(p_assignment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.magistrate_courts;
  v_self boolean;
  v_court_name text;
  v_part_heard jsonb;
  v_pins jsonb;
begin
  select * into v_row from public.magistrate_courts where id = p_assignment_id;
  if not found then
    raise exception 'Court assignment not found'
      using errcode = 'P0002';
  end if;

  v_self := v_row.profile_id = (select auth.uid()) and (select public.is_active_account());
  if not (v_self or (select public.is_admin())) then
    raise exception 'You are not authorized to review this court assignment'
      using errcode = '42501';
  end if;

  select c.name into v_court_name from public.courts c where c.id = v_row.court_id;

  with held as (
    select
      e.docket_matter_id,
      e.scheduled_date,
      e.presiding_magistrate_id,
      (
        coalesce(e.witnesses_completed, 0) > 0
        or coalesce(e.witnesses_partly_heard, 0) > 0
        or coalesce(e.outcome_at_event, '') ~* '^\s*part[- ]?heard'
      ) as took_evidence,
      row_number() over (
        partition by e.docket_matter_id
        order by e.scheduled_date desc, e.scheduled_time desc nulls last, e.created_at desc
      ) as recency
    from public.docket_events e
    join public.docket_matters dm on dm.id = e.docket_matter_id
    where dm.court_id = v_row.court_id
      and dm.deleted_at is null
      and dm.status in ('active', 'stayed')
      and e.event_status not in ('cancelled', 'entered_in_error')
      and e.scheduled_date <= current_date
  ),
  part_heard as (
    select
      dm.id,
      dm.case_number,
      dm.matter_title,
      dm.status,
      max(h.scheduled_date) filter (where h.presiding_magistrate_id = v_row.profile_id)
        as last_heard_on
    from public.docket_matters dm
    join held h on h.docket_matter_id = dm.id
    group by dm.id
    having bool_or(
      h.presiding_magistrate_id = v_row.profile_id
      and (
        h.took_evidence
        or (
          h.recency = 1
          and (dm.trial_status = 'partial' or dm.paper_committal_status in ('commenced', 'partial'))
        )
      )
    )
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'docket_matter_id', ph.id,
        'status', ph.status,
        'last_heard_on', ph.last_heard_on
      )
      || case
        when v_self then jsonb_build_object(
          'case_number', ph.case_number,
          'matter_title', ph.matter_title
        )
        else '{}'::jsonb
      end
      order by ph.last_heard_on desc, ph.id
    ),
    '[]'::jsonb
  )
  into v_part_heard
  from part_heard ph
  where not exists (
    select 1 from public.docket_matter_assignments a
    where a.docket_matter_id = ph.id
      and a.profile_id = v_row.profile_id
      and a.ended_at is null
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'pin_id', p.pin_id,
        'judgment_id', p.judgment_id,
        'docket_matter_id', p.docket_matter_id,
        'pinned_at', p.pinned_at,
        'judgment_status', p.judgment_status,
        'is_discoverable', p.is_discoverable,
        'shared', p.shared,
        'will_unlink', not p.is_discoverable and not p.shared and not p.keeps_access
      )
      || case
        when v_self then jsonb_build_object('judgment_title', p.judgment_title)
        else '{}'::jsonb
      end
      order by p.pinned_at, p.pin_id
    ),
    '[]'::jsonb
  )
  into v_pins
  from (
    select
      dmj.id as pin_id,
      dmj.judgment_id,
      dmj.docket_matter_id,
      dmj.created_at as pinned_at,
      j.status as judgment_status,
      j.is_discoverable,
      j.title as judgment_title,
      exists (
        select 1 from public.shares s
        where s.item_type = 'judgment'
          and s.item_id = j.id
          and s.recipient_id is not null
          and s.revoked_at is null
      ) as shared,
      (
        exists (
          select 1 from public.magistrate_courts mc
          where mc.profile_id = v_row.profile_id
            and mc.court_id = dm.court_id
            and mc.ended_at is null
            and mc.id <> v_row.id
        )
        or exists (
          select 1 from public.docket_matter_assignments a
          where a.profile_id = v_row.profile_id
            and a.docket_matter_id = dm.id
            and a.ended_at is null
        )
        or exists (
          select 1 from public.shares s
          where s.item_type = 'docket_matter'
            and s.item_id = dm.id
            and s.recipient_id = v_row.profile_id
            and s.revoked_at is null
        )
      ) as keeps_access
    from public.docket_matter_judgments dmj
    join public.judgments j on j.id = dmj.judgment_id
    join public.docket_matters dm on dm.id = dmj.docket_matter_id
    where j.owner_id = v_row.profile_id
      and dm.court_id = v_row.court_id
  ) p;

  return jsonb_build_object(
    'assignment_id', v_row.id,
    'profile_id', v_row.profile_id,
    'court_id', v_row.court_id,
    'court_name', v_court_name,
    'ended', v_row.ended_at is not null,
    'part_heard_unretained', v_part_heard,
    'part_heard_unretained_count', jsonb_array_length(v_part_heard),
    'pinned_judgments', v_pins,
    'pinned_judgment_count', jsonb_array_length(v_pins),
    'pins_to_unlink_count', (
      select count(*) from jsonb_array_elements(v_pins) e where (e ->> 'will_unlink')::boolean
    )
  );
end;
$$;

comment on function public.relinquish_preflight(uuid) is
  'Read-only check before ending a magistrate''s court assignment (0220, BE-26). For the assignment''s magistrate or an administrator: the open matters at that court the magistrate heard evidence in and has not retained (part_heard_unretained), and the magistrate''s judgments pinned to that court''s matters with will_unlink for the pins that ending the assignment unlinks. Case numbers, matter titles and judgment titles go to the magistrate only; an administrator gets ids, statuses and dates (ADR 0005, 0007).';

revoke all on function public.relinquish_preflight(uuid) from public, anon;
grant execute on function public.relinquish_preflight(uuid) to authenticated;

comment on function public.relinquish_magistrate_court(uuid, text) is
  'Ends exactly one magistrate''s active court assignment (ended_at set; ended_by force-set by protect_magistrate_court_history()''s trigger, 0104, never trusted from any input here). Serves both "magistrate relinquishes their own court" (profile_id = auth.uid()) and "administrator ends an incorrect assignment" (is_admin()) -- the same function, distinguished only by who is calling, mirroring revoke_clerk_court_access() (0089). Never deletes the row, never touches docket_matters/docket_matter_assignments/clerk_courts. Ending the assignment unlinks the magistrate''s judgment pins at that court that are now visible to nobody (magistrate_courts_unlink_orphaned_judgment_pins, 0220); relinquish_preflight lists them, and the un-retained part-heard matters, beforehand. Idempotent: relinquishing an already-ended assignment returns it unchanged. Ending one court has no effect on any other court the same magistrate holds. The court becomes available for a successor the instant this commits (court_has_active_primary_magistrate() re-evaluates live) -- this IS how succession works; there is no separate succession RPC.';

-- 6. Judgment ownership transfer -----------------------------------------------

create or replace function public.transfer_judgment_ownership(
  p_judgment_id uuid,
  p_to_profile_id uuid,
  p_court_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_reason text := nullif(btrim(p_reason), '');
  v_from uuid;
  v_original uuid;
  v_transfer public.judgment_ownership_transfers;
begin
  if p_judgment_id is null or p_to_profile_id is null or p_court_id is null then
    raise exception 'p_judgment_id, p_to_profile_id and p_court_id are required'
      using errcode = '22023';
  end if;
  if not (select public.is_admin()) then
    raise exception 'Only an active administrator can transfer a judgment'
      using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Give a reason for this transfer'
      using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Keep the reason to 500 characters or fewer'
      using errcode = '22023';
  end if;

  select j.owner_id into v_from
  from public.judgments j
  where j.id = p_judgment_id
  for update;
  if not found then
    raise exception 'Judgment % not found', p_judgment_id
      using errcode = 'P0002';
  end if;

  if v_from = p_to_profile_id then
    raise exception 'This magistrate already owns the judgment'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.magistrate_courts mc
    where mc.profile_id = v_from and mc.court_id = p_court_id
  ) then
    raise exception 'The judgment''s owner has never sat at this court'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.profiles p
    join public.magistrate_courts mc on mc.profile_id = p.id
    where p.id = p_to_profile_id
      and p.is_active
      and p.role in ('magistrate', 'admin')
      and mc.court_id = p_court_id
      and mc.ended_at is null
  ) then
    raise exception 'A judgment can be transferred only to an active magistrate who sits at this court'
      using errcode = 'P0001';
  end if;

  select t.original_author_id into v_original
  from public.judgment_ownership_transfers t
  where t.judgment_id = p_judgment_id
  order by t.created_at, t.id
  limit 1;
  v_original := coalesce(v_original, v_from);

  update public.judgments set owner_id = p_to_profile_id where id = p_judgment_id;

  insert into public.judgment_ownership_transfers (
    judgment_id, from_owner_id, to_owner_id, original_author_id, transferred_by, court_id, reason
  )
  values (p_judgment_id, v_from, p_to_profile_id, v_original, v_actor, p_court_id, v_reason)
  returning * into v_transfer;

  insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
  values (
    v_actor,
    'update',
    'judgments',
    p_judgment_id,
    jsonb_build_object(
      'event', 'judgment_ownership_transferred',
      'transfer_id', v_transfer.id,
      'from_owner_id', v_from,
      'to_owner_id', p_to_profile_id,
      'original_author_id', v_original,
      'court_id', p_court_id,
      'reason', v_reason
    )
  );

  perform public.notify_user(
    p_to_profile_id,
    'judgment_transferred',
    'A judgment was transferred to you',
    'An administrator made you the owner of a judgment. Its original author stays on record.',
    '/judgments/' || p_judgment_id::text
  );
  perform public.notify_user(
    v_from,
    'judgment_transferred',
    'A judgment you owned was transferred',
    'An administrator transferred one of your judgments to another magistrate of the court. Its original author stays on record.',
    '/judgments?transferred=' || p_judgment_id::text
  );

  return jsonb_build_object(
    'transfer_id', v_transfer.id,
    'judgment_id', p_judgment_id,
    'from_owner_id', v_from,
    'to_owner_id', p_to_profile_id,
    'original_author_id', v_original,
    'court_id', p_court_id,
    'transferred_at', v_transfer.created_at
  );
end;
$$;

comment on function public.transfer_judgment_ownership(uuid, uuid, uuid, text) is
  'Moves a judgment to another owner (0220, BE-26, ADR 0011). Active administrators only, with a reason (500 characters at most). The new owner must be an active magistrate (or administrator) who sits at p_court_id, and the current owner must sit or have sat there. Changes owner_id only: content, status, finalisation, versions, tags, shares, pins and documents stay as they are and nothing is deleted. Records the transfer with the original author in judgment_ownership_transfers, writes an audit_log event and notifies both magistrates (judgment_transferred). Returns ids only, never content.';

revoke all on function public.transfer_judgment_ownership(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.transfer_judgment_ownership(uuid, uuid, uuid, text) to authenticated;
