-- ============================================================================
-- 0157_statute_own_drafts_and_search_statutes.sql
--
-- Two defects surfaced by the live legislation tests once the local stack
-- was rebuilt from scratch (test-legislation-view-edit-separation 5c,
-- test-legislation-file-first 21/22).
--
-- 1. A magistrate could not see the draft Act they had just inserted.
--    0114 let magistrates INSERT a draft statute (created_by = caller,
--    review_status = 'draft') so they can add a new Act from the
--    Legislation page, but the only SELECT policy on statutes is still
--    "published OR admin" (0055, tightened by 0100 and 0118). Postgres
--    applies the SELECT policy to INSERT ... RETURNING, so the app's
--    `.insert().select().single()` in use-legislation.ts fails with
--    "new row violates row-level security policy" and the whole Add flow
--    is dead for magistrates. The draft was also invisible to its author
--    on every later read.
--
--    Fix: a second, additive SELECT policy scoped to the author's own
--    drafts. It keeps every gate the published-read envelope has --
--    clerks never, magistrates only while they sit an active Court
--    (0117) -- and adds created_by = caller AND review_status = 'draft'.
--    Published records, other people's drafts and admin behaviour are
--    untouched; the published-read policy is not altered.
--
-- 2. search_statutes() raised `column reference "id" is ambiguous` for
--    every caller. 0137 rewrote it as PL/pgSQL (to call
--    enforce_rpc_rate_limit before the query) with RETURNS TABLE(id, code,
--    ...). In PL/pgSQL those output columns are also variables, and the
--    final CTEs of the query select bare `id`, `code`, ... so the planner
--    cannot tell the variable from the column and errors. The other
--    search wrappers from 0137 qualify their columns and are unaffected
--    (verified by calling each as a magistrate). global_search, which the
--    app uses, has its own query and was never affected.
--
--    Fix: the same body with the two unqualified CTEs aliased. No change
--    to the signature, rate limit, grants (0138 revoked anon) or results.
-- ============================================================================

-- ==================== 1. Own-draft statutes are readable ====================

drop policy if exists "Magistrates can view own draft statutes" on public.statutes;
create policy "Magistrates can view own draft statutes"
  on public.statutes for select
  using (
    (select public.is_magistrate())
    and (select public.has_active_magistrate_court())
    and created_by = (select auth.uid())
    and review_status = 'draft'
  );

comment on policy "Magistrates can view own draft statutes" on public.statutes is
  'Additive to the published-read envelope: the magistrate who inserted a draft Act (0114) can read it back -- INSERT ... RETURNING and the Add flow depend on this -- while they still sit an active Court (0117). Never clerks, never other people''s drafts, never published rows (those stay with the 0055/0118 policy).';

-- ==================== 2. search_statutes: qualify the CTE columns ====================

create or replace function public.search_statutes(p_query text, p_limit integer default 20)
returns table (
  id uuid,
  code text,
  title text,
  jurisdiction text,
  summary text,
  rank real,
  headline text
)
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
    select distinct on (c.id)
      c.id, c.code, c.title, c.jurisdiction, c.summary, c.search_rank, c.headline
    from combined c
    order by c.id, c.search_rank desc
  )
  select b.id, b.code, b.title, b.jurisdiction, b.summary, b.search_rank, b.headline
  from best_per_statute b
  order by b.search_rank desc
  limit p_limit;
end;
$$;

comment on function public.search_statutes(text, integer) is
  'Full-text search over statutes and provisions. 0137: enforce_rpc_rate_limit 60/60s. 0157: CTE columns qualified so the PL/pgSQL OUT variables no longer make `id` ambiguous; results unchanged from 0055.';
