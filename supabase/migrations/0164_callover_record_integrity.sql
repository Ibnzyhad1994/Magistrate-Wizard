-- ============================================================================
-- 0164_callover_record_integrity.sql
--
-- Closes the two callover gaps found by the 2026-10-15 multi-user audit
-- (theme T3). 0129 says a callover that has been held is a judicial record
-- that stays; until now only the DELETE policies said so, and an UPDATE
-- could undo every one of them first.
--
--   B-08  A completed callover could be set back to draft and then deleted,
--         and its sheet rewritten: an outcome changed, a call cleared, then
--         the now "uncalled" row removed. Now:
--           - a completed callover cannot be changed at all, and its sheet
--             takes no new row, edit or removal;
--           - an in-progress callover cannot go back to draft (the only
--             status a DELETE policy accepts);
--           - a call, once recorded, cannot be cleared, and the time of the
--             first call is kept;
--           - a callover with a called matter cannot be deleted, so the
--             cascade from a draft callover cannot remove called rows the
--             item DELETE policy itself protects.
--         The app had a Reopen button (completed -> in_progress); it goes,
--         because a completed sitting is no longer reopenable.
--
--   B-09  A callover item could be re-pointed at any matter, including
--         another court's, which skipped the INSERT policy's
--         can_edit_docket_matter() check. An item's docket_matter_id and
--         callover_id are now fixed at INSERT, and so is a callover's
--         court_id, so the sheet only ever lists matters that passed the
--         INSERT check for that callover's court.
--
-- WHO THE FREEZE BINDS. The record rules (completed freeze, the
-- no-delete-once-called rule) bind client roles: anon and authenticated,
-- which is every app user, administrators included (ADR 0007; no admin path
-- is added). They do not bind code running as the table owner, using the
-- same current_user test 0161 uses for deleted_at. That is what keeps the
-- authorised permanent delete of a binned matter working:
-- purge_docket_matter_row() (0129, restated by 0161) is SECURITY DEFINER and
-- deletes the matter's callover items, including those on a completed
-- sheet, as 0129 section 8 designed. The callover itself stays (the sitting
-- still happened), the removed item row is kept unredacted in audit_log
-- (0129 section 9), and nothing author-only is touched (ADR 0004). The
-- profile foreign keys' ON DELETE SET NULL runs as the owner too, so
-- deleting a profile still clears created_by on old sheets. The identity
-- rules (court, callover and matter fixed, a call never cleared) bind
-- everyone: no server path changes them.
--
-- Nothing that 0160-0163 redefine is redefined here: these are two new
-- trigger functions on the callover tables only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. docket_callovers
-- ----------------------------------------------------------------------------

create or replace function public.docket_callovers_record_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.court_id is distinct from old.court_id then
      raise exception 'A callover''s court cannot be changed.';
    end if;

    if current_user in ('anon', 'authenticated') then
      if old.status = 'completed' then
        raise exception 'This callover is completed. It is the record of the sitting and cannot be changed.';
      end if;

      if old.status = 'in_progress' and new.status = 'draft' then
        raise exception 'A callover in progress cannot be set back to draft.';
      end if;
    end if;

    return new;
  end if;

  -- DELETE. The policy already limits it to a draft; a draft whose matters
  -- have been called is still the record of a sitting.
  if current_user in ('anon', 'authenticated')
    and exists (
      select 1 from public.docket_callover_items i
      where i.callover_id = old.id
        and i.called_at is not null
    )
  then
    raise exception 'Matters on this callover have been called, so it is the record of a sitting and cannot be deleted.';
  end if;

  return old;
end;
$$;

comment on function public.docket_callovers_record_guard() is
  'Keeps a callover a record of its sitting (0164): court_id is fixed; for client roles a completed callover cannot change, in_progress cannot return to draft, and a callover with a called item cannot be deleted. Owner-run code (the purge path, FK actions) is not bound by the client-role rules.';

drop trigger if exists docket_callovers_record_guard_trigger on public.docket_callovers;
create trigger docket_callovers_record_guard_trigger
  before update or delete on public.docket_callovers
  for each row execute function public.docket_callovers_record_guard();

-- ----------------------------------------------------------------------------
-- 2. docket_callover_items
--
-- The parent is read FOR SHARE, so an edit racing "Mark completed" either
-- lands before the callover is completed or sees it completed and is
-- refused; it can never land after. SECURITY INVOKER, so the current_user
-- test sees the real caller; the caller already passed
-- can_access_callover() for this item, which is the parent's own SELECT
-- and UPDATE policy, so the parent row is visible and lockable to them.
-- ----------------------------------------------------------------------------

create or replace function public.docket_callover_items_record_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status text;
begin
  if tg_op = 'UPDATE' then
    if new.callover_id is distinct from old.callover_id then
      raise exception 'A callover item cannot be moved to another callover.';
    end if;

    if new.docket_matter_id is distinct from old.docket_matter_id then
      raise exception 'A callover item cannot be changed to another matter. Remove it and add the other matter instead.';
    end if;

    if old.called_at is not null then
      if new.called_at is null then
        raise exception 'This matter has been called. That call is part of the record of the sitting and cannot be cleared.';
      end if;
      -- The first call is the record; a later stamp from a stale screen
      -- does not move it.
      new.called_at := old.called_at;
    end if;
  end if;

  if current_user in ('anon', 'authenticated') then
    select co.status into v_status
    from public.docket_callovers co
    where co.id = case when tg_op = 'INSERT' then new.callover_id else old.callover_id end
    for share;

    if v_status = 'completed' then
      raise exception 'This callover is completed. Its sheet is the record of the sitting and cannot be changed.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.docket_callover_items_record_guard() is
  'Keeps a callover sheet a record of its sitting (0164): callover_id and docket_matter_id are fixed at INSERT, a recorded call is never cleared and keeps its first time, and for client roles a completed callover''s items take no INSERT, UPDATE or DELETE. Owner-run code (purge_docket_matter_row, FK actions) is not bound by the completed freeze.';

drop trigger if exists docket_callover_items_record_guard_trigger on public.docket_callover_items;
create trigger docket_callover_items_record_guard_trigger
  before insert or update or delete on public.docket_callover_items
  for each row execute function public.docket_callover_items_record_guard();
