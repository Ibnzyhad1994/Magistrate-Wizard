-- 0038_bench_notes_polymorphic_parent.sql
--
-- Converts bench_notes from its legacy single-parent shape (case_id ->
-- the deprecated `cases` table) to a true polymorphic parent
-- (entity_type/entity_id), matching §1/§2 of the architecture spec:
-- "bench_notes many-1 polymorphic parent (docket_matters, case_law, or
-- judgments) via entity_type/entity_id".
--
-- bench_notes currently has zero rows and `cases` currently has zero
-- rows in this project (confirmed live before writing this migration),
-- so this is a pure schema change -- there is no data to backfill and
-- no risk of orphaning a real note.
--
-- RLS MODEL: corrected to match §8 exactly, which has been reaffirmed
-- twice already in this project: "private to author, full stop,
-- regardless of who can access the parent entity ... no admin clause,
-- no cascading from parent access." The CURRENT live policies do not
-- yet match this -- SELECT used the legacy user_can_access_bench_note()
-- helper (which also granted non-author Court-mates visibility when
-- is_private = false), and UPDATE/DELETE included an is_admin()
-- bypass. This migration corrects both to the resolved final model:
-- author_id = auth.uid() on all four commands, nothing else, no
-- exceptions. This is a deliberate, disclosed TIGHTENING of live
-- behavior (removing the Admin bypass, removing the is_private-gated
-- Court-mate visibility path), implementing a design decision already
-- recorded in §8 -- not a new decision made here.
--
-- is_private is left untouched (out of scope for a "polymorphic
-- parent" migration) but becomes fully inert -- no policy or function
-- on this table reads it anymore after this migration. Flagged in the
-- accompanying readiness report; not changed here.
--
-- POLYMORPHIC REFERENCE WITHOUT A SINGLE-TABLE FK: entity_id cannot
-- carry a normal foreign key, because it must reference rows across
-- three different tables (docket_matters, judgments, case_law)
-- depending on entity_type. The codebase already has one precedent for
-- this shape -- bookmarks.validate_bookmark_entity(), a plain
-- SECURITY INVOKER trigger that existence-checks against whichever
-- table entity_type names. bench_notes deliberately DIVERGES from that
-- precedent in one respect, for a disclosed reason:
--   * entity_type text, CHECK'd to the three allowed values.
--   * entity_id uuid, NOT NULL, no FK.
--   * A BEFORE INSERT OR UPDATE guard trigger
--     (bench_notes_entity_guard) validates entity_id exists in the
--     correct table for entity_type, raising an exception if not.
--   * Unlike validate_bookmark_entity(), this trigger is SECURITY
--     DEFINER. This is deliberate and necessary, not a convenience
--     shortcut: per §8, an author may attach a private note to a
--     parent they cannot currently see (e.g. another user's private
--     Case Law row, or a Docket Matter at a Court they no longer have
--     access to) -- the note stays private to them regardless. If the
--     existence check ran as SECURITY INVOKER, it would silently be
--     filtered by the parent table's own RLS, and a legitimate
--     reference to a real but currently-invisible-to-the-author row
--     would be wrongly rejected as "does not exist" -- an accidental
--     reintroduction of the parent-access cascade that §8 explicitly
--     rules out. Bookmarks does not need this divergence because
--     bookmark visibility itself follows the parent's access rules
--     (§3), so gating its existence check on parent RLS is correct
--     for bookmarks specifically. SECURITY DEFINER here returns
--     nothing but a pass/fail (via exception); no row content is ever
--     exposed by it, matching the project's existing narrow-
--     SECURITY-DEFINER precedent (is_admin(),
--     has_docket_matter_authority()).
--   * The same trigger also forces author_id := auth.uid() at INSERT,
--     matching the defense-in-depth guard-trigger convention used
--     everywhere else in this schema (docket_matters, docket_events,
--     judgments, quick_codes, etc.) -- RLS's WITH CHECK already
--     requires this; the trigger makes it non-bypassable. This is a
--     pattern-consistency addition, not a new semantic rule.
--
-- PARENT DELETION SURVIVAL (explicit, resolved decision -- not a
-- caveat): a Bench Note is independently owned personal judicial/
-- research work product. Deleting or removing its referenced parent
-- must NOT silently destroy the author's note. Therefore, by design:
--   * no CASCADE from any parent table to bench_notes;
--   * no RESTRICT trigger on any parent table blocking lawful parent
--     deletion merely because a Bench Note references it;
--   * no generic parent-delete trigger added here to simulate a
--     polymorphic FK;
--   * a Bench Note MAY retain an unresolved historical
--     (entity_type, entity_id) pair after its parent is gone --
--     entity_id is never automatically nulled;
--   * RLS continues to depend on author_id only, so an unresolved
--     parent does not make the Bench Note unreadable to its author;
--   * bench_notes_entity_guard() (below) validates existence only at
--     the moment a reference is established or changed (INSERT/
--     UPDATE) -- it is not, and must not become, a continuous
--     requirement for reading an already-existing Bench Note. Reading
--     a note never re-validates its parent.
--   * surfacing "this reference no longer resolves" is a future UI
--     concern, explicitly not built here.
-- No table in this schema currently allows hard-deleting
-- docket_matters/judgments; personal case_law rows are owner-
-- deletable (0031/0035) and are therefore the one live path to an
-- unresolved reference today -- expected and accepted per the above,
-- not a defect.
--
-- REQUIRED CONSEQUENTIAL FIXES (discovered while writing this
-- migration, not optional): dropping bench_notes.case_id would
-- silently break two existing functions that reference it at runtime
-- (Postgres does not track plain-function-to-column dependencies the
-- way it does for views, so DROP COLUMN would not itself error --
-- the break would only surface the next time each function is
-- called):
--   * user_can_access_bench_note(uuid) -- joined through case_id and
--     read is_private/is_admin()/my_court_id() to implement the OLD
--     Court-mate-visibility model. Corrected in this migration to the
--     resolved §8 model (author_id = auth.uid() only). Its signature
--     (uuid -> boolean) is unchanged, so every existing caller
--     (bench_note_tags, documents, comments, storage.objects RLS,
--     global_search()) keeps working unchanged and automatically
--     inherits the corrected, tighter behavior -- consistent with §3's
--     "documents/comments follow the parent entity's access rules."
--   * search_bench_notes(text, integer) -- returned n.case_id as a
--     table column. Recreated below returning entity_type/entity_id
--     instead. This is a return-shape change; safe today because no
--     frontend exists yet to consume it.
-- global_search() calls user_can_access_bench_note() only (no direct
-- case_id reference in its bench_note branch) and needs no edit.
-- validate_bookmark_entity() checks bench_notes existence by id only
-- and needs no edit.
--
-- RE-POINTING / MUTABILITY: the UPDATE policy below is author_id-gated
-- only, with no column-level restriction and no immutability guard
-- trigger (unlike, e.g., docket_matter_judgments' locked
-- docket_matter_id, or shares' revoked_at-only guard). This means an
-- author CAN currently change entity_type/entity_id on an existing
-- note via ordinary UPDATE, and bench_notes_entity_guard() re-validates
-- existence on every UPDATE, not just INSERT. This is the design as
-- approved in principle -- no new mutability rule is introduced here;
-- it is recorded explicitly so the behavior is verified against, not
-- assumed.
--
-- Explicitly NOT built in 0038: any change to documents (0039) or
-- bookmarks (0040), which have their own separate polymorphic
-- refactors; any change to is_private's meaning or removal; any
-- search/indexing change beyond carrying the existing search_vector
-- column forward unmodified; any change to the legacy `cases` table
-- itself (remains untouched, per the project's standing rule that it
-- is not built upon).

-- ===== Drop the legacy single-parent shape =====
drop policy "Users can view accessible bench notes" on public.bench_notes;
drop policy "Users can create their own bench notes" on public.bench_notes;
drop policy "Authors and admins can update bench notes" on public.bench_notes;
drop policy "Authors and admins can delete bench notes" on public.bench_notes;

alter table public.bench_notes drop constraint bench_notes_case_id_fkey;
drop index if exists public.bench_notes_case_id_idx;
alter table public.bench_notes drop column case_id;

-- ===== Add the polymorphic parent columns =====
alter table public.bench_notes
  add column entity_type text,
  add column entity_id uuid;

-- table has zero rows in this project today, so it is safe to move
-- straight to NOT NULL / CHECK without a backfill step.
alter table public.bench_notes
  alter column entity_type set not null,
  alter column entity_id set not null;

alter table public.bench_notes
  add constraint bench_notes_entity_type_check
    check (entity_type in ('docket_matter','judgment','case_law'));

comment on column public.bench_notes.entity_type is
  'Polymorphic parent discriminator -- docket_matter | judgment | case_law. No policy or function on this table reads it for access control; it exists purely to locate/organize notes, never to gate visibility (see §8 -- access is author_id = auth.uid() only, no parent-access cascade).';
comment on column public.bench_notes.entity_id is
  'Polymorphic parent id. No declarative FK is possible across three target tables; existence is enforced procedurally by bench_notes_entity_guard() below, which runs SECURITY DEFINER specifically so a note''s validity never depends on whether the author can currently see the parent row (see migration header).';

create index bench_notes_entity_idx on public.bench_notes (entity_type, entity_id);

-- is_private: retained, NOT removed in 0038. Formally deprecated --
-- legacy, inert under the new polymorphic-parent model, not consulted
-- by any RLS policy or function as of this migration, not an access
-- determinant, not part of the resolved architecture going forward.
-- Existing/future values must not be relied on to change visibility.
-- Physical removal is left to a dedicated future cleanup migration,
-- only once all dependent application code is confirmed migrated off
-- it (none exists yet).
comment on column public.bench_notes.is_private is
  'DEPRECATED as of 0038 -- legacy column, inert under the resolved §8 access model (author_id = auth.uid() only). No RLS policy or function on this table reads this column anymore. Retained for now rather than dropped; do not consult it for access control. Candidate for removal in a future dedicated cleanup migration once confirmed unused by application code.';

-- ===== Guard trigger: forces author_id, validates polymorphic existence =====
create or replace function public.bench_notes_entity_guard()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
declare
  v_exists boolean;
begin
  new.author_id := auth.uid();

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

  return new;
end;
$$;

comment on function public.bench_notes_entity_guard() is
  'BEFORE INSERT OR UPDATE on bench_notes. Forces author_id to the caller (defense in depth alongside RLS WITH CHECK). Validates entity_id exists in the table named by entity_type -- SECURITY DEFINER so the check is not filtered by the parent table''s own RLS (a note may legitimately reference a parent the author cannot currently see; see migration header for why this deliberately diverges from validate_bookmark_entity()''s SECURITY INVOKER approach). Security audit checklist (see 0038 migration header / architecture spec §16): RETURNS TRIGGER, not a general-purpose data-returning RPC -- Postgres refuses to invoke a trigger function via a direct SQL call regardless of EXECUTE grants ("trigger functions can only be called as triggers"), so anon/authenticated EXECUTE privilege on it (if granted by default) is not a usable direct-invocation path -- verified live in the 0038 verification battery. SECURITY DEFINER is used for existence validation only. Fixed search_path = public. No dynamic SQL / no table name built from unvalidated input -- entity_type is matched via a strict IF/ELSIF over exactly the three CHECK-constrained values, with an explicit ELSE branch that fails closed (false) for anything else, so no fourth/fabricated type can reach any table lookup. Each approved type maps to exactly one hardcoded, known table (docket_matters | judgments | case_law). Returns only NEW (the trigger row already supplied by the caller) or raises an exception -- never selects out or returns parent title, content, ownership, or any column beyond the (entity_type, entity_id) pair the caller already supplied. Never writes to the parent table. No is_admin() call anywhere in this function. No can_access_court()/has_retained_assignment()/has_docket_share() call anywhere in this function -- it answers existence only, never authority. No dependency on shares or any RLS-bearing table''s own policies, so it cannot participate in an RLS recursion cycle.';

create trigger bench_notes_entity_guard_trigger
  before insert or update on public.bench_notes
  for each row execute function public.bench_notes_entity_guard();

-- ===== RLS: author-only, no exceptions (§8) =====
create policy "Authors can view their own bench notes"
  on public.bench_notes for select
  using (author_id = (select auth.uid()));

create policy "Authors can create their own bench notes"
  on public.bench_notes for insert
  with check (author_id = (select auth.uid()));

create policy "Authors can update their own bench notes"
  on public.bench_notes for update
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

create policy "Authors can delete their own bench notes"
  on public.bench_notes for delete
  using (author_id = (select auth.uid()));

-- ===== Required consequential fix #1: user_can_access_bench_note() =====
-- Same signature/return type (uuid -> boolean), so CREATE OR REPLACE
-- is sufficient and every existing caller keeps working unchanged.
create or replace function public.user_can_access_bench_note(p_note_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.bench_notes n
    where n.id = p_note_id
      and n.author_id = auth.uid()
  );
$$;

comment on function public.user_can_access_bench_note(uuid) is
  'Corrected in 0038 to match the resolved §8 model: author_id = auth.uid() only, no is_admin() bypass, no is_private-gated Court-mate visibility (that path relied on the now-dropped case_id join). Signature unchanged so bench_note_tags/documents/comments/storage.objects RLS and global_search() all inherit the corrected behavior automatically.';

-- ===== Required consequential fix #2: search_bench_notes() =====
-- Return shape changes (case_id -> entity_type/entity_id), which
-- Postgres does not allow via CREATE OR REPLACE -- drop first.
drop function if exists public.search_bench_notes(text, integer);

create function public.search_bench_notes(p_query text, p_limit integer default 20)
returns table(id uuid, entity_type text, entity_id uuid, title text, rank real, headline text)
language sql
stable
set search_path = public
as $$
  select
    n.id, n.entity_type, n.entity_id, n.title,
    ts_rank(n.search_vector, websearch_to_tsquery('english', p_query)) as rank,
    ts_headline('english', coalesce(n.content_text, ''),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10') as headline
  from public.bench_notes n
  where n.search_vector @@ websearch_to_tsquery('english', p_query)
    and public.user_can_access_bench_note(n.id)
  order by rank desc
  limit p_limit;
$$;
