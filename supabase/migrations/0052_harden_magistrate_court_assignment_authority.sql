-- 0052_harden_magistrate_court_assignment_authority.sql
--
-- Closes a genuine authorization gap surfaced during manual release-
-- candidate testing: `magistrate_courts` is an AUTHORITY-ORIGINATING
-- table — a row in it is the sole input to can_access_court(), which is
-- one of the three paths feeding every Docket read/write predicate
-- (docket_matters, docket_events, docket_matter_parties,
-- docket_matter_tags, docket_matter_judgments, docket_matter_case_law,
-- shares creation via has_docket_matter_authority(), etc.). The INSERT
-- and UPDATE policies shipped with 0017_magistrate_courts.sql were
-- `profile_id = auth.uid() OR is_admin()` — i.e. self-service. That was
-- a deliberate, reasonable choice for docket_matter_assignments
-- (retained/part-heard, 0022): a retained assignment can only be
-- self-created by a magistrate who, at that moment, ALREADY holds
-- ordinary Court access to that one matter via can_access_court() — it
-- narrows a pre-existing, already-legitimate grant down to a single
-- matter, never originates access from nothing.
--
-- `magistrate_courts` has no such precondition available to check —
-- there is nothing upstream of it to require, because it IS the
-- upstream grant. Under the pre-0052 policy, any authenticated user
-- could INSERT their own row against any active Court and immediately
-- gain full ordinary Docket authority over it, with zero invitation,
-- approval, or relationship check. That is a fundamentally different
-- (and unacceptable) trust decision from retained-assignment
-- self-service, confirmed live: production `magistrate_courts` has
-- zero rows and zero real accounts have ever exercised this path, but
-- the privilege existed and was reachable by any signed-up user.
--
-- Live state confirmed before writing this migration (see chat
-- transcript / architecture spec update in the same session):
--   - latest applied migration: 0051_docket_share_recipient_lookup
--   - magistrate_courts: 0 rows total
--   - profiles: 1 row (the real admin account), 0 magistrate_courts
--     rows for it either
--   - docket_matters: 0 rows
--   - no ordinary-magistrate UPDATE capability is removed from any
--     OTHER table by this migration; docket_matter_assignments
--     (retained/part-heard) self-service is explicitly unchanged
--
-- V1 resolved model (see architecture spec §4 for full rationale):
--   1. Registration never grants Court authority.
--   2. A profile may legitimately have zero current Court assignments,
--      permanently.
--   3. Court assignment (both creating and ending) is Admin-managed
--      only.
--   4. Admin may assign any profile to any ACTIVE Court
--      (check_court_active_for_assignment() trigger, unchanged, still
--      enforces this — including against Admins).
--   5. Ordinary magistrates cannot self-assign, assign another
--      profile, reactivate an ended assignment, or transfer/mutate
--      their own assignment row in any way.
--   6. is_admin() still does not appear anywhere in
--      can_access_court()/can_view_docket_matter()/
--      can_edit_docket_matter() or any other Docket/Judgment/Case-Law
--      predicate — Admin management authority over the roster is not
--      Docket content authority. An Admin who is also a sitting
--      magistrate needs an ordinary magistrate_courts row, created the
--      same way anyone else's is (by an Admin), to read or write any
--      Docket content.
--   7. History is never deleted — still no DELETE policy on this
--      table, still ended_at-only lifecycle.
--
-- This migration modifies the two existing policies IN PLACE via
-- ALTER POLICY (same technique as 0050), renaming each to reflect its
-- new, no-longer-self-service semantics rather than leaving a
-- misleading name. SELECT is untouched — self-or-admin visibility was
-- already correct and is not being broadened or narrowed.
--
-- protect_magistrate_court_history() (0017) and
-- check_court_active_for_assignment() (0017) are both left completely
-- unmodified: the former's non-admin branch (field-immutability,
-- no-reactivation) becomes dead code now that UPDATE requires
-- is_admin() to even reach it — harmless, and not worth a migration
-- of its own to remove. The latter already applies uniformly
-- regardless of role and continues to correctly block Admin
-- assignment to an inactive Court, confirmed in the rollback-only
-- pretest below.
--
-- Rollback-only pretest (disposable eeeeeeee-.../ffffffff-.../
-- dddddddd-... fixtures, never the real admin account): 12/12
-- assertions PASS — ordinary self-assign denied; ordinary
-- assign-another-profile denied; ordinary reactivate-ended denied
-- (RLS silently excludes the row from UPDATE's USING clause — 0 rows
-- affected, not an exception, confirmed by row-count/state
-- inspection rather than assuming an exception is thrown); ordinary
-- transfer/mutate-own-row denied (same silent-0-rows mechanism);
-- Admin create succeeds; Admin assignment to an inactive Court is
-- still rejected by the pre-existing trigger; Admin end-assignment
-- succeeds; ended history row survives (not deleted); Admin alone
-- (no own magistrate_courts row) has can_access_court() = false;
-- Admin-created assignment flips can_access_court() to true for the
-- assignee; ending that assignment flips it back to false; and a
-- retained/part-heard assignment created while ordinary Court access
-- was held continues to grant can_view_docket_matter() on that one
-- matter after the ordinary Court assignment is later ended by an
-- Admin (docket_matter_assignments self-service path fully
-- unaffected).

alter policy "Magistrates can create their own court assignments"
  on public.magistrate_courts
  rename to "Admins can create Court assignments";

alter policy "Admins can create Court assignments"
  on public.magistrate_courts
  with check ((select public.is_admin()));

alter policy "Magistrates can end their own court assignments"
  on public.magistrate_courts
  rename to "Admins can manage Court assignments";

alter policy "Admins can manage Court assignments"
  on public.magistrate_courts
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
