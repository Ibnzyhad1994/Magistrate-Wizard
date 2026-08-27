-- ============================================================================
-- 0094_clerk_excluded_from_case_law_judgments_inline.sql
--
-- Completes 0093 (already applied): case_law's and judgments' OWN SELECT/
-- UPDATE policies are INLINE, not routed through can_view_case_law()/
-- can_view_judgment()/can_edit_case_law()/can_edit_judgment() -- 0050
-- deliberately rewrote them off the id-based helpers to fix the exact
-- same INSERT...RETURNING self-reference bug documented there (a self-
-- referencing helper query breaks RETURNING for the row's own creator).
-- Fixing those functions in 0093 does NOT reach these two policies --
-- live testing confirmed a clerk could still SELECT real, existing
-- published Case Law/Judgment rows directly after 0093 alone, even
-- though can_view_case_law()/can_view_judgment() themselves already
-- correctly returned false. This is a new migration, not an edit to
-- 0093, because 0093 was already applied to this local database before
-- the gap was caught.
-- ============================================================================

alter policy "Canonical, own, and discoverable Case Law is viewable"
  on public.case_law
  using (
    not (select public.is_clerk())
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
    and (
      (owner_id is null and (select public.is_admin()))
      or owner_id = (select auth.uid())
    )
  )
  with check (
    not (select public.is_clerk())
    and (
      (owner_id is null and (select public.is_admin()))
      or owner_id = (select auth.uid())
    )
  );

alter policy "Owners and discoverable readers can view Judgments"
  on public.judgments
  using (
    not (select public.is_clerk())
    and (owner_id = (select auth.uid()) or is_discoverable = true)
  );

alter policy "Owners can update Judgments"
  on public.judgments
  using (not (select public.is_clerk()) and owner_id = (select auth.uid()))
  with check (not (select public.is_clerk()) and owner_id = (select auth.uid()));
