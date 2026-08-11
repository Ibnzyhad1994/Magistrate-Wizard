-- 0029_docket_matter_judgments.sql
--
-- Docket Matter <-> Judgment association table. A row here represents
-- an association ONLY -- it never grants access in either direction.
-- Docket access (current Court assignment or retained assignment) never
-- grants Judgment access; Judgment access (ownership or discoverability)
-- never grants Docket access; a successor magistrate who inherits a
-- Court/Docket never automatically gains access to a predecessor's
-- private Judgment merely because the association remains.
--
-- Beyond that already-established principle, this migration additionally
-- ensures the association ITSELF cannot become a side-channel for
-- discovering an otherwise-inaccessible record: SELECT on this table
-- requires independent lawful access to BOTH linked records
-- (DocketAccess AND JudgmentAccess, never OR). It is not enough that the
-- linked content stays protected by the parent tables' own RLS -- the
-- mere visibility of a link row to only one side would itself leak
-- information.
--
-- The join row carries no descriptive metadata whatsoever -- only its
-- two foreign keys and creation provenance. No Judgment title/citation,
-- no Docket case_number/matter_title, no court_id/district_id, no
-- owner_id, no status, no notes.
--
-- can_access_court(), has_retained_assignment(), and is_admin() are used
-- exactly as they already exist; nothing about the underlying Docket or
-- Judgment RLS is modified by this migration. No shares logic is
-- implemented (shares does not yet exist for either side).

create table public.docket_matter_judgments (
  id uuid primary key default gen_random_uuid(),
  docket_matter_id uuid not null references public.docket_matters (id) on delete restrict,
  judgment_id uuid not null references public.judgments (id) on delete cascade,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint docket_matter_judgments_unique unique (docket_matter_id, judgment_id)
);

comment on table public.docket_matter_judgments is
  'Docket Matter <-> Judgment association only -- never confers access in either direction. SELECT requires independent lawful access to BOTH the Docket Matter and the Judgment (AND, never OR), preventing the join row itself from becoming a metadata side-channel. INSERT/DELETE require lawful Docket access AND Judgment ownership specifically (is_discoverable alone is never sufficient). No admin bypass. No descriptive metadata beyond the two foreign keys and creation provenance.';
comment on column public.docket_matter_judgments.docket_matter_id is
  'ON DELETE RESTRICT, matching the Court-Anchored Docket judicial-history convention -- Docket Matters are not intended to be hard-deleted, and this association defensively prevents privileged/database-level deletion of a referenced Docket Matter while a link exists.';
comment on column public.docket_matter_judgments.judgment_id is
  'ON DELETE CASCADE, matching judgment_tags -- Judgment owner DELETE remains provisionally permitted under 0027; if a Judgment is lawfully deleted, its purely associative link rows are removed automatically rather than blocking deletion or leaving orphaned associations. Does not alter or resolve the future Judgment lifecycle-locking design.';
comment on column public.docket_matter_judgments.created_by is
  'Provenance only -- the creator of the association does not "own" the link. created_by never determines ongoing SELECT or DELETE access; both depend solely on independently satisfying the Docket-access and Judgment-ownership predicates at the time of the request. Forced to auth.uid() at creation by a guard trigger (cannot be forged). ON DELETE RESTRICT matches the established provenance-preservation convention.';

-- Forces created_by to the authenticated user at creation (defense in
-- depth alongside the DEFAULT and the RLS WITH CHECK below). No
-- immutability check is needed for docket_matter_id/judgment_id: this
-- table has no UPDATE policy at all, so RLS already blocks every
-- ordinary client UPDATE regardless.
create or replace function public.docket_matter_judgments_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_by := (select auth.uid());
  return new;
end;
$$;

create trigger docket_matter_judgments_guard_trigger
  before insert on public.docket_matter_judgments
  for each row execute function public.docket_matter_judgments_guard();

-- The unique constraint above (docket_matter_judgments_unique) doubles
-- as the covering index for docket_matter_id, since it is the leading
-- column -- ordinary "all Judgments linked to this Docket Matter"
-- lookups and the docket-side RLS EXISTS clause below both benefit from
-- it. It does NOT, however, provide an efficient judgment_id lookup
-- (judgment_id is the trailing column), so a dedicated index is added
-- for the judgment-side RLS EXISTS clause and for "all Docket Matters
-- linked to this Judgment" lookups.
create index docket_matter_judgments_judgment_id_idx
  on public.docket_matter_judgments (judgment_id);

-- Covers docket_matter_judgments_created_by_fkey proactively, matching
-- the lesson learned from the 0021/0023 follow-up index migrations.
create index docket_matter_judgments_created_by_idx
  on public.docket_matter_judgments (created_by);

alter table public.docket_matter_judgments enable row level security;

create policy "Magistrates can view accessible Docket Matter Judgments"
  on public.docket_matter_judgments for select
  using (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_matter_judgments.docket_matter_id
        and ((select public.can_access_court(dm.court_id))
             or (select public.has_retained_assignment(dm.id)))
    )
    and exists (
      select 1 from public.judgments j
      where j.id = docket_matter_judgments.judgment_id
        and (j.owner_id = (select auth.uid()) or j.is_discoverable = true)
    )
  );

create policy "Judgment owners can link accessible Docket Matters"
  on public.docket_matter_judgments for insert
  with check (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_matter_judgments.docket_matter_id
        and ((select public.can_access_court(dm.court_id))
             or (select public.has_retained_assignment(dm.id)))
    )
    and exists (
      select 1 from public.judgments j
      where j.id = docket_matter_judgments.judgment_id
        and j.owner_id = (select auth.uid())
    )
    and created_by = (select auth.uid())
  );

create policy "Judgment owners can unlink accessible Docket Matters"
  on public.docket_matter_judgments for delete
  using (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_matter_judgments.docket_matter_id
        and ((select public.can_access_court(dm.court_id))
             or (select public.has_retained_assignment(dm.id)))
    )
    and exists (
      select 1 from public.judgments j
      where j.id = docket_matter_judgments.judgment_id
        and j.owner_id = (select auth.uid())
    )
  );

-- No UPDATE policy: the association has no editable business fields --
-- it is either present or absent. Correcting a wrong link is DELETE
-- then INSERT, subject to the same authority rules above.
--
-- DELETE uses the IDENTICAL substantive authority as INSERT (lawful
-- Docket access AND Judgment ownership), never merely "whoever created
-- the row" -- created_by is provenance only. A discoverable-reader
-- cannot unlink another magistrate's Judgment; a successor magistrate
-- with inherited Docket access cannot unlink a predecessor's private
-- Judgment merely because they now have Court access; a Judgment owner
-- who has since lost lawful Docket access to the matter cannot unlink
-- the association through ordinary client RLS either. Such a historical
-- association may remain until someone satisfying both conditions can
-- act, or until the Judgment itself is lawfully deleted (at which point
-- ON DELETE CASCADE removes it automatically).
--
-- No admin bypass, anywhere on this table.
--
-- Not yet the shares path: when shares exists on both the Docket and
-- Judgment sides, association visibility should continue to require
-- independent lawful access to both -- conceptually
-- FutureDocketReadAccess AND FutureJudgmentReadAccess. Whether a future
-- edit-level share on either side should extend to link creation/
-- removal is an explicit, undecided future question -- not implemented
-- here.
