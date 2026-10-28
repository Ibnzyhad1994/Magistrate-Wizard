-- ============================================================================
-- 0172_global_search_per_type_limit.sql
--
-- BE-14: global_search applied one LIMIT across all seven result types.
--
-- One `order by rank desc limit p_limit` over the union meant a type whose
-- rows rank high (twenty strong Case Law hits) pushed every other type out:
-- the Docket Matter the magistrate was looking for never reached the page,
-- although the page groups results by type.
--
-- Now each type is ranked and limited on its own, and p_limit (still 1 to
-- 100, default 20) is the cap PER TYPE. The response keeps its shape:
-- setof search_result, ordered by rank across types, so the search page
-- groups it exactly as before; it can now hold up to seven times p_limit
-- rows, at most p_limit of any one type. Ties within a type break on id so
-- the same query returns the same rows.
--
-- ts_headline, the costliest step, now runs only on the rows that survive
-- each type's limit instead of on every match (including every matching
-- provision of every Act). The matching, ranking and access rules of each
-- branch are unchanged from 0171.
-- ============================================================================

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
  -- The cap for EACH result type (0172).
  p_limit := least(greatest(coalesce(p_limit, 20), 1), 100);

  return query
  with provision_hits as (
    -- Best-ranked matching provision per Act, so an Act whose forty
    -- sections match is still one result.
    select distinct on (sp.statute_id)
      sp.statute_id,
      sp.id as provision_id,
      sp.level,
      sp.number,
      sp.heading,
      sp.body_text,
      ts_rank(sp.search_vector, websearch_to_tsquery('english', p_query)) as rank
    from public.statute_provisions sp
    where sp.search_vector @@ websearch_to_tsquery('english', p_query)
    order by sp.statute_id, ts_rank(sp.search_vector, websearch_to_tsquery('english', p_query)) desc
  )
  select
    hit.entity_type,
    hit.id,
    hit.title,
    hit.subtitle,
    ts_headline('english', hit.headline_source,
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10'),
    hit.rank
  from (
    (
      select
        'case'::text as entity_type,
        c.id,
        c.title,
        c.case_number as subtitle,
        coalesce(c.description, '') as headline_source,
        ts_rank(c.search_vector, websearch_to_tsquery('english', p_query)) as rank
      from public.cases c
      where c.search_vector @@ websearch_to_tsquery('english', p_query)
        and public.user_can_access_case(c.id)
      order by rank desc, c.id
      limit p_limit
    )

    union all

    (
      select
        'bench_note'::text,
        n.id,
        n.title,
        null::text,
        coalesce(n.content_text, ''),
        ts_rank(n.search_vector, websearch_to_tsquery('english', p_query)) as rank
      from public.bench_notes n
      where n.search_vector @@ websearch_to_tsquery('english', p_query)
        and public.user_can_access_bench_note(n.id)
      order by rank desc, n.id
      limit p_limit
    )

    union all

    (
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
        -- A provision hit takes its excerpt from that section.
        case
          when ph.provision_id is not null then
            coalesce(ph.heading, '') || ' ' || coalesce(ph.body_text, '')
          else coalesce(s.summary, s.full_text, '')
        end,
        greatest(
          coalesce(ts_rank(s.search_vector, websearch_to_tsquery('english', p_query)), 0),
          coalesce(ph.rank, 0)
        ) as rank
      from public.statutes s
      left join provision_hits ph on ph.statute_id = s.id
      where s.search_vector @@ websearch_to_tsquery('english', p_query)
         or ph.provision_id is not null
      order by rank desc, s.id
      limit p_limit
    )

    union all

    (
      select
        'case_law'::text,
        cl.id,
        cl.case_name,
        cl.citation,
        coalesce(cl.summary, cl.full_text, ''),
        public.case_law_search_rank(cl.case_name, cl.search_vector, p_query) as rank
      from private.case_law_search_hits(p_query) h
      join public.case_law cl on cl.id = h.id
      order by rank desc, cl.id
      limit p_limit
    )

    union all

    (
      select
        'docket_matter'::text,
        dm.id,
        dm.matter_title,
        dm.case_number,
        concat_ws(' ', dm.case_number, dm.matter_title, coalesce(dm.charge_or_issue, ''), coalesce(dm.orders_summary, '')),
        public.docket_matter_search_rank(dm.case_number, dm.matter_title, dm.search_vector, dm.id, p_query) as rank
      from private.docket_matter_search_hits(p_query) h
      join public.docket_matters dm on dm.id = h.id
      where dm.deleted_at is null
      order by rank desc, dm.id
      limit p_limit
    )

    union all

    (
      select
        'judgment'::text,
        j.id,
        j.title,
        j.citation,
        coalesce(j.content_text, ''),
        ts_rank(j.search_vector, websearch_to_tsquery('english', p_query)) as rank
      from public.judgments j
      where j.search_vector @@ websearch_to_tsquery('english', p_query)
      order by rank desc, j.id
      limit p_limit
    )

    union all

    (
      select
        'quick_code'::text,
        qc.id,
        coalesce(qc.title, qc.code_word),
        qc.code_word,
        coalesce(qc.content, ''),
        ts_rank(qc.search_vector, websearch_to_tsquery('english', p_query)) as rank
      from public.quick_codes qc
      where qc.search_vector @@ websearch_to_tsquery('english', p_query)
      order by rank desc, qc.id
      limit p_limit
    )
  ) hit
  order by hit.rank desc, hit.entity_type, hit.id;
end;
$function$;

comment on function public.global_search(text, integer) is
  'Unified search across case, bench note, statute (and provision), case law, docket matter, judgment and quick code. 0166: blank query, length and limit guards. 0171: index-served case_law and docket_matter candidates. 0172: p_limit (1-100, default 20) caps EACH type, so one type can no longer crowd out the rest; rows still come ordered by rank, and headlines are built only for the rows returned. RLS applies to every returned row.';

notify pgrst, 'reload schema';
