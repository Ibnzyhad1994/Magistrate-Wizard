-- 0028_judgment_tags.sql
--
-- Judgment-specific tags: organizational labels that belong directly to
-- an individually owned Judgment.
--
-- Deliberately NOT connected to the existing global `tags` table (0006),
-- for the same reason reuse was rejected for the Docket in 0026, applied
-- here with even sharper force: `tags` is globally readable to every
-- authenticated user with no access-scoping mechanism at all. A private,
-- individually owned Judgment's tag text could itself disclose sensitive
-- judicial work-product information even while the Judgment remains
-- completely inaccessible to everyone but its owner. `tags`,
-- `case_tags`, `bench_note_tags`, `case_law_tags`, `statute_tags`, and
-- `docket_matter_tags` are all left completely untouched by this
-- migration.
--
-- judgment_id uses ON DELETE CASCADE, deliberately the opposite of the
-- RESTRICT convention used throughout the Court-Anchored Docket. At this
-- pre-lifecycle-locking stage the owner may still DELETE a Judgment
-- (0027); tag rows are purely organizational metadata, so they are
-- removed automatically with the Judgment rather than blocking deletion
-- or leaving orphaned rows. This does not change the Judgment DELETE
-- decision itself, which remains provisional pending the future
-- judgment_lifecycle_locking migration.
--
-- Access is fully inherited from the parent Judgment's own access model
-- (owner_id / is_discoverable) -- never from Court/Docket access.
-- can_access_court(), has_retained_assignment(), and
-- docket_matter_judgments are never referenced anywhere in this
-- migration.

create table public.judgment_tags (
  id uuid primary key default gen_random_uuid(),
  judgment_id uuid not null references public.judgments (id) on delete cascade,
  tag_name text not null,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint judgment_tags_tag_name_not_blank check (btrim(tag_name) <> '')
);

comment on table public.judgment_tags is
  'Judgment-specific tags: organizational labels belonging directly to a Judgment. Deliberately NOT the global tags table (see migration header for rationale). SELECT inherits the parent Judgment''s own access model (owner OR is_discoverable); INSERT/DELETE are owner-only, even for a discoverable reader. No Court/Docket access rule applies. No admin bypass.';
comment on column public.judgment_tags.judgment_id is
  'ON DELETE CASCADE (deliberately the opposite of the Docket child-table RESTRICT convention) -- tag rows are purely organizational metadata and are removed automatically if the owner deletes the still-provisionally-deletable parent Judgment. Effectively immutable otherwise: this table has no UPDATE policy at all, so a tag can never be moved between Judgments after creation.';
comment on column public.judgment_tags.tag_name is
  'Free-form text, no controlled vocabulary/enum. Must not be blank after trimming whitespace (CHECK). Entered/display casing is preserved as typed; the stored value is whitespace-trimmed for storage hygiene. Case-insensitive, whitespace-trimmed uniqueness is enforced per Judgment only (see judgment_tags_judgment_tag_unique_idx) -- the same tag text on a different Judgment is explicitly not a duplicate.';
comment on column public.judgment_tags.created_by is
  'Provenance only -- who added this tag. Never used for access control. Forced to the authenticated user at creation by a guard trigger (cannot be forged). ON DELETE RESTRICT matches the judgments.owner_id provenance convention.';

-- Forces created_by to the authenticated user at creation (defense in
-- depth alongside the DEFAULT and the RLS WITH CHECK below), and
-- normalizes stored tag_name by trimming leading/trailing whitespace
-- (casing is left exactly as entered). Mirrors docket_matter_tags_guard()
-- from 0026.
create or replace function public.judgment_tags_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_by := (select auth.uid());
  new.tag_name := btrim(new.tag_name);
  return new;
end;
$$;

create trigger judgment_tags_guard_trigger
  before insert on public.judgment_tags
  for each row execute function public.judgment_tags_guard();

-- Case-insensitive, whitespace-trimmed duplicate prevention, scoped to
-- the individual Judgment only. Leading column (judgment_id) also
-- serves ordinary parent-Judgment lookups and the RLS EXISTS joins
-- below, so no separate plain index on judgment_id is added (it would
-- be redundant with this one).
create unique index judgment_tags_judgment_tag_unique_idx
  on public.judgment_tags (judgment_id, lower(btrim(tag_name)));

-- Covers judgment_tags_created_by_fkey proactively, matching the lesson
-- learned from the 0021/0023 follow-up index migrations.
create index judgment_tags_created_by_idx
  on public.judgment_tags (created_by);

alter table public.judgment_tags enable row level security;

create policy "Owners and discoverable readers can view Judgment Tags"
  on public.judgment_tags for select
  using (exists (
    select 1 from public.judgments j
    where j.id = judgment_tags.judgment_id
      and (j.owner_id = (select auth.uid()) or j.is_discoverable = true)
  ));

create policy "Owners can add Judgment Tags"
  on public.judgment_tags for insert
  with check (
    exists (
      select 1 from public.judgments j
      where j.id = judgment_tags.judgment_id
        and j.owner_id = (select auth.uid())
    )
    and created_by = (select auth.uid())
  );

create policy "Owners can remove Judgment Tags"
  on public.judgment_tags for delete
  using (exists (
    select 1 from public.judgments j
    where j.id = judgment_tags.judgment_id
      and j.owner_id = (select auth.uid())
  ));

-- No UPDATE policy: the approved lifecycle is add/remove only (INSERT
-- to add a tag, DELETE to remove one). Renaming a tag is a DELETE +
-- INSERT, not an in-place edit. Tag rows are organizational metadata,
-- not immutable judicial history -- no tag_status, no
-- entered_in_error, no ended-at state.
--
-- A discoverable reader (owner_id <> auth.uid(), is_discoverable = true)
-- can SELECT tags but has no INSERT or DELETE path -- both require
-- Judgment ownership specifically, preserving the "discoverability is
-- read-only" rule established in 0027.
--
-- No admin bypass, anywhere on this table.
--
-- Not yet the shares path: when Judgment sharing (a future migration)
-- is built, share-based VIEW access to a Judgment should extend to
-- SELECT of its tags; whether share-based EDIT access also includes tag
-- mutation is an explicit future decision, not implemented here. For
-- now, INSERT/DELETE remain owner-only regardless of any future share
-- grant.
