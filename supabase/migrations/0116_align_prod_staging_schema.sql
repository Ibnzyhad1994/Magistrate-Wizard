-- ============================================================================
-- 0116_align_prod_staging_schema.sql
--
-- Production and staging drifted in four function bodies (comments /
-- whitespace in the guards, and list_docket_matters) and in the
-- case_law table comment (staging still had the original 0005 one-liner).
-- Columns, constraints, RLS policies, and triggers already matched.
--
-- This migration re-applies the current repo definitions so both
-- hosted databases, and a fresh local reset, share the same public
-- schema. No behaviour change versus 0097 / 0046 / 0022 / 0037 / 0035.
--
-- documents.entity_id remains polymorphic on purpose (0040): Postgres
-- cannot hang one FK off six parent tables. Attachments still follow
-- the parent via documents_parent_cascade_delete() and RLS EXISTS.
-- Clone/sync of library rows must copy the parent together with
-- documents + storage + join tables; a FK cannot do that across
-- projects.
-- ============================================================================

comment on table public.case_law is
  'Dual-model Case Law: canonical/institutional legal authority (owner_id IS NULL, admin-curated, globally readable, admin-only write) coexisting with privately owned personal Case Law research (owner_id IS NOT NULL, private by default with owner-controlled is_discoverable, owner-only write) in a single table -- see 0035. Ownership is immutable after creation. No admin bypass into personal rows; Admin''s canonical curation authority and a magistrate''s personal-record privacy are separate concerns. citation uniqueness is enforced only among canonical rows (case_law_citation_canonical_unique_idx); personal rows have no citation uniqueness constraint. docket_matter_case_law (0030) and quick_code_case_law (0034) both express Case-Law-side access as a live, unmodified EXISTS against this table, so they automatically inherit this new access model with zero change to either table. Related details that belong with a row: summary/full_text (same row); case_law_tags (FK ON DELETE CASCADE); case_law_annotations (FK ON DELETE CASCADE); documents where entity_type=''case_law'' and entity_id=id (polymorphic, no declarative FK); storage object at documents.file_path.';

create or replace function public.protect_docket_matter_assignment_history()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_profile_nulled boolean;
  v_granted_by_nulled boolean;
begin
  v_profile_nulled := old.profile_id is not null and new.profile_id is null;
  v_granted_by_nulled := old.granted_by is not null and new.granted_by is null;

  if v_profile_nulled or v_granted_by_nulled then
    if new.docket_matter_id is distinct from old.docket_matter_id
       or new.started_at is distinct from old.started_at
       or new.reason is distinct from old.reason
       or (new.profile_id is distinct from old.profile_id and not v_profile_nulled)
       or (new.granted_by is distinct from old.granted_by and not v_granted_by_nulled) then
      raise exception 'Unexpected combined change alongside a profile/grantor removal on a Docket Matter Assignment';
    end if;

    if v_profile_nulled and old.ended_at is null then
      new.ended_at := now();
    end if;

    return new;
  end if;

  if old.ended_at is not null then
    raise exception 'Cannot modify a historical (already-ended) Docket Matter Assignment';
  end if;

  if new.docket_matter_id is distinct from old.docket_matter_id
     or new.profile_id is distinct from old.profile_id
     or new.granted_by is distinct from old.granted_by
     or new.started_at is distinct from old.started_at
     or new.reason is distinct from old.reason then
    raise exception 'A Docket Matter Assignment may only have ended_at set to end it; no other field may change';
  end if;

  if new.ended_at is null then
    raise exception 'Reactivating an ended Docket Matter Assignment is not permitted; create a new assignment instead, subject to the ordinary creation authorization at that time';
  end if;

  return new;
end;
$$;

create or replace function public.shares_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_recipient_nulled boolean;
  v_granted_by_nulled boolean;
begin
  if tg_op = 'INSERT' then
    new.granted_by := (select auth.uid());
    return new;
  end if;

  v_recipient_nulled := old.recipient_id is not null and new.recipient_id is null;
  v_granted_by_nulled := old.granted_by is not null and new.granted_by is null;

  if v_recipient_nulled or v_granted_by_nulled then
    if new.item_type is distinct from old.item_type
       or new.item_id is distinct from old.item_id
       or new.permission is distinct from old.permission
       or new.created_at is distinct from old.created_at
       or (new.recipient_id is distinct from old.recipient_id and not v_recipient_nulled)
       or (new.granted_by is distinct from old.granted_by and not v_granted_by_nulled) then
      raise exception 'Unexpected combined change alongside a recipient/granter removal on a Share';
    end if;

    if v_recipient_nulled and old.revoked_at is null then
      new.revoked_at := now();
    end if;

    return new;
  end if;

  if old.revoked_at is not null then
    raise exception 'Cannot modify an already-revoked Share';
  end if;

  if new.item_type is distinct from old.item_type
     or new.item_id is distinct from old.item_id
     or new.recipient_id is distinct from old.recipient_id
     or new.granted_by is distinct from old.granted_by
     or new.permission is distinct from old.permission
     or new.created_at is distinct from old.created_at then
    raise exception 'A Share may only have revoked_at set to revoke it; no other field may change';
  end if;

  if new.revoked_at is null then
    raise exception 'Reactivating a revoked Share is not permitted; create a new Share instead, subject to the ordinary creation authorization at that time';
  end if;

  return new;
end;
$$;

create or replace function public.protect_judgment_lifecycle()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.finalized_at := null;
    new.finalized_by := null;
    return new;
  end if;

  if old.status = 'draft' and new.status = 'final' then
    new.finalized_at := now();
    new.finalized_by := (select auth.uid());
    return new;
  end if;

  if old.status = 'final' then
    if new.status = 'draft' then
      if new.title is distinct from old.title
        or new.case_number is distinct from old.case_number
        or new.court_name is distinct from old.court_name
        or new.judgment_date is distinct from old.judgment_date
        or new.citation is distinct from old.citation
        or new.content is distinct from old.content
        or new.content_text is distinct from old.content_text
      then
        raise exception 'Cannot unlock (final -> draft) and edit substantive Judgment fields in the same statement. Unlock first, then edit in a separate UPDATE.';
      end if;
      new.finalized_at := old.finalized_at;
      new.finalized_by := old.finalized_by;
      return new;
    elsif new.status = 'final' then
      if new.title is distinct from old.title
        or new.case_number is distinct from old.case_number
        or new.court_name is distinct from old.court_name
        or new.judgment_date is distinct from old.judgment_date
        or new.citation is distinct from old.citation
        or new.content is distinct from old.content
        or new.content_text is distinct from old.content_text
      then
        raise exception 'Judgment is final; substantive fields (title, case_number, court_name, judgment_date, citation, content, content_text) are locked. Unlock (status -> draft) before editing.';
      end if;
      new.finalized_at := old.finalized_at;
      new.finalized_by := old.finalized_by;
      return new;
    else
      raise exception 'Invalid Judgment status transition.';
    end if;
  end if;

  new.finalized_at := old.finalized_at;
  new.finalized_by := old.finalized_by;
  return new;
end;
$$;

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
    left join lateral (
      select e.event_status, e.stage_at_event
      from public.docket_events e
      where e.docket_matter_id = dm.id
        and p_exact_date is not null
        and e.scheduled_date = p_exact_date
        and e.event_status <> 'entered_in_error'
      order by e.created_at desc
      limit 1
    ) appear on true
    where (
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
    board.appearance_stage, board.rank, board.headline
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
