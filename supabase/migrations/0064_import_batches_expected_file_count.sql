-- ============================================================================
-- 0064_import_batches_expected_file_count.sql
--
-- Magistrate Wizard — COMPREHENSIVE STABILIZATION, BULK INGESTION COMPLETION,
-- LEGAL LIBRARY QA & AUTONOMOUS DEBUGGING PASS -- batch accounting fix.
--
-- ROOT CAUSE (confirmed via live data inspection, no browser needed): the
-- Batch Detail "N documents" figure a curator sees is NOT derived from any
-- persisted count -- import_batches.label is a static string baked in at
-- creation time from files.length ("Bulk import — <date> — 5 documents"),
-- while Batch Detail's row list (and its OWN "N documents" line) comes
-- from a live COUNT of import_jobs rows for that batch. Before 0063, only
-- the RPC-coupled success path ever wrote an import_jobs row -- a
-- duplicate/failed/rejected outcome left literally zero DB trace. So a
-- pre-0063 "5 documents" batch can legitimately have just 1 persisted job
-- (the one success) with the other 4 outcomes lost forever -- confirmed
-- live: batch ab383006 (created 2026-08-12 18:38, BEFORE this session's
-- 0063 fix went live at 18:38:13) has exactly 1 import_jobs row. Batches
-- created AFTER the fix (4adbc876/d10df17c, both "7 documents") correctly
-- have exactly 7 persisted rows each -- the invariant already holds for
-- new batches; there was just no way to tell a "fully accounted" batch
-- apart from a "legacy, some outcomes were never recorded" one.
--
-- This migration adds the missing structural fact: how many files the
-- curator ORIGINALLY selected, recorded once at batch-creation time,
-- independent of the (already correct) per-file completion count. NULL on
-- every existing row (they predate this column and their true original
-- selection size cannot be reconstructed -- never invented, per this
-- pass's explicit instruction to label unreconstructable legacy batches
-- honestly rather than fabricate rows/counts). Every NEW batch created
-- after this migration ships sets it once, at creation, from the actual
-- file count the curator selected (including files rejected by
-- client-side validation before processing began -- those still get a
-- persisted "failed" job row via recordBulkRejectedJobs, so they count
-- toward both sides of the invariant).
-- ============================================================================

alter table public.import_batches
  add column expected_file_count integer;

comment on column public.import_batches.expected_file_count is
  'Number of files the curator originally selected for this batch, recorded once at creation (0064). NULL on any batch created before this column existed -- those predate the persistent bare-job-row architecture (0063) and their true original selection size cannot be reconstructed, so the UI must label them as legacy/incomplete history rather than compare against a fabricated number. For every batch created after 0063+0064 together, the product invariant is: expected_file_count = count(import_jobs where batch_id = this batch) once processing completes -- every selected file, including ones rejected by client-side validation before processing began, produces exactly one persisted import_jobs row (see recordBulkRejectedJobs/recordBulkNonDraftJob in use-import-jobs.ts).';
