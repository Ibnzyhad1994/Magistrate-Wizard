-- 0046_fix_judgment_lifecycle_search_path.sql
--
-- PURPOSE: minimal forward-only repair. `protect_judgment_lifecycle()`
-- (introduced in the immediately preceding, already-applied
-- `0045_judgment_lifecycle_locking.sql`) was found live, via the
-- security advisor, to lack an explicit `SET search_path` pin
-- (`function_search_path_mutable`, WARN) -- inconsistent with every
-- sibling guard trigger in this codebase (`judgments_guard()`,
-- `docket_matters_guard()`, `quick_codes_guard()`, `shares_guard()`,
-- `set_updated_at()` all pin `search_path=public`; confirmed live via
-- `pg_proc.proconfig` before writing this migration). This is a genuine
-- oversight in 0045, not an accepted pre-existing gap like
-- `validate_bookmark_entity()`'s (which remains untouched here, per
-- "no unrelated cleanup").
--
-- This migration does NOT edit or reapply 0045 -- per this project's
-- standing rule, an already-applied migration is never edited.
-- Reconciliation is forward-only: this is a new migration that
-- `CREATE OR REPLACE FUNCTION`s the exact same function, with the
-- identical PL/pgSQL body captured live from the applied 0045 function
-- (`pg_proc.prosrc`, confirmed character-for-character below), and adds
-- exactly one thing: `set search_path = public`.
--
-- The trigger itself (`judgments_lifecycle_guard_trigger`, its name,
-- its BEFORE INSERT OR UPDATE timing/events, and its attachment to
-- `judgments`) is NOT recreated or touched -- `CREATE OR REPLACE
-- FUNCTION` on the function body alone is sufficient; a trigger bound
-- to a function by name automatically picks up a replaced function
-- definition with no need to re-run `CREATE TRIGGER`. No Judgment
-- columns, no RLS policies (including the 0045 DELETE policy), no 0044
-- helpers, no judgment_tags/association/documents policies are touched.
--
-- SEMANTIC IDENTITY: the function body below is byte-for-byte the same
-- control flow as the live, applied 0045 version -- INSERT forces
-- status='draft'/finalized_at=NULL/finalized_by=NULL; draft->final
-- forces finalized_at=now()/finalized_by=auth.uid(); final->draft
-- (unlock) is permitted only as the sole substantive change and
-- preserves finalized_at/finalized_by; final->final permits only
-- is_discoverable (and DB-maintained columns) to change, rejecting the
-- seven substantive fields; draft->draft preserves finalized_at/
-- finalized_by against forging. Zero logic changes. The only DDL-level
-- difference is the addition of `set search_path = public` to the
-- function definition itself.

create or replace function public.protect_judgment_lifecycle()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- A Judgment can never be created already-finalized; finalization is
    -- always a deliberate draft -> final UPDATE, never bundled into
    -- creation. Force safe defaults regardless of client payload.
    new.status := 'draft';
    new.finalized_at := null;
    new.finalized_by := null;
    return new;
  end if;

  -- tg_op = 'UPDATE' from here on.

  if old.status = 'draft' and new.status = 'final' then
    -- Finalizing now. Force provenance; never trust client-supplied
    -- finalized_at/finalized_by. All other field changes in this same
    -- statement are permitted -- OLD.status was 'draft', where normal
    -- authorized edits are unrestricted.
    new.finalized_at := now();
    new.finalized_by := (select auth.uid());
    return new;
  end if;

  if old.status = 'final' then
    if new.status = 'draft' then
      -- Unlocking. Must be the ONLY substantive change in this
      -- statement -- prevents a client from combining unlock+edit to
      -- bypass the final lock atomically.
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
      -- Unlocking must not erase the most-recent finalization record.
      new.finalized_at := old.finalized_at;
      new.finalized_by := old.finalized_by;
      return new;
    elsif new.status = 'final' then
      -- Staying final. Only is_discoverable (and ordinary DB-maintained
      -- bookkeeping such as updated_at, handled by a separate trigger)
      -- may change; the seven substantive fields remain locked.
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
      -- Do not let a client forge new finalization provenance merely by
      -- toggling is_discoverable (or resubmitting status='final') on an
      -- already-final Judgment.
      new.finalized_at := old.finalized_at;
      new.finalized_by := old.finalized_by;
      return new;
    else
      raise exception 'Invalid Judgment status transition.';
    end if;
  end if;

  -- OLD.status = 'draft' and NEW.status = 'draft': ordinary draft edit.
  -- Prevent a client from forging finalization provenance on an edit
  -- that never actually finalizes anything.
  new.finalized_at := old.finalized_at;
  new.finalized_by := old.finalized_by;
  return new;
end;
$$;

comment on function public.protect_judgment_lifecycle() is
  'BEFORE INSERT OR UPDATE trigger on judgments. Supplies lifecycle STATE-MACHINE protection only -- WHO may attempt an UPDATE/INSERT remains governed entirely by the existing, unmodified owner-only judgments RLS (can_edit_judgment()); this trigger never checks auth.uid() for authorization, only for forcing finalized_by provenance. On INSERT: forces status=''draft'', finalized_at=NULL, finalized_by=NULL regardless of client payload -- a Judgment cannot be created already-finalized. On UPDATE: draft->final forces finalized_at=now()/finalized_by=auth.uid() (provenance cannot be forged) and permits any other concurrent authorized edit; final->draft (unlock) is permitted only as the SOLE substantive change in the statement and preserves historical finalized_at/finalized_by; final->final permits only is_discoverable (and DB-maintained columns) to change, rejecting any of the seven substantive fields (title/case_number/court_name/judgment_date/citation/content/content_text); draft->draft (ordinary edit) is unrestricted but still prevents forging finalized_at/finalized_by. No is_admin() bypass anywhere in this function. search_path fixed to public as of 0046 (fixes function_search_path_mutable advisory WARN present since 0045; no behavioral change).';
