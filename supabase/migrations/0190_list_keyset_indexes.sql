-- ============================================================================
-- 0190_list_keyset_indexes.sql
--
-- BE-15: the library, bench-note, judgment, dashboard and import-job lists
-- were one capped fetch each (300, 500, 300, 200, 400 and 200 rows), with no
-- way to see past the cap. They now page by keyset (src/lib/keyset-pagination.ts):
-- each page is the next N rows after the last row shown, in a total order
-- that ends in `id`.
--
-- Access pattern: a browse screen loads the first page on open and further
-- pages on "load more"; every page request is
--
--   <list filter> AND <lead> <=|>= cursor AND <exact "after cursor" or-tree>
--   ORDER BY <sort key> LIMIT <page size>
--
-- and the first page also counts the whole list once.
--
-- Expected cardinality: case_law and statutes hold the curated library (tens
-- of thousands of rows once the official corpus in
-- docs/legal-library-official-seeding.md lands); bench_notes and judgments
-- hundreds to thousands per magistrate; docket_events thousands a year per
-- court; import_jobs one row per imported file.
--
-- Each index below matches one list's filter and sort key exactly, so a page
-- is an index range scan that starts at the cursor and stops after one page,
-- instead of a sort of the whole visible table:
--
--   list                    filter (index predicate)        sort key
--   useCaseLawList          review_status = 'published'     updated_at desc, id desc
--   useStatutes             published and current           title, id
--   useBenchNotes           author_id = auth.uid() (RLS)    updated_at desc, id desc
--   useJudgments            RLS only                        updated_at desc, id desc
--   useDashboardEventPulse  scheduled_date window           scheduled_date, scheduled_time nulls first, id
--   useImportJobs           RLS only (admins)               created_at desc, id desc
--
-- bench_notes_author_id_idx and docket_events_scheduled_date_idx are leading
-- prefixes of the new bench_notes and docket_events indexes, which serve
-- every query they served (including the bench_notes.author_id foreign key),
-- so they are dropped rather than kept as write overhead.
-- ============================================================================

create index if not exists case_law_published_updated_at_idx
  on public.case_law (updated_at desc, id desc)
  where review_status = 'published';

create index if not exists statutes_published_current_title_idx
  on public.statutes (title, id)
  where review_status = 'published' and is_current_version = true;

create index if not exists bench_notes_author_updated_at_idx
  on public.bench_notes (author_id, updated_at desc, id desc);
drop index if exists public.bench_notes_author_id_idx;

create index if not exists judgments_updated_at_idx
  on public.judgments (updated_at desc, id desc);

create index if not exists docket_events_scheduled_idx
  on public.docket_events (scheduled_date, scheduled_time nulls first, id);
drop index if exists public.docket_events_scheduled_date_idx;

create index if not exists import_jobs_created_at_idx
  on public.import_jobs (created_at desc, id desc);
