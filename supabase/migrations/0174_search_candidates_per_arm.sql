-- ============================================================================
-- 0174_search_candidates_per_arm.sql
--
-- BE-13 follow-up: the candidate queries are a UNION of one indexed query
-- per match rule, not one OR.
--
-- With the match written as a single OR (0171), the planner prices a
-- BitmapOr of every arm against a sequential scan of the whole table, and
-- on 20,000 Docket Matters it chose the sequential scan for some queries
-- (132 ms where the index plan took 31 ms; the live test
-- test-search-index-plans.mjs caught it). As separate queries each rule is
-- planned on its own, so each is served by its own index, whatever the
-- query and the table size.
--
-- The match, the visibility check and every caller are unchanged: same
-- signatures, same ids. UNION removes the duplicates the OR never produced.
-- ============================================================================

create or replace function private.case_law_search_hits(p_query text)
returns table (id uuid)
language plpgsql
stable
security definer
set search_path = public
set pg_trgm.similarity_threshold = '0.3'
rows 50
as $$
declare
  v_query text := public.btrim_whitespace(p_query);
  v_pattern text;
begin
  if v_query is null or v_query = '' then
    return;
  end if;
  v_pattern := '%' || public.escape_like_pattern(v_query) || '%';

  return query
  select hit.id
  from (
    select cl.id
    from public.case_law cl
    where cl.search_vector @@ websearch_to_tsquery('english', v_query)
    union
    -- `%` is the indexable form of similarity >= the threshold pinned
    -- above; the explicit check keeps 0112's strict > 0.3.
    select cl.id
    from public.case_law cl
    where cl.case_name operator(extensions.%) v_query
      and extensions.similarity(cl.case_name, v_query) > 0.3
    union
    select cl.id
    from public.case_law cl
    where cl.case_name ilike v_pattern
    union
    select cl.id
    from public.case_law cl
    where cl.citation ilike v_pattern
  ) hit
  where public.can_view_case_law(hit.id);
end;
$$;

comment on function private.case_law_search_hits(text) is
  'Ids of the case_law rows matching a search that the caller may read (0171, 0174): full text OR case-name trigram similarity > 0.3 OR a literal substring of the case name or citation, the query trimmed and matched literally, each rule its own indexed query. SECURITY DEFINER so the GIN indexes serve the match (RLS would force a per-row policy check first); can_view_case_law, the SELECT policy''s own test, keeps only rows the caller can see. A blank query returns nothing; callers keep their own browse listing. The single case_law match used by search_case_law, search_case_law_scoped, the case_law_counts_by_* facets and global_search.';

create or replace function private.docket_matter_search_hits(p_query text)
returns table (id uuid)
language plpgsql
stable
security definer
set search_path = public
set pg_trgm.similarity_threshold = '0.3'
rows 50
as $$
declare
  v_query text := public.btrim_whitespace(p_query);
  v_pattern text;
begin
  if v_query is null or v_query = '' then
    return;
  end if;
  v_pattern := '%' || public.escape_like_pattern(v_query) || '%';

  return query
  select hit.id
  from (
    select dm.id
    from public.docket_matters dm
    where dm.search_vector @@ websearch_to_tsquery('english', v_query)
    union
    select dm.id
    from public.docket_matters dm
    where dm.matter_title operator(extensions.%) v_query
      and extensions.similarity(dm.matter_title, v_query) > 0.3
    union
    select dm.id
    from public.docket_matters dm
    where dm.case_number ilike v_pattern
    union
    select dm.id
    from public.docket_matters dm
    where dm.matter_title ilike v_pattern
    union
    select dm.id
    from public.docket_matters dm
    where dm.charge_or_issue ilike v_pattern
    union
    select p.docket_matter_id
    from public.docket_matter_parties p
    where p.full_name ilike v_pattern
      and p.party_status = 'active'
    union
    select p.docket_matter_id
    from public.docket_matter_parties p
    where p.attorney_name ilike v_pattern
      and p.party_status = 'active'
  ) hit
  where public.can_view_docket_matter(hit.id);
end;
$$;

comment on function private.docket_matter_search_hits(text) is
  'Ids of the docket_matters matching a search that the caller may read (0171, 0174), binned ones included (callers filter deleted_at): full text OR title trigram similarity > 0.3 OR a literal substring of the case number, title, charge, or an active party''s name or attorney, each rule its own indexed query. SECURITY DEFINER so the GIN indexes serve the match; can_view_docket_matter, the SELECT policy of both docket_matters and docket_matter_parties, keeps only matters the caller can see. A blank query returns nothing; callers keep their own browse listing. Used by search_docket_matters, list_docket_matters and global_search.';
