-- 0026_docket_matter_tags.sql
--
-- Institutional Docket tags: operational/workflow labels that belong to the
-- Docket Matter itself (e.g. urgent, warrant outstanding, awaiting report —
-- illustrative only, NOT seeded or hard-coded anywhere in this migration).
--
-- Deliberately NOT connected to the existing global `tags` table (0006).
-- `tags` is globally readable to every authenticated user and freely
-- extensible by any authenticated user, with no scoping boundary at all --
-- appropriate for the individually-owned content it already serves
-- (cases, bench_notes, case_law, statutes), but NOT appropriate for Docket
-- metadata: a Docket tag's text may itself reveal sensitive information
-- about a judicial matter, and that must never be exposed outside the
-- matter's own access boundary. `tags`, `case_tags`, `bench_note_tags`,
-- `case_law_tags`, and `statute_tags` are all left completely untouched by
-- this migration.
--
-- This table implements ONLY institutional Docket tags. A separate,
-- private, user-owned "personal label" feature (e.g. "review Friday",
-- "read before hearing") is explicitly deferred -- not designed or built
-- here, and must never auto-transfer to a successor magistrate merely
-- because the successor inherits ordinary Court Docket access.

create table public.docket_matter_tags (
  id uuid primary key default gen_random_uuid(),
  docket_matter_id uuid not null references public.docket_matters (id) on delete restrict,
  tag_name text not null,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint docket_matter_tags_tag_name_not_blank check (btrim(tag_name) <> '')
);

comment on table public.docket_matter_tags is
  'Institutional Docket tags: operational/workflow labels belonging to the Docket Matter itself, visible to every magistrate with lawful (current or retained) access to the parent matter. Deliberately NOT the global tags table (see migration header for rationale). Distinct from a future, separate, user-owned personal-label feature, which is not implemented here.';
comment on column public.docket_matter_tags.docket_matter_id is
  'Effectively immutable: this table has no UPDATE policy at all, so a tag can never be moved between Docket Matters after creation. No court_id/district_id duplication -- both are obtained exclusively through the parent Docket Matter.';
comment on column public.docket_matter_tags.tag_name is
  'Free-form text, no controlled vocabulary/enum. Must not be blank after trimming whitespace (CHECK). Entered/display casing is preserved as typed; the stored value is whitespace-trimmed for storage hygiene. Case-insensitive, whitespace-trimmed uniqueness is enforced per Docket Matter only (see docket_matter_tags_matter_tag_unique_idx) -- the same tag text on a different Docket Matter is explicitly not a duplicate.';
comment on column public.docket_matter_tags.created_by is
  'Provenance only -- who added this institutional tag. Never used for access control. Forced to the authenticated user at creation by a guard trigger (cannot be forged). ON DELETE RESTRICT matches the docket_matters/docket_events/docket_matter_parties provenance convention.';

-- Forces created_by to the authenticated user at creation (defense in
-- depth alongside the DEFAULT and the RLS WITH CHECK below), and
-- normalizes stored tag_name by trimming leading/trailing whitespace
-- (casing is left exactly as entered).
create or replace function public.docket_matter_tags_guard()
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

create trigger docket_matter_tags_guard_trigger
  before insert on public.docket_matter_tags
  for each row execute function public.docket_matter_tags_guard();

-- Case-insensitive, whitespace-trimmed duplicate prevention, scoped to the
-- individual Docket Matter only. Leading column (docket_matter_id) also
-- serves ordinary parent-matter lookups and the RLS EXISTS join below, so
-- no separate plain index on docket_matter_id is added (it would be
-- redundant with this one).
create unique index docket_matter_tags_matter_tag_unique_idx
  on public.docket_matter_tags (docket_matter_id, lower(btrim(tag_name)));

-- Covers docket_matter_tags_created_by_fkey proactively, matching the
-- lesson learned from the 0021/0023 follow-up index migrations.
create index docket_matter_tags_created_by_idx
  on public.docket_matter_tags (created_by);

alter table public.docket_matter_tags enable row level security;

create policy "Magistrates can view Docket Matter Tags"
  on public.docket_matter_tags for select
  using (exists (
    select 1 from public.docket_matters dm
    where dm.id = docket_matter_tags.docket_matter_id
      and ((select public.can_access_court(dm.court_id))
           or (select public.has_retained_assignment(dm.id)))
  ));

create policy "Magistrates can add Docket Matter Tags"
  on public.docket_matter_tags for insert
  with check (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_matter_tags.docket_matter_id
        and ((select public.can_access_court(dm.court_id))
             or (select public.has_retained_assignment(dm.id)))
    )
    and created_by = (select auth.uid())
  );

create policy "Magistrates can remove Docket Matter Tags"
  on public.docket_matter_tags for delete
  using (exists (
    select 1 from public.docket_matters dm
    where dm.id = docket_matter_tags.docket_matter_id
      and ((select public.can_access_court(dm.court_id))
           or (select public.has_retained_assignment(dm.id)))
  ));

-- No UPDATE policy: the approved lifecycle is add/remove only (INSERT to
-- add a tag, DELETE to remove one). Renaming a tag is a DELETE + INSERT,
-- not an in-place edit. This is a deliberate, explicit exception to the
-- no-hard-delete rule used elsewhere in the Court-Anchored Docket
-- (docket_matters, docket_matter_assignments, docket_events,
-- docket_matter_parties all forbid hard DELETE) -- institutional tags are
-- operational metadata, not substantive judicial history.
--
-- No admin bypass, anywhere on this table.
--
-- Not yet the shares path: when shares (0037) is built, institutional
-- Docket tags should inherit whatever visibility the parent matter grants
-- a shares recipient -- not implemented here since shares does not exist
-- yet.
