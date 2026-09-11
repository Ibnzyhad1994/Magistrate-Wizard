-- ============================================================================
-- 0142_lock_profile_row_in_recovery_rpcs.sql
--
-- return_unassigned_magistrate_to_requester() (0135) and
-- correct_unassigned_account_type() (0136) both follow a check-then-write
-- shape: read the target's role, confirm they hold no active
-- magistrate_courts / clerk_courts row, then write. Neither takes a lock,
-- so two administrators acting on the same person concurrently can both
-- pass the same emptiness check and then both write.
--
-- decide_magistrate_court_request() (0107) already established the lock
-- pattern in this schema -- `select ... for update` before its status
-- checks -- so this brings the two recovery RPCs in line with it.
--
-- The change is deliberately one word per function: the existing
--
--     select role into v_role
--     from public.profiles
--     where id = p_profile_id;
--
-- becomes the same statement with `for update`. That takes the row lock
-- BEFORE the magistrate_courts / clerk_courts emptiness checks that follow
-- it, so a second caller blocks until the first commits and then re-reads
-- state that already reflects the first writer. No other behaviour, error
-- message, or ordering changes.
--
-- SCOPE, STATED HONESTLY: this serializes the two recovery RPCs against
-- EACH OTHER. It does NOT close the race against a concurrent
-- decide_magistrate_court_request() approval, because that function locks
-- the magistrate_court_requests row and never touches profiles -- two
-- different lock objects cannot exclude one another. Closing that one
-- properly needs (a) decide_magistrate_court_request() to take the same
-- profiles-row lock and (b) a consistent acquisition order across all
-- three, since decide currently locks the request row first and the
-- recovery RPCs would lock profiles first -- acquiring them in opposite
-- orders is a textbook ABBA deadlock. It also needs decide to re-check the
-- target's role after locking, which it does not do today. That is a
-- larger, riskier change to the main approval path and is deliberately NOT
-- attempted here; it is left flagged rather than half-done.
--
-- Replaces the statement textually rather than restating the bodies: both
-- functions are identical byte-for-byte across staging and production
-- (verified with md5(pg_get_functiondef(...)) on both projects), so a
-- surgical swap keeps them that way and cannot silently import an
-- unrelated drift. Same approach 0141 used, for the same reason. Every
-- assumption is asserted, so this fails loudly rather than quietly doing
-- nothing.
-- ============================================================================

do $$
declare
  v_old constant text :=
    E'  select role into v_role\n  from public.profiles\n  where id = p_profile_id;';
  v_new constant text :=
    E'  select role into v_role\n  from public.profiles\n  where id = p_profile_id\n  for update;';
  v_targets constant text[] := array[
    'return_unassigned_magistrate_to_requester',
    'correct_unassigned_account_type'
  ];
  v_name text;
  v_oid  oid;
  v_def  text;
  v_out  text;
  v_hits integer;
begin
  foreach v_name in array v_targets loop
    select p.oid into v_oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name and p.prokind = 'f';

    if v_oid is null then
      raise exception '0142: public.%() not found -- expected it to exist', v_name;
    end if;

    v_def := pg_get_functiondef(v_oid);
    v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);

    if v_hits = 0 then
      -- Already locked (re-run, or fixed upstream). Only acceptable if the
      -- locking form is actually present; anything else means the body
      -- changed in a way this migration did not anticipate.
      if position(v_new in v_def) > 0 then
        raise notice '0142: public.%() already locks the profiles row -- skipping', v_name;
        continue;
      end if;
      raise exception
        '0142: public.%() contains neither the expected select nor the locked form -- aborting rather than guessing',
        v_name;
    end if;

    if v_hits <> 1 then
      raise exception
        '0142: expected the profile select exactly once in public.%(), found % -- aborting',
        v_name, v_hits;
    end if;

    v_out := replace(v_def, v_old, v_new);
    if v_out = v_def then
      raise exception '0142: replacement was a no-op for public.%()', v_name;
    end if;

    execute v_out;
  end loop;
end $$;

-- Post-apply assertion: both must now take the row lock.
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
    and p.proname in (
      'return_unassigned_magistrate_to_requester',
      'correct_unassigned_account_type'
    )
    and pg_get_functiondef(p.oid) not like '%where id = p_profile_id%for update%';

  if v_bad is not null then
    raise exception '0142: still not locking the profiles row: %', v_bad;
  end if;
end $$;
