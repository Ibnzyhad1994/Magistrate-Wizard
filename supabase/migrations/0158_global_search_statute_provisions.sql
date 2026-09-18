-- Magistrate Wizard -- 0158: global search looks inside a statute's sections
--
-- Problem
--   statute_provisions has carried a generated, GIN-indexed search_vector
--   since 0055, maintained on every write. global_search has never
--   referenced it -- not in any of its six definitions (0010, 0047, 0112,
--   0120, 0137, 0145). A magistrate searching for a phrase that appears
--   only in the body of one section got nothing back for it, and
--   docs/workflows-layman/10 tells users exactly that: such a phrase "is
--   more reliably found on the Legislation list page than here".
--
--   search_statutes (0157) does search provisions, but collapses with
--   DISTINCT ON and returns no provision identity, and its only caller
--   (useScopedSearchIds) consumes just a set of statute ids.
--
-- Change
--   The statute branch of global_search now LEFT JOINs the best-ranked
--   matching provision per Act. An Act matched only through one of its
--   sections is returned; the result names that section in the subtitle
--   ("Section 12 - Assault") in place of the Act's code, and its headline
--   is drawn from the provision text rather than the Act summary. Rank is
--   the greater of the Act-level and provision-level ranks.
--
--   DISTINCT ON keeps the "at most one row per Act" shape the composite
--   result set already had, so a query matching forty sections of one Act
--   cannot crowd every other entity type out of the shared LIMIT.
--
-- Threat model
--   No new exposure. global_search is SECURITY INVOKER (confirmed on the
--   live function, prosecdef = false) and stays so, so every row is
--   filtered by the caller's own RLS. statute_provisions' SELECT policy is
--   `can_view_statute(statute_id)` -- the same predicate that governs the
--   parent Act -- so a provision is readable exactly when its Act already
--   was. No admin path is added, and an unpublished or draft Act's
--   sections remain as invisible as the Act itself. No new grants; the
--   existing EXECUTE grant and the 60/60s rate limit are unchanged.
--
-- Body provenance
--   Reproduced from the LIVE definition (pg_get_functiondef, md5
--   f874f33fbee22c3c3e50bff74fddc048) rather than pasted from 0145,
--   because 0141 established that these bodies can drift between
--   environments -- it patches set_docket_matter_next_date textually
--   rather than redefining it. Only the statute branch and the new CTE
--   differ from that live body.

CREATE OR REPLACE FUNCTION public.global_search(p_query text, p_limit integer DEFAULT 20)
 RETURNS SETOF search_result
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  perform public.enforce_rpc_rate_limit('global_search', 60, 60);
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
$function$;
