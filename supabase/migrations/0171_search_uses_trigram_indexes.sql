-- ============================================================================
-- 0171_search_uses_trigram_indexes.sql
--
-- BE-13: Case Law and Docket Matter search could not use their indexes.
--
-- Access pattern: an interactive, debounced type-ahead. One keystroke on the
-- Case Law browse page runs search_case_law_scoped plus the three
-- case_law_counts_by_* facet counts; the search page runs global_search; the
-- docket board runs list_docket_matters (search_docket_matters for the scoped
-- id search). A query usually matches tens to a few hundred rows.
--
-- Expected cardinality: case_law holds the curated library, and the official
-- corpus planned in docs/legal-library-official-seeding.md takes it to tens
-- of thousands of rows. docket_matters grows by thousands a year per court.
--
-- Why every search was a sequential scan (two reasons, both needed fixing):
--
--   1. The match predicate lived in case_law_matches_query() /
--      docket_matter_matches_query(), SQL functions with a SET search_path,
--      which the planner never inlines. Each one was an opaque per-row call,
--      and inside them `similarity() > 0.3`, `position(lower ...)` and the
--      party EXISTS are not index operators anyway.
--   2. Even with indexable operators written out (`@@`, `%`, ILIKE), a
--      signed-in caller cannot use them as index conditions on a table with
--      RLS: none of those operators is LEAKPROOF, so the planner must run the
--      RLS policy on every row before it may evaluate them. Only the table
--      owner, which RLS does not apply to, gets the Bitmap Index Scans.
--
-- Fix: one SECURITY DEFINER candidate function per table, in the `private`
-- schema (not exposed by the Data API), that runs the match as the owner so
-- the GIN full-text and trigram indexes serve it through a BitmapOr, and
-- keeps only rows the CALLER may read through the same can_view_* helper
-- the table's SELECT policy uses. Every search surface joins those ids back
-- to the table as the caller, so RLS still decides what is returned and the
-- per-row policy check runs on the candidates only, not on the whole table.
-- The match itself is unchanged:
--
--   case_law       full text OR case-name trigram similarity > 0.3 OR a
--                  literal substring of the case name or citation (0112,
--                  0166: query trimmed, %, _ and \ matched literally);
--   docket_matters full text OR title trigram similarity > 0.3 OR a literal
--                  substring of the case number, title, charge, or an active
--                  party's name or attorney (0145).
--
-- An empty query still lists everything where it did before (browse), and a
-- query that is only whitespace still matches nothing. Every function keeps
-- its name, arguments and return shape, so no client changes.
-- ============================================================================

create extension if not exists pg_trgm with schema extensions;

-- Server-side helpers that no client should call directly. Not in
-- supabase/config.toml [api] schemas, so the Data API does not serve it.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

comment on schema private is
  'Server-side helpers called from public functions; not exposed by the Data API (0171).';

-- The two substring arms that had no trigram index (0145 indexed only the
-- case number, the title and the party name).
create index if not exists docket_matters_charge_or_issue_trgm_idx
  on public.docket_matters using gin (charge_or_issue extensions.gin_trgm_ops);

create index if not exists docket_matter_parties_attorney_name_trgm_idx
  on public.docket_matter_parties using gin (attorney_name extensions.gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- 1. Candidate functions
-- ----------------------------------------------------------------------------

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
  select cl.id
  from public.case_law cl
  where (
      cl.search_vector @@ websearch_to_tsquery('english', v_query)
      -- `%` is the indexable form of similarity >= the threshold pinned
      -- above; the explicit check keeps 0112's strict > 0.3.
      or (
        cl.case_name operator(extensions.%) v_query
        and extensions.similarity(cl.case_name, v_query) > 0.3
      )
      or cl.case_name ilike v_pattern
      or cl.citation ilike v_pattern
    )
    and public.can_view_case_law(cl.id);
end;
$$;

comment on function private.case_law_search_hits(text) is
  'Ids of the case_law rows matching a search that the caller may read (0171): full text OR case-name trigram similarity > 0.3 OR a literal substring of the case name or citation, the query trimmed and matched literally. SECURITY DEFINER so the GIN indexes serve the match (RLS would force a per-row policy check first); can_view_case_law, the SELECT policy''s own test, keeps only rows the caller can see. A blank query returns nothing; callers keep their own browse listing. The single case_law match used by search_case_law, search_case_law_scoped, the case_law_counts_by_* facets and global_search.';

revoke all on function private.case_law_search_hits(text) from public, anon;
grant execute on function private.case_law_search_hits(text) to authenticated, service_role;

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
      or (
        dm.matter_title operator(extensions.%) v_query
        and extensions.similarity(dm.matter_title, v_query) > 0.3
      )
      or dm.case_number ilike v_pattern
      or dm.matter_title ilike v_pattern
      or dm.charge_or_issue ilike v_pattern
    union
    select p.docket_matter_id
    from public.docket_matter_parties p
    where p.party_status = 'active'
      and (p.full_name ilike v_pattern or p.attorney_name ilike v_pattern)
  ) hit
  where public.can_view_docket_matter(hit.id);
end;
$$;

comment on function private.docket_matter_search_hits(text) is
  'Ids of the docket_matters matching a search that the caller may read (0171), binned ones included (callers filter deleted_at): full text OR title trigram similarity > 0.3 OR a literal substring of the case number, title, charge, or an active party''s name or attorney. SECURITY DEFINER so the GIN indexes serve the match; can_view_docket_matter, the SELECT policy of both docket_matters and docket_matter_parties, keeps only matters the caller can see. A blank query returns nothing; callers keep their own browse listing. Used by search_docket_matters, list_docket_matters and global_search.';

revoke all on function private.docket_matter_search_hits(text) from public, anon;
grant execute on function private.docket_matter_search_hits(text) to authenticated, service_role;

comment on function public.case_law_matches_query(text, text, tsvector, text) is
  'Single-row case_law match predicate (0112, 0166). No search surface calls it since 0171: they all use private.case_law_search_hits, which applies the same rule through the indexes. Kept for compatibility; change both together.';

comment on function public.docket_matter_matches_query(text, text, text, tsvector, uuid, text) is
  'Single-row Docket Matter match predicate (0145). No search surface calls it since 0171: they all use private.docket_matter_search_hits, which applies the same rule through the indexes. Kept for compatibility; change both together.';

-- ----------------------------------------------------------------------------
-- 2. Case Law surfaces. Each reads its rows from `matched`: every row for a
--    browse (no query), otherwise the candidates joined back as the caller.
--    The rest of each body is unchanged.
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
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform public.enforce_rpc_rate_limit('search_case_law', 60, 60);
  return query
  with matched as (
    select c.* from public.case_law c
    where p_query is null or p_query = ''
    union all
    select c.* from private.case_law_search_hits(p_query) h
    join public.case_law c on c.id = h.id
  )
  select
    cl.id, cl.case_name, cl.citation, cl.court, cl.jurisdiction, cl.summary,
    public.case_law_search_rank(cl.case_name, cl.search_vector, p_query) as rank,
    ts_headline('english', coalesce(cl.summary, cl.full_text, ''),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10') as headline
  from matched cl
  order by public.case_law_search_rank(cl.case_name, cl.search_vector, p_query) desc
  limit p_limit;
end;
$$;

comment on function public.search_case_law(text, int) is
  'Full-text + trigram-fuzzy search over case_law. 0137: enforce_rpc_rate_limit 60/60s. 0171: candidates from private.case_law_search_hits (index-served); RLS still applies to every returned row.';

create or replace function public.search_case_law_scoped(
  p_query text default null,
  p_limit integer default 50,
  p_court_id uuid default null,
  p_jurisdiction_id uuid default null,
  p_tag_id uuid default null,
  p_category_id uuid default null
)
returns table(id uuid, case_name text, citation text, court text, jurisdiction text, summary text, rank real, headline text)
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform public.enforce_rpc_rate_limit('search_case_law_scoped', 60, 60);
  return query
  with matched as (
    select c.* from public.case_law c
    where p_query is null or p_query = ''
    union all
    select c.* from private.case_law_search_hits(p_query) h
    join public.case_law c on c.id = h.id
  )
  select
    cl.id, cl.case_name, cl.citation, cl.court, cl.jurisdiction, cl.summary,
    public.case_law_search_rank(cl.case_name, cl.search_vector, p_query) as rank,
    case when p_query is not null and p_query <> ''
      then ts_headline('english', coalesce(cl.summary, cl.full_text, ''),
             websearch_to_tsquery('english', p_query), 'MaxFragments=2, MaxWords=30, MinWords=10')
      else null end as headline
  from matched cl
  where cl.owner_id is null
    and (p_court_id is null or cl.court_id = p_court_id)
    and (p_jurisdiction_id is null or cl.jurisdiction_id = p_jurisdiction_id)
    and (p_category_id is null or cl.category_id = p_category_id)
    and (p_tag_id is null or exists (
      select 1 from public.case_law_tags clt where clt.case_law_id = cl.id and clt.tag_id = p_tag_id
    ))
  order by (p_query is not null and p_query <> '') desc,
    public.case_law_search_rank(cl.case_name, cl.search_vector, p_query) desc,
    cl.updated_at desc
  limit p_limit;
end;
$$;

comment on function public.search_case_law_scoped(text, integer, uuid, uuid, uuid, uuid) is
  'Canonical, facet-scoped Case Law Browse search. 0137: enforce_rpc_rate_limit 60/60s. 0171: candidates from private.case_law_search_hits (index-served); filters unchanged.';

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
  with matched as (
    select c.* from public.case_law c
    where p_query is null or p_query = ''
    union all
    select c.* from private.case_law_search_hits(p_query) h
    join public.case_law c on c.id = h.id
  )
  select cl.court_id, count(*) as result_count
  from matched cl
  where cl.owner_id is null
    and cl.court_id is not null
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
  with matched as (
    select c.* from public.case_law c
    where p_query is null or p_query = ''
    union all
    select c.* from private.case_law_search_hits(p_query) h
    join public.case_law c on c.id = h.id
  )
  select cl.jurisdiction_id, count(*) as result_count
  from matched cl
  where cl.owner_id is null
    and cl.jurisdiction_id is not null
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
  with matched as (
    select c.* from public.case_law c
    where p_query is null or p_query = ''
    union all
    select c.* from private.case_law_search_hits(p_query) h
    join public.case_law c on c.id = h.id
  )
  select cl.category_id, count(*) as result_count
  from matched cl
  where cl.category_id is not null
    and (cl.owner_id is not null or p_court_id is null or cl.court_id = p_court_id)
    and (cl.owner_id is not null or p_jurisdiction_id is null or cl.jurisdiction_id = p_jurisdiction_id)
    and (p_tag_id is null or exists (
      select 1 from public.case_law_tags clt where clt.case_law_id = cl.id and clt.tag_id = p_tag_id
    ))
  group by cl.category_id;
$$;

comment on function public.case_law_counts_by_court(text, uuid, uuid, uuid) is
  'RLS-respecting, cross-filtered result counts per court (0084). 0171: the same private.case_law_search_hits match as search_case_law_scoped, so a facet never shows an option the search would then return zero results for, or vice versa.';
comment on function public.case_law_counts_by_jurisdiction(text, uuid, uuid, uuid) is
  'Same shape/semantics as case_law_counts_by_court, keyed on jurisdiction_id (0171: private.case_law_search_hits).';
comment on function public.case_law_counts_by_category(text, uuid, uuid, uuid) is
  'RLS-respecting, cross-filtered result counts per category (0084). 0171: private.case_law_search_hits.';

-- ----------------------------------------------------------------------------
-- 3. Docket surfaces
-- ----------------------------------------------------------------------------

create or replace function public.search_docket_matters(p_query text, p_limit integer default 20)
returns table (
  id uuid,
  case_number text,
  matter_title text,
  status docket_matter_status,
  rank real,
  headline text,
  cover_image_path text,
  charge_or_issue text,
  arraignment_status text,
  custody_status text,
  disclosure_status text,
  trial_status text,
  ruling_status text,
  judgment_status text,
  sentence_status text,
  appeal_status text,
  procedure_stage text
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform public.enforce_rpc_rate_limit('search_docket_matters', 60, 60);
  return query
  with matched as (
    select d.* from public.docket_matters d
    where p_query is null or btrim(p_query) = ''
    union all
    select d.* from private.docket_matter_search_hits(p_query) h
    join public.docket_matters d on d.id = h.id
  )
  select
    dm.id, dm.case_number, dm.matter_title, dm.status,
    public.docket_matter_search_rank(dm.case_number, dm.matter_title, dm.search_vector, dm.id, p_query) as rank,
    ts_headline(
      'english',
      concat_ws(' ', dm.case_number, dm.matter_title, coalesce(dm.charge_or_issue, ''), coalesce(dm.orders_summary, '')),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10'
    ) as headline,
    dm.cover_image_path,
    dm.charge_or_issue,
    dm.arraignment_status,
    dm.custody_status,
    dm.disclosure_status,
    dm.trial_status,
    dm.ruling_status,
    dm.judgment_status,
    dm.sentence_status,
    dm.appeal_status,
    dm.procedure_stage
  from matched dm
  where dm.deleted_at is null
  order by public.docket_matter_search_rank(dm.case_number, dm.matter_title, dm.search_vector, dm.id, p_query) desc
  limit p_limit;
end;
$$;

comment on function public.search_docket_matters(text, integer) is
  'Docket Matter search. 0145: case number substring, title, charge, and active party/attorney names, plus the original full-text vector. 0171: candidates from private.docket_matter_search_hits (index-served). Rate limit unchanged from 0137.';

create or replace function public.list_docket_matters(
  p_query text default '',
  p_limit integer default 100,
  p_procedure_stages text[] default null,
  p_custody text[] default null,
  p_disclosure text[] default null,
  p_trial text[] default null,
  p_next_date text[] default null,
  p_exact_date date default null,
  p_court_id uuid default null
)
returns table (
  id uuid,
  case_number text,
  matter_title text,
  status docket_matter_status,
  charge_or_issue text,
  cover_image_path text,
  court_id uuid,
  district_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  court_name text,
  arraignment_status text,
  custody_status text,
  disclosure_status text,
  trial_status text,
  paper_committal_status text,
  ruling_status text,
  judgment_status text,
  sentence_status text,
  appeal_status text,
  information_sworn_status text,
  summons_served text,
  returns_of_summons text,
  civil_trial_held text,
  decision_granted text,
  decision_amount numeric,
  stage_adjournments jsonb,
  outcome_status text,
  outcome_adjourned boolean,
  workflow_protocol text,
  procedure_stage text,
  next_appearance date,
  can_edit boolean,
  has_ruling_document boolean,
  has_judgment_document boolean,
  appearance_status text,
  appearance_stage text,
  appearance_outcome text,
  category_id uuid,
  category_name text,
  category_other text,
  rank real,
  headline text
)
language sql
stable
security invoker
set search_path = public
as $$
  with board as (
    select
      dm.id,
      dm.case_number,
      dm.matter_title,
      dm.status,
      dm.charge_or_issue,
      dm.cover_image_path,
      dm.court_id,
      dm.district_id,
      dm.created_at,
      dm.updated_at,
      c.name as court_name,
      dm.arraignment_status,
      dm.custody_status,
      dm.disclosure_status,
      dm.trial_status,
      dm.paper_committal_status,
      dm.ruling_status,
      dm.judgment_status,
      dm.sentence_status,
      dm.appeal_status,
      dm.information_sworn_status,
      dm.summons_served,
      dm.returns_of_summons,
      dm.civil_trial_held,
      dm.decision_granted,
      dm.decision_amount,
      dm.stage_adjournments,
      dm.outcome_status,
      dm.outcome_adjourned,
      dm.workflow_protocol,
      dm.procedure_stage,
      (
        select min(e.scheduled_date)
        from public.docket_events e
        where e.docket_matter_id = dm.id
          and e.event_status = 'scheduled'
          and e.scheduled_date >= current_date
      ) as next_appearance,
      public.can_edit_docket_matter(dm.id) as can_edit,
      exists (
        select 1 from public.documents d
        where d.entity_type = 'docket_matter' and d.entity_id = dm.id and d.purpose = 'ruling'
      ) as has_ruling_document,
      exists (
        select 1 from public.documents d
        where d.entity_type = 'docket_matter' and d.entity_id = dm.id and d.purpose = 'judgment'
      ) as has_judgment_document,
      appear.event_status as appearance_status,
      appear.stage_at_event as appearance_stage,
      appear.outcome_at_event as appearance_outcome,
      dm.category_id,
      cat.name as category_name,
      dm.category_other,
      case
        when btrim(coalesce(p_query, '')) = '' then 0::real
        else public.docket_matter_search_rank(dm.case_number, dm.matter_title, dm.search_vector, dm.id, p_query)
      end as rank,
      case
        when btrim(coalesce(p_query, '')) = '' then null::text
        else ts_headline(
          'english',
          concat_ws(' ', dm.case_number, dm.matter_title, coalesce(dm.charge_or_issue, ''), coalesce(dm.orders_summary, '')),
          websearch_to_tsquery('english', p_query),
          'MaxFragments=2, MaxWords=30, MinWords=10'
        )
      end as headline
    from (
      select d.* from public.docket_matters d
      where btrim(coalesce(p_query, '')) = ''
      union all
      select d.* from private.docket_matter_search_hits(p_query) h
      join public.docket_matters d on d.id = h.id
    ) dm
    left join public.courts c on c.id = dm.court_id
    left join public.docket_matter_categories cat on cat.id = dm.category_id
    left join lateral (
      select e.event_status, e.stage_at_event, e.outcome_at_event
      from public.docket_events e
      where e.docket_matter_id = dm.id
        and p_exact_date is not null
        and e.scheduled_date = p_exact_date
        and e.event_status <> 'entered_in_error'
      order by e.created_at desc
      limit 1
    ) appear on true
    where dm.deleted_at is null
      and (p_court_id is null or dm.court_id = p_court_id)
      and (
        p_procedure_stages is null
        or cardinality(p_procedure_stages) = 0
        or dm.procedure_stage = any (p_procedure_stages)
      )
      and (
        p_custody is null
        or cardinality(p_custody) = 0
        or (
          dm.workflow_protocol in ('criminal_trial', 'paper_committal')
          and dm.custody_status = any (p_custody)
        )
      )
      and (
        p_disclosure is null
        or cardinality(p_disclosure) = 0
        or (
          dm.workflow_protocol in ('criminal_trial', 'paper_committal')
          and dm.disclosure_status = any (p_disclosure)
        )
      )
      and (
        p_trial is null
        or cardinality(p_trial) = 0
        or (
          dm.workflow_protocol = 'criminal_trial'
          and dm.trial_status = any (p_trial)
        )
      )
      and (
        p_exact_date is null
        or exists (
          select 1 from public.docket_events e2
          where e2.docket_matter_id = dm.id
            and e2.scheduled_date = p_exact_date
            and e2.event_status <> 'entered_in_error'
        )
      )
  )
  select
    board.id, board.case_number, board.matter_title, board.status, board.charge_or_issue,
    board.cover_image_path, board.court_id, board.district_id, board.created_at, board.updated_at,
    board.court_name, board.arraignment_status, board.custody_status, board.disclosure_status,
    board.trial_status, board.paper_committal_status, board.ruling_status, board.judgment_status,
    board.sentence_status, board.appeal_status, board.information_sworn_status, board.summons_served,
    board.returns_of_summons, board.civil_trial_held, board.decision_granted, board.decision_amount,
    board.stage_adjournments, board.outcome_status, board.outcome_adjourned, board.workflow_protocol,
    board.procedure_stage, board.next_appearance, board.can_edit,
    board.has_ruling_document, board.has_judgment_document, board.appearance_status,
    board.appearance_stage, board.appearance_outcome, board.category_id, board.category_name,
    board.category_other, board.rank, board.headline
  from board
  where
    p_exact_date is not null
    or p_next_date is null
    or cardinality(p_next_date) = 0
    or (
      ('today' = any (p_next_date) and board.next_appearance = current_date)
      or ('upcoming' = any (p_next_date) and board.next_appearance > current_date)
      or ('no_date' = any (p_next_date) and board.next_appearance is null)
    )
  order by board.rank desc, board.updated_at desc
  limit p_limit;
$$;

comment on function public.list_docket_matters(text, integer, text[], text[], text[], text[], text[], date, uuid) is
  'Docket spreadsheet/tiles list. SECURITY INVOKER. 0146 adds workflow_protocol columns. 0171: a search reads its candidates from private.docket_matter_search_hits (index-served), the same match as search_docket_matters and global_search.';

-- ----------------------------------------------------------------------------
-- 4. global_search: the case_law and docket_matter branches read their
--    candidates from the same functions. Every other line is 0166's.
-- ----------------------------------------------------------------------------

create or replace function public.global_search(p_query text, p_limit integer default 20)
 returns setof search_result
 language plpgsql
 set search_path to 'public'
as $function$
begin
  perform public.enforce_rpc_rate_limit('global_search', 60, 60);

  -- A blank query is not a search: without this, the docket branch's
  -- "empty means browse" rule (0145) returned every matter in scope.
  p_query := public.btrim_whitespace(p_query);
  if p_query is null or p_query = '' then
    return;
  end if;
  if char_length(p_query) > 500 then
    raise exception 'Search terms must be 500 characters or fewer.'
      using errcode = '22001';
  end if;
  p_limit := least(greatest(coalesce(p_limit, 20), 1), 100);

  return query
  with provision_hits as (
    -- Best-ranked matching provision per Act. DISTINCT ON keeps global
    -- search returning at most one row per Act, exactly as before -- a
    -- query matching forty sections of one Act must not crowd out every
    -- other entity type under the shared LIMIT.
    select distinct on (sp.statute_id)
      sp.statute_id,
      sp.id as provision_id,
      sp.level,
      sp.number,
      sp.heading,
      ts_rank(sp.search_vector, websearch_to_tsquery('english', p_query)) as rank,
      ts_headline('english',
        coalesce(sp.heading, '') || ' ' || coalesce(sp.body_text, ''),
        websearch_to_tsquery('english', p_query),
        'MaxFragments=2, MaxWords=30, MinWords=10') as headline
    from public.statute_provisions sp
    where sp.search_vector @@ websearch_to_tsquery('english', p_query)
    order by sp.statute_id, ts_rank(sp.search_vector, websearch_to_tsquery('english', p_query)) desc
  )
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
      -- Name the section when one matched, so a hit inside an Act says
      -- WHERE it is rather than only which Act it was in.
      case
        when ph.provision_id is not null then
          nullif(
            trim(coalesce(initcap(ph.level), '') || ' ' || coalesce(ph.number, '')),
            ''
          ) || coalesce(' - ' || nullif(ph.heading, ''), '')
        else s.code
      end,
      coalesce(
        ph.headline,
        ts_headline('english', coalesce(s.summary, s.full_text, ''),
          websearch_to_tsquery('english', p_query),
          'MaxFragments=2, MaxWords=30, MinWords=10')
      ),
      greatest(
        coalesce(ts_rank(s.search_vector, websearch_to_tsquery('english', p_query)), 0),
        coalesce(ph.rank, 0)
      )
    from public.statutes s
    left join provision_hits ph on ph.statute_id = s.id
    where s.search_vector @@ websearch_to_tsquery('english', p_query)
       or ph.provision_id is not null

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
    from private.case_law_search_hits(p_query) h
    join public.case_law cl on cl.id = h.id

    union all

    select
      'docket_matter'::text,
      dm.id,
      dm.matter_title,
      dm.case_number,
      ts_headline(
        'english',
        concat_ws(' ', dm.case_number, dm.matter_title, coalesce(dm.charge_or_issue, ''), coalesce(dm.orders_summary, '')),
        websearch_to_tsquery('english', p_query),
        'MaxFragments=2, MaxWords=30, MinWords=10'
      ),
      public.docket_matter_search_rank(dm.case_number, dm.matter_title, dm.search_vector, dm.id, p_query)
    from private.docket_matter_search_hits(p_query) h
    join public.docket_matters dm on dm.id = h.id
    where dm.deleted_at is null

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
  order by results.rank desc
  limit p_limit;
end;
$function$;

comment on function public.global_search(text, integer) is
  'Unified search across case, bench note, statute (and provision), case law, docket matter, judgment and quick code. 0166: blank query, length and limit guards. 0171: the case_law and docket_matter branches use private.case_law_search_hits / private.docket_matter_search_hits (index-served); RLS still applies to every returned row.';

notify pgrst, 'reload schema';
