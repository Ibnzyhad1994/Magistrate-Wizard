-- ============================================================================
-- 0099_legislation_replace_ordering_fix.sql
--
-- Fixes a real sequencing bug in the file-first Legislation replace/
-- version flow introduced by 0098, caught during live testing: a
-- replacement's draft `statutes` row is inserted BEFORE
-- finalize_legislation_document() runs, using is_current_version's
-- column default (true). At that INSERT, the row it supersedes is still
-- is_current_version=true too -- two "current" rows with the same
-- (code, jurisdiction) transiently exist, and
-- statutes_code_jurisdiction_current_idx (0098) correctly rejects the
-- INSERT itself, before finalize ever gets a chance to demote the old
-- row. 0098's applied migration is left untouched, per this task's own
-- "applied migrations are immutable" rule -- this is a new, additive fix.
--
-- Fix (two parts, both required):
--   1. finalize_legislation_document() now demotes the superseded row
--      FIRST, then promotes the new row to is_current_version=true
--      SECOND, as two separate statements in the same transaction -- so
--      the unique index is never asked to accept two true rows at once.
--   2. The application's replacement-upload path must insert the new
--      draft row with is_current_version=false explicitly (see
--      use-legislation.ts's useCreateLegislationDocument) -- otherwise
--      the INSERT itself still fails before finalize ever runs. This
--      migration cannot fix that half by itself (it is client-side
--      insert behavior), so it is paired with an application code change
--      in the same commit.
-- ============================================================================

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

  select supersedes_statute_id into v_supersedes
  from public.statutes
  where id = p_statute_id;

  if not found then
    raise exception 'Legislation record % not found.', p_statute_id;
  end if;

  -- Demote the superseded row FIRST (if any) -- this row's own
  -- is_current_version is still false/whatever it was inserted as, so
  -- this statement alone never conflicts with the unique index.
  if v_supersedes is not null then
    update public.statutes set is_current_version = false where id = v_supersedes;
  end if;

  -- Only now promote the new row to current, in the SAME transaction as
  -- the demotion above -- by this point at most one row (this one) will
  -- be is_current_version=true for this (code, jurisdiction) pair.
  update public.statutes
  set primary_document_id = p_document_id,
      page_count = p_page_count,
      has_text_layer = p_has_text_layer,
      review_status = 'published',
      is_current_version = true
  where id = p_statute_id;
end;
$$;

comment on function public.finalize_legislation_document(uuid, uuid, integer, boolean) is
  'File-first Legislation flow (0098, ordering fixed 0099): links the uploaded PDF as the canonical viewing document, records optional page_count/has_text_layer hints, and publishes. If the statute row has supersedes_statute_id set (a version-replacement upload), demotes the OLD row''s is_current_version to false BEFORE promoting this row to true, in the same transaction -- avoiding a transient two-current-rows conflict with statutes_code_jurisdiction_current_idx. The application must insert a replacement''s draft row with is_current_version=false explicitly (see useCreateLegislationDocument) since the column''s default (true) would otherwise fail the unique index at INSERT time, before this function ever runs. Admin-only, mirrors the existing publish_legislation_import authorization model. Does not touch import_jobs -- the file-first path never creates one.';
