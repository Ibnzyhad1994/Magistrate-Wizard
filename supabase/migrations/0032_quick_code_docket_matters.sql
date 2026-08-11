-- 0032_quick_code_docket_matters.sql
--
-- Quick Code <-> Docket Matter association table. A row here represents
-- an association ONLY -- it never grants access in either direction.
-- Docket access (current Court assignment or retained assignment) never
-- grants Quick Code access; Quick Code ownership never grants Docket
-- access. The Quick Code remains privately owned throughout -- linking
-- it to a Docket Matter never transforms it into Court-owned or shared
-- content. A successor magistrate who inherits a Court/Docket does NOT
-- automatically inherit a predecessor's linked Quick Codes, and a
-- retained magistrate's Docket access does not make another person's
-- Quick Codes visible.
--
-- Following the same governing principle established in 0029/0030:
-- SELECT requires independent lawful access to BOTH linked records
-- (DocketAccess AND QuickCodeAccess, never OR), preventing the join row
-- itself from becoming a metadata side-channel for an otherwise-
-- inaccessible Docket Matter or Quick Code.
--
-- IMPORTANT: because Quick Codes (0031) have NO discoverability tier at
-- all -- owner_id = auth.uid() is the only access path that exists for
-- them -- "Quick Code access" is identical in strength everywhere it
-- appears in this migration. SELECT and INSERT/DELETE therefore all use
-- the same Quick-Code-side check. This is a genuine simplification
-- versus docket_matter_judgments, where SELECT could be satisfied by
-- mere Judgment discoverability but INSERT/DELETE required Judgment
-- ownership specifically -- no such distinction is possible or needed
-- here.
--
-- quick_code_id uses ON DELETE CASCADE: Quick Code owner hard DELETE is
-- already approved (0031). Deleting a Quick Code removes its purely
-- associative Docket links automatically rather than blocking deletion
-- or leaving orphaned rows. CASCADE is database referential cleanup
-- triggered by the owner's own authorized deletion of their own
-- record -- not an RLS unlink operation -- so it applies even if the
-- owner has since lost Docket access to some linked matters.
--
-- docket_matter_id uses ON DELETE RESTRICT, matching the Court-Anchored
-- Docket's judicial-history convention and docket_matter_judgments/
-- docket_matter_case_law -- Docket Matters are not intended to be
-- hard-deleted.
--
-- The join row carries no descriptive metadata whatsoever -- only its
-- two foreign keys and creation provenance. No code_word/title/content
-- copy, no Docket case_number/matter_title/court/district copy.
--
-- can_access_court(), has_retained_assignment(), and is_admin() are
-- used exactly as they already exist; nothing about the underlying
-- Docket or Quick Code RLS is modified by this migration. No shares
-- logic is implemented -- no Quick Code sharing mechanism exists yet.

create table public.quick_code_docket_matters (
  id uuid primary key default gen_random_uuid(),
  quick_code_id uuid not null references public.quick_codes (id) on delete cascade,
  docket_matter_id uuid not null references public.docket_matters (id) on delete restrict,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint quick_code_docket_matters_unique unique (quick_code_id, docket_matter_id)
);

comment on table public.quick_code_docket_matters is
  'Quick Code <-> Docket Matter association only -- never confers access in either direction. SELECT requires independent lawful access to BOTH the Docket Matter and the Quick Code (AND, never OR), preventing the join row itself from becoming a metadata side-channel. INSERT/DELETE require the identical Docket-access-AND-Quick-Code-ownership predicate as SELECT, since Quick Codes have no discoverability tier -- owner_id = auth.uid() is the only Quick-Code access path that exists. No admin bypass. No descriptive metadata beyond the two foreign keys and creation provenance.';
comment on column public.quick_code_docket_matters.quick_code_id is
  'ON DELETE CASCADE -- Quick Code owner hard DELETE is already approved (0031); deleting a Quick Code removes its purely associative Docket links automatically. This is database referential cleanup of the owner''s own authorized deletion, not an RLS unlink operation, so it applies even if the owner has since lost Docket access to a linked matter.';
comment on column public.quick_code_docket_matters.docket_matter_id is
  'ON DELETE RESTRICT, matching the Court-Anchored Docket judicial-history convention and docket_matter_judgments/docket_matter_case_law -- Docket Matters are not intended to be hard-deleted, and this association defensively prevents privileged/database-level deletion of a referenced Docket Matter while a link exists.';
comment on column public.quick_code_docket_matters.created_by is
  'Provenance only -- the creator of the association does not "own" the link. created_by never determines ongoing SELECT or DELETE access; both depend solely on independently satisfying the Docket-access and Quick-Code-ownership predicates at the time of the request. Forced to auth.uid() at creation by a guard trigger (cannot be forged). ON DELETE RESTRICT matches the established provenance-preservation convention.';

-- Forces created_by to the authenticated user at creation (defense in
-- depth alongside the DEFAULT and the RLS WITH CHECK below). No
-- immutability check is needed for quick_code_id/docket_matter_id: this
-- table has no UPDATE policy at all, so RLS already blocks every
-- ordinary client UPDATE regardless.
create or replace function public.quick_code_docket_matters_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_by := (select auth.uid());
  return new;
end;
$$;

create trigger quick_code_docket_matters_guard_trigger
  before insert on public.quick_code_docket_matters
  for each row execute function public.quick_code_docket_matters_guard();

-- The unique constraint above (quick_code_docket_matters_unique) doubles
-- as the covering index for quick_code_id, since it is the leading
-- column -- ordinary "all Docket Matters linked to this Quick Code"
-- lookups and the Quick-Code-side RLS EXISTS clause below both benefit
-- from it. It does NOT, however, provide an efficient docket_matter_id
-- lookup (docket_matter_id is the trailing column), so a dedicated
-- index is added for the Docket-side RLS EXISTS clause and for "all
-- Quick Codes linked to this Docket Matter" lookups.
create index quick_code_docket_matters_docket_matter_id_idx
  on public.quick_code_docket_matters (docket_matter_id);

-- Covers quick_code_docket_matters_created_by_fkey proactively, matching
-- the lesson learned from the 0021/0023 follow-up index migrations.
create index quick_code_docket_matters_created_by_idx
  on public.quick_code_docket_matters (created_by);

alter table public.quick_code_docket_matters enable row level security;

create policy "Owners can view accessible Quick Code Docket Matter links"
  on public.quick_code_docket_matters for select
  using (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = quick_code_docket_matters.docket_matter_id
        and ((select public.can_access_court(dm.court_id))
             or (select public.has_retained_assignment(dm.id)))
    )
    and exists (
      select 1 from public.quick_codes qc
      where qc.id = quick_code_docket_matters.quick_code_id
        and qc.owner_id = (select auth.uid())
    )
  );

create policy "Owners can link their Quick Codes to accessible Docket Matters"
  on public.quick_code_docket_matters for insert
  with check (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = quick_code_docket_matters.docket_matter_id
        and ((select public.can_access_court(dm.court_id))
             or (select public.has_retained_assignment(dm.id)))
    )
    and exists (
      select 1 from public.quick_codes qc
      where qc.id = quick_code_docket_matters.quick_code_id
        and qc.owner_id = (select auth.uid())
    )
    and created_by = (select auth.uid())
  );

create policy "Owners can unlink their Quick Codes from accessible Docket Matters"
  on public.quick_code_docket_matters for delete
  using (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = quick_code_docket_matters.docket_matter_id
        and ((select public.can_access_court(dm.court_id))
             or (select public.has_retained_assignment(dm.id)))
    )
    and exists (
      select 1 from public.quick_codes qc
      where qc.id = quick_code_docket_matters.quick_code_id
        and qc.owner_id = (select auth.uid())
    )
  );

-- No UPDATE policy: the association has no editable business fields --
-- it is either present or absent. Correcting a wrong link is DELETE
-- then INSERT, subject to the same authority rules above.
--
-- DELETE uses the IDENTICAL substantive authority as INSERT (lawful
-- Docket access AND Quick Code ownership), never merely "whoever
-- created the row" -- created_by is provenance only. If the owner loses
-- lawful Docket access to a linked matter, they cannot unlink the
-- association through ordinary client RLS until lawful Docket access
-- exists again -- the association simply persists until then, or until
-- the Quick Code itself is deleted (at which point ON DELETE CASCADE
-- removes the association automatically regardless of the owner's
-- current Docket-access state).
--
-- No admin bypass, anywhere on this table. The real Admin profile must
-- independently satisfy Quick Code ownership AND lawful Docket access
-- like anyone else -- Quick Code ownership is never available to Admin
-- by virtue of being Admin.
--
-- Not yet the shares path: no Quick Code sharing mechanism exists
-- today. The principle is recorded now for when one eventually does:
-- association visibility should continue to require independent lawful
-- access to both sides -- conceptually FutureDocketReadAccess AND
-- FutureQuickCodeReadAccess. A future Quick Code share must not be
-- assumed to also permit link creation/removal -- that is an explicit,
-- undecided future question, not implemented here.
--
-- Explicitly NOT built in 0032: Quick Code sharing itself,
-- quick_code_judgments, quick_code_case_law, full-text/global search
-- over linked context, and any frontend surface.
