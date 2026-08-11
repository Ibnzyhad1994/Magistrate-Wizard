-- 0039_fix_bench_notes_entity_guard.sql
--
-- Forward-reconciliation repair. Does NOT edit 0038
-- (bench_notes_polymorphic_parent), which is already applied and
-- immutable per this project's standing rule -- this migration only
-- replaces the one function found defective during 0038's
-- verification battery.
--
-- DEFECT: bench_notes_entity_guard() (0038) ran its polymorphic
-- existence check on every INSERT OR UPDATE unconditionally, including
-- updates that never touched entity_type/entity_id. Once a note's
-- referenced parent was lawfully hard-deleted (the one live path being
-- an owner deleting their own personal case_law row), the trigger
-- re-checked the now-gone parent on the very next ordinary edit (e.g.
-- changing only the title) and rejected it. This contradicted the
-- already-resolved architecture: a Bench Note is independently owned
-- author work product that survives deletion of its referenced parent
-- and remains fully usable/editable by its author afterward, not just
-- readable.
--
-- FIX: existence validation now runs only when it is actually
-- establishing or changing the polymorphic reference --
--   * always on INSERT (a reference is always being established), or
--   * on UPDATE, only when entity_type or entity_id is actually
--     changing (new IS DISTINCT FROM old).
-- An ordinary UPDATE that leaves entity_type/entity_id untouched never
-- queries any parent table and never fails because a parent is gone.
-- A deliberate re-point (author changes entity_type and/or entity_id)
-- is still validated exactly as before -- the new target must exist at
-- that time, using the same three explicit, hardcoded branches
-- (docket_matter | judgment | case_law), no dynamic SQL.
--
-- Everything else about the function is unchanged: SECURITY DEFINER
-- (existence validation must not be filtered by the parent's own RLS,
-- for the same reason recorded in 0038 -- an author may reference a
-- parent they cannot currently SELECT), fixed search_path, author_id
-- forced on every INSERT/UPDATE (defense in depth alongside RLS WITH
-- CHECK; a no-op for UPDATE since RLS already restricts reachable rows
-- to author_id = auth.uid()), RETURNS TRIGGER (not a general-purpose
-- RPC -- Postgres refuses direct invocation regardless of EXECUTE
-- grants, confirmed live in the 0038 verification battery and
-- reconfirmed below), no is_admin()/Court/Docket/shares logic.
--
-- Bench Note RLS itself is untouched by this migration -- the four
-- author-only policies from 0038 are unaffected. search_bench_notes()
-- and user_can_access_bench_note() do not reference this trigger and
-- are unaffected.

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

comment on function public.bench_notes_entity_guard() is
  'BEFORE INSERT OR UPDATE on bench_notes. Forces author_id to the caller on every INSERT/UPDATE (defense in depth; a no-op on UPDATE since RLS already restricts reachable rows to the author). Validates entity_id exists in the table named by entity_type -- but ONLY on INSERT or when entity_type/entity_id is actually changing (fixed in 0039; the original 0038 version incorrectly re-validated on every UPDATE, blocking ordinary edits once a referenced parent was deleted). SECURITY DEFINER so the check is not filtered by the parent table''s own RLS (a note may legitimately reference a parent the author cannot currently see). RETURNS TRIGGER, not a general-purpose data-returning RPC -- Postgres refuses to invoke a trigger function via a direct SQL call regardless of EXECUTE grants. No dynamic SQL (strict IF/ELSIF over exactly the three CHECK-constrained entity types, fails closed for anything else), each type maps to exactly one hardcoded table, returns only NEW or raises an exception, never selects out parent content/ownership, never writes to the parent, no is_admin()/Court/Docket/shares logic anywhere in this function.';
