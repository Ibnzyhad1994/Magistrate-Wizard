-- ============================================================================
-- 0134_bench_note_quick_code_case_document_ownership.sql
--
-- Bug found in a security audit: the bench_note, quick_code, and case
-- branches of both the `documents` SELECT policy and the matching
-- storage.objects read policy check only that a row with the given id
-- EXISTS -- not that the caller has any right to it. bench_notes itself
-- is strictly author-scoped (0038), but any authenticated user who learns
-- a bench note's UUID could read its `documents` row and download the
-- attached file from Storage regardless of authorship -- directly
-- contradicting "your notes stay yours". Same gap for quick_code (should
-- be owner_id-gated) and the legacy case entity type (should be
-- court-scoped like everywhere else it's checked). Flagged as a known,
-- deferred gap in 0091's own migration comment; fixed here.
--
-- The fix makes both policies check exactly what the `documents` table's
-- OWN INSERT policy already checks for these same three branches (same
-- migration, unmodified) -- this was never a design disagreement, just an
-- oversight that the SELECT side didn't match the INSERT side. bench_note
-- uses the existing user_can_access_bench_note() helper (already
-- anon-executable, already author_id-scoped, unchanged by this
-- migration); quick_code and case get the equivalent inline ownership
-- check the INSERT policy already uses, since no dedicated helper exists
-- for either.
-- ============================================================================

alter policy "Users can view documents they have access to"
  on public.documents
  using (
    (uploaded_by = (select auth.uid()))
    or ((entity_type = 'docket_matter') and can_view_docket_matter(entity_id))
    or ((entity_type = 'judgment') and can_view_judgment(entity_id))
    or ((entity_type = 'case_law') and can_view_case_law(entity_id))
    or (
      (entity_type = 'quick_code')
      and exists (
        select 1 from public.quick_codes qc
        where qc.id = documents.entity_id
          and qc.owner_id = (select auth.uid())
      )
    )
    or ((entity_type = 'bench_note') and public.user_can_access_bench_note(entity_id))
    or (
      (entity_type = 'case')
      and exists (
        select 1 from public.cases c
        where c.id = documents.entity_id
          and ((select public.is_admin()) or c.court_id = (select public.my_court_id()))
      )
    )
    or ((entity_type = 'statute') and can_view_statute(entity_id))
  );

alter policy "Users can read documents they have access to"
  on storage.objects
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.documents d
      where d.file_path = objects.name
        and (
          d.uploaded_by = (select auth.uid())
          or ((d.entity_type = 'docket_matter') and can_view_docket_matter(d.entity_id))
          or ((d.entity_type = 'judgment') and can_view_judgment(d.entity_id))
          or ((d.entity_type = 'case_law') and can_view_case_law(d.entity_id))
          or (
            (d.entity_type = 'quick_code')
            and exists (
              select 1 from public.quick_codes qc
              where qc.id = d.entity_id
                and qc.owner_id = (select auth.uid())
            )
          )
          or ((d.entity_type = 'bench_note') and public.user_can_access_bench_note(d.entity_id))
          or (
            (d.entity_type = 'case')
            and exists (
              select 1 from public.cases c
              where c.id = d.entity_id
                and ((select public.is_admin()) or c.court_id = (select public.my_court_id()))
            )
          )
          or ((d.entity_type = 'statute') and can_view_statute(d.entity_id))
        )
    )
  );
