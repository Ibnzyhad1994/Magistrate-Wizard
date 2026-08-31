-- ============================================================================
-- 0111_magistrate_primary_exclusivity_index.sql
--
-- Upgrades primary-magistrate exclusivity from trigger-only (0105) to a
-- REAL unique index for every court that is not currently in conflict --
-- a genuine database-level constraint, not merely an application-level
-- check, enforced going forward for every such court without touching
-- any existing row or picking a winner anywhere.
--
-- WHY THIS COULDN'T BE DONE IN 0105: `CREATE UNIQUE INDEX` validates
-- EVERY existing row at creation time and refuses to create the index at
-- all if any duplicate exists. Georgetown Magistrates' Court 1 has
-- multiple concurrent active 'regular' assignments today (explicit
-- product decision in 0105: leave as-is, do not touch). A plain
-- `CREATE UNIQUE INDEX ... WHERE assignment_type='regular' AND ended_at
-- IS NULL` would therefore fail outright, blocking this migration for
-- EVERY court, not just the conflicted one.
--
-- THE FIX: detect, at apply time, exactly which court(s) currently have
-- more than one active 'regular' row, and build a partial unique index
-- that excludes ONLY those specific courts (by court_id, discovered live
-- -- never hardcoded, so this migration applies identically to dev and
-- production despite them having different UUIDs for "the same" court).
-- Every court NOT in that conflict set -- including Vigilance
-- Magistrates' Court 1 and Kamarang Magistrate's Court, each with
-- exactly one existing active assignment -- is fully covered by the new
-- index from the moment this migration applies: a genuine Postgres
-- unique-constraint violation (23505) blocks any second concurrent
-- 'regular' row at that court, atomically, with no reliance on the
-- application layer at all.
--
-- Georgetown itself is excluded from the index (not from protection --
-- see below) until it is manually reconciled. A trivial follow-up
-- migration, once that happens, can simply create an unconditional
-- (unexcluded) version of this index and drop this one -- or this one
-- can be left as-is: once only one of Georgetown's rows remains active
-- (`ended_at` set on the others via the admin Court Assignments page),
-- there is nothing left there for the exclusion to matter, since the
-- exclusion only ever suppressed the index's own validation, never
-- application access.
--
-- BOTH LAYERS NOW COEXIST DELIBERATELY:
--   - check_primary_magistrate_exclusivity() (0105, trigger + advisory
--     lock) remains unchanged and still fires on every write. It is the
--     ONLY protection left at a still-conflicted court (this index does
--     not cover it), and it is what produces the friendly, pre-emptive
--     error message (still caught identically by every calling RPC's
--     `exception when unique_violation`, since the trigger raises with
--     errcode 23505) before a write would even reach the index.
--   - This index is the new, stronger, genuinely-enforced-by-Postgres
--     backstop for every other court -- true defense in depth: even a
--     hypothetical future write path that bypassed the trigger entirely
--     would still be physically blocked here for any court not in
--     conflict today.
-- No RPC changes were needed: every existing RPC already catches
-- `unique_violation` generically, regardless of which layer raised it.
-- ============================================================================

do $$
declare
  v_conflicting_court_ids uuid[];
begin
  select array_agg(court_id) into v_conflicting_court_ids
  from (
    select court_id
    from public.magistrate_courts
    where assignment_type = 'regular' and ended_at is null
    group by court_id
    having count(*) > 1
  ) conflicts;

  if v_conflicting_court_ids is null then
    execute
      'create unique index magistrate_courts_primary_per_court_idx '
      || 'on public.magistrate_courts (court_id) '
      || 'where assignment_type = ''regular'' and ended_at is null';
  else
    execute format(
      'create unique index magistrate_courts_primary_per_court_idx '
      || 'on public.magistrate_courts (court_id) '
      || 'where assignment_type = ''regular'' and ended_at is null and court_id <> all (%L)',
      v_conflicting_court_ids
    );
    raise notice 'magistrate_courts_primary_per_court_idx created, excluding % still-conflicted court(s): %',
      array_length(v_conflicting_court_ids, 1), v_conflicting_court_ids;
  end if;
end $$;

comment on index public.magistrate_courts_primary_per_court_idx is 'Real unique-constraint enforcement of "at most one active primary (regular) magistrate per court", for every court not already in conflict at the time this index was created (see 0111''s migration header for which court(s), if any, are excluded and why). Works alongside, not instead of, check_primary_magistrate_exclusivity() (0105) -- that trigger remains the sole protection at an excluded/conflicted court, and still produces the friendly pre-emptive error message everywhere else.';
