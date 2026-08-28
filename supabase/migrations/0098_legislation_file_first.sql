-- ============================================================================
-- 0098_legislation_file_first.sql
--
-- Legislation becomes a file-first PDF library: the ORIGINAL PDF is the
-- authoritative visual source, never a reconstruction of extracted text.
-- This migration adds the minimum schema needed to link a canonical
-- viewing PDF to a `statutes` row and publish it atomically. It does NOT
-- touch Case Law's tables, RPCs, or policies, and does not remove or
-- alter the existing ingestion RPCs (create_legislation_import,
-- publish_legislation_import, reject_legislation_import,
-- set_legislation_review_status) -- those remain correct for any
-- pre-existing draft/needs_review row still in the Review Queue; the new
-- file-first upload flow simply never calls them.
--
-- Sections:
--   1. statutes: primary_document_id / page_count / has_text_layer.
--   2. Fix a real bug the version-chain reuse would otherwise hit: the
--      blanket unique(code, jurisdiction) index (0005) rejects a
--      replacement row that legitimately shares its code/jurisdiction
--      with the row it supersedes. Replaced with a partial index scoped
--      to is_current_version = true.
--   3. finalize_legislation_document() -- links the uploaded PDF,
--      publishes, and (for a replacement) flips the superseded row's
--      is_current_version in the same transaction.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. New columns
-- ----------------------------------------------------------------------------

alter table public.statutes
  add column primary_document_id uuid references public.documents(id) on delete set null,
  add column page_count integer,
  add column has_text_layer boolean;

comment on column public.statutes.primary_document_id is
  'The single canonical viewing PDF for this Act (file-first upload flow, 0098) -- distinct from ad hoc supplementary attachments via DocumentsPanel (entity_type=''statute''). Null means no PDF has been linked yet (legacy record or a failed/incomplete upload) -- the detail page must show a re-upload state, never fabricate content.';
comment on column public.statutes.page_count is
  'Client-computed via pdfjs at upload time (0098). Optional display metadata only -- never authoritative, never blocks anything if null.';
comment on column public.statutes.has_text_layer is
  'Client-computed hint (0098): whether the uploaded PDF had a meaningful text layer at upload time. The viewer independently re-derives this at open time and never trusts this column alone -- it is a UI hint (e.g. a library "not searchable" badge), not a security or correctness boundary.';

-- ----------------------------------------------------------------------------
-- 2. Version-chain fix: a replacement row shares code+jurisdiction with the
--    row it supersedes -- only the CURRENT version needs to be unique.
-- ----------------------------------------------------------------------------

drop index public.statutes_code_jurisdiction_idx;

create unique index statutes_code_jurisdiction_current_idx
  on public.statutes (code, jurisdiction) where is_current_version = true;

comment on index public.statutes_code_jurisdiction_current_idx is
  'Replaces the old blanket unique(code, jurisdiction) (0005). A version-chain replacement (supersedes_statute_id, 0055/0098) legitimately shares code+jurisdiction with the row it supersedes; only one CURRENT version per code+jurisdiction may exist at a time.';

-- ----------------------------------------------------------------------------
-- 3. finalize_legislation_document() -- link + publish, atomically flip the
--    superseded row when this is a replacement.
-- ----------------------------------------------------------------------------

create or replace function public.finalize_legislation_document(
  p_statute_id uuid,
  p_document_id uuid,
  p_page_count integer default null,
  p_has_text_layer boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supersedes uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may publish Legislation.';
  end if;

  update public.statutes
  set primary_document_id = p_document_id,
      page_count = p_page_count,
      has_text_layer = p_has_text_layer,
      review_status = 'published'
  where id = p_statute_id
  returning supersedes_statute_id into v_supersedes;

  if not found then
    raise exception 'Legislation record % not found.', p_statute_id;
  end if;

  if v_supersedes is not null then
    update public.statutes set is_current_version = false where id = v_supersedes;
  end if;
end;
$$;

revoke execute on function public.finalize_legislation_document from public;
grant execute on function public.finalize_legislation_document to authenticated;

comment on function public.finalize_legislation_document(uuid, uuid, integer, boolean) is
  'File-first Legislation flow (0098): links the uploaded PDF as the canonical viewing document, records optional page_count/has_text_layer hints, and publishes. If the statute row has supersedes_statute_id set (a version-replacement upload), atomically flips the OLD row''s is_current_version to false in the same transaction -- exactly one current version per Act at a time. Admin-only, mirrors the existing publish_legislation_import authorization model. Does not touch import_jobs -- the file-first path never creates one.';
