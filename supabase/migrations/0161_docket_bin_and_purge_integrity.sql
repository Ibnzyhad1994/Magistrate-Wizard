-- ============================================================================
-- 0161_docket_bin_and_purge_integrity.sql
--
-- Closes the four bin and purge gaps found by the 2026-10-15 multi-user
-- audit (theme T1). Every function below is re-declared from 0120/0129 (or
-- 0024/0124 for the two event-side functions); nothing outside the bin,
-- restore and purge surface changes.
--
--   B-01  Moving a matter to the bin and emptying it now need court
--         authority (has_docket_matter_authority: a current magistrate
--         assignment at the matter's court, or a retained assignment on the
--         matter). An edit share lets a recipient work the file (ADR 0006);
--         it no longer lets them remove it from the court's docket, and
--         neither does a clerk attachment. Restore stays open to every
--         editor, so anyone who can work the file can rescue it.
--         Court staff are told when a matter is binned and when it is
--         permanently deleted.
--         The purge no longer deletes bench notes. 0038 settled that a
--         bench note is the author's own work product and survives its
--         parent ("PARENT DELETION SURVIVAL"), and 0039 made such a note
--         editable once its parent is gone; 0120/0129 broke that by
--         deleting every author's notes on the matter (ADR 0004).
--
--   B-02  deleted_at / deleted_by are written only by bin_docket_matter and
--         restore_docket_matter, which stamp now() and auth.uid() on the
--         server. docket_matters_guard() refuses any client-role change to
--         either column and refuses a matter born in the bin. The two
--         functions are SECURITY DEFINER so their write is the only one the
--         guard lets through: a client session (anon/authenticated) can no
--         longer reach these columns at all.
--         The bin list no longer runs the global purge on read, and the
--         expiry purge is not executable by anon or authenticated: only
--         the hourly pg_cron job scheduled in 0120 runs it. Bin, restore,
--         purge and the bin list lose the default anon EXECUTE that 0120
--         only revoked from public.
--
--   B-04  The purge locks the matter row and deletes only while it is still
--         binned, so a restore racing a purge either wins (the purge is
--         refused as live) or loses (the restore reports not found). It can
--         no longer report "restored" and then lose the matter. Restore and
--         the expiry purge take the same lock; the expiry purge skips a row
--         a restore is holding.
--
--   B-10  docket_events_guard() refuses a new or changed hearing on a
--         binned matter, which also covers set_docket_matter_next_date and
--         schedule_docket_event_with_capacity (both write through this
--         trigger). mark_past_hearings() skips binned matters, so the daily
--         job never trips that refusal; their hearings are marked past on
--         the first run after a restore.
--
-- Admin keeps the documented 0120 purge path (purge_docket_matter or
-- is_admin()); no new admin path is added, and with bench notes kept that
-- path can no longer touch author-only content.
-- ============================================================================

-- 1. Notification kinds ------------------------------------------------------

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
    'docket_matter_purged'
  ));

create or replace function public.notify_court_staff_except(
  p_court_id uuid,
  p_except_profile_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_link text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select profile_id
    from public.magistrate_courts
    where court_id = p_court_id
      and ended_at is null
    union
    select profile_id
    from public.clerk_courts
    where court_id = p_court_id
      and ended_at is null
  loop
    if r.profile_id is distinct from p_except_profile_id then
      perform public.notify_user(r.profile_id, p_type, p_title, p_body, p_link);
    end if;
  end loop;
end;
$$;

revoke all on function public.notify_court_staff_except(uuid, uuid, text, text, text, text) from public, anon, authenticated;

comment on function public.notify_court_staff_except(uuid, uuid, text, text, text, text) is
  'notify_court_staff() (0123) without the acting user: the court''s current magistrates and clerks, minus p_except_profile_id. Internal; called by the bin and purge functions (0161).';

-- 2. Guard: bin columns are server-stamped only -----------------------------

create or replace function public.docket_matters_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_district_id uuid;
  v_is_active boolean;
begin
  if tg_op = 'UPDATE' and old.deleted_at is not null and new.deleted_at is not null then
    raise exception 'A binned Docket Matter cannot be edited. Restore it first.';
  end if;

  if tg_op = 'INSERT' and (new.deleted_at is not null or new.deleted_by is not null) then
    raise exception 'A Docket Matter cannot be created in the bin.';
  end if;

  -- bin_docket_matter / restore_docket_matter are SECURITY DEFINER, so a
  -- client role here means the change came straight from the API.
  if tg_op = 'UPDATE'
    and (new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by)
    and current_user in ('anon', 'authenticated')
  then
    raise exception 'A Docket Matter moves to and from the bin only through Move to bin and Restore.';
  end if;

  if tg_op = 'UPDATE' and new.court_id is distinct from old.court_id then
    raise exception 'A Docket Matter''s court cannot be changed through an ordinary update. Court reassignment is not supported.';
  end if;

  if tg_op = 'INSERT' then
    select c.district_id, c.is_active into v_district_id, v_is_active
    from public.courts c
    where c.id = new.court_id;

    if v_district_id is null then
      raise exception 'Cannot create a Docket Matter at court % - that court has no Magisterial District assigned', new.court_id;
    end if;

    if not coalesce(v_is_active, false) then
      raise exception 'Cannot create a Docket Matter at inactive court % - is_active must be true to accept new Docket entry', new.court_id;
    end if;

    new.district_id := v_district_id;
  else
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
  'Derives district_id from court_id on INSERT only; force-preserves district_id/created_by on UPDATE; forces last_updated_by on UPDATE. court_id is immutable (0097). Binned rows (deleted_at set) reject further edits until restored (0120). deleted_at/deleted_by are never set on INSERT and never changed by a client role: only bin_docket_matter/restore_docket_matter write them (0161).';

-- 3. Bin / restore -----------------------------------------------------------

create or replace function public.bin_docket_matter(p_id uuid)
returns public.docket_matters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.docket_matters;
begin
  if p_id is null then
    raise exception 'Matter id is required.';
  end if;

  if not public.has_docket_matter_authority(p_id) then
    raise exception 'You do not have permission to delete this matter.';
  end if;

  select * into v_row from public.docket_matters where id = p_id for update;
  if not found then
    raise exception 'This matter could not be found, or you no longer have access to it.';
  end if;

  if v_row.deleted_at is not null then
    return v_row;
  end if;

  update public.docket_matters
  set deleted_at = now(),
      deleted_by = (select auth.uid())
  where id = p_id
  returning * into v_row;

  perform public.notify_court_staff_except(
    v_row.court_id,
    (select auth.uid()),
    'docket_matter_binned',
    'Matter moved to the bin',
    coalesce(v_row.case_number || ' · ', '') || coalesce(v_row.matter_title, 'A matter')
      || ' is in the bin and will be permanently deleted after 7 days unless it is restored.',
    '/docket/' || v_row.id::text
  );

  return v_row;
end;
$$;

create or replace function public.restore_docket_matter(p_id uuid)
returns public.docket_matters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.docket_matters;
begin
  if p_id is null then
    raise exception 'Matter id is required.';
  end if;

  if not public.can_edit_docket_matter(p_id) then
    raise exception 'You do not have permission to restore this matter.';
  end if;

  select * into v_row from public.docket_matters where id = p_id for update;
  if not found then
    raise exception 'This matter could not be found, or you no longer have access to it.';
  end if;

  if v_row.deleted_at is null then
    return v_row;
  end if;

  update public.docket_matters
  set deleted_at = null,
      deleted_by = null
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.bin_docket_matter(uuid) from public, anon;
revoke execute on function public.restore_docket_matter(uuid) from public, anon;
grant execute on function public.bin_docket_matter(uuid) to authenticated;
grant execute on function public.restore_docket_matter(uuid) to authenticated;

comment on function public.bin_docket_matter(uuid) is
  'Moves a Docket Matter to the bin, stamping deleted_at = now() and deleted_by = auth.uid(). Requires has_docket_matter_authority (court or retained assignment; never a share or a clerk attachment). Tells the court''s other staff. No-op if already binned. SECURITY DEFINER so it is the only writer of the bin columns (0161).';
comment on function public.restore_docket_matter(uuid) is
  'Clears deleted_at/deleted_by so the matter returns to the live Docket. Requires can_edit_docket_matter. Locks the row, so it cannot interleave with a purge. SECURITY DEFINER so it is the only writer of the bin columns besides bin_docket_matter (0161).';

-- 4. Hard purge ---------------------------------------------------------------
-- Child FKs stay ON DELETE RESTRICT. This function deletes matter-owned
-- rows in dependency order, then the matter. Judgments, case law, quick
-- codes and bench notes themselves are not deleted, only association rows;
-- a bench note keeps its now-unresolved (entity_type, entity_id) pair, as
-- 0038 decided. documents_parent_cascade_delete (0040) removes documents
-- rows after the matter DELETE; it does not remove storage.objects.

create or replace function public.purge_docket_matter_row(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_id is null then
    return;
  end if;

  perform 1 from public.docket_matters where id = p_id and deleted_at is not null for update;
  if not found then
    raise exception 'This matter is no longer in the bin, so it was not permanently deleted.';
  end if;

  delete from public.docket_event_calendar_links
  where docket_event_id in (
    select id from public.docket_events where docket_matter_id = p_id
  );

  delete from public.docket_events where docket_matter_id = p_id;
  delete from public.docket_matter_parties where docket_matter_id = p_id;
  delete from public.docket_matter_tags where docket_matter_id = p_id;
  delete from public.docket_matter_assignments where docket_matter_id = p_id;
  delete from public.shares where item_type = 'docket_matter' and item_id = p_id;
  delete from public.docket_matter_judgments where docket_matter_id = p_id;
  delete from public.docket_matter_case_law where docket_matter_id = p_id;
  delete from public.quick_code_docket_matters where docket_matter_id = p_id;
  delete from public.bookmarks where entity_type = 'docket_matter' and entity_id = p_id;
  delete from public.docket_callover_items where docket_matter_id = p_id;

  delete from public.docket_matters where id = p_id and deleted_at is not null;
  if not found then
    raise exception 'This matter is no longer in the bin, so it was not permanently deleted.';
  end if;
end;
$$;

revoke execute on function public.purge_docket_matter_row(uuid) from public, anon, authenticated;

comment on function public.purge_docket_matter_row(uuid) is
  'Internal hard-delete of one binned Docket Matter and matter-owned children, including its callover items (0129). Locks the row and refuses unless it is still binned (0161). Keeps every bench note (0038, ADR 0004). Not granted to authenticated. Called only by purge_docket_matter / purge_expired_docket_matters.';

create or replace function public.purge_docket_matter(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.docket_matters;
begin
  if p_id is null then
    raise exception 'Matter id is required.';
  end if;

  if not (
    public.has_docket_matter_authority(p_id)
    or public.is_admin()
  ) then
    raise exception 'You do not have permission to permanently delete this matter.';
  end if;

  select * into v_row from public.docket_matters where id = p_id for update;
  if not found then
    raise exception 'This matter could not be found, or you no longer have access to it.';
  end if;

  if v_row.deleted_at is null then
    raise exception 'A live Docket Matter cannot be permanently deleted. Move it to the bin first.';
  end if;

  perform public.purge_docket_matter_row(p_id);

  perform public.notify_court_staff_except(
    v_row.court_id,
    (select auth.uid()),
    'docket_matter_purged',
    'Matter permanently deleted',
    coalesce(v_row.case_number || ' · ', '') || coalesce(v_row.matter_title, 'A matter')
      || ' was emptied from the bin and permanently deleted.',
    '/docket/' || v_row.id::text
  );
end;
$$;

create or replace function public.purge_expired_docket_matters()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select id, court_id, case_number, matter_title
    from public.docket_matters
    where deleted_at is not null
      and deleted_at <= now() - interval '7 days'
    for update skip locked
  loop
    perform public.purge_docket_matter_row(r.id);
    perform public.notify_court_staff_except(
      r.court_id,
      null,
      'docket_matter_purged',
      'Matter permanently deleted',
      coalesce(r.case_number || ' · ', '') || coalesce(r.matter_title, 'A matter')
        || ' spent 7 days in the bin and was permanently deleted.',
      '/docket/' || r.id::text
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.purge_docket_matter(uuid) from public, anon;
grant execute on function public.purge_docket_matter(uuid) to authenticated;
revoke execute on function public.purge_expired_docket_matters() from public, anon, authenticated;

comment on function public.purge_docket_matter(uuid) is
  'Permanently deletes a binned Docket Matter ("Empty now"). Requires has_docket_matter_authority or is_admin; a share or a clerk attachment is not enough (0161). Live rows are rejected under a row lock, so a racing restore cannot be lost. Tells the court''s other staff.';
comment on function public.purge_expired_docket_matters() is
  'Hard-deletes every Docket Matter binned for 7 days or more and tells the court''s staff. Run only by the hourly pg_cron job (0120); not executable by anon or authenticated (0161). Skips a row a restore is holding.';

-- 5. Bin list (read only) ------------------------------------------------------

drop function if exists public.list_binned_docket_matters();

create function public.list_binned_docket_matters()
returns table (
  id uuid,
  case_number text,
  matter_title text,
  status docket_matter_status,
  court_id uuid,
  court_name text,
  deleted_at timestamptz,
  deleted_by uuid,
  updated_at timestamptz,
  can_purge boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    dm.id,
    dm.case_number,
    dm.matter_title,
    dm.status,
    dm.court_id,
    c.name as court_name,
    dm.deleted_at,
    dm.deleted_by,
    dm.updated_at,
    public.has_docket_matter_authority(dm.id) as can_purge
  from public.docket_matters dm
  left join public.courts c on c.id = dm.court_id
  where dm.deleted_at is not null
    and public.can_edit_docket_matter(dm.id)
  order by dm.deleted_at desc;
$$;

revoke execute on function public.list_binned_docket_matters() from public, anon;
grant execute on function public.list_binned_docket_matters() to authenticated;

comment on function public.list_binned_docket_matters() is
  'Matters in the bin that the caller can edit (and so restore), with can_purge where the caller may also empty them now. Read only: it no longer runs purge_expired_docket_matters (0161); the hourly pg_cron job does.';

-- 6. Hearings on a binned matter ---------------------------------------------

create or replace function public.docket_events_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_presiding_nulled boolean;
begin
  if tg_op = 'UPDATE' and new.docket_matter_id is distinct from old.docket_matter_id then
    raise exception 'A Docket Event''s docket_matter_id is immutable; it cannot be moved to another Docket Matter. Create a new event on the correct matter instead.';
  end if;

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

  if tg_op = 'INSERT' then
    new.presiding_magistrate_id := (select auth.uid());
  else
    v_presiding_nulled := old.presiding_magistrate_id is not null and new.presiding_magistrate_id is null;
    if v_presiding_nulled then
      new.presiding_magistrate_id := null;
    else
      new.presiding_magistrate_id := old.presiding_magistrate_id;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    new.last_updated_by := (select auth.uid());
  end if;

  return new;
end;
$$;

comment on function public.docket_events_guard() is 'BEFORE INSERT OR UPDATE guard combining four protections: docket_matter_id immutability (exception on change), no new or changed event on a binned matter (0161; covers set_docket_matter_next_date and schedule_docket_event_with_capacity, which write through this trigger), created_by provenance (forced at creation, force-preserved after; safe unconditionally, since created_by is ON DELETE RESTRICT), and presiding_magistrate_id provenance (forced at creation, force-preserved after, except the profile''s own ON DELETE SET NULL transition, which is permitted and independently closed off to client forgery by the UPDATE policy''s WITH CHECK).';

create or replace function public.mark_past_hearings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.docket_events de
     set event_status = 'past'
   where de.event_status = 'scheduled'
     and de.scheduled_date < public.guyana_today()
     and not exists (
       select 1 from public.docket_matters dm
       where dm.id = de.docket_matter_id
         and dm.deleted_at is not null
     );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.mark_past_hearings() is
  'Marks still-scheduled docket_events as past once the Guyana calendar date has elapsed. Skips binned matters, which are frozen until restored (0161).';

revoke all on function public.mark_past_hearings() from public, anon, authenticated;
