-- ============================================================================
-- 0083_document_preview_derivatives.sql
--
-- Supports a faithful, page-based DOCX preview (docx-preview, client-side)
-- by giving the generic `documents` polymorphic attachment table a way to
-- record a CACHED PREVIEW DERIVATIVE of an original upload, instead of
-- re-converting the source .docx every time it's opened. The original file
-- is completely unaffected -- a derivative is just another `documents` row
-- pointing back at the source it was generated from.
--
-- Sections:
--   1. documents.source_document_id -- self-referencing FK, nullable. Set
--      only on a derivative row; on delete cascade, so deleting the source
--      `documents` row (e.g. the magistrate deletes the original upload)
--      automatically removes the derivative's metadata row too. (Mirrors
--      this project's already-accepted limitation of not cleaning up the
--      underlying Storage BLOB via SQL cascade -- see 0040's header note --
--      the client-side delete path removes the blob first, same as today.)
--   2. documents_purpose_check -- add 'preview_derivative'.
--   3. documents_preview_derivative_pair_check -- purpose='preview_derivative'
--      iff source_document_id is set (mirrors the existing entity_type/
--      entity_id pair-check pattern from 0007/0040).
--   4. One derivative per source: partial unique index on source_document_id
--      where purpose='preview_derivative'.
--   5. New, NARROW insert policy: any user who can currently VIEW a source
--      document (per the existing "Users can view documents they have
--      access to" SELECT policy, 0055's final form) may attach a
--      preview_derivative row for it -- deliberately using the READ-side
--      visibility check, not the stricter WRITE-side "attach" policy
--      (0040), because generating a preview is a read-adjacent convenience
--      computation, not a substantive edit to the parent record. Without
--      this, an ordinary magistrate viewing a canonical (admin-owned)
--      Case Law DOCX could never cache a preview at all, since the
--      existing attach policy restricts case_law/judgment attachments to
--      the record's admin/owner. This is a new, separate policy -- the
--      existing "Users can attach documents to accessible parents" policy
--      (0040/0055) is untouched, so ordinary attachment/cover/
--      identification_photo/ruling/judgment uploads keep their existing,
--      stricter authorization exactly as before.
--   6. storage.buckets -- allow 'text/html' as an upload content-type for
--      the 'documents' bucket (the derivative is stored as a sanitized,
--      self-contained HTML snapshot of the rendered pages, same as any
--      other document -- a private Storage blob, signed URLs only).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. source_document_id
-- ----------------------------------------------------------------------------
alter table public.documents
  add column source_document_id uuid references public.documents(id) on delete cascade;

comment on column public.documents.source_document_id is
  'Set only on a preview-derivative row (purpose=''preview_derivative''): the original documents.id this is a cached, generated preview OF. NULL for every ordinary uploaded document. on delete cascade -- deleting the source document row removes its derivative''s metadata row automatically (the derivative''s own Storage blob is removed client-side first, same as any other document delete -- see use-documents.ts).';

-- ----------------------------------------------------------------------------
-- 2 & 3. purpose check + pair check
-- ----------------------------------------------------------------------------
alter table public.documents
  drop constraint documents_purpose_check;

alter table public.documents
  add constraint documents_purpose_check
    check (purpose in ('attachment', 'cover', 'identification_photo', 'ruling', 'judgment', 'preview_derivative'));

alter table public.documents
  add constraint documents_preview_derivative_pair_check
    check (
      (purpose <> 'preview_derivative' and source_document_id is null)
      or (purpose = 'preview_derivative' and source_document_id is not null)
    );

comment on column public.documents.purpose is
  'attachment (default, generic) | cover | identification_photo | ruling | judgment | preview_derivative. preview_derivative (0083) is a cached, generated preview of another documents row (source_document_id) -- never itself a user-facing "document" (excluded from DocumentsPanel'' visible list, same pattern already used there for cover/identification_photo).';

-- ----------------------------------------------------------------------------
-- 4. One derivative per source
-- ----------------------------------------------------------------------------
create unique index documents_source_document_id_preview_unique_idx
  on public.documents (source_document_id)
  where purpose = 'preview_derivative';

create index documents_source_document_id_idx
  on public.documents (source_document_id)
  where source_document_id is not null;

-- ----------------------------------------------------------------------------
-- 5. Insert policy for preview derivatives -- mirrors the current SELECT
--    policy's visibility dispatch exactly (0055's final form), not the
--    stricter WRITE "attach" policy (0040). Generic across every
--    entity_type the SELECT policy already covers (not just case_law/
--    judgment) -- DocumentViewerDialog is one shared component used by
--    every entity type's Documents tab, so scoping this more narrowly
--    would silently break preview caching for Docket Matter/Quick Code/
--    Bench Note/Statute DOCX attachments while leaving Case Law/Judgment
--    working, which would be a confusing, undocumented inconsistency.
-- ----------------------------------------------------------------------------
create policy "Users can attach a preview derivative to a document they can view"
  on public.documents for insert
  with check (
    purpose = 'preview_derivative'
    and uploaded_by = (select auth.uid())
    and source_document_id is not null
    and exists (
      select 1 from public.documents src
      where src.id = documents.source_document_id
        and src.purpose <> 'preview_derivative'
        and src.entity_type is not distinct from documents.entity_type
        and src.entity_id is not distinct from documents.entity_id
        and (
          src.uploaded_by = (select auth.uid())
          or (src.entity_type = 'docket_matter' and public.can_view_docket_matter(src.entity_id))
          or (src.entity_type = 'judgment' and public.can_view_judgment(src.entity_id))
          or (src.entity_type = 'case_law' and public.can_view_case_law(src.entity_id))
          or (src.entity_type = 'quick_code' and exists (select 1 from public.quick_codes qc where qc.id = src.entity_id))
          or (src.entity_type = 'bench_note' and exists (select 1 from public.bench_notes bn where bn.id = src.entity_id))
          or (src.entity_type = 'case' and exists (select 1 from public.cases c where c.id = src.entity_id))
          or (src.entity_type = 'statute' and public.can_view_statute(src.entity_id))
        )
    )
  );

-- ----------------------------------------------------------------------------
-- 6. Allow 'text/html' uploads into the 'documents' bucket
-- ----------------------------------------------------------------------------
update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'text/html')
where id = 'documents'
  and not ('text/html' = any (allowed_mime_types));
