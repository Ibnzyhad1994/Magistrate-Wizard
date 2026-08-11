-- 0045_judgment_lifecycle_locking.sql
--
-- PURPOSE: introduce exactly two Judgment lifecycle states, draft and
-- final, with a field-level content lock while final. This is the
-- migration `0027_judgments` explicitly deferred ("NO draft/final
-- status, NO locking... all intentionally deferred to the dedicated
-- future judgment_lifecycle_locking migration"). Scope is deliberately
-- narrow, per explicit approved design: no archived/superseded/
-- corrigendum/version-number/amendment/publication states, no
-- versioning, no corrigendum table, no full audit history. Those
-- remain future work.
--
-- LIVE STATE CONFIRMED BEFORE WRITING THIS MIGRATION:
--   * public.judgments currently has 0 rows in production -- no
--     backfill classification decision is actually exercised, but
--     `status` still gets an explicit `not null default 'draft'` so
--     that decision is recorded in the schema itself, not left as an
--     accident of an empty table.
--   * `judgments_guard()` (BEFORE INSERT/UPDATE, SECURITY INVOKER)
--     already forces `owner_id` at INSERT and blocks `owner_id` UPDATE.
--     The new lifecycle trigger added here is independent of it (no
--     shared fields) and fires after it in trigger-name alphabetical
--     order (`judgments_guard_trigger` before
--     `judgments_lifecycle_guard_trigger`) -- ordering does not matter
--     since neither trigger inspects the fields the other maintains.
--   * `set_judgments_updated_at` (BEFORE UPDATE) is untouched and
--     independent.
--   * The existing owner-only UPDATE policy (`can_edit_judgment(id)` in
--     both USING and WITH CHECK) is left completely unmodified, per
--     explicit instruction -- ordinary UPDATE authorization stays
--     exactly as it is today. This migration adds a BEFORE INSERT OR
--     UPDATE trigger that narrows WHICH fields may actually change,
--     layered underneath that unchanged owner-only authorization, not a
--     replacement for it.
--   * `judgment_tags`, `docket_matter_judgments`, `quick_code_judgments`,
--     and `documents`' Judgment branch (SELECT/INSERT) all reference
--     only `can_view_judgment()`/`can_edit_judgment()` today -- neither
--     helper is modified by this migration (see below), so all four are
--     confirmed, by direct inspection, to require zero code changes.
--
-- WHY LIFECYCLE STATE STAYS OUT OF can_view_judgment()/can_edit_judgment()
-- (critical, per explicit instruction): those two helpers, introduced in
-- 0044, mean "does this caller have ownership/mutation authority over
-- this Judgment" -- a question that remains true for a final Judgment's
-- owner. Association tables (docket_matter_judgments, quick_code_-
-- judgments), judgment_tags, and documents all reuse can_edit_judgment()
-- for organizational actions (linking, tagging, attaching) that must
-- continue to work on a final Judgment -- finalization locks the
-- Judgment ROW's own substantive content, not the owner's ability to
-- organize/attach material around it. If `status = 'draft'` were folded
-- into can_edit_judgment() itself, every one of those consumers would
-- silently and incorrectly lose access the moment a Judgment is
-- finalized. Lifecycle enforcement therefore lives in exactly two
-- places instead: (1) a BEFORE INSERT OR UPDATE trigger on `judgments`
-- itself, narrowing which fields may change without altering who may
-- attempt the UPDATE, and (2) the `judgments` DELETE policy directly
-- (`can_edit_judgment(id) AND status = 'draft'`), which is Judgment-
-- table-specific and not shared with any other table, so adding the
-- status check there cannot leak into association/tag/document policies
-- the way modifying the shared helper would have.
--
-- WHY A TRIGGER, NOT A NARROWED UPDATE POLICY (per explicit instruction):
-- naively changing the UPDATE policy to require `status = 'draft'`
-- would incorrectly block the two explicitly-approved final-state
-- actions -- toggling is_discoverable and unlocking (final -> draft)
-- both require UPDATE while status is CURRENTLY 'final', which a bare
-- `USING/WITH CHECK (status = 'draft')` predicate would reject outright
-- regardless of which fields actually changed. A row-level BEFORE
-- trigger, which can compare OLD and NEW field-by-field, is the only
-- mechanism available that can permit "is_discoverable changed, nothing
-- substantive did" and "status went final -> draft, nothing substantive
-- also changed" while rejecting every other final-state mutation.
--
-- ATOMIC BYPASS PREVENTION: a client could otherwise attempt to combine
-- unlock (final -> draft) and a substantive edit in one UPDATE
-- statement, defeating the lock in a single round-trip. The trigger
-- explicitly detects this (OLD.status = 'final' AND NEW.status =
-- 'draft' AND any substantive field differs) and rejects the entire
-- statement -- unlock must be its own, separate UPDATE, with substantive
-- edits only permitted in a subsequent statement once the row is
-- already back in 'draft'.
--
-- INSERT-TIME CLOSURE (a gap not explicitly named in the approved
-- design but required by its own stated threat model, "client sets
-- status='final' and forges finalized_by"): without INSERT-time
-- handling, a client could INSERT a brand-new Judgment with
-- `status='final'` and arbitrary `finalized_at`/`finalized_by` values
-- directly, bypassing the UPDATE-path provenance forcing entirely,
-- since finalization is defined throughout this design as a deliberate
-- draft -> final UPDATE transition, never a creation-time state. The
-- same trigger is therefore also attached to BEFORE INSERT and forces
-- `status := 'draft'`, `finalized_at := null`, `finalized_by := null`
-- on every INSERT regardless of client payload -- a Judgment can never
-- be born already-finalized.
--
-- PROVENANCE FIELDS ARE MOST-RECENT-ONLY, NOT A HISTORY (per explicit
-- instruction): `finalized_at`/`finalized_by` are overwritten on every
-- draft -> final transition and deliberately preserved (never nulled)
-- across an unlock. They answer "when/by whom was this Judgment most
-- recently finalized," not "every time this Judgment changed lifecycle
-- state." A full lifecycle history/audit trail is explicitly out of
-- scope here and remains the responsibility of the later, dedicated
-- audit migration.
--
-- FK NOTE, FLAGGED PER INSTRUCTION: `finalized_by references profiles
-- (id) on delete set null` is the preferred design and is implemented
-- exactly as specified. However, live inspection shows `owner_id`
-- already carries `on delete restrict` on this same table, and under
-- the owner-only finalization rule enforced here, `finalized_by` can
-- only ever equal `owner_id` (only the owner can ever finalize their
-- own Judgment) -- there is no code path in this migration that lets
-- them diverge. Consequently `finalized_by`'s `ON DELETE SET NULL`
-- branch is presently unreachable in practice: any attempt to delete a
-- profile that owns a finalized Judgment is already blocked by
-- `owner_id`'s `ON DELETE RESTRICT` on the very same row before
-- `finalized_by`'s `SET NULL` could ever fire. This is not a conflict
-- and nothing here needs to change -- `finalized_by` is specified
-- exactly as instructed, and the `SET NULL` clause is simply dormant
-- until some future design (e.g. ownership transfer) could ever let
-- `finalized_by` diverge from `owner_id`. Recorded here as instructed,
-- not treated as a defect.
--
-- INDEXES: no index is added on `status` -- two-value low-cardinality
-- column, no concrete query pattern justifies one yet, per explicit
-- instruction not to index merely because the column exists. An index
-- IS added on `finalized_by` (a new FK column) to preempt the exact
-- `unindexed_foreign_keys` advisory finding already seen elsewhere in
-- this schema (e.g. `shares.item_id`) -- a simple, justified,
-- FK-covering index, matching the precedent already set by
-- `judgments_owner_id_idx`.

alter table public.judgments
  add column status text not null default 'draft'
    constraint judgments_status_check check (status in ('draft', 'final')),
  add column finalized_at timestamptz,
  add column finalized_by uuid references public.profiles(id) on delete set null;

create index judgments_finalized_by_idx on public.judgments using btree (finalized_by);

comment on column public.judgments.status is
  'Judgment lifecycle state: draft (default) or final. Draft is fully editable by the owner (title/case_number/court_name/judgment_date/citation/content/content_text), including hard DELETE. Final locks those seven substantive fields and blocks hard DELETE, but is_discoverable remains owner-toggleable in both states and the owner may always unlock (final -> draft). Enforced by protect_judgment_lifecycle() (BEFORE INSERT OR UPDATE) and this table''s DELETE policy -- deliberately NOT folded into can_view_judgment()/can_edit_judgment(), which remain pure ownership/mutation-authority checks reused by association, tag, and document policies that must keep working on a final Judgment.';

comment on column public.judgments.finalized_at is
  'Timestamp of the most recent draft -> final transition only -- not a full lifecycle history. Force-set by protect_judgment_lifecycle(); client-supplied values are always overwritten/ignored. Preserved (never nulled) across an unlock (final -> draft). Overwritten on re-finalization. NULL for a Judgment that has never been finalized.';

comment on column public.judgments.finalized_by is
  'Owner profile that performed the most recent draft -> final transition only -- not a full lifecycle history. Force-set to auth.uid() by protect_judgment_lifecycle(); client-supplied values are always overwritten/ignored. Always equal to owner_id today, since finalization is owner-only with no admin/Court/Docket/share bypass and ownership is immutable -- see the FK note above regarding ON DELETE SET NULL currently being unreachable given owner_id''s existing ON DELETE RESTRICT.';

create or replace function public.protect_judgment_lifecycle()
returns trigger
language plpgsql
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
  'BEFORE INSERT OR UPDATE trigger on judgments. Supplies lifecycle STATE-MACHINE protection only -- WHO may attempt an UPDATE/INSERT remains governed entirely by the existing, unmodified owner-only judgments RLS (can_edit_judgment()); this trigger never checks auth.uid() for authorization, only for forcing finalized_by provenance. On INSERT: forces status=''draft'', finalized_at=NULL, finalized_by=NULL regardless of client payload -- a Judgment cannot be created already-finalized. On UPDATE: draft->final forces finalized_at=now()/finalized_by=auth.uid() (provenance cannot be forged) and permits any other concurrent authorized edit; final->draft (unlock) is permitted only as the SOLE substantive change in the statement and preserves historical finalized_at/finalized_by; final->final permits only is_discoverable (and DB-maintained columns) to change, rejecting any of the seven substantive fields (title/case_number/court_name/judgment_date/citation/content/content_text); draft->draft (ordinary edit) is unrestricted but still prevents forging finalized_at/finalized_by. No is_admin() bypass anywhere in this function.';

drop trigger if exists judgments_lifecycle_guard_trigger on public.judgments;
create trigger judgments_lifecycle_guard_trigger
  before insert or update on public.judgments
  for each row execute function public.protect_judgment_lifecycle();

-- ==================== DELETE policy: draft-only hard delete ====================
-- Judgment-table-specific change, deliberately NOT routed through
-- can_edit_judgment() (see header) -- ownership authorization is
-- unchanged; the lifecycle restriction is added directly to this one
-- policy, which nothing else shares.

drop policy "Owners can delete Judgments" on public.judgments;
create policy "Owners can delete Judgments"
  on public.judgments for delete
  using (public.can_edit_judgment(id) and status = 'draft');

-- ==================== Explicitly NOT touched in 0045 ====================
-- can_view_judgment(), can_edit_judgment() -- unmodified (see header).
-- judgments' own SELECT/INSERT/UPDATE policies -- unmodified.
-- judgment_tags, docket_matter_judgments, quick_code_judgments,
--   documents -- zero policy changes; all confirmed live to reference
--   only can_view_judgment()/can_edit_judgment(), neither of which
--   changed.
-- No archived/superseded/corrigendum/version/amendment/publication
--   state. No corrigendum table, amendment entity, version history,
--   superseding-Judgment chain. No full audit/lifecycle-history table.
--   No is_admin() introduced into Judgment lifecycle logic anywhere.
