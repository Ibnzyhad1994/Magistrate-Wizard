-- 0047_search_extensions.sql
--
-- STATUS: APPLIED and verified live (20260811023028). Full 20-item
-- rollback-only pretest passed clean (zero defects); live post-apply
-- verification of privacy-transition behavior and security/performance
-- advisors confirmed zero new findings attributable to this migration
-- (only the three expected `unused_index` INFO findings on the new
-- search_vector indexes, matching the judgments_finalized_by_idx
-- precedent from 0045).
--
-- PURPOSE: extend full-text search to the three tables built since the
-- original `0010_search` migration that still have none:
-- `docket_matters`, `judgments`, `quick_codes`. Follows the established
-- live pattern exactly (confirmed by inspection, not assumed): a
-- `GENERATED ALWAYS ... STORED` `tsvector` column built from
-- `to_tsvector('english', coalesce(...) || ' ' || coalesce(...) ...)`,
-- a covering GIN index, a per-table `SECURITY INVOKER` `search_X(p_query
-- text, p_limit integer default 20)` function using
-- `websearch_to_tsquery('english', p_query)` and `ts_rank`/`ts_headline`,
-- and three new branches added to `global_search()`'s existing
-- `UNION ALL`, returning the unmodified `search_result` composite type
-- (`entity_type text, id uuid, title text, subtitle text, headline
-- text, rank real`) -- confirmed live; no type/enum change of any kind,
-- so none of the `bookmark_entity_type` enum-migration risk applies
-- here (`search_result.entity_type` is plain `text`, not a Postgres
-- enum -- there is nothing to `ALTER TYPE`).
--
-- SCOPE, EXPLICIT (Part I/Z/AA/AB/AC): only `docket_matters`,
-- `judgments`, `quick_codes` are added. `docket_events`,
-- `docket_matter_parties`, `docket_matter_tags`, `judgment_tags`, and
-- `case_law_annotations` are NOT made independent search entities --
-- they are child/organizational rows of an already-searchable parent,
-- not their own identity a user would search for standalone (a Docket
-- Event or a tag is never itself the "result" someone is looking for).
-- `documents` is explicitly deferred -- file/attachment content search
-- is a distinct storage/privacy question outside this migration's
-- scope. `shares` and `bookmarks` are association/metadata rows, not
-- content, and are never independently searchable, matching the
-- existing precedent that no association table in this codebase has
-- ever been given its own search identity.
--
-- SECURITY PRINCIPLE (Part J), confirmed by design: every new function
-- is `SECURITY INVOKER`. Search must never be a privacy bypass --
-- results are always a strict subset of what `SELECT` already returns
-- to the same caller. `search_docket_matters()`/`search_judgments()`
-- rely purely on the base table's own RLS (`can_view_docket_matter()`/
-- `can_view_judgment()`, both already live from 0044/0045) with NO
-- redundant explicit predicate duplicated in the function body --
-- unlike `search_cases()`/`search_bench_notes()` (the original 0010
-- legacy pattern, which duplicate `user_can_access_case()`/
-- `user_can_access_bench_note()` in their WHERE clause), this migration
-- follows the more recent, more directly analogous `search_case_law()`
-- precedent (0035-era): rely on RLS alone, since RLS already applies
-- transparently to any SECURITY INVOKER query and the table's own
-- policy IS the same helper function -- duplicating it would only
-- double-evaluate the identical predicate for zero additional safety.
-- `search_quick_codes()` relies on `quick_codes`' own trivial
-- `owner_id = auth.uid()` RLS the same way case_law/statutes do.
--
-- DYNAMIC ACCESS TRACKING (Part W): none of the three new
-- `search_vector` expressions reference any access-control field
-- (`owner_id`, `is_discoverable`, `court_id`, share state) -- exactly
-- like the four existing tables. Privacy is enforced entirely by RLS at
-- query time, never by vector content. A revoked Docket share, a
-- Judgment toggled private, or (hypothetically) a re-toggled-
-- discoverable Judgment all take effect immediately on the next search,
-- with zero search-vector rewrite required -- proven by the rollback-
-- only pretest accompanying this review (see chat response).
--
-- FIELDS INCLUDED, PER TABLE (Part K/L/M, verified against live schema,
-- not assumed):
--   docket_matters: case_number, matter_title, charge_or_issue,
--     orders_summary, outcome. District/Court NAME metadata is
--     deliberately excluded -- not an approved searchable Docket field,
--     and including it would inflate hit rate without being part of
--     the Docket's own authoritative content.
--   judgments: title, case_number, court_name, citation, content_text.
--     Raw `content` (jsonb) is deliberately excluded -- `content_text`
--     is the approved plain-text search projection (per its own
--     existing column comment from 0027); there is no established,
--     reviewed JSONB-to-text extraction convention in this codebase to
--     invent one now. Lifecycle `status` does NOT gate search
--     visibility in any way -- `can_view_judgment()` is unchanged by
--     0045, so a final Judgment searches exactly like a draft one,
--     subject only to ownership/is_discoverable.
--   quick_codes: code_word, title, content, description. `owner_id` is
--     never in the vector, obviously -- it is not searchable text and
--     including it would do nothing but risk a future accidental
--     UUID-substring search oracle.
--
-- NO NEW INFORMATION OMITTED FROM VECTORS (Part R): no owner IDs,
-- emails, internal profile IDs, share recipients, or another table's
-- private annotations appear in any of the three new vectors.
--
-- INDEXES (Part S): a GIN index is added on each new `search_vector`,
-- matching the existing convention on all four current tables. All
-- three underlying tables are currently empty in production (confirmed
-- live) -- an `unused_index` INFO finding is expected and accepted, the
-- same as `judgments_finalized_by_idx` in 0045.
--
-- QUERY BEHAVIOR (Part X/Y): `websearch_to_tsquery('english', ...)` is
-- used throughout, matching all four existing functions exactly -- no
-- UX redesign. Empty/whitespace/punctuation-only queries produce an
-- empty tsquery that matches zero rows (confirmed live via a direct
-- probe before writing this file) -- identical, already-accepted
-- behavior to the four existing search functions; no special-casing is
-- invented here that doesn't already exist for `search_cases()` etc.
-- Apostrophes, quoted phrases, and hyphenated case numbers all parse
-- without error (confirmed live).
--
-- RESULT SCHEMA (Part U): `global_search()`'s return type,
-- `search_result`, is unchanged -- three new UNION ALL branches are
-- added additively, in the same shape as the four existing branches.
-- No frontend/API-facing schema break.

-- ==================== docket_matters ====================

alter table public.docket_matters
  add column search_vector tsvector generated always as (
    to_tsvector('english',
      coalesce(case_number, '') || ' ' ||
      coalesce(matter_title, '') || ' ' ||
      coalesce(charge_or_issue, '') || ' ' ||
      coalesce(orders_summary, '') || ' ' ||
      coalesce(outcome, '')
    )
  ) stored;

create index docket_matters_search_vector_idx on public.docket_matters using gin (search_vector);

create or replace function public.search_docket_matters(p_query text, p_limit integer default 20)
returns table (
  id uuid,
  case_number text,
  matter_title text,
  status docket_matter_status,
  rank real,
  headline text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    dm.id, dm.case_number, dm.matter_title, dm.status,
    ts_rank(dm.search_vector, websearch_to_tsquery('english', p_query)) as rank,
    ts_headline('english', coalesce(dm.orders_summary, dm.charge_or_issue, ''),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10') as headline
  from public.docket_matters dm
  where dm.search_vector @@ websearch_to_tsquery('english', p_query)
  order by rank desc
  limit p_limit;
$$;

comment on function public.search_docket_matters(text, integer) is
  'Full-text search over docket_matters (case_number, matter_title, charge_or_issue, orders_summary, outcome). SECURITY INVOKER -- relies entirely on docket_matters'' own SELECT RLS (can_view_docket_matter(), live since 0044: current Court assignment OR retained assignment OR active view/edit Docket share). No redundant explicit predicate duplicated here. A revoked share removes search visibility on the very next call, with no search_vector rewrite -- privacy is enforced by RLS, never by vector content.';

-- ==================== judgments ====================

alter table public.judgments
  add column search_vector tsvector generated always as (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(case_number, '') || ' ' ||
      coalesce(court_name, '') || ' ' ||
      coalesce(citation, '') || ' ' ||
      coalesce(content_text, '')
    )
  ) stored;

create index judgments_search_vector_idx on public.judgments using gin (search_vector);

create or replace function public.search_judgments(p_query text, p_limit integer default 20)
returns table (
  id uuid,
  title text,
  case_number text,
  citation text,
  status text,
  rank real,
  headline text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    j.id, j.title, j.case_number, j.citation, j.status,
    ts_rank(j.search_vector, websearch_to_tsquery('english', p_query)) as rank,
    ts_headline('english', coalesce(j.content_text, ''),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10') as headline
  from public.judgments j
  where j.search_vector @@ websearch_to_tsquery('english', p_query)
  order by rank desc
  limit p_limit;
$$;

comment on function public.search_judgments(text, integer) is
  'Full-text search over judgments (title, case_number, court_name, citation, content_text -- NOT raw jsonb content). SECURITY INVOKER -- relies entirely on judgments'' own SELECT RLS (can_view_judgment(), unchanged by 0045: owner OR is_discoverable). Lifecycle status (draft/final) does NOT itself gate search visibility -- a final Judgment searches exactly like a draft one, subject only to ownership/discoverability. Toggling is_discoverable takes effect on the very next call, with no search_vector rewrite.';

-- ==================== quick_codes ====================

alter table public.quick_codes
  add column search_vector tsvector generated always as (
    to_tsvector('english',
      coalesce(code_word, '') || ' ' ||
      coalesce(title, '') || ' ' ||
      coalesce(content, '') || ' ' ||
      coalesce(description, '')
    )
  ) stored;

create index quick_codes_search_vector_idx on public.quick_codes using gin (search_vector);

create or replace function public.search_quick_codes(p_query text, p_limit integer default 20)
returns table (
  id uuid,
  code_word text,
  title text,
  rank real,
  headline text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    qc.id, qc.code_word, qc.title,
    ts_rank(qc.search_vector, websearch_to_tsquery('english', p_query)) as rank,
    ts_headline('english', coalesce(qc.content, ''),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10') as headline
  from public.quick_codes qc
  where qc.search_vector @@ websearch_to_tsquery('english', p_query)
  order by rank desc
  limit p_limit;
$$;

comment on function public.search_quick_codes(text, integer) is
  'Full-text search over quick_codes (code_word, title, content, description -- never owner_id). SECURITY INVOKER -- relies entirely on quick_codes'' own SELECT RLS (owner_id = auth.uid(), unchanged, no Court/Docket/share path, no is_admin() bypass). A non-owner never sees another user''s Quick Codes in search, exactly as in ordinary SELECT.';

-- ==================== global_search() extension ====================
-- Additive only: three new UNION ALL branches, same search_result
-- shape as the four existing branches. No type/enum change.

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
      ts_rank(cl.search_vector, websearch_to_tsquery('english', p_query))
    from public.case_law cl
    where cl.search_vector @@ websearch_to_tsquery('english', p_query)

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
  'Unified full-text search across nine entity types (case, bench_note, statute, case_law, docket_matter, judgment, quick_code -- extended in 0047 to add the last three). Same search_result shape as before 0047 (entity_type, id, title, subtitle, headline, rank) -- no schema break. Every branch is a strict subset of what the caller could already SELECT directly: cases/bench_notes duplicate their legacy explicit access-check function (user_can_access_case()/user_can_access_bench_note()) in the WHERE clause per the original 0010 pattern; statutes/case_law/docket_matters/judgments/quick_codes rely purely on their own table RLS, transparently applied to this SECURITY INVOKER function. No SECURITY DEFINER anywhere in this function or any function it calls.';

-- ==================== Explicitly NOT touched / NOT added in 0047 ====================
-- docket_events, docket_matter_parties, docket_matter_tags,
--   judgment_tags, case_law_annotations -- not independent search
--   entities (child/organizational rows of an already-searchable
--   parent).
-- documents -- file/attachment content search explicitly deferred, a
--   distinct storage/privacy question outside this migration.
-- shares, bookmarks -- association/metadata rows, never independently
--   searchable, no exception made here.
-- search_cases(), search_bench_notes(), search_statutes(),
--   search_case_law() -- unmodified, per "do not rewrite unnecessarily."
