-- ============================================================================
-- 0162_case_law_library_integrity.sql
--
-- Forward-only hardening of Case Law and the curated legal library, from
-- the 2026-10-15 agentic audit (theme T5: C-01, C-02, C-03, C-05, C-06,
-- C-07, C-08). Every change narrows an existing envelope; no invariant in
-- docs/adr/ is reopened, and no admin path into personal Case Law, private
-- Judgments, Bench Notes or Quick Codes is added (ADR 0007).
--
-- 1. C-01: an EDIT share on personal Case Law let the recipient flip
--    is_discoverable (publishing the owner's research to every
--    magistrate) and DELETE the record: the UPDATE policy and
--    can_edit_case_law (behind the DELETE policy) both accept
--    has_item_share('case_law', id, 'edit'). Mirrors 0154 for Judgments:
--    a. case_law_ownership_guard also refuses is_discoverable and
--       review_status changes on a personal row unless auth.uid() is the
--       owner. An edit share still edits content.
--    b. The DELETE policy no longer accepts an edit share: the admin
--       deletes canonical rows, the owner deletes their own.
-- 2. C-02: the SECURITY DEFINER curator RPCs checked only is_admin(), so
--    the admin could re-status (hiding it from its owner's list), tag and
--    delete a magistrate's personal research it cannot even SELECT.
--    a. set_case_law_review_status, apply_case_law_tags,
--       publish_case_law_import and reject_case_law_import act on
--       canonical rows only (owner_id is null); a personal id gets the
--       same "not found" as a missing one, so no existence oracle.
--    b. case_law_tags: SELECT follows can_view_case_law (it was USING
--       true, leaking tagged row ids), and the admin's direct INSERT /
--       DELETE is limited to canonical rows like the RPC.
-- 3. C-03: a magistrate could supersede a published canonical Act ("Only
--    administrators may replace existing Legislation", 0114). The
--    magistrate INSERT branch requires supersedes_statute_id is null, and
--    the magistrate branch of finalize_legislation_document refuses a
--    draft that supersedes anything. finalize also requires p_document_id
--    to be a document attached to that statute, and locks the row.
-- 4. C-05: audit_trigger_fn kept every personal Case Law research field
--    except summary/full_text, plus Judgment and Bench Note titles, in the
--    admin-readable audit_log. Private rows now record an ALLOWLIST of
--    metadata (ids, owner, status, flags, timestamps) instead of a
--    denylist, so a new content column can never leak by default. Titles,
--    case names, case numbers, code words and file names count as content.
--    Covered: judgments, bench_notes, quick_codes, case_law_annotations,
--    personal case_law, and documents attached to any of those (or to
--    nothing). Rows already in audit_log are not rewritten: the table is
--    hash-chained (0126) and append-only.
-- 5. C-06: any signed-in user, a clerk included, could create, rename or
--    delete the global tags the curator applies to canonical Case Law and
--    Legislation (apply_*_tags reuse a tag by lower(name)). Tag writes are
--    admin-only; the app never writes tags directly.
-- 6. C-07: reject_case_law_import / reject_legislation_import deleted an
--    already-published record from a stale review queue, and a concurrent
--    publish || reject deadlocked (publish locked the record then the job;
--    reject locked the job then the record). All four RPCs now lock the
--    record row FIRST (select ... for update), and reject refuses a
--    published record in plain English. A reject waiting on a publish
--    re-reads the row and refuses; a publish waiting on a reject finds
--    the row gone and says "not found".
-- 7. C-08: unpublished canonical Case Law (draft / needs_review / ready,
--    including failed-quality OCR) was readable by every magistrate and
--    returned by global_search and search_case_law_scoped (both SECURITY
--    INVOKER, so RLS is their only filter). 0058 had the right predicate;
--    later rewrites (0093, 0117, 0121) dropped it. The canonical branch of
--    can_view_case_law and of the case_law SELECT policy again requires
--    review_status = 'published' or is_admin(), and the discoverable
--    branch again requires owner_id is not null (is_discoverable is inert
--    on canonical rows, 0058).
--
-- Overlap with 0160_anon_and_auth_surface.sql (theme T4): 0160 also
-- redefines can_view_case_law (no auth.uid() -> false) and scopes the
-- case_law SELECT policy TO authenticated. The redefinitions below carry
-- both of those, so whichever of 0160 / 0162 runs last, the result keeps
-- the T4 and the T5 behaviour. Nothing here is redefined by 0161.
-- ============================================================================

-- ==================== 1a. discoverability and review status are the owner's ====================
-- Latest body: 0035. Only the UPDATE owner check is new.

create or replace function public.case_law_ownership_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if new.owner_id is null then
      if not (select public.is_admin()) then
        raise exception 'Only administrators may create canonical (owner_id IS NULL) Case Law records. Submit owner_id as your own profile to create a personal Case Law record instead.';
      end if;
    else
      new.owner_id := v_actor;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id then
      raise exception 'Case Law ownership is immutable: a canonical record cannot become personal, a personal record cannot become canonical, and personal ownership cannot be transferred, through UPDATE.';
    end if;

    -- 0162: who can see personal research, and its review status, are
    -- ownership decisions. An active EDIT share (can_edit_case_law, the
    -- UPDATE policy) may edit content only. auth.uid() IS NULL (service
    -- role / cron, which bypasses RLS anyway) is deliberately not blocked.
    if v_actor is not null
       and old.owner_id is not null
       and old.owner_id <> v_actor
       and (
         new.is_discoverable is distinct from old.is_discoverable
         or new.review_status is distinct from old.review_status
       )
    then
      raise exception 'Only the owner of this Case Law research may change its discoverability or review status.';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.case_law_ownership_guard() is
  'Case Law ownership guard (0035): canonical inserts are admin-only, personal inserts are stamped with the caller, owner_id is immutable. 0162: is_discoverable and review_status changes on a personal row raise unless auth.uid() is the owner (an edit-share recipient may edit content only). Service-role context (auth.uid() null) untouched.';

-- ==================== 1b. delete is the admin's (canonical) or the owner's (personal) ====================

drop policy "Admins delete canonical Case Law; owners delete their personal " on public.case_law;
create policy "Admins delete canonical Case Law; owners delete their personal "
  on public.case_law for delete
  to authenticated
  using (
    not (select public.is_clerk())
    and (
      (owner_id is null and (select public.is_admin()))
      or owner_id = (select auth.uid())
    )
  );

-- ==================== 2a. curator RPCs act on canonical rows only ====================
-- C-07: every RPC that changes a record's review state locks that record
-- row first, then its import_jobs row, so publish and reject serialise.

create or replace function public.set_case_law_review_status(p_case_law_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may change Case Law review status.';
  end if;

  if p_status not in ('draft', 'needs_review', 'ready') then
    raise exception 'set_case_law_review_status only accepts draft/needs_review/ready -- use publish_case_law_import or reject_case_law_import for other transitions.';
  end if;

  -- 0162: canonical rows only; a personal id is indistinguishable from a
  -- missing one (ADR 0007).
  select import_job_id into v_job_id
  from public.case_law
  where id = p_case_law_id and owner_id is null
  for update;

  if not found then
    raise exception 'Case Law record % not found.', p_case_law_id;
  end if;

  update public.case_law set review_status = p_status where id = p_case_law_id;

  -- import_jobs.status has no 'draft' value (0055) -- only sync the job
  -- when the target status exists in both vocabularies.
  if v_job_id is not null and p_status in ('needs_review', 'ready') then
    update public.import_jobs set status = p_status where id = v_job_id;
  end if;
end;
$$;

create or replace function public.apply_case_law_tags(p_case_law_id uuid, p_tag_names text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_tag_id uuid;
  v_final_ids uuid[] := '{}';
begin
  if not public.is_admin() then
    raise exception 'Only administrators may apply Case Law tags.';
  end if;

  -- 0162: canonical rows only (ADR 0007).
  if not exists (
    select 1 from public.case_law where id = p_case_law_id and owner_id is null
  ) then
    raise exception 'Case Law record % not found.', p_case_law_id;
  end if;

  foreach v_name in array coalesce(p_tag_names, '{}') loop
    v_name := trim(v_name);
    continue when v_name = '';

    select id into v_tag_id from public.tags where lower(name) = lower(v_name) limit 1;
    if v_tag_id is null then
      insert into public.tags (name, created_by) values (v_name, auth.uid())
      returning id into v_tag_id;
    end if;
    v_final_ids := array_append(v_final_ids, v_tag_id);
  end loop;

  delete from public.case_law_tags
  where case_law_id = p_case_law_id
    and not (tag_id = any (v_final_ids));

  insert into public.case_law_tags (case_law_id, tag_id)
  select p_case_law_id, t
  from unnest(v_final_ids) as t
  on conflict do nothing;
end;
$$;

-- Latest body: 0072. The canonical filter and the row lock are new.
create or replace function public.publish_case_law_import(p_case_law_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_case_name text;
  v_citation text;
  v_court text;
  v_jurisdiction text;
  v_court_id uuid;
  v_jurisdiction_id uuid;
  v_content_quality_status text;
  -- Mirrors the PLACEHOLDER_VALUES set in
  -- src/lib/publication-validation.ts -- keep both lists in sync.
  v_bad text[] := array[
    '', 'untitled', 'untitled (pending review)', 'unknown', 'tbd', 'n/a',
    'na', 'none', 'pending', 'pending review', 'coa', 'court', 'jurisdiction'
  ];
begin
  if not public.is_admin() then
    raise exception 'Only administrators may publish canonical Case Law.';
  end if;

  select import_job_id, case_name, citation, court, jurisdiction, court_id,
         jurisdiction_id, content_quality_status
    into v_job_id, v_case_name, v_citation, v_court, v_jurisdiction, v_court_id,
         v_jurisdiction_id, v_content_quality_status
    from public.case_law
    where id = p_case_law_id and owner_id is null
    for update;

  if not found then
    raise exception 'Case Law record % not found.', p_case_law_id;
  end if;

  if lower(trim(coalesce(v_case_name, ''))) = any(v_bad) then
    raise exception 'Cannot publish: Case name requires review.';
  end if;
  if lower(trim(coalesce(v_citation, ''))) = any(v_bad) then
    raise exception 'Cannot publish: Citation is missing.';
  end if;
  if v_jurisdiction_id is null or lower(trim(coalesce(v_jurisdiction, ''))) = any(v_bad) then
    raise exception 'Cannot publish: Jurisdiction is missing.';
  end if;
  if v_court_id is null or lower(trim(coalesce(v_court, ''))) = any(v_bad) then
    raise exception 'Cannot publish: Court is missing.';
  end if;
  if v_content_quality_status = 'failed' then
    raise exception 'Cannot publish: extracted text failed automated quality checks and requires correction before publish.';
  end if;

  update public.case_law set review_status = 'published' where id = p_case_law_id;

  if v_job_id is not null then
    update public.import_jobs set status = 'published', completed_at = now() where id = v_job_id;
  end if;
end;
$$;

-- Latest body: 0058. The canonical filter, the row lock and the
-- published refusal are new. The caller reads the attached documents'
-- file paths BEFORE this call and removes the Storage objects only after
-- it succeeds (use-case-law.ts), so a refused reject never deletes files.
create or replace function public.reject_case_law_import(p_case_law_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_review_status text;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may reject a Case Law draft.';
  end if;

  select import_job_id, review_status into v_job_id, v_review_status
  from public.case_law
  where id = p_case_law_id and owner_id is null
  for update;

  if not found then
    raise exception 'Case Law record % not found.', p_case_law_id;
  end if;

  if v_review_status = 'published' then
    raise exception 'This Case Law record has already been published, so it can no longer be rejected. Refresh the review queue.';
  end if;

  if v_job_id is not null then
    update public.import_jobs
    set status = 'failed',
        error_summary = coalesce(p_reason, 'Rejected by curator during review.'),
        target_case_law_id = null,
        completed_at = now()
    where id = v_job_id;
  end if;

  -- documents_parent_cascade_delete() (0055) removes any attached
  -- `documents` metadata rows on this DELETE; SQL cannot delete the
  -- Storage objects themselves.
  delete from public.case_law where id = p_case_law_id;
end;
$$;

-- ==================== 2b. case_law_tags follow their Case Law ====================

drop policy "Case law tags are viewable by all authenticated users" on public.case_law_tags;
create policy "Case law tags are viewable with their Case Law"
  on public.case_law_tags for select
  to authenticated
  using (public.can_view_case_law(case_law_id));

drop policy "Admins can tag case law" on public.case_law_tags;
create policy "Admins can tag canonical case law"
  on public.case_law_tags for insert
  to authenticated
  with check (
    (select public.is_admin())
    and exists (
      select 1 from public.case_law cl where cl.id = case_law_id and cl.owner_id is null
    )
  );

drop policy "Admins can untag case law" on public.case_law_tags;
create policy "Admins can untag canonical case law"
  on public.case_law_tags for delete
  to authenticated
  using (
    (select public.is_admin())
    and exists (
      select 1 from public.case_law cl where cl.id = case_law_id and cl.owner_id is null
    )
  );

-- ==================== 3. replacing an Act stays admin-only ====================

drop policy "Admins and magistrates can insert statutes" on public.statutes;
create policy "Admins and magistrates can insert statutes"
  on public.statutes for insert
  to authenticated
  with check (
    (select public.is_admin())
    or (
      (select public.is_magistrate())
      and created_by = (select auth.uid())
      and review_status = 'draft'
      and supersedes_statute_id is null
    )
  );

-- Latest body: 0114. The row lock, the document check and the
-- magistrate supersede refusal are new.
create or replace function public.finalize_legislation_document(
  p_statute_id uuid,
  p_document_id uuid,
  p_page_count integer default null,
  p_has_text_layer boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supersedes uuid;
  v_created_by uuid;
  v_review_status text;
begin
  select supersedes_statute_id, created_by, review_status
    into v_supersedes, v_created_by, v_review_status
  from public.statutes
  where id = p_statute_id
  for update;

  if not found then
    raise exception 'Legislation record % not found.', p_statute_id;
  end if;

  if (select public.is_admin()) then
    null;
  elsif (select public.is_magistrate())
    and v_created_by = (select auth.uid())
    and v_review_status = 'draft'
    and v_supersedes is null
  then
    null;
  else
    raise exception 'Only administrators may replace existing Legislation; magistrates may only publish a new Act they just created.';
  end if;

  if not exists (
    select 1 from public.documents d
    where d.id = p_document_id
      and d.entity_type = 'statute'
      and d.entity_id = p_statute_id
  ) then
    raise exception 'The Legislation file must be attached to this record before it can be published.';
  end if;

  if v_supersedes is not null then
    update public.statutes set is_current_version = false where id = v_supersedes;
  end if;

  update public.statutes
  set primary_document_id = p_document_id,
      page_count = p_page_count,
      has_text_layer = p_has_text_layer,
      review_status = 'published',
      is_current_version = true
  where id = p_statute_id;
end;
$$;

-- ==================== 4. audit_log keeps metadata only for private rows ====================
-- audit_trigger_fn() re-declared from its latest definition (0154). The
-- profiles branch and the insert tail are byte-for-byte the 0154 body.

create or replace function public.audit_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_keep text[];
  v_private boolean;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old);
  end if;

  -- 0162: private rows record an allowlist of metadata, never content.
  -- Titles, case names, case numbers, code words and file names are
  -- content (ADR 0007). A column added later stays out until listed here.
  if tg_table_name = 'judgments' then
    v_keep := array[
      'id', 'owner_id', 'status', 'is_discoverable', 'category_id',
      'finalized_at', 'finalized_by', 'created_at', 'updated_at'
    ];
  elsif tg_table_name = 'bench_notes' then
    v_keep := array[
      'id', 'author_id', 'status', 'is_private', 'entity_type', 'entity_id',
      'created_at', 'updated_at'
    ];
  elsif tg_table_name = 'quick_codes' then
    v_keep := array['id', 'owner_id', 'created_at', 'updated_at'];
  elsif tg_table_name = 'case_law_annotations' then
    v_keep := array['id', 'case_law_id', 'owner_id', 'created_at', 'updated_at'];
  elsif tg_table_name = 'docket_matter_parties' then
    v_old := v_old - 'contact_info';
    v_new := v_new - 'contact_info';
  elsif tg_table_name = 'case_law' then
    if coalesce(v_new ->> 'owner_id', v_old ->> 'owner_id') is not null then
      v_keep := array[
        'id', 'owner_id', 'created_by', 'is_discoverable', 'review_status',
        'content_quality_status', 'import_job_id', 'category_id',
        'created_at', 'updated_at'
      ];
    end if;
  elsif tg_table_name = 'documents' then
    -- Library files (statutes, canonical Case Law) and court files
    -- (docket matters, legacy cases) keep their file name; files on a
    -- private parent, on personal Case Law, or on nothing do not. A
    -- parent already deleted (the cascade from its DELETE) counts as
    -- private, failing closed.
    v_private := case coalesce(v_new ->> 'entity_type', v_old ->> 'entity_type')
      when 'statute' then false
      when 'docket_matter' then false
      when 'case' then false
      when 'case_law' then not exists (
        select 1 from public.case_law cl
        where cl.id = coalesce(v_new ->> 'entity_id', v_old ->> 'entity_id')::uuid
          and cl.owner_id is null
      )
      else true
    end;
    if v_private then
      v_keep := array[
        'id', 'uploaded_by', 'entity_type', 'entity_id', 'purpose', 'mime_type',
        'file_size', 'source_document_id', 'created_at'
      ];
    end if;
  end if;

  if v_keep is not null then
    v_old := (select jsonb_object_agg(e.key, e.value) from jsonb_each(v_old) e where e.key = any (v_keep));
    v_new := (select jsonb_object_agg(e.key, e.value) from jsonb_each(v_new) e where e.key = any (v_keep));
  end if;

  -- Privilege-only capture for profiles. The UPDATE trigger's WHEN
  -- clause already skips name/avatar noise; this slim object is what
  -- actually lands in audit_log so avatar_url never does.
  if tg_table_name = 'profiles' then
    if tg_op = 'DELETE' then
      v_old := jsonb_build_object(
        'id', old.id,
        'role', old.role,
        'is_active', old.is_active,
        'court_id', old.court_id,
        'email', old.email,
        'full_name', old.full_name
      );
    else
      if tg_op = 'UPDATE' then
        v_old := jsonb_build_object(
          'id', old.id,
          'role', old.role,
          'is_active', old.is_active,
          'court_id', old.court_id,
          'email', old.email,
          'full_name', old.full_name
        );
      end if;
      v_new := jsonb_build_object(
        'id', new.id,
        'role', new.role,
        'is_active', new.is_active,
        'court_id', new.court_id,
        'email', new.email,
        'full_name', new.full_name
      );
    end if;
  end if;

  if tg_op = 'INSERT' then
    insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
    values (auth.uid(), 'insert', tg_table_name, new.id, v_new);
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    values (auth.uid(), 'update', tg_table_name, new.id, v_old, v_new);
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (actor_id, action, table_name, record_id, old_data)
    values (auth.uid(), 'delete', tg_table_name, old.id, v_old);
    return old;
  end if;
  return null;
end;
$$;

comment on function public.audit_trigger_fn() is
  'Generic AFTER INSERT/UPDATE/DELETE audit trigger, SECURITY DEFINER, search_path pinned to public. 0113: profiles writes a slim privilege payload only. 0154: that payload also carries court_id. 0162: judgments, bench_notes, quick_codes, case_law_annotations, personal case_law and documents on private or personal parents record an allowlist of metadata only (no titles, names, case numbers or file names).';

-- ==================== 5. the global tag taxonomy is admin-curated ====================

drop policy "Authenticated users can create tags" on public.tags;
drop policy "Creators and admins can update tags" on public.tags;
drop policy "Creators and admins can delete tags" on public.tags;

create policy "Admins can create tags"
  on public.tags for insert
  to authenticated
  with check ((select public.is_admin()) and created_by = (select auth.uid()));

create policy "Admins can update tags"
  on public.tags for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins can delete tags"
  on public.tags for delete
  to authenticated
  using ((select public.is_admin()));

-- ==================== 6. legislation publish / reject serialise ====================
-- Latest bodies: 0072 (publish) and 0058 (reject). The row lock and the
-- published refusal are new.

create or replace function public.publish_legislation_import(p_statute_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_code text;
  v_title text;
  v_jurisdiction text;
  v_jurisdiction_id uuid;
  v_content_quality_status text;
  v_bad text[] := array[
    '', 'untitled', 'untitled (pending review)', 'unknown', 'tbd', 'n/a',
    'na', 'none', 'pending', 'pending review', 'coa', 'court', 'jurisdiction'
  ];
begin
  if not public.is_admin() then
    raise exception 'Only administrators may publish canonical Legislation.';
  end if;

  select import_job_id, code, title, jurisdiction, jurisdiction_id, content_quality_status
    into v_job_id, v_code, v_title, v_jurisdiction, v_jurisdiction_id, v_content_quality_status
    from public.statutes
    where id = p_statute_id
    for update;

  if not found then
    raise exception 'Legislation record % not found.', p_statute_id;
  end if;

  if lower(trim(coalesce(v_title, ''))) = any(v_bad) then
    raise exception 'Cannot publish: Title requires review.';
  end if;
  if lower(trim(coalesce(v_code, ''))) = any(v_bad) then
    raise exception 'Cannot publish: Code is missing.';
  end if;
  if v_jurisdiction_id is null or lower(trim(coalesce(v_jurisdiction, ''))) = any(v_bad) then
    raise exception 'Cannot publish: Jurisdiction is missing.';
  end if;
  if v_content_quality_status = 'failed' then
    raise exception 'Cannot publish: extracted text failed automated quality checks and requires correction before publish.';
  end if;

  update public.statutes set review_status = 'published' where id = p_statute_id;

  if v_job_id is not null then
    update public.import_jobs set status = 'published', completed_at = now() where id = v_job_id;
  end if;
end;
$$;

create or replace function public.reject_legislation_import(p_statute_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_review_status text;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may reject a Legislation draft.';
  end if;

  select import_job_id, review_status into v_job_id, v_review_status
  from public.statutes
  where id = p_statute_id
  for update;

  if not found then
    raise exception 'Legislation record % not found.', p_statute_id;
  end if;

  if v_review_status = 'published' then
    raise exception 'This Legislation record has already been published, so it can no longer be rejected. Refresh the review queue.';
  end if;

  if v_job_id is not null then
    update public.import_jobs
    set status = 'failed',
        error_summary = coalesce(p_reason, 'Rejected by curator during review.'),
        target_statute_id = null,
        completed_at = now()
    where id = v_job_id;
  end if;

  -- statute_provisions cascade-delete via their own FK (0055, on delete
  -- cascade); documents_parent_cascade_delete() (0058) removes any
  -- attached `documents` metadata rows.
  delete from public.statutes where id = p_statute_id;
end;
$$;

-- ==================== 7. unpublished canonical Case Law is the admin's ====================
-- Carries 0160's signed-in guard (auth.uid() is not null) and keeps anon
-- EXECUTE (0133: a policy-evaluated helper without it fails the query).

create or replace function public.can_view_case_law(p_case_law_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.case_law cl
    where cl.id = p_case_law_id
      and (select auth.uid()) is not null
      and not (select public.is_clerk())
      and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
      and (
        (cl.owner_id is null and (cl.review_status = 'published' or (select public.is_admin())))
        or cl.owner_id = (select auth.uid())
        or (cl.owner_id is not null and cl.is_discoverable = true)
        or public.has_item_share('case_law', p_case_law_id, 'view')
      )
  );
$$;

comment on function public.can_view_case_law(uuid) is
  'The Case Law read envelope for a signed-in, non-clerk caller (magistrates need an active court): published canonical rows (any review status for an admin), the caller''s own personal rows, discoverable personal rows, and rows shared with them. No admin read path into another user''s personal research (ADR 0007). 0160: false with no auth.uid(). 0162: unpublished canonical rows are admin-only again, as in 0058.';

-- Carries 0160's TO authenticated scoping.
drop policy "Canonical, own, and discoverable Case Law is viewable" on public.case_law;
create policy "Canonical, own, and discoverable Case Law is viewable"
  on public.case_law for select
  to authenticated
  using (
    not (select public.is_clerk())
    and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
    and (
      (owner_id is null and (review_status = 'published' or (select public.is_admin())))
      or owner_id = (select auth.uid())
      or (owner_id is not null and is_discoverable = true)
      or public.has_item_share('case_law', id, 'view')
    )
  );
