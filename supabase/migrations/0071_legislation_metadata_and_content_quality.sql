-- ============================================================================
-- 0071_legislation_metadata_and_content_quality.sql
--
-- Follow-up to a bulk seed-legislation audit that found published Acts with
-- zero real legislative text (full_text was 100% repeated gazette running-
-- header/footer boilerplate) and OCR-garbled text (`�` replacement chars),
-- because the ingest path that created them fabricated a fixed "perfect
-- quality" envelope instead of running the real assessExtractionQuality()
-- gate (src/lib/extraction-quality.ts). It also found every seeded Act had
-- NULL act_number/enactment_year/instrument_type/chapter_number/short_title
-- despite those columns existing since 0055/0058 -- create_legislation_import
-- never had params for them.
--
-- This migration is purely additive: new columns + CREATE OR REPLACE of the
-- two create_*_import functions with new, optional, trailing parameters.
-- Existing callers (the real "New Import" UI) that omit the new named
-- params are unaffected. Does not edit 0058 in place -- 0058 is applied
-- history, not touched here.
--
-- content_quality_status is a plain enum string, not a jsonb-shape lookup:
-- the client computes it once via deriveContentQualityStatus() (in
-- extraction-quality.ts) from the real ExtractionEnvelope and passes it
-- explicitly, so this SQL never needs to know the `_extraction` jsonb
-- shape and can't silently break if that TypeScript shape is renamed.
-- ============================================================================

alter table public.statutes
  add column content_quality_status text not null default 'unknown';

alter table public.statutes
  add constraint statutes_content_quality_status_check
    check (content_quality_status in ('good', 'fair', 'poor', 'failed', 'unknown'));

create index statutes_content_quality_status_idx on public.statutes (content_quality_status);

comment on column public.statutes.content_quality_status is
  'Deterministic content-quality signal computed client-side (deriveContentQualityStatus, extraction-quality.ts) from the real ExtractionEnvelope at creation/reassessment time. ''failed'' blocks publish -- see publish_legislation_import (0072). Never derived server-side from extracted_metadata jsonb, to avoid coupling this column to a TypeScript-owned shape.';

alter table public.case_law
  add column content_quality_status text not null default 'unknown';

alter table public.case_law
  add constraint case_law_content_quality_status_check
    check (content_quality_status in ('good', 'fair', 'poor', 'failed', 'unknown'));

create index case_law_content_quality_status_idx on public.case_law (content_quality_status);

comment on column public.case_law.content_quality_status is
  'Same purpose/derivation as statutes.content_quality_status -- see that column comment.';

-- ============================================================================
-- create_legislation_import: add optional trailing params for the metadata
-- columns that have existed since 0055/0058 but were never populated by
-- this function, plus content_quality_status. chapter_number was likewise
-- never in the INSERT column list despite existing since 0055 -- fixed
-- here alongside the new params rather than as a separate migration, since
-- it's the identical class of gap (a real column, never wired up).
--
-- New trailing params change the function's argument-type signature, so
-- CREATE OR REPLACE alone would create a SECOND overload rather than
-- replace 0058's original (Postgres identifies a function by name +
-- parameter types) -- explicitly drop the exact old signature first.
-- ============================================================================
drop function if exists public.create_legislation_import(
  text, text, text, uuid, text, text, text, uuid, text, text, uuid, jsonb, text[], text, jsonb
);

create or replace function public.create_legislation_import(
  p_code text,
  p_title text,
  p_jurisdiction text,
  p_jurisdiction_id uuid default null,
  p_short_title text default null,
  p_full_text text default null,
  p_source_url text default null,
  p_source_id uuid default null,
  p_original_filename text default null,
  p_document_hash text default null,
  p_batch_id uuid default null,
  p_extracted_metadata jsonb default null,
  p_proposed_tags text[] default null,
  p_duplicate_warning text default null,
  p_provisions jsonb default '[]'::jsonb,
  p_act_number text default null,
  p_enactment_year integer default null,
  p_instrument_type text default null,
  p_chapter_number text default null,
  p_effective_date date default null,
  p_content_quality_status text default 'unknown'
)
returns table(statute_id uuid, import_job_id uuid, provision_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_statute_id uuid;
  v_import_job_id uuid;
  v_provision jsonb;
  v_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may create a canonical Legislation import.';
  end if;

  insert into public.statutes (
    code, title, short_title, jurisdiction, jurisdiction_id, full_text,
    source_url, source_id, original_filename, document_hash, retrieved_at,
    review_status, act_number, enactment_year, instrument_type,
    chapter_number, effective_date, content_quality_status
  ) values (
    p_code, p_title, p_short_title, p_jurisdiction, p_jurisdiction_id, p_full_text,
    p_source_url, p_source_id, p_original_filename, p_document_hash, now(),
    'needs_review', p_act_number, p_enactment_year, p_instrument_type,
    p_chapter_number, p_effective_date, coalesce(p_content_quality_status, 'unknown')
  )
  returning id into v_statute_id;

  for v_provision in select * from jsonb_array_elements(coalesce(p_provisions, '[]'::jsonb))
  loop
    insert into public.statute_provisions (statute_id, level, number, heading, body_text, sort_order)
    values (
      v_statute_id,
      v_provision->>'level',
      v_provision->>'number',
      v_provision->>'heading',
      v_provision->>'body_text',
      coalesce((v_provision->>'sort_order')::integer, 0)
    );
    v_count := v_count + 1;
  end loop;

  insert into public.import_jobs (
    batch_id, content_type, source_id, source_url, status,
    target_statute_id, extracted_text, extracted_metadata, proposed_tags,
    duplicate_warning, created_by, started_at, completed_at
  ) values (
    p_batch_id, 'legislation', p_source_id, p_source_url, 'needs_review',
    v_statute_id, p_full_text, p_extracted_metadata, p_proposed_tags,
    p_duplicate_warning, auth.uid(), now(), now()
  )
  returning id into v_import_job_id;

  update public.statutes set import_job_id = v_import_job_id where id = v_statute_id;

  return query select v_statute_id, v_import_job_id, v_count;
end;
$$;

-- ============================================================================
-- create_case_law_import: add content_quality_status only (no metadata
-- column gap here -- case_law's equivalent columns already have params).
-- Same overload issue as above -- drop the exact old signature first.
-- ============================================================================
drop function if exists public.create_case_law_import(
  text, text, text, text, uuid, uuid, text, text, date, text, text, uuid, text, text, uuid, jsonb, text[], text
);

create or replace function public.create_case_law_import(
  p_case_name text,
  p_citation text,
  p_court text,
  p_jurisdiction text,
  p_court_id uuid default null,
  p_jurisdiction_id uuid default null,
  p_neutral_citation text default null,
  p_reported_citation text default null,
  p_decided_date date default null,
  p_full_text text default null,
  p_source_url text default null,
  p_source_id uuid default null,
  p_original_filename text default null,
  p_document_hash text default null,
  p_batch_id uuid default null,
  p_extracted_metadata jsonb default null,
  p_proposed_tags text[] default null,
  p_duplicate_warning text default null,
  p_content_quality_status text default 'unknown'
)
returns table(case_law_id uuid, import_job_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case_law_id uuid;
  v_import_job_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may create a canonical Case Law import.';
  end if;

  insert into public.case_law (
    case_name, citation, court, jurisdiction, court_id, jurisdiction_id,
    neutral_citation, reported_citation, decided_date, full_text,
    source_url, source_id, original_filename, document_hash, retrieved_at,
    owner_id, review_status, content_quality_status
  ) values (
    p_case_name, p_citation, p_court, p_jurisdiction, p_court_id, p_jurisdiction_id,
    p_neutral_citation, p_reported_citation, p_decided_date, p_full_text,
    p_source_url, p_source_id, p_original_filename, p_document_hash, now(),
    null, 'needs_review', coalesce(p_content_quality_status, 'unknown')
  )
  returning id into v_case_law_id;

  insert into public.import_jobs (
    batch_id, content_type, source_id, source_url, status,
    target_case_law_id, extracted_text, extracted_metadata, proposed_tags,
    duplicate_warning, created_by, started_at, completed_at
  ) values (
    p_batch_id, 'case_law', p_source_id, p_source_url, 'needs_review',
    v_case_law_id, p_full_text, p_extracted_metadata, p_proposed_tags,
    p_duplicate_warning, auth.uid(), now(), now()
  )
  returning id into v_import_job_id;

  update public.case_law set import_job_id = v_import_job_id where id = v_case_law_id;

  return query select v_case_law_id, v_import_job_id;
end;
$$;

revoke execute on function public.create_case_law_import from public;
revoke execute on function public.create_legislation_import from public;
grant execute on function public.create_case_law_import to authenticated;
grant execute on function public.create_legislation_import to authenticated;
