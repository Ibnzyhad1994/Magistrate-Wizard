-- 0040_documents_polymorphic_refactor.sql
--
-- Converts documents from its legacy two-nullable-FK-column shape
-- (case_id -> the deprecated `cases` table, bench_note_id -> bench_notes)
-- to a true polymorphic parent (entity_type/entity_id), matching §1/§2
-- of the architecture spec: "documents many-1 polymorphic parent
-- (docket_matters, judgments, case_law, quick_codes, bench_notes, or
-- legacy cases) via entity_type/entity_id". documents currently has
-- zero live rows in this project, so this is a pure schema change --
-- no data to backfill, no orphan risk.
--
-- ACCESS MODEL: unlike bench_notes (0038/0039), which is
-- unconditionally private to its author regardless of parent
-- visibility, documents' resolved rule (§3) is "follows the parent
-- entity's access rules" -- if you cannot see the parent, you should
-- not be able to see a document attached to it (excepting the
-- uploader, who can always see/manage their own upload). For SELECT,
-- this means a plain, SECURITY-INVOKER nested EXISTS against each
-- target table, evaluated under the caller's own RLS, exactly the
-- "plain nested-RLS pattern" already established and preferred
-- elsewhere in this project (0029 docket_matter_judgments' Judgment
-- side, 0030/0034 Case-Law associations) over a "decorated EXISTS"
-- that duplicates a parent's predicate inline. Because of this, no
-- SECURITY DEFINER guard trigger is needed here (a deliberate,
-- disclosed divergence from bench_notes' design, for the opposite
-- reason: bench_notes needed to bypass parent RLS, documents needs to
-- respect it exactly). documents also has no UPDATE policy today and
-- none is added here, so the "over-validation on unrelated UPDATE"
-- defect fixed in 0039 has no equivalent surface here.
--
-- READ vs WRITE ARE NOT THE SAME CHECK. Parent READ/visibility access
-- must not be assumed to also confer permission to attach a document
-- to that parent. INSERT (attach) therefore dispatches on a separate,
-- narrower WRITE predicate per type -- each one copied from that
-- parent's own mutation-authority policy (its UPDATE policy, or its
-- INSERT/ownership policy where there is no broader UPDATE tier),
-- NOT its SELECT policy:
--   * docket_matter -- docket_matters' own UPDATE policy:
--     can_access_court(court_id) OR has_retained_assignment(id) OR
--     has_docket_share(id, 'edit'). (Its SELECT policy additionally
--     allows has_docket_share(id, 'view') -- a view-only Docket share
--     can see a Docket Matter's documents but not attach new ones.)
--   * judgment -- judgments' own INSERT/UPDATE policy: owner_id =
--     auth.uid() only. (Its SELECT policy additionally allows
--     is_discoverable = true -- a discoverable reader who is not the
--     owner can see attached documents but not attach new ones.)
--   * case_law -- case_law's own INSERT/UPDATE policy: (owner_id IS
--     NULL AND is_admin()) OR owner_id = auth.uid(). (Its SELECT
--     policy additionally allows is_discoverable = true and always
--     allows owner_id IS NULL to any reader -- a canonical-Case-Law
--     reader who is not an admin, or a discoverable-reader who is not
--     the owner, can see attached documents but not attach new ones.)
--   * quick_code -- quick_codes' own INSERT/UPDATE policy: owner_id =
--     auth.uid(). Identical to its SELECT policy -- Quick Codes have
--     no discoverability tier, so read and write coincide here.
--   * bench_note -- bench_notes' own INSERT/UPDATE policy: author_id =
--     auth.uid(). Identical to its SELECT policy -- Bench Notes are
--     author-only for everything (0038/0039), so read and write
--     coincide here too.
--   * case (legacy) -- cases' own UPDATE policy: is_admin() OR
--     court_id = my_court_id(). This happens to be textually identical
--     to cases' SELECT policy today, but is written out explicitly as
--     its own WRITE branch (not a plain nested EXISTS) so that it does
--     not silently start tracking a future, broader `cases` SELECT
--     policy if one is ever added.
-- Because the WRITE branches duplicate each parent's predicate inline
-- rather than delegating to it via plain nested EXISTS, they are
-- "decorated EXISTS" in this project's established terminology (see
-- 0037's docket_events/docket_matter_parties/docket_matter_tags) --
-- if any of the six parents' own mutation-authority policy is ever
-- altered, this migration's INSERT policy on documents must be updated
-- to match via its own forward-reconciliation migration; it will not
-- auto-inherit the change the way the SELECT policy's plain nested
-- EXISTS does.
--
-- uploaded_by enforcement is left exactly as the original 0007 design
-- has it -- RLS WITH CHECK only (uploaded_by = auth.uid()), no
-- trigger. 0007 never had a provenance-forcing trigger for this table
-- and introducing one is out of scope for a "polymorphic parent"
-- migration.
--
-- STANDALONE DOCUMENTS PRESERVED: the original design allows a
-- document with no parent at all (case_id and bench_note_id both
-- null). entity_type/entity_id are therefore both left NULLable (not
-- NOT NULL, unlike bench_notes) with a CHECK enforcing "both null or
-- both set" -- exactly the same shape as the original
-- documents_parent_check, just generalized from two named columns to
-- one discriminated pair.
--
-- SIX APPROVED TYPES (from §2, already resolved -- not decided here):
-- docket_matter | judgment | case_law | quick_code | bench_note |
-- case. 'case' (the deprecated `cases` table) is deliberately included
-- because §2 explicitly names "legacy cases" as one of the six
-- polymorphic targets and `cases` retains real RLS -- see below.
--
-- REQUIRED CONSEQUENTIAL FIX (found by inspection before writing this
-- migration, mirroring the 0038 lesson of checking every live
-- reference first): storage.objects has one policy
-- ("Users can read documents they have access to") that reads
-- documents.case_id/documents.bench_note_id directly, inline, not
-- through a wrapper function. It is rewritten below using the same
-- six-branch nested-EXISTS dispatch. user_can_access_case() and
-- user_can_access_bench_note() are NOT modified or dropped -- they
-- remain in active use by bench_note_tags, comments, and (the case
-- helper) other case-scoped policies; this migration simply stops
-- calling them from documents/storage.objects, in favor of direct
-- nested EXISTS against each of the six target tables.
--
-- PARENT-DELETION LIFECYCLE (Part D, resolved by explicit user
-- decision after this migration's Part A dependency inventory
-- surfaced a fact that changes its scope): documents_case_id_fkey and
-- documents_bench_note_id_fkey are both, today, ON DELETE CASCADE --
-- not plain FKs. Deleting a `cases` row or a `bench_notes` row today
-- automatically deletes its attached documents rows. Unlike
-- bench_notes (0038/0039), where the polymorphic parent reference is
-- independent work product that deliberately SURVIVES deletion of its
-- referenced parent, the resolved rule for documents is the opposite:
-- a Document is an attachment, not independent work product, and its
-- metadata row follows its parent's lifecycle -- it must be deleted
-- when its parent is deleted, for all six approved types (extending
-- the two that already had real-FK CASCADE to the four that never
-- had a parent column of their own before this migration). Standalone
-- Documents (entity_type/entity_id both NULL) are unaffected. Storage
-- blobs are explicitly NOT deleted by this migration (they already
-- survive parent/document-row deletion today -- no existing trigger
-- removes them); physical blob cleanup is deferred to a later
-- storage-lifecycle migration (currently
-- 0047_storage_policy_updates.sql under the renumbered §16 sequence).
-- Because entity_id cannot carry a declarative FK across six target
-- tables, this cascade is reproduced below with a single reusable
-- SECURITY DEFINER AFTER DELETE trigger function installed on all six
-- parent tables -- see the dedicated section near the end of this
-- file for the full design rationale.
--
-- Explicitly NOT built in 0040: any change to bookmarks (0041, its own
-- separate polymorphic extension); any UPDATE policy for documents
-- (none exists today); any change to the `comments`/`bench_note_tags`
-- tables or their use of user_can_access_case()/
-- user_can_access_bench_note() (untouched, still needed elsewhere);
-- any change to the legacy `cases` table itself; any storage.objects
-- blob cleanup (deferred, see above).

-- ===== Drop the legacy two-column shape =====
-- All three dependent policies (both on documents AND the
-- storage.objects read policy) must be dropped BEFORE the columns are
-- dropped -- confirmed live via the Part I rollback-only DDL pre-test,
-- which failed with "cannot drop column case_id ... policy Users can
-- read documents they have access to on table storage.objects depends
-- on column case_id of table documents" until this ordering was fixed.
-- This is a genuine, tracked DDL dependency (unlike a plpgsql function
-- body's reference to a column, which is NOT tracked -- see 0038/0040
-- notes elsewhere on that distinction): Postgres records a real
-- dependency from a policy's USING/WITH CHECK expression onto every
-- column it names.
drop policy "Users can view documents they have access to" on public.documents;
drop policy "Users can attach documents to accessible parents" on public.documents;
drop policy "Users can read documents they have access to" on storage.objects;

alter table public.documents drop constraint documents_parent_check;
alter table public.documents drop constraint documents_case_id_fkey;
alter table public.documents drop constraint documents_bench_note_id_fkey;
drop index if exists public.documents_case_id_idx;
drop index if exists public.documents_bench_note_id_idx;
alter table public.documents drop column case_id;
alter table public.documents drop column bench_note_id;

-- ===== Add the polymorphic parent columns =====
alter table public.documents
  add column entity_type text,
  add column entity_id uuid;

alter table public.documents
  add constraint documents_entity_type_check
    check (entity_type is null or entity_type in
      ('docket_matter','judgment','case_law','quick_code','bench_note','case'));

alter table public.documents
  add constraint documents_entity_pair_check
    check ((entity_type is null and entity_id is null)
        or (entity_type is not null and entity_id is not null));

comment on column public.documents.entity_type is
  'Polymorphic parent discriminator -- docket_matter | judgment | case_law | quick_code | bench_note | case (legacy), or NULL for a standalone document (preserved from the original case_id/bench_note_id-both-null design). Access dispatches to whichever target table entity_type names, via SECURITY-INVOKER nested EXISTS in this table''s own RLS -- if the caller cannot SELECT the parent, they cannot see or attach a document to it, matching §3''s "documents follows the parent entity''s access rules."';
comment on column public.documents.entity_id is
  'Polymorphic parent id. No declarative FK is possible across six target tables; unlike bench_notes (0038/0039), no separate existence-validation trigger is needed here, because the RLS access check and the existence check are the same nested-EXISTS query -- a document referencing a real-but-invisible-to-the-caller parent is correctly rejected as if the parent did not exist, which is the intended behavior for this table (see migration header).';

create index documents_entity_idx on public.documents (entity_type, entity_id);

-- ===== RLS: uploader OR parent-access, dispatched by entity_type =====
create policy "Users can view documents they have access to"
  on public.documents for select
  using (
    uploaded_by = (select auth.uid())
    or (entity_type = 'docket_matter' and exists (select 1 from public.docket_matters dm where dm.id = documents.entity_id))
    or (entity_type = 'judgment' and exists (select 1 from public.judgments j where j.id = documents.entity_id))
    or (entity_type = 'case_law' and exists (select 1 from public.case_law cl where cl.id = documents.entity_id))
    or (entity_type = 'quick_code' and exists (select 1 from public.quick_codes qc where qc.id = documents.entity_id))
    or (entity_type = 'bench_note' and exists (select 1 from public.bench_notes bn where bn.id = documents.entity_id))
    or (entity_type = 'case' and exists (select 1 from public.cases c where c.id = documents.entity_id))
  );

-- WRITE-level dispatch (attach authority) -- deliberately narrower
-- than, and NOT delegated from, the SELECT policy above. See the
-- "READ vs WRITE ARE NOT THE SAME CHECK" note in the migration header
-- for the source of each branch.
create policy "Users can attach documents to accessible parents"
  on public.documents for insert
  with check (
    uploaded_by = (select auth.uid())
    and (
      entity_type is null
      or (entity_type = 'docket_matter' and exists (
            select 1 from public.docket_matters dm
            where dm.id = documents.entity_id
              and (
                (select can_access_court(dm.court_id))
                or (select has_retained_assignment(dm.id))
                or (select has_docket_share(dm.id, 'edit'))
              )
          ))
      or (entity_type = 'judgment' and exists (
            select 1 from public.judgments j
            where j.id = documents.entity_id
              and j.owner_id = (select auth.uid())
          ))
      or (entity_type = 'case_law' and exists (
            select 1 from public.case_law cl
            where cl.id = documents.entity_id
              and (
                (cl.owner_id is null and (select is_admin()))
                or cl.owner_id = (select auth.uid())
              )
          ))
      or (entity_type = 'quick_code' and exists (
            select 1 from public.quick_codes qc
            where qc.id = documents.entity_id
              and qc.owner_id = (select auth.uid())
          ))
      or (entity_type = 'bench_note' and exists (
            select 1 from public.bench_notes bn
            where bn.id = documents.entity_id
              and bn.author_id = (select auth.uid())
          ))
      or (entity_type = 'case' and exists (
            select 1 from public.cases c
            where c.id = documents.entity_id
              and ((select is_admin()) or c.court_id = (select my_court_id()))
          ))
    )
  );

-- "Uploaders and admins can delete documents" is untouched -- it never
-- referenced case_id/bench_note_id and needs no change.

-- ===== Required consequential fix: storage.objects read policy =====
-- (already dropped above, alongside the two documents policies, before
-- the case_id/bench_note_id columns were dropped -- see the dependency
-- note in the migration header.)
create policy "Users can read documents they have access to"
  on storage.objects for select
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.documents d
      where d.file_path = objects.name
        and (
          d.uploaded_by = (select auth.uid())
          or (d.entity_type = 'docket_matter' and exists (select 1 from public.docket_matters dm where dm.id = d.entity_id))
          or (d.entity_type = 'judgment' and exists (select 1 from public.judgments j where j.id = d.entity_id))
          or (d.entity_type = 'case_law' and exists (select 1 from public.case_law cl where cl.id = d.entity_id))
          or (d.entity_type = 'quick_code' and exists (select 1 from public.quick_codes qc where qc.id = d.entity_id))
          or (d.entity_type = 'bench_note' and exists (select 1 from public.bench_notes bn where bn.id = d.entity_id))
          or (d.entity_type = 'case' and exists (select 1 from public.cases c where c.id = d.entity_id))
        )
    )
  );

-- ===== Parent-delete cascade for polymorphic Document attachments =====
-- Resolved design (see the "PARENT-DELETION LIFECYCLE" note in the
-- migration header): Documents are attachments whose metadata row
-- must be deleted when their parent is deleted, reproducing the
-- pre-0040 documents_case_id_fkey/documents_bench_note_id_fkey ON
-- DELETE CASCADE behavior for all six polymorphic parent types. A
-- single reusable trigger function is installed identically as an
-- AFTER DELETE trigger on all six parent tables. It:
--   * uses an explicit, hardcoded TG_TABLE_NAME -> entity_type CASE
--     mapping -- no dynamic table-name execution, the same discipline
--     already used by bench_notes_entity_guard() (0038/0039);
--   * deletes only rows where entity_type = <the mapped type> AND
--     entity_id = OLD.id -- an exact type+id match, so a parent row in
--     one table can never delete a Document that belongs to a
--     differently-typed parent which happens to share the same UUID
--     (cross-type UUID isolation);
--   * is SECURITY DEFINER specifically so cleanup does not depend on
--     the deleting user separately satisfying documents' own DELETE
--     RLS ("Uploaders and admins can delete documents": is_admin() OR
--     uploaded_by = auth.uid()) -- e.g. a Docket Matter can have
--     Documents attached by several different Court-mates or Docket
--     Share collaborators, and all of them must be cleaned up
--     regardless of which single user (or admin) deletes the Docket
--     Matter;
--   * grants no user-facing access, exposes no row data, performs no
--     mutation beyond the one scoped DELETE, and has no
--     is_admin()/Court/Docket bypass logic of its own;
--   * does NOT touch storage.objects -- deliberately left in place,
--     matching current live behavior (no existing trigger deletes the
--     blob either); physical blob cleanup is out of scope for 0040
--     (see migration header).
-- Standalone Documents (entity_type/entity_id both NULL) are
-- structurally unreachable by this trigger's DELETE and are
-- unaffected.
create or replace function public.documents_parent_cascade_delete()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
declare
  v_entity_type text;
begin
  case tg_table_name
    when 'docket_matters' then v_entity_type := 'docket_matter';
    when 'judgments'      then v_entity_type := 'judgment';
    when 'case_law'       then v_entity_type := 'case_law';
    when 'quick_codes'    then v_entity_type := 'quick_code';
    when 'bench_notes'    then v_entity_type := 'bench_note';
    when 'cases'          then v_entity_type := 'case';
    else
      raise exception 'documents_parent_cascade_delete: unsupported parent table %', tg_table_name;
  end case;

  delete from public.documents
  where entity_type = v_entity_type
    and entity_id = old.id;

  return old;
end;
$$;

comment on function public.documents_parent_cascade_delete() is
  'AFTER DELETE trigger, installed identically on all six polymorphic parent tables (docket_matters, judgments, case_law, quick_codes, bench_notes, cases). Reproduces the pre-0040 documents_case_id_fkey/documents_bench_note_id_fkey ON DELETE CASCADE behavior for a polymorphic entity_id that cannot carry a declarative FK. Deletes only public.documents rows matching (entity_type = the hardcoded mapping for TG_TABLE_NAME, entity_id = OLD.id) -- an exact type+id match, so cross-type UUID collisions cannot cross-delete unrelated Documents. SECURITY DEFINER so cleanup does not depend on the deleting user satisfying documents'' own DELETE RLS. No dynamic SQL (explicit CASE over exactly the six approved table names, fails closed for anything else), no is_admin()/Court/Docket logic, no other mutation, does not touch storage.objects. Does not fire for standalone Documents (entity_type/entity_id both NULL), which have no parent to be deleted.';

create trigger documents_cascade_delete
  after delete on public.docket_matters
  for each row execute function public.documents_parent_cascade_delete();

create trigger documents_cascade_delete
  after delete on public.judgments
  for each row execute function public.documents_parent_cascade_delete();

create trigger documents_cascade_delete
  after delete on public.case_law
  for each row execute function public.documents_parent_cascade_delete();

create trigger documents_cascade_delete
  after delete on public.quick_codes
  for each row execute function public.documents_parent_cascade_delete();

create trigger documents_cascade_delete
  after delete on public.bench_notes
  for each row execute function public.documents_parent_cascade_delete();

create trigger documents_cascade_delete
  after delete on public.cases
  for each row execute function public.documents_parent_cascade_delete();
