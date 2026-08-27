-- ============================================================================
-- 0091_storage_visibility_hardening.sql
--
-- Closes a real, pre-existing gap directly relevant to this feature's own
-- guarantees. storage.objects' current SELECT policy for the 'documents'
-- bucket (0055) checks only that a matching `documents` metadata row's
-- parent EXISTS for the docket_matter/judgment/case_law/statute branches
-- -- not that the caller actually has real, authorized VISIBILITY into
-- that parent. 0044 deliberately left this alone at the time ("no helper
-- substitution there is worth the risk of regressing it, for this
-- migration's purposes") -- correct for that migration's narrower scope,
-- but this feature explicitly requires "a clerk must not be able to
-- discover, list or download case-law or judgment files by guessing
-- object paths or calling Storage directly," and today ANY authenticated
-- user (clerk or not) can already do exactly that for ANY docket/
-- judgment/case-law/statute attachment, regardless of Court assignment,
-- ownership, or discoverability. Left as-is, this feature's Storage
-- guarantee would simply be false.
--
-- Fix: swap those four branches for the real, already-existing
-- can_view_docket_matter() / can_view_judgment() / can_view_case_law() /
-- can_view_statute() helpers -- the SAME functions that already govern
-- the `documents` table's own SELECT policy (0055) for these same four
-- entity types. This also means a clerk's newly-added Docket visibility
-- (0090) now correctly extends to their approved court's attachments at
-- the Storage layer too, with zero separate clerk-specific Storage rule
-- needed.
--
-- Deliberately left untouched: the quick_code/bench_note/case branches
-- (same existence-only shape) -- a pre-existing gap, but genuinely
-- unrelated to clerk access (clerks have no interaction with quick_codes/
-- bench_notes at all, and `case` is the legacy, deprecated table) --
-- fixing those here would be an unrelated change. Flagged in the
-- completion report as a discovered issue, not fixed in this pass.
-- ============================================================================

drop policy "Users can read documents they have access to" on storage.objects;

create policy "Users can read documents they have access to" on storage.objects
  for select using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.documents d
      where d.file_path = objects.name
        and (
          d.uploaded_by = (select auth.uid())
          or (d.entity_type = 'docket_matter' and public.can_view_docket_matter(d.entity_id))
          or (d.entity_type = 'judgment' and public.can_view_judgment(d.entity_id))
          or (d.entity_type = 'case_law' and public.can_view_case_law(d.entity_id))
          or (d.entity_type = 'quick_code' and exists (select 1 from public.quick_codes qc where qc.id = d.entity_id))
          or (d.entity_type = 'bench_note' and exists (select 1 from public.bench_notes bn where bn.id = d.entity_id))
          or (d.entity_type = 'case' and exists (select 1 from public.cases c where c.id = d.entity_id))
          or (d.entity_type = 'statute' and public.can_view_statute(d.entity_id))
        )
    )
  );
