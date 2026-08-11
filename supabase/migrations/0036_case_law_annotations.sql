-- 0036_case_law_annotations.sql
--
-- Case Law Annotations: a PRIVATE personal research note created by one
-- magistrate and attached to one Case Law record (canonical or
-- personal, own or another user's discoverable). Personal research/
-- work-product metadata only -- an annotation never modifies, is never
-- part of, and is never mistaken for the underlying Case Law record
-- itself. Not canonical content.
--
-- OWNERSHIP AND PRIVACY: strictly private to the annotation's own
-- owner_id, permanently, in this migration. No discoverability, no
-- sharing, no admin bypass, no Court/Docket access path of any kind.
-- Even the Case Law record's own owner does NOT automatically see
-- annotations another magistrate privately made on their discoverable
-- Case Law -- ownership of the parent Case Law confers no visibility
-- into other people's annotations on it. Admin has no bypass either:
-- Admin may create their own annotation on any Case Law they can
-- independently read, but that annotation belongs to Admin alone and
-- remains exactly as private as anyone else's.
--
-- GOVERNING PRINCIPLE -- BOTH-sides, reusing the nested-RLS pattern from
-- 0030/0034 unmodified: SELECT/INSERT/UPDATE/DELETE all require
-- `AnnotationOwnership AND CaseLawReadAccess`, expressed as
-- `owner_id = auth.uid() AND EXISTS (select 1 from case_law cl where
-- cl.id = case_law_annotations.case_law_id)`. The EXISTS clause is a
-- plain, undecorated existence check -- it does not duplicate or inline
-- case_law's own SELECT predicate. Because RLS applies to every query
-- against case_law regardless of where that query originates (including
-- from inside another table's policy), this EXISTS clause is
-- automatically filtered by case_law's own current RLS at query time.
-- This means: if the parent Case Law record later becomes unreadable to
-- the annotation's owner (e.g. a discoverable personal Case Law they
-- don't own is set back to private by its owner), the owner
-- automatically and immediately loses SELECT/UPDATE/DELETE on their own
-- annotation through ordinary RLS -- the annotation row persists,
-- untouched, in the database, and access returns automatically the
-- moment the parent becomes readable again, with zero mutation to the
-- annotation row itself. This exactly preserves the BOTH-sides model
-- already proven for docket_matter_case_law (0030) and
-- quick_code_case_law (0034), and must be regression-tested the same
-- way those tables were.
--
-- FK LIFECYCLE -- deliberately different from the 0030/0034 association
-- model:
--   case_law_id ON DELETE CASCADE. Annotations are personal subordinate
--   notes, not judicial history and not a reference/citation the way
--   docket_matter_case_law/quick_code_case_law are -- they must not
--   block a lawful Case Law deletion (whether an admin deleting a
--   canonical record or a magistrate deleting their own personal
--   record). If the parent Case Law record is lawfully deleted, ALL
--   annotations on it CASCADE-delete automatically, regardless of which
--   magistrate(s) authored them -- an annotation never creates any
--   right to keep the parent record alive, and an annotation author has
--   no standing to block or even be consulted about the parent's
--   deletion.
--   owner_id ON DELETE RESTRICT, matching the established profile-
--   preservation convention (judgments.owner_id, quick_codes.owner_id,
--   case_law.owner_id) -- normal offboarding must not silently destroy
--   or orphan a magistrate's personal research notes.
--
-- TABLE SHAPE: id, case_law_id, owner_id, annotation_text, created_at,
-- updated_at only. Deliberately no title, no is_discoverable, no shares
-- field, no court_id/district_id/docket_matter_id, no canonical flag,
-- no tags, no search_vector -- none of these exist in 0036.
--
-- Multiple annotations by the same owner on the same Case Law record
-- are explicitly allowed -- no uniqueness constraint on
-- (owner_id, case_law_id). A magistrate may need several distinct notes
-- on one authority.
--
-- annotation_text must not be blank after trimming (CHECK). It is never
-- silently rewritten/reformatted -- only validated.
--
-- is_admin() is never referenced anywhere in this migration.

create table public.case_law_annotations (
  id uuid primary key default gen_random_uuid(),
  case_law_id uuid not null references public.case_law (id) on delete cascade,
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  annotation_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_law_annotations_text_not_blank check (btrim(annotation_text) <> '')
);

comment on table public.case_law_annotations is
  'Private personal research notes, one owner per row, attached to one Case Law record (canonical or personal, own or another user''s discoverable). Never canonical content; never modifies the parent. SELECT/INSERT/UPDATE/DELETE all require AnnotationOwnership AND CaseLawReadAccess (owner_id = auth.uid() AND a live, undecorated EXISTS against case_law -- reusing the 0030/0034 nested-RLS pattern unmodified, so annotation access automatically tracks the parent Case Law''s own current RLS with zero code change here). Strictly private, permanently, in 0036 -- no discoverability, no sharing, no admin bypass; even the parent Case Law''s own owner has no special visibility into another magistrate''s annotations on it. Multiple annotations per owner per Case Law record are allowed (no uniqueness). case_law_id is ON DELETE CASCADE (annotations are subordinate personal notes that must never block a lawful Case Law deletion) -- deliberately different from the RESTRICT association-table model used by docket_matter_case_law/quick_code_case_law.';
comment on column public.case_law_annotations.case_law_id is
  'ON DELETE CASCADE -- deliberately different from the docket_matter_case_law/quick_code_case_law RESTRICT model. Annotations are personal subordinate notes, not citations/references; a lawful Case Law deletion (admin deleting canonical, or a magistrate deleting their own personal record) must never be blocked by, or require consulting, anyone''s annotations on it. All annotations on a deleted Case Law record disappear automatically, regardless of which magistrate(s) authored them.';
comment on column public.case_law_annotations.owner_id is
  'Forced to auth.uid() at creation by a guard trigger (cannot be forged) and immutable thereafter -- an annotation can never be transferred to another profile by UPDATE. ON DELETE RESTRICT preserves the established profile-preservation convention -- normal offboarding must not silently destroy a magistrate''s personal research notes.';
comment on column public.case_law_annotations.annotation_text is
  'The private note itself. Must not be blank after trimming (CHECK). Never auto-rewritten/reformatted -- only validated.';

-- Forces owner_id to the authenticated user at creation (defense in
-- depth alongside the DEFAULT and the RLS WITH CHECK below), and
-- rejects any attempt to change owner_id on UPDATE (ownership is
-- immutable after creation, mirroring quick_codes_guard()/
-- case_law_ownership_guard()). annotation_text is never rewritten here
-- -- it must reach storage exactly as the owner wrote it, subject only
-- to the not-blank CHECK constraint.
create or replace function public.case_law_annotations_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := (select auth.uid());
  elsif tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id then
      raise exception 'A Case Law Annotation''s owner_id is immutable; ownership cannot be transferred by UPDATE.';
    end if;
  end if;
  return new;
end;
$$;

create trigger case_law_annotations_guard_trigger
  before insert or update on public.case_law_annotations
  for each row execute function public.case_law_annotations_guard();

create trigger set_case_law_annotations_updated_at
  before update on public.case_law_annotations
  for each row execute function public.set_updated_at();

-- Composite index, owner_id leading -- matches the universal RLS filter
-- (owner_id = auth.uid() is present in every policy on this table) and
-- efficiently serves both "all of my annotations" and "my annotations
-- on this specific Case Law record" lookups.
create index case_law_annotations_owner_case_law_idx
  on public.case_law_annotations (owner_id, case_law_id);

-- Dedicated case_law_id index -- owner_id is the leading column above,
-- so this table has no efficient plain case_law_id lookup otherwise.
-- Needed both for the nested-RLS EXISTS pattern's underlying join cost
-- and, more importantly, for CASCADE-delete performance when a Case Law
-- record referenced by many annotations (across many different owners)
-- is deleted -- Postgres must efficiently find all dependent rows.
create index case_law_annotations_case_law_id_idx
  on public.case_law_annotations (case_law_id);

alter table public.case_law_annotations enable row level security;

create policy "Owners can view their own Case Law Annotations"
  on public.case_law_annotations for select
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.case_law cl
      where cl.id = case_law_annotations.case_law_id
    )
  );

create policy "Owners can create Case Law Annotations on readable Case Law"
  on public.case_law_annotations for insert
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.case_law cl
      where cl.id = case_law_annotations.case_law_id
    )
  );

create policy "Owners can update their own Case Law Annotations"
  on public.case_law_annotations for update
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.case_law cl
      where cl.id = case_law_annotations.case_law_id
    )
  )
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.case_law cl
      where cl.id = case_law_annotations.case_law_id
    )
  );

create policy "Owners can delete their own Case Law Annotations"
  on public.case_law_annotations for delete
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.case_law cl
      where cl.id = case_law_annotations.case_law_id
    )
  );

-- DELETE/UPDATE use the IDENTICAL substantive authority as INSERT
-- (annotation ownership AND current lawful Case Law read access) --
-- there is no "whoever created the row" concept here since owner_id IS
-- the creator, forced and locked at creation.
--
-- If the parent Case Law record later becomes unreadable to the
-- annotation's owner (e.g. another magistrate's personal Case Law they
-- could read via is_discoverable is set back to private), the owner
-- immediately loses SELECT/UPDATE/DELETE on their own annotation
-- through ordinary RLS -- the annotation row persists, untouched, until
-- Case Law access returns or the Case Law record itself is deleted (at
-- which point ON DELETE CASCADE removes the annotation automatically,
-- regardless of the owner's access state at that moment).
--
-- No admin bypass, anywhere on this table. The real Admin profile may
-- create and manage their OWN annotations like anyone else (subject to
-- Admin independently satisfying CaseLawReadAccess, exactly like any
-- other magistrate), but has zero visibility into another magistrate's
-- annotations -- including annotations on Case Law Admin itself curates
-- as canonical.
--
-- The parent Case Law record's own owner_id is NOT referenced anywhere
-- in this table's RLS. Owning the annotated Case Law confers no
-- visibility into annotations other magistrates have privately made on
-- it, even when that Case Law is the owner's own discoverable personal
-- research or an admin-curated canonical record.
--
-- Not yet the shares path: no annotation sharing exists in 0036. If
-- ever introduced, it requires an explicit future design decision,
-- exactly as recorded for judgments/quick_codes/case_law.
--
-- Explicitly NOT built in 0036: any title field, discoverability,
-- sharing, Court/Docket association, canonical/personal distinction on
-- the annotation itself (it always belongs to exactly one private
-- owner regardless of the parent's canonical/personal status),
-- tagging, search_vector/full-text/global-search integration, and any
-- frontend surface.
