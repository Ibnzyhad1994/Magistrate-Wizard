-- 0033_quick_code_judgments.sql
--
-- Quick Code <-> Judgment association table. A row here represents an
-- association ONLY -- it never grants access in either direction. Quick
-- Code ownership never grants Judgment access; Judgment ownership/
-- discoverability never grants Quick Code access. The Quick Code
-- remains privately owned throughout -- linking it to a Judgment never
-- transforms it into Judgment-owned/shared/discoverable content, and a
-- discoverable-Judgment reader never thereby sees another magistrate's
-- private Quick Codes merely because they can read the Judgment.
--
-- Following the same governing principle established in 0029/0030/0032:
-- SELECT requires independent lawful access to BOTH linked records
-- (QuickCodeOwnership AND JudgmentReadAccess, never OR), preventing the
-- join row itself from becoming a metadata side-channel.
--
-- IMPORTANT, deliberate difference from quick_code_docket_matters (0032)
-- and docket_matter_judgments (0029): INSERT/DELETE require Judgment
-- READ access only, NOT Judgment ownership. A Quick Code is the linking
-- user's own private metadata; associating it with a Judgment they can
-- lawfully read -- including another magistrate's discoverable Judgment
-- -- grants nobody else anything, since the association row itself
-- remains invisible to everyone except the Quick Code's owner. There is
-- no Docket-Matter-style "no ownership concept to lean on" reason to
-- require Judgment ownership here.
--
-- IMPORTANT: visibility follows Judgment discoverability DYNAMICALLY,
-- exactly mirroring 0029's discoverability-transition behavior, without
-- ever mutating the association row itself. If the Judgment owner later
-- sets is_discoverable = false, the Quick Code owner immediately loses
-- read access to the Judgment and therefore immediately loses
-- visibility of (and the ordinary ability to unlink) the association --
-- the row persists in the database, simply invisible under RLS, until
-- Judgment access is regained or a CASCADE removes it. If is_discoverable
-- is later set back to true, visibility and unlink ability return
-- immediately.
--
-- Both quick_code_id and judgment_id use ON DELETE CASCADE. Quick Code
-- owner hard DELETE is already approved (0031); Judgment owner DELETE
-- remains provisionally permitted pre-lifecycle-locking (0027). These
-- are personal organizational link rows, not judicial history, and must
-- not block either lawful deletion. A Judgment may be deleted by its
-- owner even when another magistrate has privately associated one of
-- their own Quick Codes with that (formerly discoverable) Judgment --
-- CASCADE removes only the association row; the Quick Code itself is
-- untouched, and the association never created a property/ownership
-- interest in the Judgment in the first place.
--
-- The join row carries no descriptive metadata whatsoever -- only its
-- two foreign keys and creation provenance. No code_word/content copy,
-- no Judgment title/citation copy.
--
-- is_admin() is never referenced anywhere in this migration. No shares
-- logic is implemented -- neither Quick Code sharing nor Judgment
-- sharing exists yet.

create table public.quick_code_judgments (
  id uuid primary key default gen_random_uuid(),
  quick_code_id uuid not null references public.quick_codes (id) on delete cascade,
  judgment_id uuid not null references public.judgments (id) on delete cascade,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint quick_code_judgments_unique unique (quick_code_id, judgment_id)
);

comment on table public.quick_code_judgments is
  'Quick Code <-> Judgment association only -- never confers access in either direction. SELECT requires independent lawful access to BOTH the Quick Code and the Judgment (QuickCodeOwnership AND JudgmentReadAccess, never OR), preventing the join row itself from becoming a metadata side-channel. INSERT/DELETE require the identical predicate -- deliberately Judgment READ access only, not ownership (unlike quick_code_docket_matters/docket_matter_judgments), since the Quick Code is the linking user''s own private metadata and the association grants nobody else access. Visibility follows Judgment discoverability dynamically, without the association row ever being touched. No admin bypass. No descriptive metadata beyond the two foreign keys and creation provenance.';
comment on column public.quick_code_judgments.quick_code_id is
  'ON DELETE CASCADE -- Quick Code owner hard DELETE is already approved (0031); deleting a Quick Code removes its purely associative Judgment links automatically, independent of current Judgment read access.';
comment on column public.quick_code_judgments.judgment_id is
  'ON DELETE CASCADE -- Judgment owner DELETE remains provisionally permitted pre-lifecycle-locking (0027); these personal organizational link rows must not block lawful Judgment deletion. A Judgment may be deleted by its owner even while another magistrate has privately linked one of their own Quick Codes to it -- CASCADE removes only the association row, never the Quick Code itself, and the association never created a property/ownership interest in the Judgment. If a future judgment_lifecycle_locking migration restricts Judgment DELETE, that migration controls the parent lifecycle, not this one.';
comment on column public.quick_code_judgments.created_by is
  'Provenance only -- the creator of the association does not "own" the link. created_by never determines ongoing SELECT or DELETE access; both depend solely on independently satisfying the Quick-Code-ownership and Judgment-read-access predicates at the time of the request. Forced to auth.uid() at creation by a guard trigger (cannot be forged). ON DELETE RESTRICT matches the established provenance-preservation convention.';

-- Forces created_by to the authenticated user at creation (defense in
-- depth alongside the DEFAULT and the RLS WITH CHECK below). No
-- immutability check is needed for quick_code_id/judgment_id: this
-- table has no UPDATE policy at all, so RLS already blocks every
-- ordinary client UPDATE regardless.
create or replace function public.quick_code_judgments_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_by := (select auth.uid());
  return new;
end;
$$;

create trigger quick_code_judgments_guard_trigger
  before insert on public.quick_code_judgments
  for each row execute function public.quick_code_judgments_guard();

-- The unique constraint above (quick_code_judgments_unique) doubles as
-- the covering index for quick_code_id, since it is the leading column
-- (matching the 0032 Quick-Code-centric index convention, explicitly
-- approved to remain as-is rather than following the Docket-association
-- tables' docket_matter_id-leading convention) -- ordinary "all
-- Judgments linked to this Quick Code" lookups and the Quick-Code-side
-- RLS EXISTS clause below both benefit from it. It does NOT, however,
-- provide an efficient judgment_id lookup (judgment_id is the trailing
-- column), so a dedicated index is added for the Judgment-side RLS
-- EXISTS clause and for "all Quick Codes linked to this Judgment"
-- lookups.
create index quick_code_judgments_judgment_id_idx
  on public.quick_code_judgments (judgment_id);

-- Covers quick_code_judgments_created_by_fkey proactively, matching the
-- lesson learned from the 0021/0023 follow-up index migrations.
create index quick_code_judgments_created_by_idx
  on public.quick_code_judgments (created_by);

alter table public.quick_code_judgments enable row level security;

create policy "Owners can view their Quick Code Judgment links"
  on public.quick_code_judgments for select
  using (
    exists (
      select 1 from public.quick_codes qc
      where qc.id = quick_code_judgments.quick_code_id
        and qc.owner_id = (select auth.uid())
    )
    and exists (
      select 1 from public.judgments j
      where j.id = quick_code_judgments.judgment_id
        and (j.owner_id = (select auth.uid()) or j.is_discoverable = true)
    )
  );

create policy "Owners can link their Quick Codes to readable Judgments"
  on public.quick_code_judgments for insert
  with check (
    exists (
      select 1 from public.quick_codes qc
      where qc.id = quick_code_judgments.quick_code_id
        and qc.owner_id = (select auth.uid())
    )
    and exists (
      select 1 from public.judgments j
      where j.id = quick_code_judgments.judgment_id
        and (j.owner_id = (select auth.uid()) or j.is_discoverable = true)
    )
    and created_by = (select auth.uid())
  );

create policy "Owners can unlink their Quick Codes from Judgments"
  on public.quick_code_judgments for delete
  using (
    exists (
      select 1 from public.quick_codes qc
      where qc.id = quick_code_judgments.quick_code_id
        and qc.owner_id = (select auth.uid())
    )
    and exists (
      select 1 from public.judgments j
      where j.id = quick_code_judgments.judgment_id
        and (j.owner_id = (select auth.uid()) or j.is_discoverable = true)
    )
  );

-- No UPDATE policy: the association has no editable business fields --
-- it is either present or absent. Correcting a wrong link is DELETE
-- then INSERT, subject to the same authority rules above.
--
-- DELETE uses the IDENTICAL substantive authority as INSERT (Quick Code
-- ownership AND current lawful Judgment read access), never merely
-- "whoever created the row" -- created_by is provenance only. If the
-- linked Judgment later becomes private (is_discoverable set false) and
-- the Quick Code owner does not own it, they cannot unlink the
-- association through ordinary client RLS until Judgment read access
-- returns -- the association simply persists, invisible, until then, or
-- until either parent is deleted (at which point ON DELETE CASCADE
-- removes it automatically regardless of current read-access state).
--
-- No admin bypass, anywhere on this table. The real Admin profile must
-- independently satisfy Quick Code ownership AND lawful Judgment read
-- access like anyone else.
--
-- Not yet the shares path: neither Quick Code sharing nor Judgment
-- sharing exists today. The principle is recorded now for when either
-- eventually does: association visibility should continue to require
-- independent lawful access to both sides -- conceptually
-- QuickCodeReadAccess AND FutureJudgmentReadAccess (Quick Codes
-- currently have only owner-read access; if Quick Code sharing is ever
-- added, that side may broaden only through a deliberate future
-- design). A future Judgment edit/view share must not be assumed to
-- also permit link creation/removal beyond whatever explicit policy is
-- later approved -- for 0033, Quick Code ownership + Judgment read
-- access remains the complete mutation rule.
--
-- Explicitly NOT built in 0033: Quick Code sharing, Judgment sharing,
-- quick_code_case_law, full-text/global search over linked context, and
-- any frontend surface.
