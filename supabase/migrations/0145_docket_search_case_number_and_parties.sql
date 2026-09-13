-- 0145_docket_search_case_number_and_parties.sql
--
-- Docket search only used search_vector @@ websearch_to_tsquery('english').
-- Registry numbers like 10000/2026-RQXZJ9J are stored as one lexeme, so
-- typing "10000" or "10000/2026" (how a magistrate looks up a file) matched
-- nothing. Party names live on docket_matter_parties and were never folded
-- into the parent vector, so a name that is not also in matter_title was
-- invisible. Parties are still not their own result type — a hit still
-- returns the Docket Matter, matching 0047's rule that child rows are not
-- independent search identities.
--
-- Same pattern as 0112 for case_law: keep FTS, add substring + trigram
-- matching in a shared helper so global_search, search_docket_matters,
-- and list_docket_matters stay in lockstep.

create extension if not exists pg_trgm with schema extensions;

create index if not exists docket_matters_case_number_trgm_idx
  on public.docket_matters using gin (case_number extensions.gin_trgm_ops);

create index if not exists docket_matters_matter_title_trgm_idx
  on public.docket_matters using gin (matter_title extensions.gin_trgm_ops);

create index if not exists docket_matter_parties_full_name_trgm_idx
  on public.docket_matter_parties using gin (full_name extensions.gin_trgm_ops);

create or replace function public.docket_matter_matches_query(
  p_case_number text,
  p_matter_title text,
  p_charge_or_issue text,
  p_search_vector tsvector,
  p_docket_matter_id uuid,
  p_query text
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    p_query is null or btrim(p_query) = '' or (
      p_search_vector @@ websearch_to_tsquery('english', btrim(p_query))
      or extensions.similarity(p_matter_title, btrim(p_query)) > 0.3
      or position(lower(btrim(p_query)) in lower(p_case_number)) > 0
      or position(lower(btrim(p_query)) in lower(p_matter_title)) > 0
      or position(lower(btrim(p_query)) in lower(coalesce(p_charge_or_issue, ''))) > 0
      or exists (
        select 1
        from public.docket_matter_parties p
        where p.docket_matter_id = p_docket_matter_id
          and p.party_status = 'active'
          and (
            position(lower(btrim(p_query)) in lower(p.full_name)) > 0
            or position(lower(btrim(p_query)) in lower(coalesce(p.attorney_name, ''))) > 0
          )
      )
    );
$$;

comment on function public.docket_matter_matches_query(text, text, text, tsvector, uuid, text) is
  'Docket Matter match (0145): full-text OR trigram on title OR literal substring of case number, title, charge, or an active party name/attorney. Case-number trigram is deliberately omitted — nearby registry numbers share too many trigrams. Empty query matches everything (same convention as case_law_matches_query). Parties are never returned as their own rows.';

grant execute on function public.docket_matter_matches_query(text, text, text, tsvector, uuid, text) to authenticated;
revoke execute on function public.docket_matter_matches_query(text, text, text, tsvector, uuid, text) from public, anon;

create or replace function public.docket_matter_search_rank(
  p_case_number text,
  p_matter_title text,
  p_search_vector tsvector,
  p_docket_matter_id uuid,
  p_query text
)
returns real
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when p_query is null or btrim(p_query) = '' then 0::real
    else greatest(
      ts_rank(p_search_vector, websearch_to_tsquery('english', btrim(p_query))),
      extensions.similarity(p_matter_title, btrim(p_query)),
      case
        when position(lower(btrim(p_query)) in lower(p_case_number)) > 0
          or position(lower(btrim(p_query)) in lower(p_matter_title)) > 0
        then 0.5
        else 0
      end,
      case
        when exists (
          select 1
          from public.docket_matter_parties p
          where p.docket_matter_id = p_docket_matter_id
            and p.party_status = 'active'
            and (
              position(lower(btrim(p_query)) in lower(p.full_name)) > 0
              or position(lower(btrim(p_query)) in lower(coalesce(p.attorney_name, ''))) > 0
            )
        ) then 0.45
        else 0
      end
    )
  end;
$$;

comment on function public.docket_matter_search_rank(text, text, tsvector, uuid, text) is
  'Relevance for Docket Matter search (0145): greatest of full-text rank, title trigram similarity, a 0.5 floor for a case-number/title substring, and a 0.45 floor for an active party/attorney substring.';

grant execute on function public.docket_matter_search_rank(text, text, tsvector, uuid, text) to authenticated;
revoke execute on function public.docket_matter_search_rank(text, text, tsvector, uuid, text) from public, anon;

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
      ts_headline(
        'english',
        concat_ws(' ', dm.case_number, dm.matter_title, coalesce(dm.charge_or_issue, ''), coalesce(dm.orders_summary, '')),
        websearch_to_tsquery('english', p_query),
        'MaxFragments=2, MaxWords=30, MinWords=10'
      ),
      public.docket_matter_search_rank(dm.case_number, dm.matter_title, dm.search_vector, dm.id, p_query)
    from public.docket_matters dm
    where dm.deleted_at is null
      and public.docket_matter_matches_query(
        dm.case_number, dm.matter_title, dm.charge_or_issue, dm.search_vector, dm.id, p_query
      )

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
  'Unified search. 0145: docket branch uses docket_matter_matches_query so registry numbers and party names hit the parent matter. Rate limit unchanged from 0137.';

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
  from public.docket_matters dm
  where dm.deleted_at is null
    and public.docket_matter_matches_query(
      dm.case_number, dm.matter_title, dm.charge_or_issue, dm.search_vector, dm.id, p_query
    )
  order by public.docket_matter_search_rank(dm.case_number, dm.matter_title, dm.search_vector, dm.id, p_query) desc
  limit p_limit;
end;
$$;

comment on function public.search_docket_matters(text, integer) is
  'Docket Matter search. 0145: case number substring, title, charge, and active party/attorney names, plus the original full-text vector. Rate limit unchanged from 0137.';

-- list_docket_matters return shape differs between 0139 (this local DB)
-- and 0146_docket_workflow_protocols. Patch the live body in place so
-- neither signature is dropped. Skip if 0146 (or a prior 0145 run) already
-- wired the shared matcher.
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef(
    'public.list_docket_matters(text, integer, text[], text[], text[], text[], text[], date, uuid)'::regprocedure
  );
  if v_def like '%docket_matter_matches_query%' then
    raise notice '0145: list_docket_matters already uses docket_matter_matches_query';
    return;
  end if;
  v_def := replace(
    v_def,
    'else ts_rank(dm.search_vector, websearch_to_tsquery(''english'', p_query))',
    'else public.docket_matter_search_rank(dm.case_number, dm.matter_title, dm.search_vector, dm.id, p_query)'
  );
  v_def := replace(
    v_def,
    'or dm.search_vector @@ websearch_to_tsquery(''english'', p_query)',
    'or public.docket_matter_matches_query(dm.case_number, dm.matter_title, dm.charge_or_issue, dm.search_vector, dm.id, p_query)'
  );
  if v_def not like '%docket_matter_matches_query%' then
    raise exception '0145: list_docket_matters predicate was not the expected FTS snippet';
  end if;
  execute v_def;
end;
$$;
