-- 0114_magistrate_legislation_create.sql
--
-- Magistrates (and admins) may publish a NEW Act from the Legislation
-- browse page: insert a draft, attach its PDF, and finalize. They still
-- cannot edit, replace, or delete an already-published library record
-- (that remains admin-only, matching /legislation/:id/edit).

-- Provenance: authenticated inserts always stamp created_by as the caller
-- so the magistrate-draft policies below can key off it. Service-role
-- inserts (auth.uid() null) keep whatever created_by they supplied.
create or replace function public.statutes_created_by_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and (select auth.uid()) is not null then
    new.created_by := (select auth.uid());
  elsif tg_op = 'UPDATE' and new.created_by is distinct from old.created_by then
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

drop trigger if exists statutes_created_by_guard on public.statutes;
create trigger statutes_created_by_guard
  before insert or update on public.statutes
  for each row execute function public.statutes_created_by_guard();

drop policy if exists "Admins can insert statutes" on public.statutes;
create policy "Admins and magistrates can insert statutes"
  on public.statutes for insert
  with check (
    (select public.is_admin())
    or (
      (select public.is_magistrate())
      and created_by = (select auth.uid())
      and review_status = 'draft'
    )
  );

drop policy if exists "Magistrates can delete own draft statutes" on public.statutes;
create policy "Magistrates can delete own draft statutes"
  on public.statutes for delete
  using (
    (select public.is_magistrate())
    and created_by = (select auth.uid())
    and review_status = 'draft'
  );

drop policy if exists "Users can attach documents to accessible parents" on public.documents;
create policy "Users can attach documents to accessible parents" on public.documents
  for insert with check (
    uploaded_by = (select auth.uid())
    and (
      entity_type is null
      or (entity_type = 'docket_matter' and public.can_edit_docket_matter(entity_id))
      or (entity_type = 'judgment' and public.can_edit_judgment(entity_id))
      or (entity_type = 'case_law' and public.can_edit_case_law(entity_id))
      or (entity_type = 'quick_code' and exists (
        select 1 from public.quick_codes qc where qc.id = documents.entity_id and qc.owner_id = (select auth.uid())
      ))
      or (entity_type = 'bench_note' and exists (
        select 1 from public.bench_notes bn where bn.id = documents.entity_id and bn.author_id = (select auth.uid())
      ))
      or (entity_type = 'case' and exists (
        select 1 from public.cases c
        where c.id = documents.entity_id and ((select public.is_admin()) or c.court_id = (select public.my_court_id()))
      ))
      or (
        entity_type = 'statute'
        and (
          (select public.is_admin())
          or exists (
            select 1 from public.statutes s
            where s.id = entity_id
              and s.review_status = 'draft'
              and s.created_by = (select auth.uid())
              and (select public.is_magistrate())
          )
        )
      )
    )
  );

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
  where id = p_statute_id;

  if not found then
    raise exception 'Legislation record % not found.', p_statute_id;
  end if;

  if (select public.is_admin()) then
    null;
  elsif (select public.is_magistrate())
    and v_created_by = (select auth.uid())
    and v_review_status = 'draft'
  then
    null;
  else
    raise exception 'Only administrators may replace existing Legislation; magistrates may only publish a new Act they just created.';
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

comment on function public.finalize_legislation_document(uuid, uuid, integer, boolean) is
  'File-first Legislation flow (0098/0099, magistrate create 0114): links the uploaded PDF as the canonical viewing document and publishes. Admins may finalize any row (including replacements). Magistrates may finalize only a draft they created. Does not touch import_jobs.';
