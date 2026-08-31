-- ============================================================================
-- 0117_magistrate_library_requires_active_court.sql
--
-- Closes the gap flagged in docs/develop-preview-followup.md ("Route gate
-- vs database (RLS)"): a magistrate with zero currently-active
-- magistrate_courts assignments is now redirected away from Case Law/
-- Judgments/Legislation in the UI (requireApprovedMagistrateCourt,
-- router.tsx), but the underlying RLS predicates
-- (can_view_case_law()/can_view_judgment()/can_view_statute(), 0093) never
-- required a court at all -- they only ever excluded clerks by role. A
-- stale client, a direct API call, or any future route that forgets the
-- gate could still read the published library. The route gate remains
-- the primary UX, but the database is now the actual enforcement boundary
-- underneath it, matching how every other Docket-adjacent gate in this
-- schema already works (can_access_court() etc.) -- never UI-only.
--
-- SCOPE: read (SELECT-backing) predicates only -- can_view_case_law(),
-- can_view_judgment(), can_view_statute() -- matching exactly what the
-- follow-up doc flagged as readable-without-a-court. Their companion
-- edit/insert policies are left untouched here: a magistrate without a
-- court cannot reach any UI to exercise them (Legislation/Case Law/
-- Judgments are all behind the same route gate), and 0114 separately,
-- recently touched the Legislation insert/delete policies -- broadening
-- this migration into that territory is unrelated scope, not the gap
-- this migration exists to close.
--
-- WHO IS AFFECTED: only role='magistrate' with zero active
-- magistrate_courts rows. Unchanged for everyone else:
--   - admin: canonical/published rows were already visible via the
--     existing owner_id IS NULL / review_status='published' branch, with
--     no role check at all -- untouched, admins keep full access
--     regardless of whether they personally hold a court (matching
--     0052's own established principle that roster-admin authority and
--     Docket/library content access are independent).
--   - clerk: already excluded entirely by role (0093) -- untouched.
--   - a magistrate who DOES hold an active court: sees exactly what they
--     see today -- this migration adds a condition that is already true
--     for them, changing nothing observable.
--
-- has_active_magistrate_court() is SECURITY DEFINER for the same reason
-- can_access_court() and its siblings already are: it must evaluate
-- against magistrate_courts regardless of the caller's own SELECT RLS
-- there (self-or-admin), which would otherwise make this correct for
-- everyone by construction anyway (a magistrate can always see their own
-- rows) -- SECURITY DEFINER here is for consistency with the rest of
-- this schema's helper-function convention, not a workaround for a real
-- visibility gap in this specific case.
-- ============================================================================

create or replace function public.has_active_magistrate_court()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.magistrate_courts
    where profile_id = (select auth.uid())
      and ended_at is null
  );
$$;

comment on function public.has_active_magistrate_court() is
  'True if the authenticated caller currently holds at least one active (ended_at IS NULL) magistrate_courts row, of any assignment_type. Used to gate the shared Case Law/Judgments/Legislation library to a magistrate who has not yet been approved for a court (0117) -- a no-op for admin and for a magistrate who already holds a court.';

grant execute on function public.has_active_magistrate_court() to authenticated;

create or replace function public.can_view_case_law(p_case_law_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.case_law cl
    where cl.id = p_case_law_id
      and not (select public.is_clerk())
      and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
      and (cl.owner_id is null or cl.owner_id = (select auth.uid()) or cl.is_discoverable = true)
  );
$$;

comment on function public.can_view_case_law(uuid) is
  'Case Law read envelope: canonical OR personal owner OR discoverable personal -- EXCEPT a clerk (always denied, 0093) or a magistrate with no currently-active Court (0117, matches the "full suite requires an approved Court" route gate as an actual database boundary, not just UI). Admin is unaffected by the Court condition.';

create or replace function public.can_view_judgment(p_judgment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.judgments j
    where j.id = p_judgment_id
      and not (select public.is_clerk())
      and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
      and (j.owner_id = (select auth.uid()) or j.is_discoverable = true)
  );
$$;

comment on function public.can_view_judgment(uuid) is
  'Judgment read envelope: owner OR discoverable -- EXCEPT a clerk (always denied, 0093) or a magistrate with no currently-active Court (0117). Admin is unaffected by the Court condition.';

create or replace function public.can_view_statute(p_statute_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.statutes s
    where s.id = p_statute_id
      and not (select public.is_clerk())
      and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
      and (s.review_status = 'published' or public.is_admin())
  );
$$;

comment on function public.can_view_statute(uuid) is
  'Statute (Legislation) read envelope: published OR admin -- EXCEPT a clerk (always denied, 0093) or a magistrate with no currently-active Court (0117). Admin is unaffected by the Court condition (both the review_status branch and this one).';
