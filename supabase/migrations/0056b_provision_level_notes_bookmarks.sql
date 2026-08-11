-- Provision-level Bench Notes and Bookmarks: a magistrate should be able
-- to note/bookmark a SPECIFIC provision of an Act, not only the Act as a
-- whole (Legislation Ingestion Phase, Section 23).
--
-- Same pattern as 0054 (which added 'statute'): widen the entity_type
-- CHECK + guard-trigger branch for bench_notes; add a matching CASE
-- branch to validate_bookmark_entity() for bookmarks (existence-only
-- check, consistent with every other branch there). No RLS change on
-- either table -- bench_notes stays author-only, bookmarks stays
-- owner-only; provision-level rows are exactly as private as Act-level
-- ones already were.

alter table public.bench_notes
  drop constraint bench_notes_entity_type_check;
alter table public.bench_notes
  add constraint bench_notes_entity_type_check
  check (entity_type in ('docket_matter', 'judgment', 'case_law', 'statute', 'statute_provision'));

create or replace function public.bench_notes_entity_guard()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
declare
  v_exists boolean;
  v_reference_changed boolean;
begin
  new.author_id := auth.uid();

  v_reference_changed := (tg_op = 'INSERT')
    or (new.entity_type is distinct from old.entity_type)
    or (new.entity_id is distinct from old.entity_id);

  if v_reference_changed then
    if new.entity_type = 'docket_matter' then
      select exists(select 1 from public.docket_matters where id = new.entity_id) into v_exists;
    elsif new.entity_type = 'judgment' then
      select exists(select 1 from public.judgments where id = new.entity_id) into v_exists;
    elsif new.entity_type = 'case_law' then
      select exists(select 1 from public.case_law where id = new.entity_id) into v_exists;
    elsif new.entity_type = 'statute' then
      select exists(select 1 from public.statutes where id = new.entity_id) into v_exists;
    elsif new.entity_type = 'statute_provision' then
      select exists(select 1 from public.statute_provisions where id = new.entity_id) into v_exists;
    else
      v_exists := false;
    end if;

    if not v_exists then
      raise exception 'bench_notes.entity_id does not reference an existing % row', new.entity_type;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.validate_bookmark_entity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  case new.entity_type
    when 'case' then
      if not exists (select 1 from public.cases where id = new.entity_id) then
        raise exception 'bookmark references a case that does not exist: %', new.entity_id;
      end if;
    when 'bench_note' then
      if not exists (select 1 from public.bench_notes where id = new.entity_id) then
        raise exception 'bookmark references a bench note that does not exist: %', new.entity_id;
      end if;
    when 'statute' then
      if not exists (select 1 from public.statutes where id = new.entity_id) then
        raise exception 'bookmark references a statute that does not exist: %', new.entity_id;
      end if;
    when 'statute_provision' then
      if not exists (select 1 from public.statute_provisions where id = new.entity_id) then
        raise exception 'bookmark references a statute provision that does not exist: %', new.entity_id;
      end if;
    when 'case_law' then
      if not exists (select 1 from public.case_law where id = new.entity_id) then
        raise exception 'bookmark references a case law entry that does not exist: %', new.entity_id;
      end if;
    when 'docket_matter' then
      if not exists (select 1 from public.docket_matters where id = new.entity_id) then
        raise exception 'bookmark references a docket matter that does not exist or is not accessible: %', new.entity_id;
      end if;
    when 'judgment' then
      if not exists (select 1 from public.judgments where id = new.entity_id) then
        raise exception 'bookmark references a judgment that does not exist or is not accessible: %', new.entity_id;
      end if;
    when 'quick_code' then
      if not exists (select 1 from public.quick_codes where id = new.entity_id) then
        raise exception 'bookmark references a quick code that does not exist or is not accessible: %', new.entity_id;
      end if;
  end case;
  return new;
end;
$$;
