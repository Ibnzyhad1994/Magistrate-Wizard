-- ============================================================================
-- 0084_case_law_search_facets.sql
--
-- Fixes the Case Law Browse filters (Court / Jurisdiction / Category)
-- showing options with zero accessible matching records. Root cause: the
-- dropdowns were populated straight from the full reference tables
-- (legal_authority_courts / legal_jurisdictions / legal_case_categories --
-- shared catalogue data, readable by every authenticated user regardless
-- of what case_law rows exist) rather than from what's actually attached
-- to a case_law row the caller can see. The existing per-dimension count
-- RPCs (case_law_counts_by_court/_jurisdiction/_category, 0058/0074)
-- already computed RLS-respecting counts, but only to ANNOTATE a label --
-- a zero/absent count never removed the option, and the three counts were
-- each independent, single-dimension aggregates with no notion of "what do
-- the OTHER currently-active filters/search text already narrow this to."
--
-- This migration re-shapes those same three functions (same names, same
-- security-invoker/RLS-respecting design) to each accept the search text
-- and the OTHER two facets' current selections, so:
--   - an option absent from the result naturally disappears from the
--     dropdown (frontend change, case-law-list-page.tsx) instead of being
--     merely un-annotated;
--   - selecting Court narrows the Jurisdiction/Category counts (and vice
--     versa) because each RPC call is now given the other two live filter
--     values;
--   - a facet's OWN current selection is never passed to its own count
--     query, so a still-valid alternative within that facet is never
--     wrongly excluded (only the facet's zero-count options disappear).
--
-- Population + cross-filter semantics, chosen to exactly match how these
-- filters actually scope results today (case-law-list-page.tsx): Court and
-- Jurisdiction only ever apply to the Canonical tab (owner_id IS NULL) --
-- a personal research row never has court_id/jurisdiction_id set, so a
-- Court/Jurisdiction filter has literally no effect on the My Research /
-- Discoverable tabs. Category, by contrast, DOES apply to all three tabs
-- (0074 added category_id to the personal-research form too). So:
--   - case_law_counts_by_court / case_law_counts_by_jurisdiction: counted
--     over owner_id IS NULL rows only (RLS already narrows this to
--     published-or-admin canonical rows -- see can_view_case_law/0058).
--     This is a no-op behavior change from today's un-scoped version,
--     since a personal row's court_id/jurisdiction_id are always NULL
--     anyway and the existing `where court_id is not null` already
--     excluded them -- it just makes the restriction explicit and lets
--     the Category cross-filter below stay correct (see next point).
--   - case_law_counts_by_category: counted over every RLS-visible row
--     (canonical + own + discoverable), matching that it narrows all
--     three tabs. When cross-applying an active Court/Jurisdiction
--     filter to THIS count, a personal row (owner_id is not null) is
--     never excluded by it -- Court/Jurisdiction simply don't apply to
--     personal rows in the frontend, so the count must not either.
--
-- security invoker (unchanged) -- Postgres applies the caller's own RLS
-- transparently inside these functions, exactly as it always has; no
-- hand-coded visibility predicate is needed beyond the owner_id branches
-- above, which are a product-consistency choice layered ON TOP of RLS,
-- not a substitute for it. A facet query can therefore never surface a
-- court/jurisdiction/category name (or its count) that maps only to
-- case_law rows the caller isn't authorized to see -- an absent id simply
-- never appears in the group-by result.
-- ============================================================================

drop function if exists public.case_law_counts_by_court();

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
    and (p_query is null or p_query = '' or cl.search_vector @@ websearch_to_tsquery('english', p_query))
    and (p_jurisdiction_id is null or cl.jurisdiction_id = p_jurisdiction_id)
    and (p_category_id is null or cl.category_id = p_category_id)
    and (p_tag_id is null or exists (
      select 1 from public.case_law_tags clt where clt.case_law_id = cl.id and clt.tag_id = p_tag_id
    ))
  group by cl.court_id;
$$;

drop function if exists public.case_law_counts_by_jurisdiction();

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
    and (p_query is null or p_query = '' or cl.search_vector @@ websearch_to_tsquery('english', p_query))
    and (p_court_id is null or cl.court_id = p_court_id)
    and (p_category_id is null or cl.category_id = p_category_id)
    and (p_tag_id is null or exists (
      select 1 from public.case_law_tags clt where clt.case_law_id = cl.id and clt.tag_id = p_tag_id
    ))
  group by cl.jurisdiction_id;
$$;

drop function if exists public.case_law_counts_by_category();

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
    and (p_query is null or p_query = '' or cl.search_vector @@ websearch_to_tsquery('english', p_query))
    and (cl.owner_id is not null or p_court_id is null or cl.court_id = p_court_id)
    and (cl.owner_id is not null or p_jurisdiction_id is null or cl.jurisdiction_id = p_jurisdiction_id)
    and (p_tag_id is null or exists (
      select 1 from public.case_law_tags clt where clt.case_law_id = cl.id and clt.tag_id = p_tag_id
    ))
  group by cl.category_id;
$$;

grant execute on function public.case_law_counts_by_court(text, uuid, uuid, uuid) to authenticated;
grant execute on function public.case_law_counts_by_jurisdiction(text, uuid, uuid, uuid) to authenticated;
grant execute on function public.case_law_counts_by_category(text, uuid, uuid, uuid) to authenticated;

comment on function public.case_law_counts_by_court(text, uuid, uuid, uuid) is
  'RLS-respecting, cross-filtered result counts per court -- Case Law Browse facet (0084). Canonical rows only (owner_id IS NULL), matching p_query + the OTHER active facets (never its own p_court_id, so a facet never suppresses its own valid alternatives). Absent court_id = zero accessible matches = option removed from the filter, not just left uncounted.';
comment on function public.case_law_counts_by_jurisdiction(text, uuid, uuid, uuid) is
  'Same shape/semantics as case_law_counts_by_court (0084), keyed on jurisdiction_id.';
comment on function public.case_law_counts_by_category(text, uuid, uuid, uuid) is
  'RLS-respecting, cross-filtered result counts per category -- Case Law Browse facet (0084). Spans every RLS-visible row (canonical + own personal research + others'' discoverable research), matching that Category (unlike Court/Jurisdiction) filters all three Browse tabs. An active Court/Jurisdiction filter is applied only to canonical rows when cross-computing this count, since Court/Jurisdiction never apply to personal rows in the frontend (they have no court_id/jurisdiction_id).';
