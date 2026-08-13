-- Magistrate Wizard — full-text search RPCs
-- Thin wrappers around the generated `search_vector` columns added in
-- earlier migrations. All are `security invoker` (the default for SQL
-- functions) so normal RLS applies to the querying user; the explicit
-- `user_can_access_*` calls inside cases/bench_notes are defense in
-- depth for callers that might bypass RLS (e.g. a service-role Edge
-- Function), not a substitute for it.
--
-- Call from the client via `supabase.rpc('global_search', { p_query: '...' })`
-- (or the entity-specific variants) rather than querying search_vector
-- columns directly.

create or replace function public.search_statutes(p_query text, p_limit int default 20)
returns table (
  id uuid,
  code text,
  title text,
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
    s.id, s.code, s.title, s.jurisdiction, s.summary,
    ts_rank(s.search_vector, websearch_to_tsquery('english', p_query)) as rank,
    ts_headline('english', coalesce(s.summary, s.full_text, ''),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10') as headline
  from public.statutes s
  where s.search_vector @@ websearch_to_tsquery('english', p_query)
  order by rank desc
  limit p_limit;
$$;

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
    ts_rank(cl.search_vector, websearch_to_tsquery('english', p_query)) as rank,
    ts_headline('english', coalesce(cl.summary, cl.full_text, ''),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10') as headline
  from public.case_law cl
  where cl.search_vector @@ websearch_to_tsquery('english', p_query)
  order by rank desc
  limit p_limit;
$$;

create or replace function public.search_bench_notes(p_query text, p_limit int default 20)
returns table (
  id uuid,
  case_id uuid,
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
    n.id, n.case_id, n.title,
    ts_rank(n.search_vector, websearch_to_tsquery('english', p_query)) as rank,
    ts_headline('english', coalesce(n.content_text, ''),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10') as headline
  from public.bench_notes n
  where n.search_vector @@ websearch_to_tsquery('english', p_query)
    and public.user_can_access_bench_note(n.id)
  order by rank desc
  limit p_limit;
$$;

create or replace function public.search_cases(p_query text, p_limit int default 20)
returns table (
  id uuid,
  case_number text,
  title text,
  status public.case_status,
  rank real,
  headline text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id, c.case_number, c.title, c.status,
    ts_rank(c.search_vector, websearch_to_tsquery('english', p_query)) as rank,
    ts_headline('english', coalesce(c.description, ''),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10') as headline
  from public.cases c
  where c.search_vector @@ websearch_to_tsquery('english', p_query)
    and public.user_can_access_case(c.id)
  order by rank desc
  limit p_limit;
$$;

-- Unified search across every searchable entity ------------------------

create type public.search_result as (
  entity_type text,
  id uuid,
  title text,
  subtitle text,
  headline text,
  rank real
);

create or replace function public.global_search(p_query text, p_limit int default 20)
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
  ) results
  order by rank desc
  limit p_limit;
$$;

grant execute on function public.search_statutes(text, int) to authenticated;
grant execute on function public.search_case_law(text, int) to authenticated;
grant execute on function public.search_bench_notes(text, int) to authenticated;
grant execute on function public.search_cases(text, int) to authenticated;
grant execute on function public.global_search(text, int) to authenticated;
