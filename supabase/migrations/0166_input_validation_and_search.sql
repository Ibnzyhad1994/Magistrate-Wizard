-- Magistrate Wizard -- 0166: input validation and search
--
-- Problem (2026-10-15 audit, theme T7)
--   B-14  docket_matters_district_case_number_unique (0020) compared raw
--         text, so "B-12/2026", "b-12/2026", "B-12/2026 " and " B-12/2026"
--         were four different numbers in one district. Nothing refused a
--         case number or title made only of spaces, or an empty title, and
--         a 1,000,000-character title was stored. The New matter dialog
--         accepted a title of three spaces, and the matter page then showed
--         an empty heading.
--   C-10  case_law_matches_query and case_law_search_rank (0112) built
--         ILIKE '%' || p_query || '%' without escaping, so a search for "%"
--         or "_" matched every Case Law row the caller can see. A query of
--         spaces passed docket_matter_matches_query's "empty means browse"
--         branch (0145), so global_search returned the docket for it.
--   C-12  global_search accepted any p_limit (-1 surfaced the raw
--         "LIMIT must not be negative"). A 10,000-character judgment title
--         and a 100,000-character Quick Code were stored. The finalised
--         judgment notice was spelt "finalized".
--   Every result stayed inside the caller's own RLS scope; none of this
--   was a leak.
--
-- Change
--   1. btrim_whitespace(text) trims the characters JavaScript's
--      String.prototype.trim() removes, so the database and the forms'
--      zod .trim() agree on what "blank" and "the same number" mean.
--      escape_like_pattern(text) escapes \, % and _ for a LIKE pattern.
--   2. Case numbers are unique per district ignoring letter case and the
--      surrounding whitespace. The unique index keeps its old name, so the
--      app's "That case number already exists in this district." mapping
--      still fires. Existing rows are checked first: two that collide
--      under the new rule stop this migration, naming both, because
--      merging or renumbering a court file is a registry decision, never
--      a migration's (see Upgrade notes in the PR, and below).
--   3. Case numbers and titles are trimmed on every write, existing ones
--      included. Only the surrounding whitespace is removed; the inside of
--      a number is never touched.
--   4. CHECKs: case number 1-100 characters, title 1-300, charge at most
--      2000 (the New matter form's limits); judgment title at most 300
--      (the judgment forms' limit); Quick Code content at most 20,000.
--      Each is added NOT VALID and validated straight away when no
--      existing row breaks it. A row that does is named in a WARNING and
--      left untouched; the constraint then guards every new write, and the
--      operator validates it once those rows are corrected.
--   5. Case Law search escapes LIKE metacharacters and trims the query.
--      "%" and "_" now find only text that really contains them. An
--      absent or empty query is still the browse listing every caller
--      relies on (search_case_law_scoped, the facet counts); a query of
--      only whitespace matches nothing, as it effectively did before.
--   6. global_search trims the query, returns nothing for a blank one,
--      refuses one longer than 500 characters with a plain sentence, and
--      clamps p_limit to 1..100 (the Search page asks for 40).
--   7. The finalised notice title is spelt "finalised". Notifications are
--      immutable by design (notifications_protect), so notices already
--      delivered keep the wording they were sent with.
--
-- Threat model
--   No access path changes. global_search, case_law_matches_query and
--   case_law_search_rank stay SECURITY INVOKER, so every row is still
--   filtered by the caller's own RLS; their grants are untouched (CREATE
--   OR REPLACE keeps the ACL), so nothing 0138 or 0160 revoked from anon
--   comes back. The two new helpers are pure string functions with no
--   table access, executable by authenticated and service_role only. The
--   new trigger function is SECURITY INVOKER and only rewrites the row
--   being written. judgments_notify_final keeps whichever body is live
--   (0123, or 0165's recipient filter); only the title literal changes.
--
-- Overlap with other open migrations
--   0161 redefines docket_matters_guard, so trimming lives in its own
--   trigger rather than in the guard. 0165 redefines judgments_notify_final
--   with the new spelling already; the textual patch in section 7 skips
--   when it finds that, and 0165 landing after this one keeps both. 0162
--   changes Case Law visibility (can_view_case_law and its policy); the
--   search functions here read through RLS and do not restate it.

-- ----------------------------------------------------------------------------
-- 1. Helpers
-- ----------------------------------------------------------------------------

create or replace function public.btrim_whitespace(p_text text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  -- The set String.prototype.trim() removes: ASCII whitespace (\x0b is the
  -- vertical tab; E'' strings have no \v), the no-break and other Unicode
  -- space separators, the line and paragraph separators, and the BOM.
  select pg_catalog.btrim(
    p_text,
    E' \t\n\r\x0b\f                 　﻿'
  );
$$;

comment on function public.btrim_whitespace(text) is
  'Trims the characters JavaScript''s String.prototype.trim() removes (0166), so the database and the forms'' zod .trim() agree on blank values and on which case numbers are the same. Used by the docket_matters case-number unique index, its CHECKs and its trimming trigger, and by the search functions.';

revoke all on function public.btrim_whitespace(text) from public, anon;
grant execute on function public.btrim_whitespace(text) to authenticated, service_role;

create or replace function public.escape_like_pattern(p_text text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.replace(
    pg_catalog.replace(pg_catalog.replace(p_text, '\', '\\'), '%', '\%'),
    '_',
    '\_'
  );
$$;

comment on function public.escape_like_pattern(text) is
  'Escapes \, % and _ so user text is matched literally inside a LIKE/ILIKE pattern with the default escape character (0166).';

revoke all on function public.escape_like_pattern(text) from public, anon;
grant execute on function public.escape_like_pattern(text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Preflight: no two existing matters may share a case number under the
--    new rule. Stops the migration, naming each conflict, before anything
--    is changed.
-- ----------------------------------------------------------------------------

do $$
declare
  v_groups integer;
  v_detail text;
begin
  select count(*), string_agg(g.line, E'\n')
  into v_groups, v_detail
  from (
    select format(
      '  district %s (%s): %s',
      coalesce(md.name, '?'),
      dm.district_id,
      string_agg(format('%L (matter %s%s)', dm.case_number, dm.id,
        case when dm.deleted_at is not null then ', in the bin' else '' end), ', '
        order by dm.created_at)
    ) as line
    from public.docket_matters dm
    left join public.magisterial_districts md on md.id = dm.district_id
    group by dm.district_id, md.name, upper(public.btrim_whitespace(dm.case_number))
    having count(*) > 1
    order by md.name
  ) g;

  if v_groups > 0 then
    raise exception
      '0166: % case number(s) are held by more than one matter in the same district once letter case and surrounding spaces are ignored. Nothing was changed.',
      v_groups
      using
        detail = v_detail,
        hint = 'Each line is one case number. Decide with the court which matter keeps it: correct the other''s case number in Edit details (or bin and empty a true duplicate), then deploy again.';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Trim the surrounding whitespace of existing case numbers and titles.
--    Safe after the preflight: no trimmed number can collide. Only the
--    BEFORE triggers that would refuse a binned row, restamp
--    last_updated_by/updated_at, or recompute derived columns are paused;
--    the audit trigger still records the change.
-- ----------------------------------------------------------------------------

do $$
declare
  v_pending integer;
  v_trimmed integer;
begin
  select count(*) into v_pending
  from public.docket_matters
  where case_number <> public.btrim_whitespace(case_number)
     or matter_title <> public.btrim_whitespace(matter_title);

  if v_pending = 0 then
    return;
  end if;

  alter table public.docket_matters disable trigger docket_matters_guard_trigger;
  alter table public.docket_matters disable trigger docket_matters_outcome_sync_trigger;
  alter table public.docket_matters disable trigger docket_matters_workflow_protocol_trigger;
  alter table public.docket_matters disable trigger set_docket_matters_updated_at;

  update public.docket_matters
  set case_number = public.btrim_whitespace(case_number),
      matter_title = public.btrim_whitespace(matter_title)
  where case_number <> public.btrim_whitespace(case_number)
     or matter_title <> public.btrim_whitespace(matter_title);
  get diagnostics v_trimmed = row_count;

  alter table public.docket_matters enable trigger docket_matters_guard_trigger;
  alter table public.docket_matters enable trigger docket_matters_outcome_sync_trigger;
  alter table public.docket_matters enable trigger docket_matters_workflow_protocol_trigger;
  alter table public.docket_matters enable trigger set_docket_matters_updated_at;

  raise notice '0166: trimmed the surrounding whitespace of % docket matter(s)', v_trimmed;
end $$;

-- ----------------------------------------------------------------------------
-- 4. Case-insensitive, trimmed uniqueness per district. Same name as the
--    0020 constraint, so 23505 still maps to the same sentence in the app.
--    district_id still leads, so the index still covers the district FK
--    (0155).
-- ----------------------------------------------------------------------------

alter table public.docket_matters
  drop constraint docket_matters_district_case_number_unique;

create unique index docket_matters_district_case_number_unique
  on public.docket_matters (district_id, upper(public.btrim_whitespace(case_number)));

comment on index public.docket_matters_district_case_number_unique is
  'One case number per Magisterial District, ignoring letter case and surrounding whitespace (0166; was a raw-text UNIQUE constraint since 0020). Binned matters still hold their number.';

comment on column public.docket_matters.case_number is
  'NOT globally unique. Unique per district ignoring letter case and surrounding whitespace (docket_matters_district_case_number_unique, 0166), matching the Magisterial District''s own registry sequence. Stored trimmed; 1-100 characters.';

-- ----------------------------------------------------------------------------
-- 5. Trim on every write. A separate trigger, not docket_matters_guard,
--    which 0161 also redefines.
-- ----------------------------------------------------------------------------

create or replace function public.docket_matters_trim_text()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.case_number := public.btrim_whitespace(new.case_number);
  new.matter_title := public.btrim_whitespace(new.matter_title);
  new.charge_or_issue := nullif(public.btrim_whitespace(new.charge_or_issue), '');
  return new;
end;
$$;

comment on function public.docket_matters_trim_text() is
  'BEFORE INSERT OR UPDATE OF case_number, matter_title, charge_or_issue on docket_matters (0166): trims the surrounding whitespace, and stores a blank charge as NULL. The CHECKs then refuse a case number or title that was only whitespace.';

revoke all on function public.docket_matters_trim_text() from public, anon, authenticated;

create trigger docket_matters_trim_text_trigger
  before insert or update of case_number, matter_title, charge_or_issue
  on public.docket_matters
  for each row execute function public.docket_matters_trim_text();

-- ----------------------------------------------------------------------------
-- 6. Blank and length CHECKs, added NOT VALID and validated below.
-- ----------------------------------------------------------------------------

alter table public.docket_matters
  add constraint docket_matters_case_number_not_blank
    check (public.btrim_whitespace(case_number) <> '') not valid,
  add constraint docket_matters_case_number_length
    check (char_length(case_number) <= 100) not valid,
  add constraint docket_matters_matter_title_not_blank
    check (public.btrim_whitespace(matter_title) <> '') not valid,
  add constraint docket_matters_matter_title_length
    check (char_length(matter_title) <= 300) not valid,
  add constraint docket_matters_charge_or_issue_length
    check (char_length(charge_or_issue) <= 2000) not valid;

alter table public.judgments
  add constraint judgments_title_length
    check (char_length(title) <= 300) not valid;

alter table public.quick_codes
  add constraint quick_codes_content_length
    check (char_length(content) <= 20000) not valid;

-- Validate each one that no existing row breaks. One that some row does
-- break stays NOT VALID (still enforced on every insert and update) and is
-- reported with the rows' ids; nothing is rewritten or truncated.
do $$
declare
  v_con record;
  v_bad bigint;
  v_ids text;
begin
  for v_con in
    select c.conname, c.conrelid::regclass as tbl, pg_get_expr(c.conbin, c.conrelid) as expr
    from pg_constraint c
    where c.conname in (
      'docket_matters_case_number_not_blank',
      'docket_matters_case_number_length',
      'docket_matters_matter_title_not_blank',
      'docket_matters_matter_title_length',
      'docket_matters_charge_or_issue_length',
      'judgments_title_length',
      'quick_codes_content_length'
    )
      and c.contype = 'c'
      and not c.convalidated
    order by c.conname
  loop
    execute format(
      'select count(*), string_agg(id::text, '', '') filter (where n <= 20)
       from (select id, row_number() over (order by id) as n from %s where not (%s)) bad',
      v_con.tbl, v_con.expr
    ) into v_bad, v_ids;

    if v_bad = 0 then
      execute format('alter table %s validate constraint %I', v_con.tbl, v_con.conname);
    else
      raise warning
        '0166: % row(s) of % break % and were left as they are; the constraint already checks every new write. Ids (first 20): %. Once they are corrected, run: alter table % validate constraint %;',
        v_bad, v_con.tbl, v_con.conname, v_ids, v_con.tbl, v_con.conname;
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 7. Case Law search treats the query as literal text. Same signatures,
--    attributes and callers as 0112.
-- ----------------------------------------------------------------------------

create or replace function public.case_law_matches_query(
  p_case_name text,
  p_citation text,
  p_search_vector tsvector,
  p_query text
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select case
    -- No query is the browse listing (search_case_law_scoped, the facet
    -- counts), exactly as 0112.
    when p_query is null or p_query = '' then true
    -- Only whitespace is not a query, and matches nothing.
    when public.btrim_whitespace(p_query) = '' then false
    else
      p_search_vector @@ websearch_to_tsquery('english', public.btrim_whitespace(p_query))
      or extensions.similarity(p_case_name, public.btrim_whitespace(p_query)) > 0.3
      or p_case_name ilike '%' || public.escape_like_pattern(public.btrim_whitespace(p_query)) || '%'
      or p_citation ilike '%' || public.escape_like_pattern(public.btrim_whitespace(p_query)) || '%'
  end;
$$;

comment on function public.case_law_matches_query(text, text, tsvector, text) is
  'Centralized case_law match predicate (0112, 0166): full-text OR trigram-fuzzy case name (similarity > 0.3, tolerates typos/misspellings) OR literal substring of case name/citation (tolerates partial/incomplete words). The query is trimmed and matched literally: %, _ and \ are escaped (0166). NULL or empty is the browse listing (matches every row); whitespace alone matches nothing. Used identically by search_case_law, search_case_law_scoped, all three case_law_counts_by_* facet functions, and global_search''s case_law branch -- keeping every case_law search surface in sync is the entire point of centralizing this, not an incidental convenience.';

create or replace function public.case_law_search_rank(
  p_case_name text,
  p_search_vector tsvector,
  p_query text
)
returns real
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when p_query is null or public.btrim_whitespace(p_query) = '' then 0::real
    else greatest(
      ts_rank(p_search_vector, websearch_to_tsquery('english', public.btrim_whitespace(p_query))),
      extensions.similarity(p_case_name, public.btrim_whitespace(p_query)),
      case
        when p_case_name ilike '%' || public.escape_like_pattern(public.btrim_whitespace(p_query)) || '%'
        then 0.5
        else 0
      end
    )
  end;
$$;

comment on function public.case_law_search_rank(text, tsvector, text) is
  'Relevance score for case_law search (0112, 0166): greatest of full-text ts_rank, trigram similarity to case_name, and a 0.5 floor for a literal case-name substring hit (the query trimmed, with %, _ and \ escaped). Used by search_case_law, search_case_law_scoped, and global_search''s case_law branch.';

-- ----------------------------------------------------------------------------
-- 8. global_search: blank query, query length and limit. The body below the
--    new guard is 0158's, unchanged.
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

-- ----------------------------------------------------------------------------
-- 9. "A judgment was finalised". Patched textually, as 0141 did, so the
--    live body is kept: 0123's, or 0165's recipient filter when 0165 has
--    already landed (it carries the new spelling, and this step skips).
-- ----------------------------------------------------------------------------

do $$
declare
  v_old constant text := '''A judgment was finalized''';
  v_new constant text := '''A judgment was finalised''';
  v_def text;
  v_hits integer;
begin
  v_def := pg_get_functiondef('public.judgments_notify_final()'::regprocedure);
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);

  if v_hits = 0 then
    if position(v_new in v_def) > 0 then
      raise notice '0166: judgments_notify_final already says finalised -- skipping';
      return;
    end if;
    raise exception
      '0166: judgments_notify_final contains neither notice title -- aborting rather than guessing';
  end if;
  if v_hits <> 1 then
    raise exception '0166: expected the notice title once in judgments_notify_final, found %', v_hits;
  end if;

  execute replace(v_def, v_old, v_new);
end $$;

do $$
begin
  if pg_get_functiondef('public.judgments_notify_final()'::regprocedure)
     not like '%''A judgment was finalised''%' then
    raise exception '0166: judgments_notify_final still does not say finalised';
  end if;
end $$;
