-- ============================================================================
-- 0055_legal_library_ingestion.sql
--
-- Legal Library Ingestion Phase: source registry, import batch/job model,
-- provenance + review/publish workflow for Case Law and Legislation, and a
-- Legislation structural hierarchy (statute_provisions).
--
-- Ordering: legal_sources -> import_batches -> import_jobs (both reference
-- already-existing case_law/statutes for their optional target_* columns)
-- -> ALTER case_law/statutes to add provenance + review_status + FKs back
-- to legal_sources/import_jobs -> statute_provisions -> documents/storage
-- entity_type extension -> can_view_case_law()/can_edit_case_law() review
-- gate -> case_law SELECT policy update -> can_view_statute() -> statutes
-- SELECT policy update -> statute_provisions RLS -> search_statutes()
-- extended to also match provision text.
--
-- SECURITY PRINCIPLE (unchanged, re-affirmed): every new table here is
-- INSTITUTIONAL/CANONICAL LEGAL-LIBRARY CURATION data, never private
-- judicial work product. Admin-only access to legal_sources/import_batches/
-- import_jobs is a curation-authority boundary, not a precedent for
-- reading Docket/Judgment/Bench Note content -- none of those tables are
-- touched, referenced, or bypassed anywhere in this migration.
-- ============================================================================

-- ============================================================================
-- 1. legal_sources -- reusable, extensible legal-source registry.
-- ============================================================================
create table public.legal_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  jurisdiction text not null,
  base_url text,
  source_type text not null check (source_type in ('case_law', 'legislation', 'mixed')),
  connector_type text not null check (
    connector_type in ('manual', 'direct_document', 'html_document', 'index_page', 'structured_feed', 'custom_adapter')
  ),
  status text not null default 'proposed' check (status in ('proposed', 'testing', 'approved', 'disabled', 'failed')),
  canonical_trusted boolean not null default false,
  notes text,
  last_checked_at timestamptz,
  last_successful_import_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.legal_sources is
  'Reusable legal-source registry (Guyana/CCJ/Privy Council/Commonwealth, etc). Adding a future source is a new row, never a schema change. New sources start "proposed" and must be moved to "approved" (admin judgment call) before use in an import job -- enforced at the application layer in the curation UI, not by a DB constraint, since "is this source reliable" is not a mechanically checkable property.';

create index legal_sources_status_idx on public.legal_sources (status);

alter table public.legal_sources enable row level security;

create policy "Admins can view legal sources" on public.legal_sources
  for select using ((select public.is_admin()));
create policy "Admins can create legal sources" on public.legal_sources
  for insert with check ((select public.is_admin()));
create policy "Admins can update legal sources" on public.legal_sources
  for update using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins can delete legal sources" on public.legal_sources
  for delete using ((select public.is_admin()));

create trigger set_legal_sources_updated_at
  before update on public.legal_sources
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 2. import_batches -- groups one or more import_jobs (bulk import UX).
-- ============================================================================
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  content_type text not null check (content_type in ('case_law', 'legislation')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.import_batches enable row level security;

create policy "Admins can view import batches" on public.import_batches
  for select using ((select public.is_admin()));
create policy "Admins can create import batches" on public.import_batches
  for insert with check ((select public.is_admin()));
create policy "Admins can delete import batches" on public.import_batches
  for delete using ((select public.is_admin()));

-- ============================================================================
-- 3. import_jobs -- one job per document/URL being ingested.
-- ============================================================================
create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.import_batches(id) on delete set null,
  content_type text not null check (content_type in ('case_law', 'legislation')),
  source_id uuid references public.legal_sources(id) on delete set null,
  source_url text,
  uploaded_document_id uuid references public.documents(id) on delete set null,
  status text not null default 'queued' check (
    status in ('queued', 'fetching', 'extracting', 'structuring', 'needs_review', 'ready', 'published', 'failed')
  ),
  target_case_law_id uuid references public.case_law(id) on delete set null,
  target_statute_id uuid references public.statutes(id) on delete set null,
  extracted_metadata jsonb,
  extracted_text text,
  proposed_tags text[],
  duplicate_warning text,
  error_summary text,
  retry_count integer not null default 0,
  created_by uuid not null references public.profiles(id) on delete restrict,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_jobs_single_target check (not (target_case_law_id is not null and target_statute_id is not null))
);

comment on table public.import_jobs is
  'One row per document/URL being ingested. error_summary is a short human-readable failure reason shown to the curator -- never a raw stack trace. extracted_text/extracted_metadata/proposed_tags are DERIVED, pre-publication working data; they are copied into the real case_law/statutes(+statute_provisions) row only when a curator approves the job in the Review Queue (Publish action), at which point target_case_law_id/target_statute_id is set.';

create index import_jobs_status_idx on public.import_jobs (status);
create index import_jobs_batch_id_idx on public.import_jobs (batch_id);
create index import_jobs_content_type_idx on public.import_jobs (content_type);

alter table public.import_jobs enable row level security;

create policy "Admins can view import jobs" on public.import_jobs
  for select using ((select public.is_admin()));
create policy "Admins can create import jobs" on public.import_jobs
  for insert with check ((select public.is_admin()) and created_by = (select auth.uid()));
create policy "Admins can update import jobs" on public.import_jobs
  for update using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins can delete import jobs" on public.import_jobs
  for delete using ((select public.is_admin()));

create trigger set_import_jobs_updated_at
  before update on public.import_jobs
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 4. case_law -- structured-extraction + provenance + review/publish columns.
-- ============================================================================
alter table public.case_law
  add column neutral_citation text,
  add column reported_citation text,
  add column judges text,
  add column parties text,
  add column issues text,
  add column principles text,
  add column key_passages text,
  add column disposition text,
  add column review_status text not null default 'published'
    check (review_status in ('draft', 'needs_review', 'ready', 'published')),
  add column source_id uuid references public.legal_sources(id) on delete set null,
  add column retrieved_at timestamptz,
  add column document_hash text,
  add column import_job_id uuid references public.import_jobs(id) on delete set null,
  add column original_filename text;

comment on column public.case_law.review_status is
  'Workflow state, distinct from owner_id/is_discoverable. A canonical row (owner_id IS NULL) is publicly visible ONLY when review_status = ''published'' (see the updated SELECT policy/can_view_case_law() below) -- this lets a curator create+review a draft canonical import without it appearing in the ordinary Case Law library before approval. Existing rows default to ''published'' so nothing already visible is hidden by this migration. Personal (owner_id IS NOT NULL) rows are UNAFFECTED by review_status -- their visibility remains exactly the owner/is_discoverable rule it always was.';

create index case_law_review_status_idx on public.case_law (review_status);
create index case_law_document_hash_idx on public.case_law (document_hash) where document_hash is not null;

-- ============================================================================
-- 5. statutes -- structural/version metadata + provenance + review/publish.
-- ============================================================================
alter table public.statutes
  add column short_title text,
  add column instrument_type text,
  add column act_number text,
  add column chapter_number text,
  add column enactment_year integer,
  add column commencement_note text,
  add column amendment_note text,
  add column is_current_version boolean not null default true,
  add column supersedes_statute_id uuid references public.statutes(id) on delete set null,
  add column review_status text not null default 'published'
    check (review_status in ('draft', 'needs_review', 'ready', 'published')),
  add column source_id uuid references public.legal_sources(id) on delete set null,
  add column retrieved_at timestamptz,
  add column document_hash text,
  add column import_job_id uuid references public.import_jobs(id) on delete set null,
  add column original_filename text;

comment on column public.statutes.review_status is
  'Same workflow-state principle as case_law.review_status. statutes has no owner_id/personal concept -- ALL rows are canonical, so this is the ONLY visibility gate for a draft import (see the updated SELECT policy below). Existing row(s) default to ''published'', unaffected.';

comment on column public.statutes.amendment_note is
  'Free-text summary of amendment history. This is deliberately NOT a full versioning engine -- supersedes_statute_id/is_current_version give room for a superseded-version chain without inventing one now, per the explicit instruction not to overbuild.';

create index statutes_review_status_idx on public.statutes (review_status);
create index statutes_document_hash_idx on public.statutes (document_hash) where document_hash is not null;

-- ============================================================================
-- 6. statute_provisions -- Act/Part/Chapter/Section/Subsection/Schedule
--    hierarchy. Self-referencing so any level can be skipped (Act->Section
--    directly is valid; not every jurisdiction has Parts/Chapters).
-- ============================================================================
create table public.statute_provisions (
  id uuid primary key default gen_random_uuid(),
  statute_id uuid not null references public.statutes(id) on delete cascade,
  parent_provision_id uuid references public.statute_provisions(id) on delete cascade,
  level text not null check (level in ('part', 'chapter', 'section', 'subsection', 'paragraph', 'schedule')),
  number text,
  heading text,
  body_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector('english', coalesce(heading, '') || ' ' || coalesce(body_text, ''))
  ) stored
);

comment on table public.statute_provisions is
  'Numbering/headings are preserved EXACTLY as sourced (e.g. "4", "4(1)", "4(1)(a)") -- never re-derived or flattened. A Part/Chapter node may have heading only and null body_text; a Section/Subsection typically has body_text. sort_order preserves document order among siblings (numbering alone is not always sortable, e.g. "4A").';

create index statute_provisions_statute_id_idx on public.statute_provisions (statute_id, sort_order);
create index statute_provisions_parent_idx on public.statute_provisions (parent_provision_id);
create index statute_provisions_search_vector_idx on public.statute_provisions using gin (search_vector);

alter table public.statute_provisions enable row level security;

create trigger set_statute_provisions_updated_at
  before update on public.statute_provisions
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 7. can_view_case_law() / can_edit_case_law() -- add the review_status
--    gate. Every dependent table (documents, docket_matter_case_law,
--    quick_code_case_law, case_law_annotations) automatically inherits this
--    with NO further change, exactly the extensibility the 0035 migration
--    was designed for (per architecture spec: "expressed as a live
--    existence check ... will automatically respect [a] future privacy
--    model with no change required").
-- ============================================================================
create or replace function public.can_view_case_law(p_case_law_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.case_law cl
    where cl.id = p_case_law_id
      and (
        (cl.owner_id is null and (cl.review_status = 'published' or public.is_admin()))
        or cl.owner_id = (select auth.uid())
        or cl.is_discoverable = true
      )
  );
$$;

create or replace function public.can_edit_case_law(p_case_law_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.case_law cl
    where cl.id = p_case_law_id
      and (
        (cl.owner_id is null and public.is_admin())
        or cl.owner_id = (select auth.uid())
      )
  );
$$;

drop policy "Canonical, own, and discoverable Case Law is viewable" on public.case_law;
create policy "Canonical, own, and discoverable Case Law is viewable" on public.case_law
  for select using (
    (owner_id is null and (review_status = 'published' or (select public.is_admin())))
    or owner_id = (select auth.uid())
    or is_discoverable = true
  );

-- ============================================================================
-- 8. can_view_statute() -- new helper, same shape as can_view_case_law(),
--    used by statute_provisions RLS and available for future callers.
--    statutes has no per-row edit distinction (write is unconditionally
--    admin-only), so no can_edit_statute() is introduced -- is_admin() is
--    used directly wherever statutes editing authority is checked.
-- ============================================================================
create or replace function public.can_view_statute(p_statute_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.statutes s
    where s.id = p_statute_id
      and (s.review_status = 'published' or public.is_admin())
  );
$$;

drop policy "Statutes are viewable by all authenticated users" on public.statutes;
create policy "Published statutes are viewable by all authenticated users; admins see drafts" on public.statutes
  for select using (review_status = 'published' or (select public.is_admin()));

-- statute_provisions RLS: SELECT tracks the parent statute's own
-- visibility automatically (a provision of a draft/unpublished Act is
-- never independently visible); write is admin-only, matching statutes.
create policy "Provisions are viewable when the parent statute is" on public.statute_provisions
  for select using (public.can_view_statute(statute_id));
create policy "Admins can create provisions" on public.statute_provisions
  for insert with check ((select public.is_admin()));
create policy "Admins can update provisions" on public.statute_provisions
  for update using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins can delete provisions" on public.statute_provisions
  for delete using ((select public.is_admin()));

-- ============================================================================
-- 9. documents / storage.objects -- extend the polymorphic parent set to
--    include 'statute', reusing the existing secure document architecture
--    unmodified in every other respect (private bucket, signed URLs).
--    Placed after can_view_statute()/can_view_case_law() above since the
--    new policies below call them.
-- ============================================================================
alter table public.documents
  drop constraint documents_entity_type_check;
alter table public.documents
  add constraint documents_entity_type_check
  check (entity_type is null or entity_type = any (array[
    'docket_matter', 'judgment', 'case_law', 'quick_code', 'bench_note', 'case', 'statute'
  ]));

drop policy "Users can attach documents to accessible parents" on public.documents;
create policy "Users can attach documents to accessible parents" on public.documents
  for insert with check (
    uploaded_by = (select auth.uid())
    and (
      entity_type is null
      or (entity_type = 'docket_matter' and public.can_edit_docket_matter(entity_id))
      or (entity_type = 'judgment' and public.can_edit_judgment(entity_id))
      or (entity_type = 'case_law' and public.can_edit_case_law(entity_id))
      or (entity_type = 'quick_code' and exists (
        select 1 from public.quick_codes qc where qc.id = documents.entity_id and qc.owner_id = (select auth.uid())
      ))
      or (entity_type = 'bench_note' and exists (
        select 1 from public.bench_notes bn where bn.id = documents.entity_id and bn.author_id = (select auth.uid())
      ))
      or (entity_type = 'case' and exists (
        select 1 from public.cases c
        where c.id = documents.entity_id and ((select public.is_admin()) or c.court_id = (select public.my_court_id()))
      ))
      -- Legislation documents (original Act PDFs etc.) are admin-curated,
      -- same authority boundary as statutes' own admin-only write RLS --
      -- an ordinary magistrate cannot attach a document to canonical
      -- Legislation, matching that they cannot edit the statute row itself.
      or (entity_type = 'statute' and (select public.is_admin()))
    )
  );

drop policy "Users can view documents they have access to" on public.documents;
create policy "Users can view documents they have access to" on public.documents
  for select using (
    uploaded_by = (select auth.uid())
    or (entity_type = 'docket_matter' and public.can_view_docket_matter(entity_id))
    or (entity_type = 'judgment' and public.can_view_judgment(entity_id))
    or (entity_type = 'case_law' and public.can_view_case_law(entity_id))
    or (entity_type = 'quick_code' and exists (select 1 from public.quick_codes qc where qc.id = documents.entity_id))
    or (entity_type = 'bench_note' and exists (select 1 from public.bench_notes bn where bn.id = documents.entity_id))
    or (entity_type = 'case' and exists (select 1 from public.cases c where c.id = documents.entity_id))
    or (entity_type = 'statute' and public.can_view_statute(entity_id))
  );

drop policy "Users can read documents they have access to" on storage.objects;
create policy "Users can read documents they have access to" on storage.objects
  for select using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.documents d
      where d.file_path = objects.name
        and (
          d.uploaded_by = (select auth.uid())
          or (d.entity_type = 'docket_matter' and exists (select 1 from public.docket_matters dm where dm.id = d.entity_id))
          or (d.entity_type = 'judgment' and exists (select 1 from public.judgments j where j.id = d.entity_id))
          or (d.entity_type = 'case_law' and exists (select 1 from public.case_law cl where cl.id = d.entity_id))
          or (d.entity_type = 'quick_code' and exists (select 1 from public.quick_codes qc where qc.id = d.entity_id))
          or (d.entity_type = 'bench_note' and exists (select 1 from public.bench_notes bn where bn.id = d.entity_id))
          or (d.entity_type = 'case' and exists (select 1 from public.cases c where c.id = d.entity_id))
          or (d.entity_type = 'statute' and exists (select 1 from public.statutes s where s.id = d.entity_id))
        )
    )
  );

-- ============================================================================
-- 10. search_statutes() -- extended to also match statute_provisions text,
--     so e.g. "trafficking" finds an Act via a matching provision, not only
--     via the Act-level title/summary/full_text. Signature UNCHANGED (still
--     SECURITY INVOKER, still returns id/code/title/jurisdiction/summary/
--     rank/headline) -- automatically continues to respect statutes' RLS
--     with no explicit predicate needed, exactly as before this migration.
-- ============================================================================
create or replace function public.search_statutes(p_query text, p_limit integer default 20)
returns table(id uuid, code text, title text, jurisdiction text, summary text, rank real, headline text)
language sql
stable
set search_path = public
as $$
  with statute_matches as (
    select
      s.id, s.code, s.title, s.jurisdiction, s.summary,
      ts_rank(s.search_vector, websearch_to_tsquery('english', p_query)) as rank,
      ts_headline('english', coalesce(s.summary, s.full_text, ''),
        websearch_to_tsquery('english', p_query),
        'MaxFragments=2, MaxWords=30, MinWords=10') as headline
    from public.statutes s
    where s.search_vector @@ websearch_to_tsquery('english', p_query)
  ),
  provision_matches as (
    select
      s.id, s.code, s.title, s.jurisdiction, s.summary,
      ts_rank(sp.search_vector, websearch_to_tsquery('english', p_query)) as rank,
      ts_headline('english', coalesce(sp.heading, '') || ' ' || coalesce(sp.body_text, ''),
        websearch_to_tsquery('english', p_query),
        'MaxFragments=2, MaxWords=30, MinWords=10') as headline
    from public.statute_provisions sp
    join public.statutes s on s.id = sp.statute_id
    where sp.search_vector @@ websearch_to_tsquery('english', p_query)
  ),
  combined as (
    select * from statute_matches
    union all
    select * from provision_matches
  ),
  best_per_statute as (
    select distinct on (id) id, code, title, jurisdiction, summary, rank, headline
    from combined
    order by id, rank desc
  )
  select id, code, title, jurisdiction, summary, rank, headline
  from best_per_statute
  order by rank desc
  limit p_limit;
$$;
