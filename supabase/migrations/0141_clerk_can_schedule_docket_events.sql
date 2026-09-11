-- ============================================================================
-- 0141_clerk_can_schedule_docket_events.sql
--
-- Bug report from preview/staging: an approved clerk gets
-- "Not authorized to schedule Docket Events on this matter." when setting a
-- Next date or logging an appearance -- on matters they can otherwise edit.
--
-- Root cause: set_docket_matter_next_date() (0079) and
-- schedule_docket_event_with_capacity() (0077, redefined by 0081/0119)
-- hand-rolled their own authorization check:
--
--     (public.can_access_court(dm.court_id)) or (public.has_retained_assignment(dm.id))
--
-- That is a strict SUBSET of the real edit envelope. can_edit_docket_matter()
-- (0044, extended by 0090) is:
--
--     can_access_court | has_retained_assignment | has_docket_share(id,'edit')
--                      | has_active_clerk_assignment
--
-- When 0090 added the clerk branch it noted that routing through the two
-- centralized helpers "cascades the clerk pathway correctly to every one of
-- those tables automatically" -- true, but only for callers that actually
-- CALL the helpers. These two RPCs did not, so they silently kept the
-- pre-0090 envelope. Reproduced live as the reporting clerk: for every matter
-- at their court, can_edit_docket_matter() = true while the RPCs' own guard
-- = false. The clerk can edit the board but cannot set a hearing date, which
-- is most of the job.
--
-- Deliberately in scope: exactly these two functions. The other three
-- functions that reference can_access_court() without a clerk branch --
-- can_access_callover() (0129), has_docket_matter_authority() and
-- resolve_docket_assignment_identity() (0090) -- exclude clerks BY DESIGN and
-- say so in their own comments. Verified against the live catalogue, not
-- assumed.
--
-- Note this also widens the guard to edit-shares (has_docket_share(id,'edit')),
-- which the hand-rolled version omitted too. That is intentional and is the
-- point of using the shared helper: someone granted edit rights on a matter
-- can schedule a hearing on it. Calling the helper is what stops this drifting
-- again the next time the envelope changes.
--
-- WHY THIS REPLACES THE GUARD TEXTUALLY RATHER THAN RESTATING THE BODIES:
-- these two functions are ~6 KB of plpgsql each and their live definitions
-- DIFFER between projects (staging carries 0139's capacity changes, production
-- does not -- confirmed by comparing md5(pg_get_functiondef(...)) on both).
-- Pasting one literal body here would silently overwrite whichever project
-- disagreed with it. Swapping only the guard expression preserves each
-- environment's actual body and changes exactly one thing. Every assumption is
-- asserted below, so this fails loudly instead of silently doing nothing.
-- ============================================================================

do $$
declare
  v_old_guard constant text :=
    '(public.can_access_court(dm.court_id)) or (public.has_retained_assignment(dm.id))';
  v_new_guard constant text := 'public.can_edit_docket_matter(dm.id)';
  v_targets   constant text[] := array[
    'set_docket_matter_next_date',
    'schedule_docket_event_with_capacity'
  ];
  v_name  text;
  v_oid   oid;
  v_def   text;
  v_new   text;
  v_hits  integer;
begin
  foreach v_name in array v_targets loop
    select p.oid into v_oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name and p.prokind = 'f';

    if v_oid is null then
      raise exception '0141: public.%() not found -- expected it to exist', v_name;
    end if;

    v_def := pg_get_functiondef(v_oid);
    v_hits := (length(v_def) - length(replace(v_def, v_old_guard, ''))) / length(v_old_guard);

    if v_hits = 0 then
      -- Already migrated (or fixed upstream). Only acceptable if the function
      -- now routes through the helper; otherwise the guard was changed to
      -- something unexpected and a human needs to look.
      if position(v_new_guard in v_def) > 0 then
        raise notice '0141: public.%() already uses can_edit_docket_matter -- skipping', v_name;
        continue;
      end if;
      raise exception
        '0141: public.%() contains neither the expected guard nor the fix -- aborting rather than guessing',
        v_name;
    end if;

    if v_hits <> 1 then
      raise exception
        '0141: expected the guard exactly once in public.%(), found % -- aborting',
        v_name, v_hits;
    end if;

    v_new := replace(v_def, v_old_guard, v_new_guard);
    if v_new = v_def then
      raise exception '0141: guard replacement was a no-op for public.%()', v_name;
    end if;

    execute v_new;
  end loop;
end $$;

-- Post-apply assertion: both functions must now route through the helper.
do $$
declare
  v_bad text;
begin
  select string_agg(p.proname, ', ')
  into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and p.proname in ('set_docket_matter_next_date', 'schedule_docket_event_with_capacity')
    and pg_get_functiondef(p.oid) not like '%can_edit_docket_matter%';

  if v_bad is not null then
    raise exception '0141: still not routed through can_edit_docket_matter: %', v_bad;
  end if;
end $$;
