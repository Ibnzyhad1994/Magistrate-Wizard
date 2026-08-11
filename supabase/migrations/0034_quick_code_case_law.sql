-- 0034_quick_code_case_law.sql
--
-- Quick Code <-> Case Law association table. A row here represents an
-- association ONLY -- it never grants access in either direction. Case
-- Law read access never grants Quick Code access; Quick Code ownership
-- never grants Case Law access or any Case Law write privilege. The
-- Quick Code remains privately owned throughout -- linking it to a Case
-- Law record never transforms it into shared/discoverable content, and
-- reading a Case Law record never exposes another magistrate's private
-- Quick Codes merely because both reference the same authority.
--
-- Following the same governing principle established in 0029/0030/0032/
-- 0033: SELECT requires independent lawful access to BOTH linked records
-- (QuickCodeOwnership AND CaseLawReadAccess, never OR), preventing the
-- join row itself from becoming a metadata side-channel.
--
-- IMPORTANT: this migration reuses, unmodified, the exact nested-RLS
-- design explicitly approved for docket_matter_case_law (0030). The
-- Case-Law-side access check is expressed as a live EXISTS against
-- case_law itself, rather than duplicating or inlining case_law's own
-- access rules -- this automatically and correctly tracks case_law's
-- current AND future RLS policy with zero changes required to this
-- table. As of 0034, case_law has NOT yet been refactored to the
-- personal/canonical split described in the architecture spec's §3
-- ownership table (nullable owner_id, is_discoverable) -- that refactor
-- is 0035_case_law_personal_research and is explicitly NOT part of
-- 0034. Today, case_law's SELECT policy is `using (true)` for every
-- authenticated user, so the Case-Law side of the predicate below is
-- trivially satisfied whenever the referenced case_law_id exists at
-- all -- this is documented, not hidden, exactly as it was for 0030. No
-- can_view_case_law() helper is created, and no future owner_id/
-- is_discoverable fields are hard-coded or referenced anywhere in this
-- migration.
--
-- MANDATORY FUTURE REGRESSION OBLIGATION: when 0035_case_law_personal_
-- research is implemented, it MUST regression-test this table's SELECT/
-- INSERT/DELETE behavior in addition to docket_matter_case_law's, since
-- both tables share the identical nested-EXISTS-against-case_law
-- pattern and both will begin respecting row-level Case Law privacy
-- automatically, with no code change here -- that automatic change in
-- behavior itself is exactly what must be verified.
--
-- IMPORTANT, deliberate difference from quick_code_docket_matters (0032)
-- and docket_matter_judgments (0029): INSERT/DELETE require Case Law
-- READ access only, NOT Case Law ownership/authorship. Case Law is
-- administratively curated, reusable research/reference authority --
-- requiring ownership to link a canonical authority a magistrate did
-- not author would make ordinary legal research impossible. This
-- mirrors docket_matter_case_law's (0030) INSERT/DELETE rule exactly,
-- and mirrors quick_code_judgments' (0033) rationale that the Quick
-- Code -- not the linked record -- is the linking user's private
-- metadata, so associating it with any Case Law record they can
-- lawfully read grants nobody else anything.
--
-- Both this table's asymmetric FK behavior mirrors 0030 precisely:
-- quick_code_id uses ON DELETE CASCADE (Quick Code owner hard DELETE is
-- already approved, 0031; these are personal organizational link rows,
-- not judicial history, and must not block lawful Quick Code deletion).
-- case_law_id uses ON DELETE RESTRICT -- deliberately NOT CASCADE,
-- matching 0030's Case Law lifecycle design exactly: Case Law is
-- administratively curated canonical/reference material, its DELETE is
-- admin-only and expected to be rare/deliberate, and an admin wishing to
-- delete a still-cited Case Law record must explicitly unlink it first
-- rather than having magistrates' personal citations silently vanish.
--
-- The join row carries no descriptive metadata whatsoever -- only its
-- two foreign keys and creation provenance. No code_word/content copy,
-- no Case Law case_name/citation copy.
--
-- is_admin() is referenced only insofar as case_law's own underlying
-- policies already use it (unchanged); this migration's own three
-- policies never reference is_admin() directly and grant no admin
-- bypass. No shares logic is implemented -- neither Quick Code sharing
-- nor any future Case Law personal-authorship sharing exists yet. No
-- search_vector/full-text/global-search wiring is added here.

create table public.quick_code_case_law (
  id uuid primary key default gen_random_uuid(),
  quick_code_id uuid not null references public.quick_codes (id) on delete cascade,
  case_law_id uuid not null references public.case_law (id) on delete restrict,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint quick_code_case_law_unique unique (quick_code_id, case_law_id)
);

comment on table public.quick_code_case_law is
  'Quick Code <-> Case Law association only -- never confers access in either direction. SELECT requires independent lawful access to BOTH the Quick Code and the Case Law record (QuickCodeOwnership AND CaseLawReadAccess, never OR), preventing the join row itself from becoming a metadata side-channel. INSERT/DELETE require the identical predicate -- deliberately Case Law READ access only, not ownership/authorship, since Case Law is reusable reference authority (mirrors docket_matter_case_law/0030) and the Quick Code is the linking user''s own private metadata (mirrors quick_code_judgments/0033). No admin bypass. No descriptive metadata beyond the two foreign keys and creation provenance. Built against the current live/legacy case_law model; the Case-Law-side RLS check is a live existence check against case_law itself (reusing 0030''s nested-RLS design unmodified) so it will automatically respect the future case_law personal/canonical refactor (0035) without requiring this table to change -- 0035 must regression-test this table alongside docket_matter_case_law.';
comment on column public.quick_code_case_law.quick_code_id is
  'ON DELETE CASCADE -- Quick Code owner hard DELETE is already approved (0031); deleting a Quick Code removes its purely associative Case Law links automatically, independent of current Case Law read access (referential cleanup of the owner''s own authorized deletion, not an RLS unlink operation).';
comment on column public.quick_code_case_law.case_law_id is
  'ON DELETE RESTRICT -- matches docket_matter_case_law''s (0030) Case Law lifecycle design exactly, and is deliberately NOT the CASCADE used for quick_code_id on this same table. Case Law is administratively curated canonical/reference material intended to be cited across many Quick Codes and Docket Matters alike, and its DELETE is currently admin-only and expected to be rare/deliberate. An admin who wants to delete a Case Law record that is actively linked from one or more Quick Codes must explicitly unlink it first (or take a deliberate privileged action), rather than having magistrates'' personal citations silently disappear out from under them.';
comment on column public.quick_code_case_law.created_by is
  'Provenance only -- the creator of the association does not "own" the link. created_by never determines ongoing SELECT or DELETE access; both depend solely on independently satisfying the Quick-Code-ownership and Case-Law-read-access predicates at the time of the request. Forced to auth.uid() at creation by a guard trigger (cannot be forged). ON DELETE RESTRICT matches the established provenance-preservation convention.';

-- Forces created_by to the authenticated user at creation (defense in
-- depth alongside the DEFAULT and the RLS WITH CHECK below). No
-- immutability check is needed for quick_code_id/case_law_id: this
-- table has no UPDATE policy at all, so RLS already blocks every
-- ordinary client UPDATE regardless.
create or replace function public.quick_code_case_law_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_by := (select auth.uid());
  return new;
end;
$$;

create trigger quick_code_case_law_guard_trigger
  before insert on public.quick_code_case_law
  for each row execute function public.quick_code_case_law_guard();

-- The unique constraint above (quick_code_case_law_unique) doubles as
-- the covering index for quick_code_id, since it is the leading column
-- (matching the 0032/0033 Quick-Code-centric index convention,
-- explicitly approved to remain as-is rather than following the
-- Docket-association tables' leading-column convention) -- ordinary
-- "all Case Law linked to this Quick Code" lookups and the Quick-Code-
-- side RLS EXISTS clause below both benefit from it. It does NOT,
-- however, provide an efficient case_law_id lookup (case_law_id is the
-- trailing column), so a dedicated index is added for the Case-Law-side
-- RLS EXISTS clause and for "all Quick Codes linked to this Case Law
-- record" lookups.
create index quick_code_case_law_case_law_id_idx
  on public.quick_code_case_law (case_law_id);

-- Covers quick_code_case_law_created_by_fkey proactively, matching the
-- lesson learned from the 0021/0023 follow-up index migrations.
create index quick_code_case_law_created_by_idx
  on public.quick_code_case_law (created_by);

alter table public.quick_code_case_law enable row level security;

create policy "Owners can view their Quick Code Case Law links"
  on public.quick_code_case_law for select
  using (
    exists (
      select 1 from public.quick_codes qc
      where qc.id = quick_code_case_law.quick_code_id
        and qc.owner_id = (select auth.uid())
    )
    and exists (
      select 1 from public.case_law cl
      where cl.id = quick_code_case_law.case_law_id
    )
  );

create policy "Owners can link their Quick Codes to readable Case Law"
  on public.quick_code_case_law for insert
  with check (
    exists (
      select 1 from public.quick_codes qc
      where qc.id = quick_code_case_law.quick_code_id
        and qc.owner_id = (select auth.uid())
    )
    and exists (
      select 1 from public.case_law cl
      where cl.id = quick_code_case_law.case_law_id
    )
    and created_by = (select auth.uid())
  );

create policy "Owners can unlink their Quick Codes from Case Law"
  on public.quick_code_case_law for delete
  using (
    exists (
      select 1 from public.quick_codes qc
      where qc.id = quick_code_case_law.quick_code_id
        and qc.owner_id = (select auth.uid())
    )
    and exists (
      select 1 from public.case_law cl
      where cl.id = quick_code_case_law.case_law_id
    )
  );

-- No UPDATE policy: the association has no editable business fields --
-- it is either present or absent. Correcting a wrong link is DELETE
-- then INSERT, subject to the same authority rules above.
--
-- DELETE uses the IDENTICAL substantive authority as INSERT (Quick Code
-- ownership AND current lawful Case Law read access), never merely
-- "whoever created the row" -- created_by is provenance only. Because
-- case_law's SELECT policy is unconditionally true today, "current
-- lawful Case Law read access" is presently always satisfied once the
-- case_law_id exists at all; if the linked Case Law record is deleted
-- (admin-only, and only after any RESTRICT-blocking links are
-- explicitly removed), ON DELETE RESTRICT prevents that deletion while
-- this association still references it -- the admin must unlink first.
--
-- No admin bypass, anywhere on this table. The real Admin profile must
-- independently satisfy Quick Code ownership AND lawful Case Law read
-- access like anyone else -- Quick Code ownership is never available to
-- Admin by virtue of being Admin, and Admin's separate, unrelated write
-- bypass on the parent case_law table does not substitute for it here.
--
-- Side-channel note, explicitly recorded rather than force-tested: a
-- Case-Law-only reader (someone with no Quick Code involved) can never
-- see this table's rows regardless of case_law's global readability,
-- since the Quick-Code-ownership EXISTS clause independently gates
-- every row. A "future private/unreadable Case Law" scenario is not
-- constructible today (case_law has no row-level privacy yet) and is
-- NOT force-tested here -- it is recorded as mandatory regression
-- coverage for 0035, per the note above.
--
-- Not yet the shares path: neither Quick Code sharing nor any future
-- Case-Law-side personal-authorship sharing exists today. The principle
-- is recorded now for when either eventually does: association
-- visibility should continue to require independent lawful access to
-- both sides -- conceptually QuickCodeReadAccess AND FutureCaseLaw
-- ReadAccess. Not implemented here.
--
-- Explicitly NOT built in 0034: the case_law personal/canonical
-- refactor itself (0035), any Case-Law-side ownership/discoverability
-- concept, case_law_annotations, full-text/global search over
-- associated authorities, and any frontend surface.
