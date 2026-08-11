-- 0030_docket_matter_case_law.sql
--
-- Docket Matter <-> Case Law association table. A row here represents
-- an association ONLY -- it never grants access in either direction.
-- Docket access (current Court assignment or retained assignment) never
-- grants Case Law access; Case Law access never grants Docket access.
--
-- Following the same governing principle established in 0029
-- (docket_matter_judgments): SELECT requires independent lawful access
-- to BOTH linked records (DocketAccess AND CaseLawAccess, never OR),
-- preventing the join row itself from becoming a metadata side-channel
-- for an otherwise-inaccessible Docket Matter or Case Law record.
--
-- IMPORTANT, deliberate difference from 0029: INSERT/DELETE require
-- Docket access AND Case Law READ access only -- NOT Case Law
-- ownership. Case Law is reusable research/reference authority intended
-- to be cited across many Docket Matters, not individually authored
-- work product like a Judgment. Requiring ownership to cite a canonical
-- authority would make ordinary legal research impossible: a magistrate
-- must be able to attach an admin-curated authority they can read but
-- did not create.
--
-- IMPORTANT, live-schema note: the `case_law` table has NOT yet been
-- refactored to the personal/canonical split described in the
-- architecture spec's §3 ownership table (nullable owner_id,
-- is_discoverable). That refactor is a separate, later, dedicated
-- migration (0035_case_law_personal_research) and is explicitly NOT
-- part of 0030. The live case_law table today is a single unified,
-- admin-curated table: SELECT is `using (true)` for every authenticated
-- user; INSERT/UPDATE/DELETE are `is_admin()`-only; created_by is
-- nullable/provenance-only (ON DELETE SET NULL), not an ownership
-- field. This migration therefore expresses its Case-Law-side access
-- check as a live EXISTS against case_law itself, rather than
-- duplicating case_law's own access rules -- this is deliberate and
-- future-proof: the same EXISTS clause will automatically respect
-- case_law's future row-level privacy model once 0035 exists, with no
-- change required here. Today, because case_law's SELECT policy is
-- unconditionally true for authenticated users, the Case-Law side of
-- the predicate is trivially satisfied whenever the referenced
-- case_law_id exists at all -- this is documented, not hidden.
--
-- The join row carries no descriptive metadata whatsoever -- only its
-- two foreign keys and creation provenance. No Case Law case_name/
-- citation, no Docket case_number/matter_title, no court_id/
-- district_id, no status, no notes.
--
-- can_access_court(), has_retained_assignment(), and is_admin() are
-- used exactly as they already exist; nothing about the underlying
-- Docket or Case Law RLS is modified by this migration. No shares logic
-- is implemented. No can_view_case_law()/can_edit_case_law() helper is
-- created -- the FINAL architecture spec's §14 references those names
-- as "unchanged from Revision 2", but they do not exist in the live
-- database, and this migration deliberately does not invent them; it
-- expresses the Case-Law-side check directly against the live table
-- instead (see above).

create table public.docket_matter_case_law (
  id uuid primary key default gen_random_uuid(),
  docket_matter_id uuid not null references public.docket_matters (id) on delete restrict,
  case_law_id uuid not null references public.case_law (id) on delete restrict,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint docket_matter_case_law_unique unique (docket_matter_id, case_law_id)
);

comment on table public.docket_matter_case_law is
  'Docket Matter <-> Case Law association only -- never confers access in either direction. SELECT requires independent lawful access to BOTH the Docket Matter and the Case Law record (AND, never OR), preventing the join row itself from becoming a metadata side-channel. INSERT/DELETE require lawful Docket access AND Case Law READ access only (NOT ownership -- deliberate difference from docket_matter_judgments, since Case Law is reusable reference authority). No admin bypass. No descriptive metadata beyond the two foreign keys and creation provenance. Built against the current live/legacy case_law model; the Case-Law-side RLS check is a live existence check against case_law itself so it will automatically respect the future case_law personal/canonical refactor (0035) without requiring this table to change.';
comment on column public.docket_matter_case_law.docket_matter_id is
  'ON DELETE RESTRICT, matching the Court-Anchored Docket judicial-history convention and docket_matter_judgments -- Docket Matters are not intended to be hard-deleted, and this association defensively prevents privileged/database-level deletion of a referenced Docket Matter while a link exists.';
comment on column public.docket_matter_case_law.case_law_id is
  'ON DELETE RESTRICT -- deliberately NOT the CASCADE used for judgment_id in docket_matter_judgments (0029). Case Law is administratively curated canonical/reference material intended to be cited across many Docket Matters, and its DELETE is currently admin-only and expected to be rare/deliberate -- unlike an individually-owned, still-provisionally-deletable Judgment. An admin who wants to delete a Case Law record that is actively cited by one or more Docket Matters must explicitly unlink it first (or take a deliberate privileged action), rather than having citations silently disappear out from under magistrates who rely on them.';
comment on column public.docket_matter_case_law.created_by is
  'Provenance only -- the creator of the association does not "own" the link. created_by never determines ongoing SELECT or DELETE access; both depend solely on independently satisfying the Docket-access and Case-Law-read-access predicates at the time of the request. Forced to auth.uid() at creation by a guard trigger (cannot be forged). ON DELETE RESTRICT matches the established provenance-preservation convention.';

-- Forces created_by to the authenticated user at creation (defense in
-- depth alongside the DEFAULT and the RLS WITH CHECK below). No
-- immutability check is needed for docket_matter_id/case_law_id: this
-- table has no UPDATE policy at all, so RLS already blocks every
-- ordinary client UPDATE regardless.
create or replace function public.docket_matter_case_law_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_by := (select auth.uid());
  return new;
end;
$$;

create trigger docket_matter_case_law_guard_trigger
  before insert on public.docket_matter_case_law
  for each row execute function public.docket_matter_case_law_guard();

-- The unique constraint above (docket_matter_case_law_unique) doubles
-- as the covering index for docket_matter_id, since it is the leading
-- column -- ordinary "all Case Law linked to this Docket Matter"
-- lookups and the docket-side RLS EXISTS clause below both benefit
-- from it. It does NOT, however, provide an efficient case_law_id
-- lookup (case_law_id is the trailing column), so a dedicated index is
-- added for the case-law-side RLS EXISTS clause and for "all Docket
-- Matters citing this Case Law record" lookups.
create index docket_matter_case_law_case_law_id_idx
  on public.docket_matter_case_law (case_law_id);

-- Covers docket_matter_case_law_created_by_fkey proactively, matching
-- the lesson learned from the 0021/0023 follow-up index migrations.
create index docket_matter_case_law_created_by_idx
  on public.docket_matter_case_law (created_by);

alter table public.docket_matter_case_law enable row level security;

create policy "Magistrates can view accessible Docket Matter Case Law"
  on public.docket_matter_case_law for select
  using (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_matter_case_law.docket_matter_id
        and ((select public.can_access_court(dm.court_id))
             or (select public.has_retained_assignment(dm.id)))
    )
    and exists (
      select 1 from public.case_law cl
      where cl.id = docket_matter_case_law.case_law_id
    )
  );

create policy "Magistrates can link readable Case Law to accessible Docket Matters"
  on public.docket_matter_case_law for insert
  with check (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_matter_case_law.docket_matter_id
        and ((select public.can_access_court(dm.court_id))
             or (select public.has_retained_assignment(dm.id)))
    )
    and exists (
      select 1 from public.case_law cl
      where cl.id = docket_matter_case_law.case_law_id
    )
    and created_by = (select auth.uid())
  );

create policy "Magistrates can unlink Case Law from accessible Docket Matters"
  on public.docket_matter_case_law for delete
  using (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_matter_case_law.docket_matter_id
        and ((select public.can_access_court(dm.court_id))
             or (select public.has_retained_assignment(dm.id)))
    )
    and exists (
      select 1 from public.case_law cl
      where cl.id = docket_matter_case_law.case_law_id
    )
  );

-- No UPDATE policy: the association has no editable business fields --
-- it is either present or absent. Correcting a wrong link is DELETE
-- then INSERT, subject to the same authority rules above.
--
-- DELETE uses the IDENTICAL substantive authority as INSERT (lawful
-- Docket access AND Case-Law read access), never merely "whoever
-- created the row" -- created_by is provenance only. A magistrate with
-- Docket access to the matter but no Case-Law read access (not
-- possible today, since case_law is globally readable, but preserved
-- for when 0035 changes that) cannot unlink; a magistrate who can read
-- the Case Law but has no lawful Docket access to the matter cannot
-- unlink either.
--
-- No admin bypass, anywhere on this table. This is unaffected by the
-- fact that case_law itself grants admins a separate, unrelated write
-- bypass on the parent case_law table -- that bypass governs case_law
-- content curation, not this association.
--
-- Not yet the shares path: when shares exists on the Docket side (and
-- any future Case-Law-side access mechanism), association visibility
-- should continue to require independent lawful access to both --
-- conceptually FutureDocketReadAccess AND FutureCaseLawReadAccess. Not
-- implemented here.
--
-- Explicitly NOT built in 0030: the case_law personal/canonical
-- refactor itself (0035), any Case-Law-side ownership/discoverability
-- concept, quick_code_case_law, case_law_annotations, full-text/global
-- search over associated authorities, and any frontend surface.
