-- Extend the bench_notes polymorphic parent to support Legislation (statutes)
-- as a fourth associable entity type, per product requirement that a
-- magistrate be able to attach a private Bench Note to an Act.
--
-- RLS is unaffected: bench_notes RLS is strictly author-only
-- (author_id = auth.uid()) on all four commands, with no parent-access
-- cascade and no admin bypass. Bench Note privacy has never depended on
-- whether the author can see the referenced parent row, so widening the
-- set of referenceable parent types introduces no new access path into
-- private judicial work and no new admin visibility into it.

alter table public.bench_notes
  drop constraint bench_notes_entity_type_check;

alter table public.bench_notes
  add constraint bench_notes_entity_type_check
  check (entity_type in ('docket_matter', 'judgment', 'case_law', 'statute'));

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
