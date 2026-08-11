-- 0042_bookmark_entity_validation_extension.sql
--
-- Part 2 of 2 of the Bookmark entity-type extension (see
-- 0041_extend_bookmark_entity_type.sql for part 1, which added
-- docket_matter/judgment/quick_code to bookmark_entity_type in its own,
-- already-committed migration). This file rewrites
-- validate_bookmark_entity() to add three new branches for those
-- values. It is a separate migration, not a combined one, because the
-- three new enum values cannot safely be compared, executed against, or
-- inserted in the SAME transaction that adds them to a pre-existing
-- enum type -- confirmed live (not assumed) during 0041's readiness
-- review via a rollback-only probe against the real
-- bookmark_entity_type: bare equality comparison, function execution,
-- and table INSERT all raised "unsafe use of new value" when attempted
-- in the same transaction as the ALTER TYPE. By the time this migration
-- runs, 0041 has already committed, so all seven enum values are fully
-- usable here.
--
-- EXPLICITLY DEFERRED, NOT ADDED: `document`. Documents (0040) are
-- subordinate attachments whose access follows their parent, not
-- independent judicial/research records. Whether to allow bookmarking
-- the attachment itself, versus only its parent record, is a separate,
-- unresolved product question -- not decided here. `document` remains
-- non-bookmarkable. Also not added: case_law_annotation, docket_event,
-- docket_matter_party, tag, association/join-table rows, share.
--
-- The four existing branches (case, bench_note, statute, case_law) are
-- preserved byte-for-byte -- no modernization, per this migration's
-- explicit scope.
--
-- ACCESS MODEL FOR THE THREE NEW BRANCHES: a Bookmark may only be
-- created against an entity the caller can currently, lawfully read --
-- the same "respect parent RLS via SECURITY INVOKER" principle the four
-- existing branches already use (this function was already SECURITY
-- INVOKER before this migration; preserved unchanged here). Each new
-- branch is a plain nested EXISTS against the parent table itself,
-- auto-inheriting that table's current SELECT RLS with no duplicated
-- predicate:
--   * docket_matter -> docket_matters' own SELECT policy (Court
--     assignment OR retained assignment OR active Docket view/edit
--     share -- the full current post-0037 envelope, inherited for
--     free, no re-implementation here);
--   * judgment -> judgments' own SELECT policy (owner OR
--     is_discoverable = true; no Judgment shares exist yet);
--   * quick_code -> quick_codes' own SELECT policy (owner only; no
--     Quick Code sharing exists).
-- No SECURITY DEFINER bypass is introduced for any of the three new
-- branches -- Bookmarks' access-at-creation principle is the opposite
-- of bench_notes' (0038/0039): it must NOT bypass parent RLS.
--
-- WHAT IS NOT CHANGED, AND WHY: bookmarks' three RLS policies
-- (owner-only SELECT/INSERT/DELETE, no admin bypass, no sharing) need
-- no change -- they never reference entity_type by value. There is
-- still no UPDATE policy on bookmarks (confirmed live, unchanged) --
-- entity re-pointing is not reachable through ordinary RLS-gated access
-- for any of the seven types, old or new, so the function's
-- unconditional (no reference-changed guard) revalidation on BEFORE
-- INSERT OR UPDATE -- structurally similar in shape to the bug fixed in
-- 0039 for bench_notes -- is not a live issue here and is preserved
-- unmodified (adding an UPDATE policy or a reference-changed guard is
-- out of scope for this migration; nothing in the current architecture
-- requires either). bookmarks has no FK to any of the seven parent
-- tables and no parent-delete cleanup trigger exists for any of the
-- four live types today (confirmed live) -- a Bookmark already survives
-- deletion of its referenced parent as dangling, owner-visible
-- metadata; this migration extends that same behavior to the three new
-- types rather than adding six/seven new parent-delete triggers, which
-- nothing in the current architecture requires. Bookmark SELECT already
-- depends only on ownership (`user_id = auth.uid()`), never on the
-- parent's continued existence or accessibility, for all seven types --
-- unchanged, not built here.

create or replace function public.validate_bookmark_entity()
returns trigger
security invoker
language plpgsql
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

comment on function public.validate_bookmark_entity() is
  'BEFORE INSERT OR UPDATE on bookmarks. Validates entity_id exists in (and, being SECURITY INVOKER, is lawfully readable under caller RLS in) the table named by entity_type, for all seven approved types: case | bench_note | statute | case_law (unchanged since 0008) | docket_matter | judgment | quick_code (added 0041/0042). SECURITY INVOKER deliberately preserved -- unlike bench_notes_entity_guard() (0038/0039), a Bookmark must only be creatable against an entity the caller can currently access; the check must NOT bypass the parent table''s own RLS. No dynamic SQL (explicit CASE over exactly the seven CHECK-enum-constrained entity types). Runs unconditionally on both INSERT and UPDATE with no reference-changed guard -- structurally similar to the bug fixed in 0039 for bench_notes, but not a live issue here because bookmarks has no UPDATE RLS policy at all, so no UPDATE ever reaches this trigger. Does not grant, return, or expose any parent row data -- existence/visibility only.';

comment on type public.bookmark_entity_type is
  'Polymorphic Bookmark target discriminator. Seven approved values: case | bench_note | statute | case_law (original, 0008) | docket_matter | judgment | quick_code (added across 0041/0042, split across two migrations because the enum values could not safely be used in the same transaction that added them to this pre-existing type). `document` is deliberately excluded -- Documents (0040) are subordinate attachments whose access follows their parent; whether to allow bookmarking the attachment itself versus only its parent record is an unresolved product question, not decided here. case_law_annotation, docket_event, docket_matter_party, tag, association/join rows, and share are not bookmarkable targets and were never considered for this enum.';
