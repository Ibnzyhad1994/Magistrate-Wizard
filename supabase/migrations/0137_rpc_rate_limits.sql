-- 0137_rpc_rate_limits.sql
--
-- Per-user sliding windows for expensive search RPCs and download_my_data.
-- Cheap helpers (is_admin, my_court_id) and high-frequency board reads
-- (list_docket_matters) are not limited. Search function query bodies are
-- unchanged from their latest migrations; they become plpgsql only so they
-- can PERFORM the limiter (language sql cannot).

create table public.rpc_rate_limit_buckets (
  user_id uuid not null,
  rpc_name text not null,
  window_start timestamptz not null,
  hit_count integer not null default 0,
  primary key (user_id, rpc_name, window_start)
);

comment on table public.rpc_rate_limit_buckets is
  'Per-user, per-RPC fixed windows for enforce_rpc_rate_limit. No client policies; definer writes only.';

create index rpc_rate_limit_buckets_window_idx
  on public.rpc_rate_limit_buckets (window_start);

alter table public.rpc_rate_limit_buckets enable row level security;

revoke all on table public.rpc_rate_limit_buckets from public, anon, authenticated;

create or replace function public.enforce_rpc_rate_limit(
  p_rpc text,
  p_max integer,
  p_window_seconds integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_window timestamptz;
  v_count integer;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_rpc is null or btrim(p_rpc) = '' or p_max is null or p_window_seconds is null
     or p_max < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate limit arguments';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rpc_rate_limit_buckets as b (user_id, rpc_name, window_start, hit_count)
  values (uid, p_rpc, v_window, 1)
  on conflict (user_id, rpc_name, window_start)
  do update set hit_count = b.hit_count + 1
  returning hit_count into v_count;

  delete from public.rpc_rate_limit_buckets
  where user_id = uid
    and rpc_name = p_rpc
    and window_start < v_window;

  if v_count > p_max then
    raise exception 'rate_limited'
      using hint = 'Too many requests. Try again in a minute.';
  end if;
end;
$$;

comment on function public.enforce_rpc_rate_limit(text, integer, integer) is
  'Increments the caller''s window for p_rpc and raises rate_limited when hit_count exceeds p_max.';

revoke all on function public.enforce_rpc_rate_limit(text, integer, integer) from public, anon;
grant execute on function public.enforce_rpc_rate_limit(text, integer, integer) to authenticated;

-- global_search (latest body: 0120)
create or replace function public.global_search(p_query text, p_limit integer default 20)
returns setof public.search_result
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform public.enforce_rpc_rate_limit('global_search', 60, 60);
  return query
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
    where dm.deleted_at is null
      and dm.search_vector @@ websearch_to_tsquery('english', p_query)

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
$$;

comment on function public.global_search(text, integer) is
  'Unified full-text search. 0137: enforce_rpc_rate_limit 60/60s. Query body unchanged from 0120.';

-- search_docket_matters (latest body: 0120)
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
  select
    dm.id, dm.case_number, dm.matter_title, dm.status,
    ts_rank(dm.search_vector, websearch_to_tsquery('english', p_query)) as rank,
    ts_headline('english', coalesce(dm.orders_summary, dm.charge_or_issue, ''),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10') as headline,
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
  from public.docket_matters dm
  where dm.deleted_at is null
    and dm.search_vector @@ websearch_to_tsquery('english', p_query)
  order by ts_rank(dm.search_vector, websearch_to_tsquery('english', p_query)) desc
  limit p_limit;
end;
$$;

comment on function public.search_docket_matters(text, integer) is
  'Full-text search over live docket_matters. 0137: enforce_rpc_rate_limit 60/60s. Query body unchanged from 0120.';

-- search_case_law (latest body: 0112)
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
  select
    cl.id, cl.case_name, cl.citation, cl.court, cl.jurisdiction, cl.summary,
    public.case_law_search_rank(cl.case_name, cl.search_vector, p_query) as rank,
    ts_headline('english', coalesce(cl.summary, cl.full_text, ''),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10') as headline
  from public.case_law cl
  where public.case_law_matches_query(cl.case_name, cl.citation, cl.search_vector, p_query)
  order by public.case_law_search_rank(cl.case_name, cl.search_vector, p_query) desc
  limit p_limit;
end;
$$;

comment on function public.search_case_law(text, int) is
  'Full-text + trigram-fuzzy search over case_law. 0137: enforce_rpc_rate_limit 60/60s. Query body unchanged from 0112.';

-- search_case_law_scoped (latest body: 0112)
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
  order by (p_query is not null and p_query <> '') desc,
    public.case_law_search_rank(cl.case_name, cl.search_vector, p_query) desc,
    cl.updated_at desc
  limit p_limit;
end;
$$;

comment on function public.search_case_law_scoped(text, integer, uuid, uuid, uuid, uuid) is
  'Canonical, facet-scoped Case Law Browse search. 0137: enforce_rpc_rate_limit 60/60s. Query body unchanged from 0112.';

-- search_judgments (latest body: 0047)
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
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform public.enforce_rpc_rate_limit('search_judgments', 60, 60);
  return query
  select
    j.id, j.title, j.case_number, j.citation, j.status,
    ts_rank(j.search_vector, websearch_to_tsquery('english', p_query)) as rank,
    ts_headline('english', coalesce(j.content_text, ''),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10') as headline
  from public.judgments j
  where j.search_vector @@ websearch_to_tsquery('english', p_query)
  order by ts_rank(j.search_vector, websearch_to_tsquery('english', p_query)) desc
  limit p_limit;
end;
$$;

comment on function public.search_judgments(text, integer) is
  'Full-text search over judgments. 0137: enforce_rpc_rate_limit 60/60s. Query body unchanged from 0047.';

-- search_statutes (latest body: 0055)
create or replace function public.search_statutes(p_query text, p_limit integer default 20)
returns table(id uuid, code text, title text, jurisdiction text, summary text, rank real, headline text)
language plpgsql
set search_path = public
as $$
begin
  perform public.enforce_rpc_rate_limit('search_statutes', 60, 60);
  return query
  with statute_matches as (
    select
      s.id, s.code, s.title, s.jurisdiction, s.summary,
      ts_rank(s.search_vector, websearch_to_tsquery('english', p_query)) as search_rank,
      ts_headline('english', coalesce(s.summary, s.full_text, ''),
        websearch_to_tsquery('english', p_query),
        'MaxFragments=2, MaxWords=30, MinWords=10') as headline
    from public.statutes s
    where s.search_vector @@ websearch_to_tsquery('english', p_query)
  ),
  provision_matches as (
    select
      s.id, s.code, s.title, s.jurisdiction, s.summary,
      ts_rank(sp.search_vector, websearch_to_tsquery('english', p_query)) as search_rank,
      ts_headline('english', coalesce(sp.heading, '') || ' ' || coalesce(sp.body_text, ''),
        websearch_to_tsquery('english', p_query),
        'MaxFragments=2, MaxWords=30, MinWords=10') as headline
    from public.statute_provisions sp
    join public.statutes s on s.id = sp.statute_id
    where sp.search_vector @@ websearch_to_tsquery('english', p_query)
  ),
  combined as (
    select * from statute_matches
    union all
    select * from provision_matches
  ),
  best_per_statute as (
    select distinct on (id) id, code, title, jurisdiction, summary, search_rank, headline
    from combined
    order by id, search_rank desc
  )
  select id, code, title, jurisdiction, summary, search_rank, headline
  from best_per_statute
  order by search_rank desc
  limit p_limit;
end;
$$;

comment on function public.search_statutes(text, integer) is
  'Full-text search over statutes and provisions. 0137: enforce_rpc_rate_limit 60/60s. Query body unchanged from 0055.';

-- search_bench_notes (latest body: 0038)
create or replace function public.search_bench_notes(p_query text, p_limit integer default 20)
returns table(id uuid, entity_type text, entity_id uuid, title text, rank real, headline text)
language plpgsql
set search_path = public
as $$
begin
  perform public.enforce_rpc_rate_limit('search_bench_notes', 60, 60);
  return query
  select
    n.id, n.entity_type, n.entity_id, n.title,
    ts_rank(n.search_vector, websearch_to_tsquery('english', p_query)) as rank,
    ts_headline('english', coalesce(n.content_text, ''),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10') as headline
  from public.bench_notes n
  where n.search_vector @@ websearch_to_tsquery('english', p_query)
    and public.user_can_access_bench_note(n.id)
  order by ts_rank(n.search_vector, websearch_to_tsquery('english', p_query)) desc
  limit p_limit;
end;
$$;

comment on function public.search_bench_notes(text, integer) is
  'Full-text search over bench notes. 0137: enforce_rpc_rate_limit 60/60s. Query body unchanged from 0038.';

-- download_my_data (latest body: 0127; no longer STABLE because the limiter writes)
create or replace function public.download_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  perform public.enforce_rpc_rate_limit('download_my_data', 5, 60);
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  return jsonb_build_object(
    'exported_at', now(),
    'profile', (
      select to_jsonb(p) - 'avatar_url'
      from public.profiles p
      where p.id = uid
    ),
    'judgments', coalesce((
      select jsonb_agg(to_jsonb(j) - 'content' - 'search_vector' order by j.updated_at desc)
      from public.judgments j
      where j.owner_id = uid
    ), '[]'::jsonb),
    'bench_notes', coalesce((
      select jsonb_agg(to_jsonb(b) - 'content' - 'search_vector' order by b.updated_at desc)
      from public.bench_notes b
      where b.author_id = uid
    ), '[]'::jsonb),
    'case_law', coalesce((
      select jsonb_agg(to_jsonb(c) - 'full_text' - 'summary' - 'key_passages' - 'search_vector' order by c.updated_at desc)
      from public.case_law c
      where c.owner_id = uid
    ), '[]'::jsonb),
    'bookmarks', coalesce((
      select jsonb_agg(to_jsonb(b) order by b.created_at desc)
      from public.bookmarks b
      where b.user_id = uid
    ), '[]'::jsonb),
    'shares', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at desc)
      from public.shares s
      where s.granted_by = uid or s.recipient_id = uid
    ), '[]'::jsonb),
    'notifications', coalesce((
      select jsonb_agg(to_jsonb(n) order by n.created_at desc)
      from public.notifications n
      where n.user_id = uid
    ), '[]'::jsonb),
    'clerk_access_requests', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc)
      from public.clerk_access_requests r
      where r.profile_id = uid
    ), '[]'::jsonb),
    'magistrate_court_requests', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc)
      from public.magistrate_court_requests r
      where r.profile_id = uid
    ), '[]'::jsonb),
    'magistrate_courts', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.started_at desc)
      from public.magistrate_courts m
      where m.profile_id = uid
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.download_my_data() is
  'JSON export of the caller''s own profile-scoped records. 0137: enforce_rpc_rate_limit 5/60s.';

revoke all on function public.download_my_data() from public, anon;
grant execute on function public.download_my_data() to authenticated;
