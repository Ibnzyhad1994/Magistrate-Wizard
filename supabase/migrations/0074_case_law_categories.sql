-- ============================================================================
-- 0074_case_law_categories.sql
--
-- Adds a "Category" classification to Case Law (e.g. "Murder", "Narcotics")
-- so a magistrate can select the type of matter a case relates to when
-- cataloguing it, then click a Category on Browse to find everything filed
-- under it. Modeled directly on the existing Court/Jurisdiction taxonomy
-- pattern (0058: `legal_jurisdictions`/`legal_authority_courts`) rather than
-- reusing the generic `tags` table (0006) -- Category is a SINGLE, flat,
-- curator-controlled classification purpose-built for Case Law browse/filter
-- navigation, distinct from `tags`, which is a free-text, multi-valued,
-- multi-entity (bench notes/statutes/docket cases too) label system with no
-- browse-navigation role. Conflating the two would blur what each is for.
--
-- Sections:
--   1. `legal_case_categories` reference table -- readable by all
--      authenticated users, write restricted to admins (same RLS shape as
--      `legal_jurisdictions`). Flat (no parent grouping) -- Category doesn't
--      need one the way Jurisdiction needs a Regional Group.
--   2. `case_law.category_id` -- nullable, additive. Every existing row is
--      uncategorized until a curator sets one; nothing is inferred/guessed.
--   3. `case_law_counts_by_category()` -- mirrors
--      `case_law_counts_by_court`/`case_law_counts_by_jurisdiction` (0058)
--      for the Browse UI's per-option result counts.
--   4. `search_case_law_scoped` -- add `p_category_id`, combining with
--      Court/Jurisdiction/Tag scoping exactly as they already combine with
--      each other. Signature changes require DROP + CREATE (not plain
--      CREATE OR REPLACE) to avoid silently creating an ambiguous
--      overload -- same reasoning as 0071's treatment of this exact
--      function family. Also fixes a latent bug exposed by this pass: the
--      function's own doc comment (0058) says it backs the Browse UI's
--      CANONICAL tab once a filter is active, but it never actually
--      restricted to `owner_id is null` -- harmless before now only
--      because a personal research row's court_id/jurisdiction_id were
--      always NULL (the personal Case Law form never set them), so it
--      could never match a Court/Jurisdiction filter. category_id IS set
--      from the personal form (this pass), so without this fix a
--      Category-filtered search would leak a magistrate's own personal
--      research into the Canonical tab.
--   5. `create_case_law_import` -- add `p_category_id` (nullable, default
--      null) so a curator can classify a Case Law record at ingestion time,
--      not only afterward from the Review Queue.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Category reference table
-- ----------------------------------------------------------------------------
create table public.legal_case_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.legal_case_categories is
  'The TYPE OF MATTER a Case Law record relates to (e.g. "Murder", "Narcotics", "Sexual Offences") -- a single, flat, curator-controlled classification used for Browse/filter navigation. Distinct from `tags` (0006), which is free-text, multi-valued, and shared across several unrelated entity types. Data-driven: adding a new Category is an INSERT, never a code change.';

alter table public.legal_case_categories enable row level security;

create policy "Case categories are viewable by all authenticated users" on public.legal_case_categories
  for select using (true);
create policy "Admins manage case categories" on public.legal_case_categories
  for insert with check ((select public.is_admin()));
create policy "Admins update case categories" on public.legal_case_categories
  for update using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins delete case categories" on public.legal_case_categories
  for delete using ((select public.is_admin()));

insert into public.legal_case_categories (name, sort_order) values
  ('Murder / Homicide', 1),
  ('Narcotics', 2),
  ('Sexual Offences', 3),
  ('Robbery', 4),
  ('Firearms Offences', 5),
  ('Assault / Violence', 6),
  ('Theft / Property Offences', 7),
  ('Fraud / Financial Crime', 8),
  ('Domestic Violence', 9),
  ('Traffic / Road Traffic Offences', 10),
  ('Public Order / Nuisance', 11),
  ('Bail & Remand', 12),
  ('Evidence & Procedure', 13),
  ('Sentencing', 14),
  ('Constitutional / Human Rights', 15),
  ('Family Law', 16),
  ('Civil — Contract', 17),
  ('Civil — Tort', 18),
  ('Other', 19);

-- ----------------------------------------------------------------------------
-- 2. case_law.category_id -- nullable, additive
-- ----------------------------------------------------------------------------
alter table public.case_law
  add column category_id uuid references public.legal_case_categories(id) on delete set null;

create index case_law_category_id_idx on public.case_law (category_id);

comment on column public.case_law.category_id is
  'The type of matter this case relates to (legal_case_categories) -- e.g. Murder, Narcotics. Nullable: uncategorized until a curator/owner sets it, never inferred.';

-- ----------------------------------------------------------------------------
-- 3. Browse count RPC
-- ----------------------------------------------------------------------------
create or replace function public.case_law_counts_by_category()
returns table(category_id uuid, result_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select category_id, count(*) as result_count
  from public.case_law
  where category_id is not null
  group by category_id;
$$;

-- ----------------------------------------------------------------------------
-- 4. search_case_law_scoped -- add p_category_id
-- ----------------------------------------------------------------------------
drop function if exists public.search_case_law_scoped(text, integer, uuid, uuid, uuid);

create or replace function public.search_case_law_scoped(
  p_query text default null,
  p_limit integer default 50,
  p_court_id uuid default null,
  p_jurisdiction_id uuid default null,
  p_tag_id uuid default null,
  p_category_id uuid default null
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
  where cl.owner_id is null
    and (p_query is null or p_query = '' or cl.search_vector @@ websearch_to_tsquery('english', p_query))
    and (p_court_id is null or cl.court_id = p_court_id)
    and (p_jurisdiction_id is null or cl.jurisdiction_id = p_jurisdiction_id)
    and (p_category_id is null or cl.category_id = p_category_id)
    and (p_tag_id is null or exists (
      select 1 from public.case_law_tags clt where clt.case_law_id = cl.id and clt.tag_id = p_tag_id
    ))
  order by (p_query is not null and p_query <> '') desc, rank desc, cl.updated_at desc
  limit p_limit;
$$;

-- ----------------------------------------------------------------------------
-- 5. create_case_law_import -- add p_category_id
-- ----------------------------------------------------------------------------
drop function if exists public.create_case_law_import(
  text, text, text, text, uuid, uuid, text, text, date, text, text, uuid, text, text, uuid, jsonb, text[], text, text
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
  p_content_quality_status text default 'unknown',
  p_category_id uuid default null
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
    owner_id, review_status, content_quality_status, category_id
  ) values (
    p_case_name, p_citation, p_court, p_jurisdiction, p_court_id, p_jurisdiction_id,
    p_neutral_citation, p_reported_citation, p_decided_date, p_full_text,
    p_source_url, p_source_id, p_original_filename, p_document_hash, now(),
    null, 'needs_review', coalesce(p_content_quality_status, 'unknown'), p_category_id
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
grant execute on function public.create_case_law_import to authenticated;
