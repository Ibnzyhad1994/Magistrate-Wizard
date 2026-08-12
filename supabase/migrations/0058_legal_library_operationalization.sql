-- ============================================================================
-- 0058_legal_library_operationalization.sql
--
-- Repairs identified by an independent source audit of commit 725045c
-- (0055-0057 "Legal Library Ingestion Phase"). Additive/forward-only --
-- 0055-0057 are NOT edited. Sections:
--   1. Security fix: is_discoverable was an unconditional OR branch in
--      can_view_case_law()/case_law's own SELECT policy, independent of
--      owner_id/review_status -- scope it to personal rows only.
--   2. documents_parent_cascade_delete() never had a 'statute' branch,
--      so deleting a Legislation row orphaned its `documents` metadata.
--   3. Normalized legal_regional_groups / legal_jurisdictions /
--      legal_authority_courts reference tables + seed catalogue.
--   4. case_law.court_id/jurisdiction_id (nullable, additive) + a
--      deterministic (never-guessed) backfill from existing free text.
--   5. Transactional SECURITY DEFINER RPCs for create/publish/reject, so
--      a Case Law/Legislation import's draft row + provisions + import
--      job + bidirectional link are one atomic operation, and
--      publish/reject keep the parent record and its import_jobs row in
--      sync instead of drifting independently.
--   6. search_case_law_scoped() -- a NEW function (search_case_law()
--      itself is untouched, avoiding any grant/signature risk to
--      existing callers) supporting Court/Jurisdiction/Tag-scoped search
--      plus two small RLS-respecting count RPCs for the Browse UI.
-- ============================================================================

-- ============================================================================
-- 1. Fix: is_discoverable must never surface DRAFT CANONICAL content.
--    Before this fix, `is_discoverable = true` was an unconditional OR
--    branch -- true regardless of owner_id or review_status. In practice
--    unexploitable today (is_discoverable defaults false and no UI path
--    sets it on a canonical row -- DiscoverabilityCard only renders when
--    isOwner, and owner_id IS NULL can never equal auth.uid()), but the
--    RLS/helper itself should not depend on that frontend restraint.
--    Scoping the branch to `owner_id IS NOT NULL` makes the invariant
--    "a draft canonical row is never visible via is_discoverable" true
--    at the database level, matching its only intended use: a personal
--    research record's owner-controlled sharing flag.
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
        or (cl.owner_id is not null and cl.is_discoverable = true)
      )
  );
$$;

drop policy "Canonical, own, and discoverable Case Law is viewable" on public.case_law;
create policy "Canonical, own, and discoverable Case Law is viewable" on public.case_law
  for select using (
    (owner_id is null and (review_status = 'published' or (select public.is_admin())))
    or owner_id = (select auth.uid())
    or (owner_id is not null and is_discoverable = true)
  );

comment on column public.case_law.is_discoverable is
  'Owner-controlled sharing flag for PERSONAL research only (owner_id IS NOT NULL). Meaningless/inert on a canonical row (owner_id IS NULL) -- canonical visibility is governed exclusively by review_status/is_admin(), never by this column (see can_view_case_law(), 0058).';

-- ============================================================================
-- 2. Fix: documents_parent_cascade_delete() had no 'statute' branch, so
--    deleting a Legislation row left orphaned `documents` metadata rows
--    (pointing at a now-nonexistent parent). Mirrors the existing
--    case_law/judgments/docket_matters/quick_codes/bench_notes/cases
--    branches exactly. As with every other branch, this deletes only the
--    `documents` METADATA row -- the underlying Storage object is never
--    touched by SQL, per this project's own established, documented
--    principle (explicit deletion removes the Storage blob via the
--    Storage API client-side FIRST; see architecture spec S16/note on
--    "0049 Storage Policy Updates").
-- ============================================================================
create or replace function public.documents_parent_cascade_delete()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
declare
  v_entity_type text;
begin
  case tg_table_name
    when 'docket_matters' then v_entity_type := 'docket_matter';
    when 'judgments'      then v_entity_type := 'judgment';
    when 'case_law'       then v_entity_type := 'case_law';
    when 'quick_codes'    then v_entity_type := 'quick_code';
    when 'bench_notes'    then v_entity_type := 'bench_note';
    when 'cases'          then v_entity_type := 'case';
    when 'statutes'       then v_entity_type := 'statute';
    else
      raise exception 'documents_parent_cascade_delete: unsupported parent table %', tg_table_name;
  end case;

  delete from public.documents
  where entity_type = v_entity_type
    and entity_id = old.id;

  return old;
end;
$$;

create trigger documents_cascade_delete_statutes
  before delete on public.statutes
  for each row execute function public.documents_parent_cascade_delete();

-- ============================================================================
-- 3. Normalized Court/Jurisdiction reference data. Shared reference data
--    (like `courts`/`magisterial_districts`, 0002/0013): readable by all
--    authenticated users, write restricted to admins. Deliberately named
--    `legal_*` / `legal_authority_courts` -- NOT `courts`, which already
--    means something different in this schema (0002: the physical
--    Magistrates' Courts a magistrate is assigned to for Docket
--    authority). Conflating the two would be a genuine, serious modeling
--    error, not a naming nicety.
-- ============================================================================
create table public.legal_regional_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.legal_regional_groups is
  'Coarse grouping used for Case Law browse/filter UI (e.g. "Guyana", "Regional", "Commonwealth Caribbean", "Eastern Caribbean / OECS", "Persuasive Commonwealth"). A jurisdiction belongs to exactly one; a supranational/apex court (CCJ, Privy Council) may also reference one directly when it has no single home jurisdiction.';

create table public.legal_jurisdictions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  regional_group_id uuid not null references public.legal_regional_groups(id) on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.legal_jurisdictions is
  'The country/territory a Case Law record is FROM (e.g. "Guyana", "Saint Lucia", "Canada") -- distinct from the DECIDING COURT (legal_authority_courts) and distinct again from the SOURCE REPOSITORY (legal_sources). The same jurisdiction can be served by more than one court, and the same court (e.g. the Eastern Caribbean Court of Appeal) can serve more than one jurisdiction -- do not conflate these three concepts anywhere in the frontend.';

create index legal_jurisdictions_regional_group_idx on public.legal_jurisdictions (regional_group_id);

create table public.legal_authority_courts (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  short_name text,
  jurisdiction_id uuid references public.legal_jurisdictions(id) on delete set null,
  regional_group_id uuid references public.legal_regional_groups(id) on delete set null,
  court_level text,
  aliases text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.legal_authority_courts is
  'Canonical deciding-court catalogue. jurisdiction_id is NULL for a supranational/apex court with no single home jurisdiction (CCJ, Privy Council, Eastern Caribbean Court of Appeal -- the last serves multiple OECS member jurisdictions, so it is NOT tied to one; the specific case''s jurisdiction is recorded separately on case_law.jurisdiction_id). aliases exists specifically to prevent taxonomy pollution -- "CCJ"/"Caribbean Court Justice"/"Caribbean Court of Justice" must resolve to ONE row, not three. Data-driven: adding a new court is an INSERT, never a code change.';

create index legal_authority_courts_jurisdiction_idx on public.legal_authority_courts (jurisdiction_id);
create index legal_authority_courts_regional_group_idx on public.legal_authority_courts (regional_group_id);
create index legal_authority_courts_aliases_gin_idx on public.legal_authority_courts using gin (aliases);
create unique index legal_authority_courts_canonical_name_unique_idx on public.legal_authority_courts (canonical_name);

alter table public.legal_regional_groups enable row level security;
alter table public.legal_jurisdictions enable row level security;
alter table public.legal_authority_courts enable row level security;

create policy "Regional groups are viewable by all authenticated users" on public.legal_regional_groups
  for select using (true);
create policy "Admins manage regional groups" on public.legal_regional_groups
  for insert with check ((select public.is_admin()));
create policy "Admins update regional groups" on public.legal_regional_groups
  for update using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins delete regional groups" on public.legal_regional_groups
  for delete using ((select public.is_admin()));

create policy "Jurisdictions are viewable by all authenticated users" on public.legal_jurisdictions
  for select using (true);
create policy "Admins manage jurisdictions" on public.legal_jurisdictions
  for insert with check ((select public.is_admin()));
create policy "Admins update jurisdictions" on public.legal_jurisdictions
  for update using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins delete jurisdictions" on public.legal_jurisdictions
  for delete using ((select public.is_admin()));

create policy "Authority courts are viewable by all authenticated users" on public.legal_authority_courts
  for select using (true);
create policy "Admins manage authority courts" on public.legal_authority_courts
  for insert with check ((select public.is_admin()));
create policy "Admins update authority courts" on public.legal_authority_courts
  for update using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins delete authority courts" on public.legal_authority_courts
  for delete using ((select public.is_admin()));

create trigger set_legal_jurisdictions_updated_at
  before update on public.legal_jurisdictions
  for each row execute function public.set_updated_at();
create trigger set_legal_authority_courts_updated_at
  before update on public.legal_authority_courts
  for each row execute function public.set_updated_at();

-- Seed: a starting catalogue, not an exhaustive one -- extensible later
-- by INSERT, never a schema/code change (per explicit instruction: "do
-- not hard-code the entire Court list permanently inside one React
-- component").
insert into public.legal_regional_groups (name, sort_order) values
  ('Guyana', 1),
  ('Regional', 2),
  ('Commonwealth Caribbean', 3),
  ('Eastern Caribbean / OECS', 4),
  ('Persuasive Commonwealth', 5);

insert into public.legal_jurisdictions (name, regional_group_id, sort_order)
select v.name, g.id, v.sort_order
from (values
  ('Guyana', 'Guyana', 1),
  ('Trinidad and Tobago', 'Commonwealth Caribbean', 2),
  ('Barbados', 'Commonwealth Caribbean', 3),
  ('Jamaica', 'Commonwealth Caribbean', 4),
  ('Belize', 'Commonwealth Caribbean', 5),
  ('Saint Lucia', 'Eastern Caribbean / OECS', 6),
  ('Saint Vincent and the Grenadines', 'Eastern Caribbean / OECS', 7),
  ('Antigua and Barbuda', 'Eastern Caribbean / OECS', 8),
  ('Dominica', 'Eastern Caribbean / OECS', 9),
  ('Grenada', 'Eastern Caribbean / OECS', 10),
  ('Saint Kitts and Nevis', 'Eastern Caribbean / OECS', 11),
  ('Canada', 'Persuasive Commonwealth', 12),
  ('South Africa', 'Persuasive Commonwealth', 13),
  ('United Kingdom', 'Persuasive Commonwealth', 14)
) as v(name, group_name, sort_order)
join public.legal_regional_groups g on g.name = v.group_name;

insert into public.legal_authority_courts (canonical_name, short_name, jurisdiction_id, regional_group_id, court_level, aliases)
select v.canonical_name, v.short_name, j.id, g.id, v.court_level, v.aliases
from (values
  ('Court of Appeal of Guyana', 'Guyana Court of Appeal', 'Guyana', null, 'appellate', array['Court of Appeal', 'Guyana Court of Appeal', 'CoA Guyana']),
  ('High Court of Guyana', 'High Court of Guyana', 'Guyana', null, 'superior', array['High Court', 'Supreme Court of Judicature of Guyana', 'High Court of Guyana']),
  ('Full Court of Guyana', 'Full Court', 'Guyana', null, 'superior', array['Full Court']),
  ('Caribbean Court of Justice', 'CCJ', null, 'Regional', 'apex', array['CCJ', 'Caribbean Court Justice', 'Caribbean Court of Justice']),
  ('Judicial Committee of the Privy Council', 'Privy Council', null, 'Regional', 'apex', array['JCPC', 'Privy Council', 'Judicial Committee of the Privy Council']),
  ('Court of Appeal of Trinidad and Tobago', 'T&T Court of Appeal', 'Trinidad and Tobago', null, 'appellate', array['Court of Appeal of Trinidad and Tobago', 'T&T Court of Appeal']),
  ('High Court of Trinidad and Tobago', 'T&T High Court', 'Trinidad and Tobago', null, 'superior', array['High Court of Trinidad and Tobago']),
  ('Court of Appeal of Barbados', 'Barbados Court of Appeal', 'Barbados', null, 'appellate', array['Court of Appeal of Barbados', 'Barbados Court of Appeal']),
  ('High Court of Barbados', null, 'Barbados', null, 'superior', array['High Court of Barbados']),
  ('Court of Appeal of Jamaica', 'Jamaica Court of Appeal', 'Jamaica', null, 'appellate', array['Court of Appeal of Jamaica', 'Jamaica Court of Appeal']),
  ('Supreme Court of Jamaica', null, 'Jamaica', null, 'superior', array['Supreme Court of Jamaica']),
  ('Court of Appeal of Belize', 'Belize Court of Appeal', 'Belize', null, 'appellate', array['Court of Appeal of Belize', 'Belize Court of Appeal']),
  ('Supreme Court of Belize', null, 'Belize', null, 'superior', array['Supreme Court of Belize']),
  ('Eastern Caribbean Court of Appeal', 'ECSC Court of Appeal', null, 'Eastern Caribbean / OECS', 'appellate', array['Eastern Caribbean Court of Appeal', 'ECSC Court of Appeal', 'Court of Appeal (ECSC)']),
  ('Eastern Caribbean Supreme Court (High Court)', 'ECSC High Court', null, 'Eastern Caribbean / OECS', 'superior', array['Eastern Caribbean Supreme Court', 'ECSC High Court', 'High Court (ECSC)']),
  ('Supreme Court of Canada', 'SCC', 'Canada', null, 'apex', array['Supreme Court of Canada', 'SCC']),
  ('Constitutional Court of South Africa', null, 'South Africa', null, 'apex', array['Constitutional Court of South Africa', 'Constitutional Court']),
  ('Supreme Court of Appeal of South Africa', 'SCA', 'South Africa', null, 'appellate', array['Supreme Court of Appeal of South Africa', 'SCA']),
  ('Supreme Court of the United Kingdom', 'UKSC', 'United Kingdom', null, 'apex', array['Supreme Court of the United Kingdom', 'UKSC']),
  ('Court of Appeal of England and Wales', null, 'United Kingdom', null, 'appellate', array['Court of Appeal of England and Wales', 'Court of Appeal (E&W)'])
) as v(canonical_name, short_name, jurisdiction_name, group_name, court_level, aliases)
left join public.legal_jurisdictions j on j.name = v.jurisdiction_name
left join public.legal_regional_groups g on g.name = v.group_name;

-- ============================================================================
-- 4. case_law.court_id / jurisdiction_id -- nullable, additive. Existing
--    free-text `court`/`jurisdiction` columns are PRESERVED unchanged
--    (used as display fallback whenever the normalized relationship is
--    absent) -- this is intentionally NOT a breaking migration. Backfill
--    is deterministic (exact case-insensitive match on jurisdiction name,
--    or court canonical_name/alias) and NEVER invents a mapping; any row
--    that doesn't exactly match stays NULL, to be corrected by a curator
--    later, exactly as instructed ("do not invent mappings").
-- ============================================================================
alter table public.case_law
  add column court_id uuid references public.legal_authority_courts(id) on delete set null,
  add column jurisdiction_id uuid references public.legal_jurisdictions(id) on delete set null;

alter table public.statutes
  add column jurisdiction_id uuid references public.legal_jurisdictions(id) on delete set null;

create index case_law_court_id_idx on public.case_law (court_id);
create index case_law_jurisdiction_id_idx on public.case_law (jurisdiction_id);
create index statutes_jurisdiction_id_idx on public.statutes (jurisdiction_id);

comment on column public.case_law.court is
  'Free-text deciding court as entered/extracted -- preserved for backward compatibility and as a display fallback. Prefer court_id (legal_authority_courts) where set; do not delete/overwrite this column.';
comment on column public.case_law.jurisdiction is
  'Free-text jurisdiction as entered/extracted -- preserved for backward compatibility and as a display fallback. Prefer jurisdiction_id (legal_jurisdictions) where set; do not delete/overwrite this column.';

update public.case_law cl
set jurisdiction_id = j.id
from public.legal_jurisdictions j
where cl.jurisdiction_id is null
  and lower(trim(cl.jurisdiction)) = lower(j.name);

update public.case_law cl
set court_id = c.id
from public.legal_authority_courts c
where cl.court_id is null
  and (
    lower(trim(cl.court)) = lower(c.canonical_name)
    or lower(trim(cl.court)) = any (select lower(a) from unnest(c.aliases) as a)
  );

update public.statutes s
set jurisdiction_id = j.id
from public.legal_jurisdictions j
where s.jurisdiction_id is null
  and lower(trim(s.jurisdiction)) = lower(j.name);

-- ============================================================================
-- 5. Transactional ingestion RPCs. SECURITY DEFINER is genuinely required
--    here (an ordinary authenticated client cannot otherwise perform a
--    multi-table atomic write across case_law/statutes + statute_provisions
--    + import_jobs in one round trip); every function re-checks
--    is_admin() explicitly as its first statement (defense in depth --
--    the pre-existing case_law_ownership_guard trigger, unmodified,
--    independently enforces the same rule on the INSERT itself, since
--    triggers observe auth.uid() from the session GUC regardless of the
--    calling function's privilege escalation). search_path is pinned to
--    'public' on every one. EXECUTE is revoked from the schema-default
--    PUBLIC grant and restricted to 'authenticated' only, mirroring the
--    0043 precedent for sensitive functions.
-- ============================================================================
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
  p_duplicate_warning text default null
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
    owner_id, review_status
  ) values (
    p_case_name, p_citation, p_court, p_jurisdiction, p_court_id, p_jurisdiction_id,
    p_neutral_citation, p_reported_citation, p_decided_date, p_full_text,
    p_source_url, p_source_id, p_original_filename, p_document_hash, now(),
    null, 'needs_review'
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
  p_provisions jsonb default '[]'::jsonb
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
    review_status
  ) values (
    p_code, p_title, p_short_title, p_jurisdiction, p_jurisdiction_id, p_full_text,
    p_source_url, p_source_id, p_original_filename, p_document_hash, now(),
    'needs_review'
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

create or replace function public.publish_case_law_import(p_case_law_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may publish canonical Case Law.';
  end if;

  if not exists (select 1 from public.case_law where id = p_case_law_id) then
    raise exception 'Case Law record % not found.', p_case_law_id;
  end if;

  select import_job_id into v_job_id from public.case_law where id = p_case_law_id;

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
begin
  if not public.is_admin() then
    raise exception 'Only administrators may publish canonical Legislation.';
  end if;

  if not exists (select 1 from public.statutes where id = p_statute_id) then
    raise exception 'Legislation record % not found.', p_statute_id;
  end if;

  select import_job_id into v_job_id from public.statutes where id = p_statute_id;

  update public.statutes set review_status = 'published' where id = p_statute_id;

  if v_job_id is not null then
    update public.import_jobs set status = 'published', completed_at = now() where id = v_job_id;
  end if;
end;
$$;

create or replace function public.reject_case_law_import(p_case_law_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may reject a Case Law draft.';
  end if;

  if not exists (select 1 from public.case_law where id = p_case_law_id) then
    raise exception 'Case Law record % not found.', p_case_law_id;
  end if;

  select import_job_id into v_job_id from public.case_law where id = p_case_law_id;

  if v_job_id is not null then
    update public.import_jobs
    set status = 'failed',
        error_summary = coalesce(p_reason, 'Rejected by curator during review.'),
        target_case_law_id = null,
        completed_at = now()
    where id = v_job_id;
  end if;

  -- documents_parent_cascade_delete() (unchanged, 0055) removes any
  -- attached `documents` metadata rows automatically on this DELETE. The
  -- caller MUST remove the underlying Storage object(s) via the Storage
  -- API BEFORE calling this function -- SQL cannot delete a Storage
  -- object, only its metadata row (see use-import-jobs.ts).
  delete from public.case_law where id = p_case_law_id;
end;
$$;

create or replace function public.reject_legislation_import(p_statute_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may reject a Legislation draft.';
  end if;

  if not exists (select 1 from public.statutes where id = p_statute_id) then
    raise exception 'Legislation record % not found.', p_statute_id;
  end if;

  select import_job_id into v_job_id from public.statutes where id = p_statute_id;

  if v_job_id is not null then
    update public.import_jobs
    set status = 'failed',
        error_summary = coalesce(p_reason, 'Rejected by curator during review.'),
        target_statute_id = null,
        completed_at = now()
    where id = v_job_id;
  end if;

  -- statute_provisions cascade-delete via their own FK (0055, on delete
  -- cascade); documents_parent_cascade_delete() (fixed in Section 2
  -- above) removes any attached `documents` metadata rows.
  delete from public.statutes where id = p_statute_id;
end;
$$;

revoke execute on function public.create_case_law_import from public;
revoke execute on function public.create_legislation_import from public;
revoke execute on function public.publish_case_law_import from public;
revoke execute on function public.publish_legislation_import from public;
revoke execute on function public.reject_case_law_import from public;
revoke execute on function public.reject_legislation_import from public;

grant execute on function public.create_case_law_import to authenticated;
grant execute on function public.create_legislation_import to authenticated;
grant execute on function public.publish_case_law_import to authenticated;
grant execute on function public.publish_legislation_import to authenticated;
grant execute on function public.reject_case_law_import to authenticated;
grant execute on function public.reject_legislation_import to authenticated;

-- ============================================================================
-- 6. Court/Jurisdiction/Tag-scoped Case Law search + RLS-respecting browse
--    counts. A NEW function, not a CREATE OR REPLACE of search_case_law()
--    -- avoids any risk of an ambiguous-overload/grant-loss regression to
--    the existing, already-relied-upon 2-argument function.
-- ============================================================================
create or replace function public.search_case_law_scoped(
  p_query text default null,
  p_limit integer default 50,
  p_court_id uuid default null,
  p_jurisdiction_id uuid default null,
  p_tag_id uuid default null
)
returns table(id uuid, case_name text, citation text, court text, jurisdiction text, summary text, rank real, headline text)
language sql
stable
security invoker
set search_path = public
as $$
  select
    cl.id, cl.case_name, cl.citation, cl.court, cl.jurisdiction, cl.summary,
    case when p_query is not null and p_query <> ''
      then ts_rank(cl.search_vector, websearch_to_tsquery('english', p_query))
      else 0 end as rank,
    case when p_query is not null and p_query <> ''
      then ts_headline('english', coalesce(cl.summary, cl.full_text, ''),
             websearch_to_tsquery('english', p_query), 'MaxFragments=2, MaxWords=30, MinWords=10')
      else null end as headline
  from public.case_law cl
  where (p_query is null or p_query = '' or cl.search_vector @@ websearch_to_tsquery('english', p_query))
    and (p_court_id is null or cl.court_id = p_court_id)
    and (p_jurisdiction_id is null or cl.jurisdiction_id = p_jurisdiction_id)
    and (p_tag_id is null or exists (
      select 1 from public.case_law_tags clt where clt.case_law_id = cl.id and clt.tag_id = p_tag_id
    ))
  order by (p_query is not null and p_query <> '') desc, rank desc, cl.updated_at desc
  limit p_limit;
$$;

create or replace function public.case_law_counts_by_court()
returns table(court_id uuid, result_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select court_id, count(*) as result_count
  from public.case_law
  where court_id is not null
  group by court_id;
$$;

create or replace function public.case_law_counts_by_jurisdiction()
returns table(jurisdiction_id uuid, result_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select jurisdiction_id, count(*) as result_count
  from public.case_law
  where jurisdiction_id is not null
  group by jurisdiction_id;
$$;
