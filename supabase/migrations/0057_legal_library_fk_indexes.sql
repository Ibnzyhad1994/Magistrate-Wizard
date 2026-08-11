-- Covering indexes for the new 0055 foreign keys flagged by the Supabase
-- performance advisor (INFO level -- unindexed_foreign_keys). Purely
-- additive, no RLS/data change. Scoped to the Legal Library ingestion
-- tables only; pre-existing unindexed FKs on unrelated tables (e.g.
-- `shares.shares_item_id_fkey`) are out of scope for this pass.

create index if not exists case_law_import_job_id_idx on public.case_law (import_job_id);
create index if not exists case_law_source_id_idx on public.case_law (source_id);

create index if not exists statutes_import_job_id_idx on public.statutes (import_job_id);
create index if not exists statutes_source_id_idx on public.statutes (source_id);
create index if not exists statutes_supersedes_statute_id_idx on public.statutes (supersedes_statute_id);

create index if not exists import_jobs_created_by_idx on public.import_jobs (created_by);
create index if not exists import_jobs_source_id_idx on public.import_jobs (source_id);
create index if not exists import_jobs_target_case_law_id_idx on public.import_jobs (target_case_law_id);
create index if not exists import_jobs_target_statute_id_idx on public.import_jobs (target_statute_id);
create index if not exists import_jobs_uploaded_document_id_idx on public.import_jobs (uploaded_document_id);

create index if not exists import_batches_created_by_idx on public.import_batches (created_by);
create index if not exists legal_sources_created_by_idx on public.legal_sources (created_by);
