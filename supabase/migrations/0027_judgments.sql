-- 0027_judgments.sql
--
-- Individually owned Judgment records -- judicial work product that
-- belongs to its authoring magistrate, NEVER to a Court. This is a
-- deliberate, permanent design boundary: Judgment access is entirely
-- independent from the Court-Anchored Docket's access model.
-- can_access_court(), has_retained_assignment(), my_court_id(), and
-- is_admin() are never referenced anywhere in this migration.
--
-- Ownership never transfers when a magistrate leaves a Court. A
-- successor magistrate who inherits ordinary Court-wide Docket access
-- does NOT automatically inherit a predecessor's privately owned
-- Judgments -- Judgment access and Docket access are two entirely
-- independent systems. The future docket_matter_judgments association
-- table (NOT created in this migration) will link a Judgment to a
-- Docket Matter for organizational purposes only; that link will never
-- itself confer access to the Judgment in either direction.
--
-- This migration establishes the editable, private-by-default Judgment
-- foundation only. Explicitly NOT built here: judgment_tags (the tag-
-- privacy question raised during the 0027 readiness review remains
-- open until 0028), docket_matter_judgments, attachments (the documents
-- table cannot represent them until its polymorphic refactor), explicit
-- shares-based view/edit collaboration, full-text search, and any
-- draft/final/locking/version-history/archive behavior (deferred to the
-- dedicated future judgment_lifecycle_locking migration).

create table public.judgments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  title text not null,
  case_number text,
  court_name text,
  judgment_date date,
  citation text,
  content jsonb,
  content_text text,
  is_discoverable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.judgments is
  'Individually owned Judgment records. Never Court-owned; ownership never transfers when a magistrate leaves a Court. Private to owner by default; is_discoverable (owner-controlled) grants other magistrates read-only access, never edit. No admin bypass. Fully independent from Docket/Court access -- linking to a Docket Matter (future docket_matter_judgments) is association only and never confers access. Owner-only DELETE in this migration is explicitly provisional pending the future judgment_lifecycle_locking migration.';
comment on column public.judgments.owner_id is
  'Ownership AND authorship identity combined for 0027. Forced to auth.uid() at creation by a guard trigger (cannot be forged) and immutable thereafter -- an owner cannot transfer a Judgment to another profile by UPDATE. Future collaboration uses explicit sharing (the future shares migration), never ownership transfer. ON DELETE RESTRICT matches the docket_matters.created_by provenance convention -- a profile that owns a Judgment cannot be hard-deleted.';
comment on column public.judgments.court_name is
  'Optional free text, deliberately NOT an FK to courts. A Judgment is independent authored work product and may concern a historical or external Court not represented in the active BenchBook Court reference structure.';
comment on column public.judgments.case_number is 'Optional official case/reference number for display and future search metadata. No global uniqueness imposed.';
comment on column public.judgments.citation is 'Optional citation/reference identifier. No uniqueness imposed.';
comment on column public.judgments.content is 'Structured rich-text/editor representation. Editor implementation not designed in this migration.';
comment on column public.judgments.content_text is 'Plain-text mirror intended for later search/indexing. Not auto-derived from content in this migration -- no approved conversion mechanism exists yet; synchronization is left to a future application/editor implementation.';
comment on column public.judgments.is_discoverable is
  'Owner-controlled. false = only the owner may access this Judgment at all. true = other authenticated magistrates may SELECT/read only -- never edit, never delete, never admin-managed, never public, never automatically attached to a Docket Matter, never canonical authority. A discoverable Judgment remains individually owned.';

-- Forces owner_id to the authenticated user at creation (defense in
-- depth alongside the DEFAULT and the RLS WITH CHECK below), and
-- rejects any attempt to change owner_id on UPDATE -- ownership is
-- immutable after creation; a genuine transfer requires a deliberate
-- future design, not an ordinary UPDATE.
create or replace function public.judgments_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := (select auth.uid());
  elsif tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id then
      raise exception 'A Judgment''s owner_id is immutable; ownership cannot be transferred by UPDATE.';
    end if;
  end if;
  return new;
end;
$$;

create trigger judgments_guard_trigger
  before insert or update on public.judgments
  for each row execute function public.judgments_guard();

create trigger set_judgments_updated_at
  before update on public.judgments
  for each row execute function public.set_updated_at();

create index judgments_owner_id_idx on public.judgments (owner_id);
create index judgments_judgment_date_idx on public.judgments (judgment_date);

-- Targeted partial index for browsing/discovering OTHER magistrates'
-- discoverable Judgments in recent-date order, without indexing the
-- majority-private is_discoverable = false rows. Deliberately not a
-- plain index on the low-selectivity is_discoverable boolean alone.
-- judgment_date is nullable; NULLs sort last under DESC and are not
-- excluded from this index.
create index judgments_discoverable_date_idx
  on public.judgments (judgment_date desc)
  where is_discoverable = true;

alter table public.judgments enable row level security;

create policy "Owners and discoverable readers can view Judgments"
  on public.judgments for select
  using (owner_id = (select auth.uid()) or is_discoverable = true);

create policy "Owners can create Judgments"
  on public.judgments for insert
  with check (owner_id = (select auth.uid()));

create policy "Owners can update Judgments"
  on public.judgments for update
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Owners can delete Judgments"
  on public.judgments for delete
  using (owner_id = (select auth.uid()));

-- The DELETE policy above is explicitly PROVISIONAL for this
-- foundational migration only. The dedicated later
-- judgment_lifecycle_locking migration is reserved for finalization/
-- locking rules; 0027 deliberately does not invent final-Judgment
-- immutability ahead of that design. No is_admin() bypass anywhere on
-- this table, matching the "unlock is owner-only, never admin"
-- principle.
