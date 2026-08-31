-- ============================================================================
-- 0112_case_law_fuzzy_search.sql
--
-- Fixes Case Law search being too brittle to find a case by title: e.g.
-- "R v Broughton" (a real canonical case_law row, citation [2020] EWCA
-- Crim 1093) was not found when the query had a typo ("R v Brouhgton"),
-- a partial/incomplete word ("Brought"), or was otherwise not an exact
-- lexeme match. Confirmed live before writing this migration:
--   to_tsvector('english','R v Broughton') @@ websearch_to_tsquery('english','R v Brouhgton') -> false
--   to_tsvector('english','R v Broughton') @@ websearch_to_tsquery('english','Brought')        -> false
-- Root cause: every case_law search path (search_case_law, 0010;
-- search_case_law_scoped, 0058/0074; the three case_law_counts_by_*
-- facet functions, 0084; global_search's case_law branch, 0047) relies
-- solely on `search_vector @@ websearch_to_tsquery('english', ...)` --
-- exact-lexeme full-text matching with ZERO typo/fuzzy/prefix tolerance.
-- Correctly-spelled multi-word queries already worked fine (confirmed:
-- word order and casing don't matter) -- the actual gap is purely typo/
-- fragment tolerance, which trigram similarity (pg_trgm) solves directly
-- and is the standard, well-understood tool for exactly this problem.
--
-- APPROACH: add pg_trgm-based fuzzy matching on case_name (and ILIKE
-- substring matching on case_name/citation) ALONGSIDE the existing
-- full-text search -- not a replacement. Two small SECURITY INVOKER
-- helper functions centralize the combined predicate/rank so every one
-- of the five call sites above uses IDENTICAL matching logic; keeping
-- them in sync matters concretely here because 0084 exists specifically
-- to keep facet counts consistent with actual search results, and a
-- second, differently-behaved matching rule in any one of the five
-- places would silently reintroduce that exact class of bug.
--
-- THRESHOLD: similarity(...) > 0.3, the same value as pg_trgm's own
-- default `pg_trgm.similarity_threshold` GUC -- but compared explicitly
-- rather than via the `%` operator, so behavior does not silently vary
-- if that session-level GUC is ever changed. Verified live (rollback-
-- only pretest) against the actual failing cases before choosing this
-- constant, no other value needed:
--   similarity('R v Broughton', 'R v Brouhgton') = 0.5556  (typo)
--   similarity('R v Broughton', 'Broughton')     = 0.7143  (exact name only)
--   similarity('R v Broughton', 'Brought')       = 0.4667  (partial word)
-- all comfortably above 0.3.
--
-- SCHEMA NOTE: this project installs extensions into the `extensions`
-- schema, not `public` (confirmed live via pg_extension/pg_namespace --
-- pgcrypto/uuid-ossp are both there). Every reference to
-- similarity()/gin_trgm_ops below is therefore schema-qualified
-- (`extensions.similarity`, `extensions.gin_trgm_ops`) rather than
-- widening any function's `search_path`, which stays pinned to `public`
-- exactly as every other function in this codebase.
--
-- NO FRONTEND CHANGES: every affected function keeps its exact existing
-- name, parameter list, and return shape -- this is a pure server-side
-- relevance/matching upgrade. The existing hooks (use-case-law.ts,
-- use-scoped-search.ts) and case-law-list-page.tsx need no changes at all.
-- ============================================================================

create extension if not exists pg_trgm with schema extensions;

-- ----------------------------------------------------------------------------
-- 1. Trigram indexes -- accelerate both similarity() and ILIKE '%...%'
--    (a GIN trgm index speeds up arbitrary substring ILIKE too, not just
--    the similarity operator).
-- ----------------------------------------------------------------------------

create index case_law_case_name_trgm_idx
  on public.case_law using gin (case_name extensions.gin_trgm_ops);

create index case_law_citation_trgm_idx
  on public.case_law using gin (citation extensions.gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- 2. case_law_matches_query(case_name, citation, search_vector, query)
--
-- True if: the query is empty (matches everything, matching every
-- existing call site's own "p_query is null or p_query = ''" branch,
-- now centralized here instead of duplicated five times); OR the
-- existing full-text predicate matches; OR the case name is fuzzy-
-- similar to the query above the threshold; OR the query appears as a
-- literal substring of the case name or citation (guarantees a partial/
-- fragment search of an otherwise-correct spelling always works,
-- independent of trigram/FTS quirks for very short queries).
-- ----------------------------------------------------------------------------

create or replace function public.case_law_matches_query(
  p_case_name text,
  p_citation text,
  p_search_vector tsvector,
  p_query text
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    p_query is null or p_query = '' or (
      p_search_vector @@ websearch_to_tsquery('english', p_query)
      or extensions.similarity(p_case_name, p_query) > 0.3
      or p_case_name ilike '%' || p_query || '%'
      or p_citation ilike '%' || p_query || '%'
    );
$$;

comment on function public.case_law_matches_query(text, text, tsvector, text) is
  'Centralized case_law match predicate (0112): full-text OR trigram-fuzzy case name (similarity > 0.3, tolerates typos/misspellings) OR literal substring of case name/citation (tolerates partial/incomplete words). Used identically by search_case_law, search_case_law_scoped, all three case_law_counts_by_* facet functions, and global_search''s case_law branch -- keeping every case_law search surface in sync is the entire point of centralizing this, not an incidental convenience.';

grant execute on function public.case_law_matches_query(text, text, tsvector, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. case_law_search_rank(case_name, search_vector, query)
--
-- Blends full-text rank and trigram similarity via greatest(), plus an
-- explicit boost for a literal substring hit -- so an exact/near-exact
-- title match always outranks a loose fuzzy one, regardless of which
-- signal happened to fire.
-- ----------------------------------------------------------------------------

create or replace function public.case_law_search_rank(
  p_case_name text,
  p_search_vector tsvector,
  p_query text
)
returns real
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when p_query is null or p_query = '' then 0::real
    else greatest(
      ts_rank(p_search_vector, websearch_to_tsquery('english', p_query)),
      extensions.similarity(p_case_name, p_query),
      case when p_case_name ilike '%' || p_query || '%' then 0.5 else 0 end
    )
  end;
$$;

comment on function public.case_law_search_rank(text, tsvector, text) is
  'Relevance score for case_law search (0112): greatest of full-text ts_rank, trigram similarity to case_name, and a 0.5 floor for a literal case-name substring hit. Used by search_case_law, search_case_law_scoped, and global_search''s case_law branch.';

grant execute on function public.case_law_search_rank(text, tsvector, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. search_case_law() -- unscoped variant (0010), used by
--    useScopedSearchIds() to intersect ids against the My Research /
--    Discoverable tabs. Same signature, same RLS reliance, only the
--    matching/ranking swapped.
-- ----------------------------------------------------------------------------

create or replace function public.search_case_law(p_query text, p_limit int default 20)
returns table (
  id uuid,
  case_name text,
  citation text,
  court text,
  jurisdiction text,
  summary text,
  rank real,
  headline text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    cl.id, cl.case_name, cl.citation, cl.court, cl.jurisdiction, cl.summary,
    public.case_law_search_rank(cl.case_name, cl.search_vector, p_query) as rank,
    ts_headline('english', coalesce(cl.summary, cl.full_text, ''),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10') as headline
  from public.case_law cl
  where public.case_law_matches_query(cl.case_name, cl.citation, cl.search_vector, p_query)
  order by rank desc
  limit p_limit;
$$;

comment on function public.search_case_law(text, int) is
  'Full-text + trigram-fuzzy search over case_law (0112). SECURITY INVOKER -- relies on case_law''s own SELECT RLS (canonical rows + caller''s own personal research + discoverable others'', unchanged). Tolerates typos and partial words via case_law_matches_query()/case_law_search_rank(), not just exact lexeme matches.';

-- ----------------------------------------------------------------------------
-- 5. search_case_law_scoped() -- the main Case Law Browse page's
--    canonical, facet-scoped search (0058/0074). Same signature, same
--    scoping filters, only the matching/ranking swapped.
-- ----------------------------------------------------------------------------

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
    public.case_law_search_rank(cl.case_name, cl.search_vector, p_query) as rank,
    case when p_query is not null and p_query <> ''
      then ts_headline('english', coalesce(cl.summary, cl.full_text, ''),
             websearch_to_tsquery('english', p_query), 'MaxFragments=2, MaxWords=30, MinWords=10')
      else null end as headline
  from public.case_law cl
  where cl.owner_id is null
    and public.case_law_matches_query(cl.case_name, cl.citation, cl.search_vector, p_query)
    and (p_court_id is null or cl.court_id = p_court_id)
    and (p_jurisdiction_id is null or cl.jurisdiction_id = p_jurisdiction_id)
    and (p_category_id is null or cl.category_id = p_category_id)
    and (p_tag_id is null or exists (
      select 1 from public.case_law_tags clt where clt.case_law_id = cl.id and clt.tag_id = p_tag_id
    ))
  order by (p_query is not null and p_query <> '') desc, rank desc, cl.updated_at desc
  limit p_limit;
$$;

comment on function public.search_case_law_scoped(text, integer, uuid, uuid, uuid, uuid) is
  'Canonical, facet-scoped Case Law Browse search (0112: now typo/fragment-tolerant via case_law_matches_query()/case_law_search_rank(), replacing plain exact-lexeme full-text matching). Filters unchanged from 0074 (court/jurisdiction/category/tag, canonical rows only).';

-- ----------------------------------------------------------------------------
-- 6. case_law_counts_by_court / _jurisdiction / _category (0084) --
--    same matching predicate swap, keeping facet counts in sync with
--    what search_case_law_scoped() actually returns (the entire reason
--    0084 exists).
-- ----------------------------------------------------------------------------

create or replace function public.case_law_counts_by_court(
  p_query text default null,
  p_jurisdiction_id uuid default null,
  p_category_id uuid default null,
  p_tag_id uuid default null
)
returns table(court_id uuid, result_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select cl.court_id, count(*) as result_count
  from public.case_law cl
  where cl.owner_id is null
    and cl.court_id is not null
    and public.case_law_matches_query(cl.case_name, cl.citation, cl.search_vector, p_query)
    and (p_jurisdiction_id is null or cl.jurisdiction_id = p_jurisdiction_id)
    and (p_category_id is null or cl.category_id = p_category_id)
    and (p_tag_id is null or exists (
      select 1 from public.case_law_tags clt where clt.case_law_id = cl.id and clt.tag_id = p_tag_id
    ))
  group by cl.court_id;
$$;

create or replace function public.case_law_counts_by_jurisdiction(
  p_query text default null,
  p_court_id uuid default null,
  p_category_id uuid default null,
  p_tag_id uuid default null
)
returns table(jurisdiction_id uuid, result_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select cl.jurisdiction_id, count(*) as result_count
  from public.case_law cl
  where cl.owner_id is null
    and cl.jurisdiction_id is not null
    and public.case_law_matches_query(cl.case_name, cl.citation, cl.search_vector, p_query)
    and (p_court_id is null or cl.court_id = p_court_id)
    and (p_category_id is null or cl.category_id = p_category_id)
    and (p_tag_id is null or exists (
      select 1 from public.case_law_tags clt where clt.case_law_id = cl.id and clt.tag_id = p_tag_id
    ))
  group by cl.jurisdiction_id;
$$;

create or replace function public.case_law_counts_by_category(
  p_query text default null,
  p_court_id uuid default null,
  p_jurisdiction_id uuid default null,
  p_tag_id uuid default null
)
returns table(category_id uuid, result_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select cl.category_id, count(*) as result_count
  from public.case_law cl
  where cl.category_id is not null
    and public.case_law_matches_query(cl.case_name, cl.citation, cl.search_vector, p_query)
    and (cl.owner_id is not null or p_court_id is null or cl.court_id = p_court_id)
    and (cl.owner_id is not null or p_jurisdiction_id is null or cl.jurisdiction_id = p_jurisdiction_id)
    and (p_tag_id is null or exists (
      select 1 from public.case_law_tags clt where clt.case_law_id = cl.id and clt.tag_id = p_tag_id
    ))
  group by cl.category_id;
$$;

comment on function public.case_law_counts_by_court(text, uuid, uuid, uuid) is
  'RLS-respecting, cross-filtered result counts per court (0084), now using case_law_matches_query() (0112) so a facet never shows an option that search_case_law_scoped() would then return zero results for, or vice versa.';
comment on function public.case_law_counts_by_jurisdiction(text, uuid, uuid, uuid) is
  'Same shape/semantics as case_law_counts_by_court, keyed on jurisdiction_id (0112: matching predicate synced).';
comment on function public.case_law_counts_by_category(text, uuid, uuid, uuid) is
  'RLS-respecting, cross-filtered result counts per category (0084), now using case_law_matches_query() (0112).';

-- ----------------------------------------------------------------------------
-- 7. global_search() -- case_law branch only (0047). Every other branch
--    (case, bench_note, statute, docket_matter, judgment, quick_code)
--    is byte-for-byte unchanged, per "do not rewrite unnecessarily."
-- ----------------------------------------------------------------------------

create or replace function public.global_search(p_query text, p_limit integer default 20)
returns setof public.search_result
language sql
stable
security invoker
set search_path = public
as $$
  select *
  from (
    select
      'case'::text as entity_type,
      c.id,
      c.title,
      c.case_number as subtitle,
      ts_headline('english', coalesce(c.description, ''),
        websearch_to_tsquery('english', p_query),
        'MaxFragments=2, MaxWords=30, MinWords=10') as headline,
      ts_rank(c.search_vector, websearch_to_tsquery('english', p_query)) as rank
    from public.cases c
    where c.search_vector @@ websearch_to_tsquery('english', p_query)
      and public.user_can_access_case(c.id)

    union all

    select
      'bench_note'::text,
      n.id,
      n.title,
      null::text,
      ts_headline('english', coalesce(n.content_text, ''),
        websearch_to_tsquery('english', p_query),
        'MaxFragments=2, MaxWords=30, MinWords=10'),
      ts_rank(n.search_vector, websearch_to_tsquery('english', p_query))
    from public.bench_notes n
    where n.search_vector @@ websearch_to_tsquery('english', p_query)
      and public.user_can_access_bench_note(n.id)

    union all

    select
      'statute'::text,
      s.id,
      s.title,
      s.code,
      ts_headline('english', coalesce(s.summary, s.full_text, ''),
        websearch_to_tsquery('english', p_query),
        'MaxFragments=2, MaxWords=30, MinWords=10'),
      ts_rank(s.search_vector, websearch_to_tsquery('english', p_query))
    from public.statutes s
    where s.search_vector @@ websearch_to_tsquery('english', p_query)

    union all

    select
      'case_law'::text,
      cl.id,
      cl.case_name,
      cl.citation,
      ts_headline('english', coalesce(cl.summary, cl.full_text, ''),
        websearch_to_tsquery('english', p_query),
        'MaxFragments=2, MaxWords=30, MinWords=10'),
      public.case_law_search_rank(cl.case_name, cl.search_vector, p_query)
    from public.case_law cl
    where public.case_law_matches_query(cl.case_name, cl.citation, cl.search_vector, p_query)

    union all

    select
      'docket_matter'::text,
      dm.id,
      dm.matter_title,
      dm.case_number,
      ts_headline('english', coalesce(dm.orders_summary, dm.charge_or_issue, ''),
        websearch_to_tsquery('english', p_query),
        'MaxFragments=2, MaxWords=30, MinWords=10'),
      ts_rank(dm.search_vector, websearch_to_tsquery('english', p_query))
    from public.docket_matters dm
    where dm.search_vector @@ websearch_to_tsquery('english', p_query)

    union all

    select
      'judgment'::text,
      j.id,
      j.title,
      j.citation,
      ts_headline('english', coalesce(j.content_text, ''),
        websearch_to_tsquery('english', p_query),
        'MaxFragments=2, MaxWords=30, MinWords=10'),
      ts_rank(j.search_vector, websearch_to_tsquery('english', p_query))
    from public.judgments j
    where j.search_vector @@ websearch_to_tsquery('english', p_query)

    union all

    select
      'quick_code'::text,
      qc.id,
      coalesce(qc.title, qc.code_word),
      qc.code_word,
      ts_headline('english', coalesce(qc.content, ''),
        websearch_to_tsquery('english', p_query),
        'MaxFragments=2, MaxWords=30, MinWords=10'),
      ts_rank(qc.search_vector, websearch_to_tsquery('english', p_query))
    from public.quick_codes qc
    where qc.search_vector @@ websearch_to_tsquery('english', p_query)
  ) results
  order by rank desc
  limit p_limit;
$$;

comment on function public.global_search(text, integer) is
  'Unified full-text search across nine entity types. 0112: the case_law branch now uses case_law_matches_query()/case_law_search_rank() (typo/fragment-tolerant), matching every other case_law search surface. Every other branch is unchanged from 0047.';
