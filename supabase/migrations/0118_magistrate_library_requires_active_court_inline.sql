-- ============================================================================
-- 0118_magistrate_library_requires_active_court_inline.sql
--
-- Completes 0117 for the same reason 0094/0100 had to exist at all:
-- case_law's, judgments', and statutes' own SELECT (and case_law/
-- judgments UPDATE) policies are INLINE, not routed through
-- can_view_case_law()/can_view_judgment()/can_view_statute() -- 0050
-- deliberately rewrote case_law/judgments off those id-based helpers to
-- fix a self-referencing INSERT...RETURNING bug, and statutes' policy
-- (0055) was simply never routed through the helper to begin with.
--
-- Confirmed live before writing this migration: after 0117 alone, a
-- courtless test magistrate could still SELECT all 30 canonical Case Law
-- rows directly via PostgREST -- identical count to an approved
-- magistrate and an admin. can_view_case_law() itself already correctly
-- returned false for them (0117); the table's own policy simply never
-- called it, exactly the class of gap 0094/0100 already document and fix
-- for the clerk case. This migration is the same fix, same technique
-- (ALTER POLICY, in place), for the magistrate-without-a-court case.
--
-- statute_provisions and documents/storage.objects for entity_type=
-- 'statute' are NOT touched here -- both already route through
-- can_view_statute() (confirmed by 0100's own header), so 0117 alone
-- already closed those. Only the three base-table policies below still
-- had the gap.
-- ============================================================================

alter policy "Canonical, own, and discoverable Case Law is viewable"
  on public.case_law
  using (
    not (select public.is_clerk())
    and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
    and (
      owner_id is null
      or owner_id = (select auth.uid())
      or is_discoverable = true
    )
  );

alter policy "Admins update canonical Case Law; owners update their personal "
  on public.case_law
  using (
    not (select public.is_clerk())
    and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
    and (
      (owner_id is null and (select public.is_admin()))
      or owner_id = (select auth.uid())
    )
  )
  with check (
    not (select public.is_clerk())
    and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
    and (
      (owner_id is null and (select public.is_admin()))
      or owner_id = (select auth.uid())
    )
  );

alter policy "Owners and discoverable readers can view Judgments"
  on public.judgments
  using (
    not (select public.is_clerk())
    and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
    and (owner_id = (select auth.uid()) or is_discoverable = true)
  );

alter policy "Owners can update Judgments"
  on public.judgments
  using (
    not (select public.is_clerk())
    and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
    and owner_id = (select auth.uid())
  )
  with check (
    not (select public.is_clerk())
    and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
    and owner_id = (select auth.uid())
  );

alter policy "Published statutes are viewable by all authenticated users; admins see drafts"
  on public.statutes
  using (
    not (select public.is_clerk())
    and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
    and (review_status = 'published' or (select public.is_admin()))
  );
