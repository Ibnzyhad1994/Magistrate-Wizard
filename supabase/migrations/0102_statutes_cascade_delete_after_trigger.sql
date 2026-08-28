-- ============================================================================
-- 0102_statutes_cascade_delete_after_trigger.sql
--
-- Completes the fix started in 0101 for the Legislation Delete circular-
-- trigger conflict ("tuple to be deleted was already modified by an
-- operation triggered by the current command"). 0101's DEFERRABLE change
-- to statutes_primary_document_id_fkey was necessary but not sufficient
-- -- live re-testing after 0101 still reproduced the exact same error,
-- and Postgres's own error hint says it directly: "Consider using an
-- AFTER trigger instead of a BEFORE trigger to propagate changes to
-- other rows."
--
-- documents_cascade_delete_statutes (0058) is the ONLY one of the seven
-- installations of documents_parent_cascade_delete() that uses BEFORE
-- DELETE -- the original six (docket_matters, judgments, case_law,
-- quick_codes, bench_notes, cases, all from 0040) all correctly use
-- AFTER DELETE. That pre-existing inconsistency was harmless until
-- 0098 added statutes.primary_document_id, a foreign key pointing back
-- INTO documents -- the one column shape none of the other six parent
-- tables has. With a BEFORE trigger, the documents row is deleted while
-- the statutes row itself is still mid-deletion (not yet actually
-- removed), so the FK's cascade action tries to touch that same
-- in-flight tuple and conflicts. Switching to AFTER DELETE (matching
-- every other installation of this function) means the statutes row is
-- already fully gone by the time its linked document is cascade-
-- deleted, so the FK's SET NULL search finds zero matching rows -- a
-- clean no-op, exactly as it should be.
--
-- The shared documents_parent_cascade_delete() function itself is
-- unchanged -- this only fixes statutes' own trigger TIMING to match
-- the other six tables it was always inconsistent with.
-- ============================================================================

drop trigger documents_cascade_delete_statutes on public.statutes;

create trigger documents_cascade_delete_statutes
  after delete on public.statutes
  for each row execute function public.documents_parent_cascade_delete();
