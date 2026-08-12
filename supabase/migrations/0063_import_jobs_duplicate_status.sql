-- ============================================================================
-- 0063_import_jobs_duplicate_status.sql
--
-- BenchBook autonomous development/debugging/testing pass -- persistent
-- bulk ingestion lifecycle.
--
-- ROOT CAUSE CONFIRMED via direct inspection of the live database
-- (Supabase MCP): case_law has a unique index scoped to canonical rows,
-- case_law_citation_canonical_unique_idx (owner_id IS NULL, migration
-- 0035). Nothing checked this BEFORE calling create_case_law_import, so a
-- bulk item whose citation matched an already-published canonical case
-- (a different scan/report of the SAME case -- a "possible legal record
-- duplicate", not a byte-identical file) hit the raw Postgres 23505
-- constraint. getErrorMessage() (src/lib/utils.ts) had no entry for that
-- constraint name, so it fell back to the generic "That already exists."
-- message -- and the bulk worker's catch-all bucketed that under status
-- "failed", indistinguishable from a genuine extraction/processing
-- failure. Live testing confirmed this exact symptom: 4 of 7 real PDFs in
-- one batch showed "Failed" with the message "That already exists."
--
-- The application-layer fix (checkCanonicalCitationConflict pre-check in
-- use-import-jobs.ts, called from use-bulk-import.ts BEFORE the RPC) now
-- prevents this constraint from firing in the normal case. But recording
-- that outcome as a real, persistent import_jobs row -- so a bulk batch's
-- FULL result set (successes AND duplicates AND failures) survives
-- navigation/refresh, per this pass's core "persistent batch" requirement
-- -- requires a status value the existing CHECK constraint does not
-- permit. This is a genuine "can't cleanly fit the existing schema"
-- case (existing statuses: queued, fetching, extracting, structuring,
-- needs_review, ready, published, failed -- none of which mean "a
-- canonical record with this identity already exists, nothing new was
-- created, and this was NOT a failure").
--
-- This migration ONLY widens the existing CHECK constraint (additive,
-- non-destructive -- no existing row uses the new value, so no data
-- migration is needed) and adds 'duplicate' to the status index's
-- documentation. It does NOT touch, redefine, or narrow anything an
-- earlier migration created. Does not edit 0055 (which originally defined
-- this constraint) or any other previously applied migration.
-- ============================================================================

alter table public.import_jobs
  drop constraint import_jobs_status_check;

alter table public.import_jobs
  add constraint import_jobs_status_check
  check (status = any (array[
    'queued', 'fetching', 'extracting', 'structuring',
    'needs_review', 'ready', 'published', 'failed',
    'duplicate'
  ]));

comment on column public.import_jobs.status is
  'Job processing status. ''duplicate'' (added 0063) means no new canonical record was created because an identical file (by content hash) or an identical citation (case_law_citation_canonical_unique_idx) already exists -- this is NOT a failure and must be counted/displayed separately from ''failed'' in any batch summary. See extracted_metadata for _duplicateOfId/_originalFilename on a bare (non-draft-creating) job row of this kind.';
