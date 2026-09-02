-- ============================================================================
-- 0120_docket_matter_bin_and_purge.sql
--
-- Soft-delete (bin) for Docket Matters, 7-day retention, then hard purge
-- of the matter and matter-owned children. Identity fields remain
-- UPDATEable through ordinary RLS; court_id stays immutable (0097).
--
-- There is still no general DELETE policy on docket_matters. Hard delete
-- is only through SECURITY DEFINER purge functions, and only after the
-- row is already in the bin. audit_docket_matters (0048) records the
-- bin UPDATE and the final DELETE.
-- ============================================================================

-- 1. Bin columns -----------------------------------------------------------

alter table public.docket_matters
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles (id) on delete set null;

comment on column public.docket_matters.deleted_at is
  'When set, the matter is in the bin and hidden from ordinary Docket lists. Permanently purged 7 days later (or sooner via purge_docket_matter). Distinct from status = archived.';
comment on column public.docket_matters.deleted_by is
  'Profile who moved the matter to the bin. Provenance only.';

create index if not exists docket_matters_deleted_at_idx
  on public.docket_matters (deleted_at)
  where deleted_at is not null;

-- 2. Guard: binned rows are frozen until restore ---------------------------

create or replace function public.docket_matters_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_district_id uuid;
  v_is_active boolean;
begin
  if tg_op = 'UPDATE' and old.deleted_at is not null and new.deleted_at is not null then
    raise exception 'A binned Docket Matter cannot be edited. Restore it first.';
  end if;

  if tg_op = 'UPDATE' and new.court_id is distinct from old.court_id then
    raise exception 'A Docket Matter''s court cannot be changed through an ordinary update. Court reassignment is not supported.';
  end if;

  if tg_op = 'INSERT' then
    select c.district_id, c.is_active into v_district_id, v_is_active
    from public.courts c
    where c.id = new.court_id;

    if v_district_id is null then
      raise exception 'Cannot create a Docket Matter at court % — that court has no Magisterial District assigned', new.court_id;
    end if;

    if not coalesce(v_is_active, false) then
      raise exception 'Cannot create a Docket Matter at inactive court % — is_active must be true to accept new Docket entry', new.court_id;
    end if;

    new.district_id := v_district_id;
  else
    new.district_id := old.district_id;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  else
    new.created_by := old.created_by;
  end if;

  if tg_op = 'UPDATE' then
    new.last_updated_by := (select auth.uid());
  end if;

  return new;
end;
$$;

comment on function public.docket_matters_guard() is
  'Derives district_id from court_id on INSERT only; force-preserves district_id/created_by on UPDATE; forces last_updated_by on UPDATE. court_id is immutable (0097). Binned rows (deleted_at set) reject further edits until restored (0120).';

-- 3. Hide binned rows from ordinary lists ----------------------------------

drop function if exists public.list_docket_matters(text, integer, text[], text[], text[], text[], text[], date, uuid);

create function public.list_docket_matters(
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
  ruling_status text,
  judgment_status text,
  sentence_status text,
  appeal_status text,
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
      dm.ruling_status,
      dm.judgment_status,
      dm.sentence_status,
      dm.appeal_status,
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
        else ts_rank(dm.search_vector, websearch_to_tsquery('english', p_query))
      end as rank,
      case
        when btrim(coalesce(p_query, '')) = '' then null::text
        else ts_headline(
          'english',
          coalesce(dm.orders_summary, dm.charge_or_issue, ''),
          websearch_to_tsquery('english', p_query),
          'MaxFragments=2, MaxWords=30, MinWords=10'
        )
      end as headline
    from public.docket_matters dm
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
      and (
        btrim(coalesce(p_query, '')) = ''
        or dm.search_vector @@ websearch_to_tsquery('english', p_query)
      )
      and (p_court_id is null or dm.court_id = p_court_id)
      and (
        p_procedure_stages is null
        or cardinality(p_procedure_stages) = 0
        or dm.procedure_stage = any (p_procedure_stages)
      )
      and (
        p_custody is null
        or cardinality(p_custody) = 0
        or dm.custody_status = any (p_custody)
      )
      and (
        p_disclosure is null
        or cardinality(p_disclosure) = 0
        or dm.disclosure_status = any (p_disclosure)
      )
      and (
        p_trial is null
        or cardinality(p_trial) = 0
        or dm.trial_status = any (p_trial)
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
    board.trial_status, board.ruling_status, board.judgment_status, board.sentence_status,
    board.appeal_status, board.procedure_stage, board.next_appearance, board.can_edit,
    board.has_ruling_document, board.has_judgment_document, board.appearance_status,
    board.appearance_stage, board.appearance_outcome, board.category_id, board.category_name,
    board.category_other, board.rank, board.headline
  from board
  where
    p_next_date is null
    or cardinality(p_next_date) = 0
    or (
      ('today' = any (p_next_date) and board.next_appearance = current_date)
      or ('upcoming' = any (p_next_date) and board.next_appearance > current_date)
      or ('no_date' = any (p_next_date) and board.next_appearance is null)
    )
  order by board.rank desc, board.updated_at desc
  limit p_limit;
$$;

grant execute on function public.list_docket_matters(text, integer, text[], text[], text[], text[], text[], date, uuid) to authenticated;
revoke execute on function public.list_docket_matters(text, integer, text[], text[], text[], text[], text[], date, uuid) from public;

comment on function public.list_docket_matters(text, integer, text[], text[], text[], text[], text[], date, uuid) is
  'Docket spreadsheet/tiles list. SECURITY INVOKER. 0120 excludes binned rows (deleted_at is not null).';

drop function if exists public.search_docket_matters(text, integer);

create function public.search_docket_matters(p_query text, p_limit integer default 20)
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
language sql
stable
security invoker
set search_path = public
as $$
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
  order by rank desc
  limit p_limit;
$$;

grant execute on function public.search_docket_matters(text, integer) to authenticated;
revoke execute on function public.search_docket_matters(text, integer) from public;

comment on function public.search_docket_matters(text, integer) is
  'Full-text search over live docket_matters. 0120 excludes binned rows.';

create or replace function public.global_search(p_query text, p_limit integer default 20)
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
  order by rank desc
  limit p_limit;
$$;

drop function if exists public.get_daily_docket_report_data(date, uuid);

create function public.get_daily_docket_report_data(p_date date, p_court_id uuid default null)
returns table (
  matter_id uuid,
  case_number text,
  matter_title text,
  charge_or_issue text,
  status docket_matter_status,
  court_name text,
  district_name text,
  custody_status text,
  procedure_stage text,
  appearance_status text,
  appearance_stage text,
  category_id uuid,
  category_name text,
  witnesses_called integer,
  witnesses_completed integer,
  witnesses_partly_heard integer,
  witnesses_remaining integer,
  outcome_at_event text,
  notes text,
  orders_summary text,
  outcome text,
  next_appearance date,
  parties jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    dm.id as matter_id,
    dm.case_number,
    dm.matter_title,
    dm.charge_or_issue,
    dm.status,
    c.name as court_name,
    md.name as district_name,
    dm.custody_status,
    dm.procedure_stage,
    appear.event_status as appearance_status,
    appear.stage_at_event as appearance_stage,
    appear.category_id,
    cat.name as category_name,
    appear.witnesses_called,
    appear.witnesses_completed,
    appear.witnesses_partly_heard,
    appear.witnesses_remaining,
    appear.outcome_at_event,
    appear.notes,
    dm.orders_summary,
    dm.outcome,
    (
      select min(e.scheduled_date)
      from public.docket_events e
      where e.docket_matter_id = dm.id
        and e.event_status = 'scheduled'
        and e.scheduled_date >= current_date
    ) as next_appearance,
    (
      select coalesce(jsonb_agg(jsonb_build_object('full_name', p.full_name, 'role', p.role) order by p.role, p.full_name), '[]'::jsonb)
      from public.docket_matter_parties p
      where p.docket_matter_id = dm.id and p.party_status = 'active'
    ) as parties
  from public.docket_matters dm
  left join public.courts c on c.id = dm.court_id
  left join public.magisterial_districts md on md.id = dm.district_id
  left join lateral (
    select e.event_status, e.stage_at_event, e.category_id, e.witnesses_called, e.witnesses_completed,
           e.witnesses_partly_heard, e.witnesses_remaining, e.outcome_at_event, e.notes
    from public.docket_events e
    where e.docket_matter_id = dm.id
      and e.scheduled_date = p_date
      and e.event_status <> 'entered_in_error'
    order by e.created_at desc
    limit 1
  ) appear on true
  left join public.docket_matter_categories cat on cat.id = appear.category_id
  where dm.deleted_at is null
  and exists (
    select 1 from public.docket_events e2
    where e2.docket_matter_id = dm.id
      and e2.scheduled_date = p_date
      and e2.event_status <> 'entered_in_error'
  )
  and (p_court_id is null or dm.court_id = p_court_id)
  order by dm.case_number, dm.matter_title;
$$;

revoke execute on function public.get_daily_docket_report_data from public;
grant execute on function public.get_daily_docket_report_data to authenticated;

comment on function public.get_daily_docket_report_data(date, uuid) is
  'Daily Docket Progress Report. 0120 excludes binned matters.';

-- 4. Bin / restore (invoker — ordinary UPDATE RLS) -------------------------

create or replace function public.bin_docket_matter(p_id uuid)
returns public.docket_matters
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.docket_matters;
begin
  if p_id is null then
    raise exception 'Matter id is required.';
  end if;

  if not public.can_edit_docket_matter(p_id) then
    raise exception 'You do not have permission to delete this matter.';
  end if;

  select * into v_row from public.docket_matters where id = p_id;
  if not found then
    raise exception 'This matter could not be found, or you no longer have access to it.';
  end if;

  if v_row.deleted_at is not null then
    return v_row;
  end if;

  update public.docket_matters
  set deleted_at = now(),
      deleted_by = (select auth.uid())
  where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'This matter could not be found, or you no longer have access to it.';
  end if;

  return v_row;
end;
$$;

create or replace function public.restore_docket_matter(p_id uuid)
returns public.docket_matters
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.docket_matters;
begin
  if p_id is null then
    raise exception 'Matter id is required.';
  end if;

  if not public.can_edit_docket_matter(p_id) then
    raise exception 'You do not have permission to restore this matter.';
  end if;

  select * into v_row from public.docket_matters where id = p_id;
  if not found then
    raise exception 'This matter could not be found, or you no longer have access to it.';
  end if;

  if v_row.deleted_at is null then
    return v_row;
  end if;

  update public.docket_matters
  set deleted_at = null,
      deleted_by = null
  where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'This matter could not be found, or you no longer have access to it.';
  end if;

  return v_row;
end;
$$;

grant execute on function public.bin_docket_matter(uuid) to authenticated;
grant execute on function public.restore_docket_matter(uuid) to authenticated;
revoke execute on function public.bin_docket_matter(uuid) from public;
revoke execute on function public.restore_docket_matter(uuid) from public;

comment on function public.bin_docket_matter(uuid) is
  'Moves a Docket Matter to the bin (deleted_at). Requires can_edit_docket_matter. No-op if already binned. Hard delete is a separate 7-day purge.';
comment on function public.restore_docket_matter(uuid) is
  'Clears deleted_at/deleted_by so the matter returns to the live Docket. Requires can_edit_docket_matter.';

-- 5. Hard purge (definer — no DELETE policy on docket_matters) -------------
-- Child FKs stay ON DELETE RESTRICT. This function deletes matter-owned
-- rows in dependency order, then the matter. Judgments, case law, and
-- quick codes themselves are not deleted — only association rows.
-- documents_parent_cascade_delete (0040) removes documents rows after
-- the matter DELETE; it does not remove storage.objects (same as 0040).

create or replace function public.purge_docket_matter_row(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_id is null then
    return;
  end if;

  delete from public.docket_event_calendar_links
  where docket_event_id in (
    select id from public.docket_events where docket_matter_id = p_id
  );

  delete from public.docket_events where docket_matter_id = p_id;
  delete from public.docket_matter_parties where docket_matter_id = p_id;
  delete from public.docket_matter_tags where docket_matter_id = p_id;
  delete from public.docket_matter_assignments where docket_matter_id = p_id;
  delete from public.shares where item_type = 'docket_matter' and item_id = p_id;
  delete from public.docket_matter_judgments where docket_matter_id = p_id;
  delete from public.docket_matter_case_law where docket_matter_id = p_id;
  delete from public.quick_code_docket_matters where docket_matter_id = p_id;
  delete from public.bookmarks where entity_type = 'docket_matter' and entity_id = p_id;
  delete from public.bench_notes where entity_type = 'docket_matter' and entity_id = p_id;

  delete from public.docket_matters where id = p_id;
end;
$$;

revoke execute on function public.purge_docket_matter_row(uuid) from public;
revoke execute on function public.purge_docket_matter_row(uuid) from anon, authenticated;

comment on function public.purge_docket_matter_row(uuid) is
  'Internal hard-delete of one Docket Matter and matter-owned children. Not granted to authenticated. Called only by purge_docket_matter / purge_expired_docket_matters.';

create or replace function public.purge_docket_matter(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_at timestamptz;
begin
  if p_id is null then
    raise exception 'Matter id is required.';
  end if;

  if not (
    public.can_edit_docket_matter(p_id)
    or public.is_admin()
  ) then
    raise exception 'You do not have permission to permanently delete this matter.';
  end if;

  select deleted_at into v_deleted_at from public.docket_matters where id = p_id;
  if not found then
    raise exception 'This matter could not be found, or you no longer have access to it.';
  end if;

  if v_deleted_at is null then
    raise exception 'A live Docket Matter cannot be permanently deleted. Move it to the bin first.';
  end if;

  perform public.purge_docket_matter_row(p_id);
end;
$$;

create or replace function public.purge_expired_docket_matters()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select id
    from public.docket_matters
    where deleted_at is not null
      and deleted_at <= now() - interval '7 days'
  loop
    perform public.purge_docket_matter_row(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.purge_docket_matter(uuid) to authenticated;
grant execute on function public.purge_expired_docket_matters() to authenticated;
revoke execute on function public.purge_docket_matter(uuid) from public;
revoke execute on function public.purge_expired_docket_matters() from public;

comment on function public.purge_docket_matter(uuid) is
  'Permanently deletes a binned Docket Matter. Requires can_edit_docket_matter or is_admin. Live rows are rejected.';
comment on function public.purge_expired_docket_matters() is
  'Hard-deletes every Docket Matter binned for 7 days or more. Safe for cron and for opportunistic calls from the bin list.';

-- 6. Bin list (opportunistic expiry purge) ---------------------------------

create or replace function public.list_binned_docket_matters()
returns table (
  id uuid,
  case_number text,
  matter_title text,
  status docket_matter_status,
  court_id uuid,
  court_name text,
  deleted_at timestamptz,
  deleted_by uuid,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform public.purge_expired_docket_matters();

  return query
  select
    dm.id,
    dm.case_number,
    dm.matter_title,
    dm.status,
    dm.court_id,
    c.name as court_name,
    dm.deleted_at,
    dm.deleted_by,
    dm.updated_at
  from public.docket_matters dm
  left join public.courts c on c.id = dm.court_id
  where dm.deleted_at is not null
    and public.can_edit_docket_matter(dm.id)
  order by dm.deleted_at desc;
end;
$$;

grant execute on function public.list_binned_docket_matters() to authenticated;
revoke execute on function public.list_binned_docket_matters() from public;

comment on function public.list_binned_docket_matters() is
  'Matters in the bin that the caller can edit. Runs purge_expired_docket_matters first so local stacks without pg_cron still empty after 7 days.';

-- 7. Optional hourly cron (skip quietly if pg_cron is unavailable) ---------

do $cron$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'purge-expired-docket-matters';
  perform cron.schedule(
    'purge-expired-docket-matters',
    '15 * * * *',
    'select public.purge_expired_docket_matters()'
  );
exception
  when others then
    raise notice 'pg_cron not scheduled for docket bin purge: %', sqlerrm;
end;
$cron$;
