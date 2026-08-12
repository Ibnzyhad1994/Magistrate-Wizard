-- ============================================================================
-- 0061_case_law_publication_validation.sql
--
-- BenchBook Case Law ingestion golden-path repair pass, §6/§20.
--
-- The live browser test confirmed a canonical Case Law record could be
-- published while `case_name` was still the system-default placeholder
-- "Untitled (pending review)" -- the frontend Publish button had no
-- validation at all. This migration re-checks the SAME placeholder rules
-- enforced client-side (src/lib/publication-validation.ts) at the
-- `publish_case_law_import`/`publish_legislation_import` RPC boundary, so
-- a record can never be published through ANY path (this admin UI today,
-- a future bulk tool, or a direct RPC call) while holding placeholder-only
-- metadata -- per the explicit instruction that publication validation
-- must exist at BOTH the frontend AND the database/RPC boundary, and must
-- never rely solely on a disabled button.
--
-- Additive, CREATE OR REPLACE only. Does not edit any previously applied
-- migration (0058 defined both functions originally; 0059/0060 have not
-- touched them). No table/column changes -- this is validation logic
-- layered onto the existing publish path only.
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

  select import_job_id, case_name, citation, court, jurisdiction, court_id, jurisdiction_id
    into v_job_id, v_case_name, v_citation, v_court, v_jurisdiction, v_court_id, v_jurisdiction_id
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

  update public.case_law set review_status = 'published' where id = p_case_law_id;

  if v_job_id is not null then
    update public.import_jobs set status = 'published', completed_at = now() where id = v_job_id;
  end if;
end;
$$;

-- Tiny shared fix (explicitly permitted per §15/§20 for consistency across
-- the two ingestion pipelines that share this exact defect class) -- same
-- placeholder gate applied to Legislation's publish path. No other
-- Legislation behavior is touched.
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
  v_bad text[] := array[
    '', 'untitled', 'untitled (pending review)', 'unknown', 'tbd', 'n/a',
    'na', 'none', 'pending', 'pending review', 'coa', 'court', 'jurisdiction'
  ];
begin
  if not public.is_admin() then
    raise exception 'Only administrators may publish canonical Legislation.';
  end if;

  select import_job_id, code, title, jurisdiction, jurisdiction_id
    into v_job_id, v_code, v_title, v_jurisdiction, v_jurisdiction_id
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

  update public.statutes set review_status = 'published' where id = p_statute_id;

  if v_job_id is not null then
    update public.import_jobs set status = 'published', completed_at = now() where id = v_job_id;
  end if;
end;
$$;

-- Grants are unaffected (CREATE OR REPLACE preserves existing grants on a
-- function whose signature is unchanged) -- re-stated defensively anyway,
-- matching 0058's original grant list exactly.
revoke execute on function public.publish_case_law_import from public;
revoke execute on function public.publish_legislation_import from public;
grant execute on function public.publish_case_law_import to authenticated;
grant execute on function public.publish_legislation_import to authenticated;
