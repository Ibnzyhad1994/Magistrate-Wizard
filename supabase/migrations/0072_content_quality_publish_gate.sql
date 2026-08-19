-- ============================================================================
-- 0072_content_quality_publish_gate.sql
--
-- Same motivating audit as 0071. Publish-time validation was previously
-- 100% blind to full_text/quality -- 0061's placeholder-value gate only
-- ever checked case_name/citation/court/jurisdiction (case law) and
-- title/code/jurisdiction (legislation), never full_text or any quality
-- signal. That meant even a correctly-computed content_quality_status
-- (0071) still couldn't block a bad publish. This migration re-implements
-- publish_case_law_import/publish_legislation_import (CREATE OR REPLACE,
-- same signatures as 0058/0061 -- not editing either in place) adding a
-- hard block when content_quality_status = 'failed' (deterministic, from
-- assessExtractionQuality()'s hard-fail gate -- see extraction-quality.ts).
-- 'poor'/'fair' are NOT blocked here -- those remain a human judgment call
-- surfaced in the Review Queue UI, not an automated block, since being too
-- strict on every borderline case risks blocking legitimately short/
-- unusual legislative text.
--
-- An earlier version of this migration also blocked "title equals code"
-- for Legislation, as a generic version of the "Marriage"/"Marriage"
-- defect this pass's audit found. Verified against the real re-ingested
-- corpus before this migration was ever committed: title===code turns out
-- to be the LEGITIMATE, common case whenever a harvested item simply has
-- no separate short code (159 of 184 real Acts) -- not a defect signal at
-- all. That check is dropped entirely; the ingest-time fix
-- (isHarvestedTitleSuspect/decideLegislationTitle in ingest-quality.mjs)
-- is what actually prevents a bare-fragment title like "Marriage" from
-- reaching the database in the first place, and 0061's existing
-- placeholder-value check still catches a genuinely empty/placeholder
-- title. This migration was only ever applied locally, never committed --
-- edited in place rather than layered with a forward-fix migration, per
-- DEVELOPMENT_WORKFLOW.md's distinction between in-review (unapplied)
-- migrations and verified production ones.
--
-- Client-side mirror: src/lib/publication-validation.ts (same dual-gate
-- requirement 0061 itself established -- must exist at BOTH boundaries).
-- ============================================================================

create or replace function public.publish_case_law_import(p_case_law_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_case_name text;
  v_citation text;
  v_court text;
  v_jurisdiction text;
  v_court_id uuid;
  v_jurisdiction_id uuid;
  v_content_quality_status text;
  -- Mirrors the PLACEHOLDER_VALUES set in
  -- src/lib/publication-validation.ts -- keep both lists in sync.
  v_bad text[] := array[
    '', 'untitled', 'untitled (pending review)', 'unknown', 'tbd', 'n/a',
    'na', 'none', 'pending', 'pending review', 'coa', 'court', 'jurisdiction'
  ];
begin
  if not public.is_admin() then
    raise exception 'Only administrators may publish canonical Case Law.';
  end if;

  select import_job_id, case_name, citation, court, jurisdiction, court_id,
         jurisdiction_id, content_quality_status
    into v_job_id, v_case_name, v_citation, v_court, v_jurisdiction, v_court_id,
         v_jurisdiction_id, v_content_quality_status
    from public.case_law
    where id = p_case_law_id;

  if not found then
    raise exception 'Case Law record % not found.', p_case_law_id;
  end if;

  if lower(trim(coalesce(v_case_name, ''))) = any(v_bad) then
    raise exception 'Cannot publish: Case name requires review.';
  end if;
  if lower(trim(coalesce(v_citation, ''))) = any(v_bad) then
    raise exception 'Cannot publish: Citation is missing.';
  end if;
  if v_jurisdiction_id is null or lower(trim(coalesce(v_jurisdiction, ''))) = any(v_bad) then
    raise exception 'Cannot publish: Jurisdiction is missing.';
  end if;
  if v_court_id is null or lower(trim(coalesce(v_court, ''))) = any(v_bad) then
    raise exception 'Cannot publish: Court is missing.';
  end if;
  if v_content_quality_status = 'failed' then
    raise exception 'Cannot publish: extracted text failed automated quality checks and requires correction before publish.';
  end if;

  update public.case_law set review_status = 'published' where id = p_case_law_id;

  if v_job_id is not null then
    update public.import_jobs set status = 'published', completed_at = now() where id = v_job_id;
  end if;
end;
$$;

create or replace function public.publish_legislation_import(p_statute_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_code text;
  v_title text;
  v_jurisdiction text;
  v_jurisdiction_id uuid;
  v_content_quality_status text;
  v_bad text[] := array[
    '', 'untitled', 'untitled (pending review)', 'unknown', 'tbd', 'n/a',
    'na', 'none', 'pending', 'pending review', 'coa', 'court', 'jurisdiction'
  ];
begin
  if not public.is_admin() then
    raise exception 'Only administrators may publish canonical Legislation.';
  end if;

  select import_job_id, code, title, jurisdiction, jurisdiction_id, content_quality_status
    into v_job_id, v_code, v_title, v_jurisdiction, v_jurisdiction_id, v_content_quality_status
    from public.statutes
    where id = p_statute_id;

  if not found then
    raise exception 'Legislation record % not found.', p_statute_id;
  end if;

  if lower(trim(coalesce(v_title, ''))) = any(v_bad) then
    raise exception 'Cannot publish: Title requires review.';
  end if;
  if lower(trim(coalesce(v_code, ''))) = any(v_bad) then
    raise exception 'Cannot publish: Code is missing.';
  end if;
  if v_jurisdiction_id is null or lower(trim(coalesce(v_jurisdiction, ''))) = any(v_bad) then
    raise exception 'Cannot publish: Jurisdiction is missing.';
  end if;
  if v_content_quality_status = 'failed' then
    raise exception 'Cannot publish: extracted text failed automated quality checks and requires correction before publish.';
  end if;

  update public.statutes set review_status = 'published' where id = p_statute_id;

  if v_job_id is not null then
    update public.import_jobs set status = 'published', completed_at = now() where id = v_job_id;
  end if;
end;
$$;

revoke execute on function public.publish_case_law_import from public;
revoke execute on function public.publish_legislation_import from public;
grant execute on function public.publish_case_law_import to authenticated;
grant execute on function public.publish_legislation_import to authenticated;
