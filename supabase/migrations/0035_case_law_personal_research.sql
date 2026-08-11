-- 0035_case_law_personal_research.sql
--
-- Refactors the live, legacy, single-tier `case_law` table (globally
-- readable to every authenticated user, admin-curated only -- see 0030's
-- and 0034's live-schema notes) into a dual-model table that supports
-- BOTH canonical/institutional legal authority AND privately owned
-- personal Case Law research, in the SAME table, distinguished purely
-- by nullable ownership -- exactly mirroring the architecture spec's §3
-- ownership-table intent. This is NOT a split into two tables; no new
-- table is created here.
--
-- CANONICAL / PERSONAL MODEL
--   owner_id IS NULL      -> canonical/institutional Case Law. Readable
--                            by every authenticated user regardless of
--                            is_discoverable. Creatable/editable/
--                            deletable by admins only (is_admin()),
--                            exactly as case_law has always worked.
--   owner_id IS NOT NULL  -> personal Case Law research, owned by
--                            exactly one magistrate. Private by default;
--                            readable to everyone once the owner sets
--                            is_discoverable = true (read-only
--                            extension, mirroring judgments/0027
--                            exactly -- discoverability never grants
--                            edit/delete). Creatable by any authenticated
--                            magistrate; editable/deletable by the owner
--                            only. No admin bypass into personal rows --
--                            Admin's canonical curation authority and a
--                            magistrate's personal-record privacy are
--                            deliberately separate concerns.
--
-- Ownership is immutable after creation (enforced by a guard trigger,
-- see below): a canonical record can never become personal, a personal
-- record can never become canonical or change owners, through ordinary
-- UPDATE. Converting personal research into canonical authority, if
-- ever wanted, requires a deliberate future curation workflow -- not
-- built here.
--
-- created_by is left EXACTLY as it already was (nullable, ON DELETE SET
-- NULL, provenance-only) and is NOT touched by this migration. It is
-- conceptually distinct from owner_id: created_by records who inserted
-- the row (an admin, for canonical rows); owner_id determines personal
-- ownership/access. For personal rows, owner_id is forced to the
-- creating magistrate's auth.uid() at INSERT time, so in practice
-- created_by and owner_id will normally coincide for personal rows, but
-- nothing here forces or assumes that -- owner_id is the sole authority
-- field; created_by remains historical-provenance-only, exactly as
-- before.
--
-- LIVE-SCHEMA FINDINGS FROM READINESS INSPECTION (all resolved below,
-- no unresolved privacy blocker):
--   1. Production `case_law` currently has ZERO rows. No backfill/data
--      migration of existing canonical rows is required; if rows had
--      existed they would already be canonical in spirit (created by
--      admins under the current admin-only INSERT policy), so the
--      correct backfill would have been `owner_id = NULL` for all of
--      them -- moot here since the table is empty.
--   2. `case_law_citation_idx` was a GLOBAL UNIQUE index on `citation`
--      alone. This is correct for canonical rows (no duplicate curated
--      authorities) but WRONG once personal rows exist: two different
--      magistrates (or the same magistrate) may legitimately create
--      independent personal research notes that happen to cite the same
--      real-world citation string, and that must not collide with each
--      other or with a canonical entry someone hasn't even necessarily
--      seen yet. This migration DROPS that global unique index and
--      replaces it with a PARTIAL unique index scoped to canonical rows
--      only (`where owner_id is null`) -- canonical citation uniqueness
--      is preserved exactly as before; personal rows have no citation
--      uniqueness constraint of any kind (deliberately not invented --
--      no per-owner citation uniqueness rule was specified, and one
--      isn't obviously correct the way per-owner code_word uniqueness
--      was for quick_codes, since citation is an external identifier,
--      not a user-invented shorthand).
--   3. `search_case_law()` is `LANGUAGE sql STABLE` with NO
--      `SECURITY DEFINER` (confirmed SECURITY INVOKER via
--      information_schema.routines) and selects directly from
--      `public.case_law` with no other bypass. It therefore already
--      respects RLS automatically and needs NO code change here -- once
--      case_law's SELECT policy narrows below, `search_case_law()`
--      transparently narrows with it, exactly like the nested-RLS
--      association tables. This was verified, not assumed -- there is
--      no known search bypass to leave in place.
--   4. `search_vector` is a GENERATED ALWAYS ... STORED column (not a
--      trigger), computed from case_name/citation/court/jurisdiction/
--      summary/full_text only. It is unaffected by adding owner_id/
--      is_discoverable (deliberately NOT folded into the generated
--      text -- ownership metadata is not searchable content) and
--      requires no change.
--   5. `case_law_tags` remains `SELECT using (true)` / INSERT-DELETE
--      `is_admin()`-only, UNCHANGED by this migration. Because ordinary
--      magistrates still have no INSERT path into case_law_tags after
--      0035, a personal Case Law row can never acquire a case_law_tags
--      association through any currently available path -- the
--      previously-identified Docket/Judgment-tag-style privacy problem
--      (a globally-visible tag join table leaking a private record's
--      existence/tags) cannot occur here today, so no redesign is
--      required. If a future migration ever lets owners tag their own
--      personal Case Law, that feature must receive the same
--      dedicated-owner-scoped-table treatment already given to
--      docket_matter_tags (0026) and judgment_tags (0028) at that time
--      -- recorded now, not built here.
--   6. `docket_matter_case_law` (0030) and `quick_code_case_law` (0034)
--      both express their Case-Law-side RLS as a live, unmodified
--      `EXISTS (select 1 from case_law cl where cl.id = ...)` with no
--      owner_id/is_discoverable reference of any kind. Neither table's
--      SQL is touched by this migration. Once case_law's own SELECT
--      policy narrows below, both association tables automatically and
--      silently begin respecting the new canonical/own/discoverable
--      predicate with zero code change -- this is the entire point of
--      the nested-RLS design approved for 0030 and reused for 0034, and
--      is the PRIMARY regression-test target the next time each table
--      is verified (their own Phase B/structural batteries already
--      passed under the OLD globally-true model; behavioral regression
--      proof of the NEW narrower model is the required follow-up once
--      0035 itself is applied and verified).
--
-- No `shares` logic is implemented here -- Case Law shares remain future
-- work, not a dependency of this migration.

-- ---------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------

alter table public.case_law
  add column owner_id uuid references public.profiles (id) on delete restrict,
  add column is_discoverable boolean not null default false;

comment on column public.case_law.owner_id is
  'Nullable. NULL = canonical/institutional Case Law (admin-curated, readable by all authenticated users regardless of is_discoverable). NOT NULL = personal Case Law research owned by exactly one magistrate, private by default. Immutable after creation (enforced by case_law_ownership_guard()) -- a canonical record can never become personal and a personal record can never become canonical or change owners via ordinary UPDATE. Forced to auth.uid() at INSERT time for any non-NULL submission (cannot be forged to another user); creating a NULL (canonical) row requires is_admin(). ON DELETE RESTRICT makes an owning profile impossible to hard-delete while personal Case Law exists.';
comment on column public.case_law.is_discoverable is
  'Owner-controlled, personal-rows-only read-only visibility extension, mirroring judgments.is_discoverable (0027) exactly. Meaningless/inert for canonical rows (owner_id IS NULL), which are already readable to everyone regardless of this flag. Discoverability never grants edit/delete authority -- only additional SELECT visibility. Defaults to false (private) for new personal rows.';

comment on table public.case_law is
  'Dual-model Case Law: canonical/institutional legal authority (owner_id IS NULL, admin-curated, globally readable, admin-only write) coexisting with privately owned personal Case Law research (owner_id IS NOT NULL, private by default with owner-controlled is_discoverable, owner-only write) in a single table -- see 0035. Ownership is immutable after creation. No admin bypass into personal rows; Admin''s canonical curation authority and a magistrate''s personal-record privacy are separate concerns. citation uniqueness is enforced only among canonical rows (case_law_citation_canonical_unique_idx); personal rows have no citation uniqueness constraint. docket_matter_case_law (0030) and quick_code_case_law (0034) both express Case-Law-side access as a live, unmodified EXISTS against this table, so they automatically inherit this new access model with zero change to either table.';

-- ---------------------------------------------------------------------
-- Ownership guard: forces/locks owner_id, gates canonical creation
-- ---------------------------------------------------------------------
--
-- INSERT: a NULL owner_id (canonical) is only permitted for an admin
-- (is_admin()); any non-NULL owner_id submission is forced to the
-- inserting user's own auth.uid(), regardless of what was submitted --
-- an ordinary magistrate cannot create a canonical row merely by
-- submitting NULL, and cannot create a personal row "owned" by anyone
-- but themselves.
--
-- UPDATE: owner_id is rejected outright if changed in any way -- NULL
-- to non-NULL, non-NULL to NULL, or non-NULL to a different non-NULL --
-- ownership/category identity is stable after creation.
create or replace function public.case_law_ownership_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.owner_id is null then
      if not (select public.is_admin()) then
        raise exception 'Only administrators may create canonical (owner_id IS NULL) Case Law records. Submit owner_id as your own profile to create a personal Case Law record instead.';
      end if;
    else
      new.owner_id := (select auth.uid());
    end if;
  elsif tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id then
      raise exception 'Case Law ownership is immutable: a canonical record cannot become personal, a personal record cannot become canonical, and personal ownership cannot be transferred, through UPDATE.';
    end if;
  end if;
  return new;
end;
$$;

create trigger case_law_ownership_guard_trigger
  before insert or update on public.case_law
  for each row execute function public.case_law_ownership_guard();

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------

-- Canonical-only citation uniqueness, replacing the old global unique
-- index -- see live-schema finding #2 above.
drop index if exists public.case_law_citation_idx;

create unique index case_law_citation_canonical_unique_idx
  on public.case_law (citation)
  where owner_id is null;

-- Covers case_law_owner_id_fkey and "my personal Case Law" / RLS
-- owner-equality lookups, matching the judgments_owner_id_idx (0027)
-- precedent exactly.
create index case_law_owner_id_idx
  on public.case_law (owner_id);

-- Partial index for browsing other magistrates' discoverable personal
-- Case Law research ordered by decided_date, matching the
-- judgments_discoverable_date_idx (0027) precedent -- refined further
-- than that precedent by also requiring owner_id is not null, since
-- (unlike judgments, where every row has an owner) a canonical row
-- could in principle have is_discoverable = true set on it without that
-- flag ever mattering to its own visibility; scoping the index to
-- personal rows keeps it aligned with the actual query pattern it
-- serves (personal discoverable browsing) rather than accidentally
-- also indexing canonical noise.
create index case_law_discoverable_decided_date_idx
  on public.case_law (decided_date desc)
  where owner_id is not null and is_discoverable = true;

-- case_law_created_by_idx, case_law_jurisdiction_idx, and
-- case_law_search_vector_idx are all unaffected and unchanged.

-- ---------------------------------------------------------------------
-- RLS -- replaces the four existing admin-only-write / globally-true-
-- read policies with the canonical/personal dual model
-- ---------------------------------------------------------------------

drop policy if exists "Case law is viewable by all authenticated users" on public.case_law;
drop policy if exists "Admins can insert case law" on public.case_law;
drop policy if exists "Admins can update case law" on public.case_law;
drop policy if exists "Admins can delete case law" on public.case_law;

create policy "Canonical, own, and discoverable Case Law is viewable"
  on public.case_law for select
  using (
    owner_id is null
    or owner_id = (select auth.uid())
    or is_discoverable = true
  );

create policy "Admins create canonical Case Law; magistrates create personal Case Law"
  on public.case_law for insert
  with check (
    (owner_id is null and (select public.is_admin()))
    or owner_id = (select auth.uid())
  );

create policy "Admins update canonical Case Law; owners update their personal Case Law"
  on public.case_law for update
  using (
    (owner_id is null and (select public.is_admin()))
    or owner_id = (select auth.uid())
  )
  with check (
    (owner_id is null and (select public.is_admin()))
    or owner_id = (select auth.uid())
  );

create policy "Admins delete canonical Case Law; owners delete their personal Case Law"
  on public.case_law for delete
  using (
    (owner_id is null and (select public.is_admin()))
    or owner_id = (select auth.uid())
  );

-- No shares logic. No case_law_tags change (see live-schema finding #5
-- above -- explicitly analyzed, not silently skipped). No
-- search_case_law()/search_vector change (see findings #3/#4 above --
-- verified safe, not assumed safe). docket_matter_case_law (0030) and
-- quick_code_case_law (0034) are NOT modified -- their nested-RLS design
-- automatically inherits this new model (see finding #6 above); their
-- behavior under it must be regression-tested the next time either
-- table is verified.
--
-- Explicitly NOT built in 0035: case_law_annotations, Case Law shares,
-- any personal-to-canonical/canonical-to-personal promotion workflow,
-- any change to case_law_tags/global tags, any change to
-- search_case_law()/search_vector, and any frontend surface.
