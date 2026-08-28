-- ============================================================================
-- 0100_clerk_excluded_from_statutes_inline.sql
--
-- Completes 0093/0094 for `statutes`: its own SELECT policy is INLINE
-- (defined 0055, never rewritten), not routed through can_view_statute()
-- -- the exact same class of gap 0094 already fixed for case_law and
-- judgments, but `statutes` itself was never included in that pass.
--
-- Live testing during the Legislation file-first work (0098/0099)
-- caught this directly: a clerk could SELECT a real, published
-- Legislation record straight from `statutes` (and find it via
-- search_statutes, which queries `statutes` directly) even though
-- can_view_statute() itself already correctly returns false for a
-- clerk (0093) -- fixing that function alone never reached this table's
-- own policy, identical to the case_law/judgments gap 0094 documents.
--
-- statute_provisions is NOT affected -- its SELECT policy already routes
-- through can_view_statute() (0055), which has been clerk-correct since
-- 0093; likewise documents/storage.objects for entity_type='statute'
-- (0091), which also calls can_view_statute(). Only the `statutes` table's
-- own policy needed this direct fix. statutes' INSERT/UPDATE/DELETE
-- (0012) are unconditionally is_admin()-only and were never reachable by
-- a clerk regardless.
-- ============================================================================

alter policy "Published statutes are viewable by all authenticated users; admins see drafts"
  on public.statutes
  using (
    not (select public.is_clerk())
    and (review_status = 'published' or (select public.is_admin()))
  );
