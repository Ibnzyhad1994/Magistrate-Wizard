-- 0037_shares.sql   (PREPARED FOR REVIEW ONLY -- NOT APPLIED)
--
-- REVISION NOTE: this replaces an earlier drafted version of 0037 that
-- was reviewed but never applied (0037 has never been applied to
-- Supabase, so revising it in place is permitted -- 0001-0036 remain
-- untouched). The earlier draft scoped a Docket share to the
-- docket_matters row alone. That draft contained a genuine, confirmed
-- defect (see "REVOCATION VISIBILITY" below) and was also functionally
-- too narrow to be useful (a recipient could see the Docket Matter
-- record but none of the institutional content that makes up a Docket
-- -- its appearances, parties, or tags). Both are corrected here.
--
-- Explicit view/edit sharing for the Court-Anchored Docket. A `shares`
-- row grants a named, registered recipient an ADDITIONAL, independent
-- access path to exactly one Docket Matter -- exceptional consultation
-- only, never ordinary succession, never a replacement for a genuine
-- Court assignment or retained/part-heard assignment. This completes the
-- three-path Docket SELECT/UPDATE predicate first described (and
-- deliberately left incomplete) in 0020, extended once already by 0022,
-- and now also extends the institutional Docket children
-- (docket_events/docket_matter_parties/docket_matter_tags) and the
-- Docket side of three association tables' SELECT predicates.
--
-- DELIBERATE SCOPE BOUNDARY (unchanged from the earlier draft) --
-- `item_type` is constrained to 'docket_matter' ONLY in this migration,
-- even though the architecture (§2/§3/§15 of the FINAL spec) already
-- names Judgments and personal Case Law as eventually shareable via this
-- same polymorphic table shape:
--
--   1. `item_id` is a genuine foreign key to docket_matters(id) in this
--      migration. Postgres cannot express a single FK that conditionally
--      targets different tables depending on item_type, and this
--      codebase has never yet built (or needed) a trigger-based
--      polymorphic-existence check -- the existing entity_type/entity_id
--      polymorphic tables (documents, bookmarks) are still on the
--      legacy per-column-FK design (0007/0008); their own polymorphic
--      refactor is explicitly future work (0039).
--   2. Creating a shares row whose item_type the *target* table's own
--      RLS does not yet consult (judgments/case_law RLS is NOT touched
--      here) would be exactly the "fake completeness" placeholder this
--      project has explicitly rejected everywhere else (0020/0022: "No
--      placeholder tables or functions are created to fake
--      completeness").
--
-- Widening `shares` to also support 'judgment' and 'case_law' -- both
-- the CHECK constraint and the corresponding judgments'/case_law's own
-- SELECT/UPDATE RLS extension -- remains explicit, disclosed FUTURE
-- work, staged the same incremental way the Docket three-path predicate
-- itself was staged. It is not implemented here. `case_law_annotations`
-- (strictly private owner work product, unaffected by any parent
-- sharing) and `judgment_tags` (Judgment sharing not live) are likewise
-- untouched -- see the closing notes.
--
-- ================================================================
-- WHAT CHANGED IN THIS REVISION, AND WHY
-- ================================================================
--
-- (A) CHILD INHERITANCE -- a Docket share now extends to the
--     institutional Docket children, applying each child's EXISTING
--     lifecycle semantics rather than inventing new ones:
--       docket_events            : existing lawful access = SELECT/
--                                   INSERT/UPDATE, no DELETE.
--                                   view share -> SELECT only.
--                                   edit share -> SELECT/INSERT/UPDATE.
--       docket_matter_parties    : existing lawful access = SELECT/
--                                   INSERT/UPDATE, no DELETE.
--                                   view share -> SELECT only.
--                                   edit share -> SELECT/INSERT/UPDATE.
--       docket_matter_tags       : existing lawful access = SELECT/
--                                   INSERT/DELETE, no UPDATE.
--                                   view share -> SELECT only.
--                                   edit share -> SELECT/INSERT/DELETE.
--     None of these three tables' own lifecycle rules change -- no
--     DELETE is added to events/parties, no UPDATE is added to tags,
--     purely because shares now exist. Each table's existing guard
--     trigger (provenance forcing/locking) is untouched and continues
--     to apply identically regardless of which access path (Court,
--     retained, or share) admitted the request.
--
-- (B) ASSOCIATION TABLES -- BOTH-sides preserved, Docket side widened
--     for SELECT only, conservatively:
--       docket_matter_judgments  : SELECT predicate's Docket-side
--                                   condition now includes an active
--                                   Docket share (view or edit). INSERT/
--                                   DELETE are NOT touched -- they keep
--                                   requiring Judgment ownership
--                                   specifically, exactly as approved
--                                   when 0029 was built. A Docket share
--                                   never broadens who may create or
--                                   remove this association; it only
--                                   changes who may see an already-
--                                   existing one, and only when the
--                                   Judgment side is independently
--                                   satisfied too (owner or
--                                   discoverable) -- a Docket share can
--                                   NEVER expose a private Judgment.
--       docket_matter_case_law   : identical treatment -- SELECT's
--                                   Docket-side condition widened,
--                                   INSERT/DELETE untouched.
--       quick_code_docket_matters: SELECT's Docket-side condition
--                                   widened by a view-or-edit share.
--                                   INSERT/DELETE's Docket-side
--                                   condition is widened by an EDIT
--                                   share specifically (per your
--                                   explicit preferred rule), but the
--                                   Quick-Code-side condition
--                                   (QuickCodeOwnership) is completely
--                                   untouched -- a Docket share can
--                                   NEVER expose, link, or unlink
--                                   another user's Quick Code. Quick
--                                   Codes remain unshareable and
--                                   owner-only in every respect.
--
-- (C) SHARE-ROW VISIBILITY / REVOCATION -- CORRECTED. The earlier draft
--     defined shares' own SELECT policy as granter-or-recipient only,
--     while separately defining an UPDATE (revocation) policy that also
--     permitted "any current lawful Docket-access holder." This was
--     empirically tested against live PostgreSQL/Supabase this turn
--     (a disposable, rolled-back probe against a throwaway table, not
--     the real schema) and CONFIRMED DEFECTIVE: a row that fails a
--     table's SELECT policy cannot be targeted by that table's UPDATE
--     policy, even when the UPDATE policy's own USING clause
--     independently evaluates to true for that row -- PostgreSQL
--     requires a row to be visible under SELECT before any UPDATE can
--     select it as a candidate. Under the earlier draft, a current
--     Court-assigned or retained magistrate who was neither the granter
--     nor the recipient of a given share could never actually revoke
--     it -- their UPDATE would silently affect zero rows despite
--     "passing" its own USING clause. This is now fixed: shares' SELECT
--     policy is widened to also include any current lawful Docket-
--     access holder for that matter (per your preferred model), so the
--     revocation UPDATE policy's matching condition is now genuinely
--     reachable. See has_docket_matter_authority() below for how this
--     is done without creating RLS recursion.
--
-- (D) HELPER FUNCTIONS -- two narrow, purpose-built helpers are
--     introduced (NOT the broader can_view_docket_matter()/
--     can_edit_docket_matter() architecture reserved for the later,
--     dedicated 0042_ownership_rls_helpers.sql):
--
--     has_docket_share(p_docket_matter_id, p_required_permission) --
--       SECURITY INVOKER. Used by docket_matters and every child/
--       association table above to check "does the current user hold
--       an active share on this Docket Matter at >= the required
--       permission level." Centralizes what would otherwise be six-plus
--       duplicated raw `shares` subqueries across six-plus policies.
--       edit implies view; view does not imply edit -- p_required_
--       permission = 'view' is satisfied by either permission value;
--       'edit' is satisfied only by permission = 'edit'.
--
--     has_docket_matter_authority(p_docket_matter_id) -- SECURITY
--       DEFINER, boolean-only, no raw data exposed. Used ONLY inside
--       shares' own RLS policies (SELECT/INSERT/UPDATE), to answer
--       "does the current user currently satisfy can_access_court() OR
--       has_retained_assignment() for this Docket Matter" WITHOUT
--       querying docket_matters through its own RLS-filtered table
--       reference. This is the one genuinely necessary use of SECURITY
--       DEFINER in this migration, and it exists specifically to break
--       a real RLS recursion risk: docket_matters' own SELECT/UPDATE
--       policies call has_docket_share(), which queries `shares`, which
--       is itself subject to shares' RLS -- if shares' RLS in turn
--       queried docket_matters through its NORMAL (RLS-filtered)
--       reference, that query would re-trigger docket_matters' policy,
--       which would call has_docket_share() again, which would query
--       shares again... an unbounded, structurally circular expansion
--       that PostgreSQL's RLS query rewriter does not detect or guard
--       against on its own. A SECURITY DEFINER function is opaque to
--       the calling query's RLS rewriter -- its own internal query runs
--       under the function owner's privileges (which bypass RLS on
--       docket_matters, since docket_matters does not have FORCE ROW
--       LEVEL SECURITY set), so the chain terminates there instead of
--       looping. The function is deliberately narrow: it returns only a
--       boolean derived from auth.uid() and the given matter id, mirror
--       ing the same safety reasoning already accepted for is_admin()
--       (SECURITY DEFINER, queries profiles directly, returns only a
--       boolean) -- no court_id or other row data is ever returned, and
--       a nonexistent or inaccessible docket_matter_id simply yields
--       false, so this function creates no existence-oracle beyond what
--       can_access_court()/has_retained_assignment() already expose
--       about the caller's own access. Like is_admin()/can_access_
--       court()/has_retained_assignment(), it remains executable by
--       anon/authenticated (required, since RLS policies evaluated for
--       those roles call it directly) -- safe for the same reason those
--       are safe: the output is a boolean derived from auth.uid(), which
--       is null for anon, so an anonymous caller only ever gets false.
--
-- (E) SELF-SHARE STRUCTURAL IMPOSSIBILITY -- the earlier draft blocked
--     self-sharing only via RLS WITH CHECK on INSERT (recipient_id IS
--     DISTINCT FROM auth.uid()), which does not protect against a
--     hypothetical future service-role/superuser write path that
--     bypasses RLS entirely. A table-level CHECK constraint
--     (shares_no_self_share) is added below as defense in depth, making
--     a live self-share row structurally impossible at the schema level,
--     not merely blocked at ordinary client INSERT -- see the
--     constraint's own commentary for why it is written to exempt rows
--     where either identity has already been nulled by offboarding.
--
-- RECIPIENT MODEL: registered BenchBook users only (profiles.id). No
-- external/email/public-link sharing exists or is invented here.
--
-- PERMISSION MODEL: exactly two levels, 'view' and 'edit', constrained
-- text (not a Postgres enum), matching docket_matter_assignments.reason/
-- docket_events.event_status. 'edit' implies 'view' everywhere it is
-- checked (see has_docket_share()); 'view' never implies 'edit'.
-- Immutable after creation -- changing a recipient's level is revoke-
-- then-create, not an in-place UPDATE (this table's only UPDATE policy
-- is narrowly for revocation).
--
-- CREATION AUTHORITY: any magistrate who currently satisfies
-- can_access_court(court_id) OR has_retained_assignment(id) for the
-- target Docket Matter (checked via has_docket_matter_authority()) --
-- never share-based. Holding a view or edit share never grants the
-- authority to create a new share -- see (C)/(D) above. This is the one
-- respect in which Docket shares are explicitly different from the
-- future Judgment/Case-Law shares design (which will be owner_id-based).
--
-- RESHARING: explicitly NOT permitted, for any permission level. An
-- edit share on the Docket Matter itself does NOT include the authority
-- to create further shares.
--
-- REVOCATION AUTHORITY: any CURRENT lawful Docket-access holder
-- (can_access_court() OR has_retained_assignment(), via has_docket_
-- matter_authority()) may revoke ANY share on that matter -- identical
-- to creation authority, never merely "whoever granted it," mirroring
-- the established, repeated project convention that DELETE/end
-- authority equals creation authority. Additionally, and separately,
-- the RECIPIENT of a share may always revoke (relinquish) their own
-- share, even with no independent Docket access. The original granter,
-- once they no longer hold ordinary/retained Docket access themselves,
-- has NO special revocation privilege beyond that -- granted_by is
-- provenance only. They can still SEE the row (shares' SELECT policy
-- keeps granted_by = auth.uid() as an independent visibility path, for
-- historical/provenance reasons), but seeing it is not the same as
-- being able to revoke it -- see (C) above for why this distinction is
-- real and was verified, not assumed.
--
-- LIFECYCLE / HISTORY MODEL: soft-revocation via `revoked_at`, NOT hard
-- DELETE -- no DELETE policy at all, mirroring docket_matter_
-- assignments.ended_at exactly. A revoked share row is never deleted
-- and never reactivated.
--
-- DUPLICATE-ACTIVE-SHARE RULE: at most one ACTIVE (revoked_at IS NULL)
-- share per (item_type, item_id, recipient_id), via a partial unique
-- index, directly reusing docket_matter_assignments_current_pair_idx's
-- pattern. Unlimited historical (revoked) rows for the same pair.
--
-- RECIPIENT / OFFBOARDING FK BEHAVIOR: recipient_id and granted_by are
-- BOTH `references profiles(id) on delete set null`, nullable at the
-- schema level ONLY to permit that FK action -- RLS WITH CHECK
-- independently requires both be real at creation. If recipient_id is
-- nulled by the FK action while the share is still active, revoked_at
-- is auto-set in the same operation -- an orphaned NULL-recipient row
-- can never grant access. If ONLY granted_by is nulled (the recipient's
-- own profile still exists), the share is NOT auto-revoked -- losing
-- provenance identity is not a reason to end a still-valid grant. See
-- shares_guard() for how the trigger tells these two transitions apart.
--
-- ADMIN BYPASS: none, anywhere, on this table, on docket_matters, or on
-- any child/association table touched below.
--
-- No can_view_docket_matter()/can_edit_docket_matter() or similar
-- BROADER reusable RLS helper is introduced here -- that architecture
-- remains reserved for the later, dedicated 0042_ownership_rls_
-- helpers.sql. The two helpers introduced in this migration
-- (has_docket_share/has_docket_matter_authority) are narrowly scoped to
-- the shares mechanism itself, not a general-purpose access API.

-- 1. shares table -------------------------------------------------------

create table public.shares (
  id uuid primary key default gen_random_uuid(),
  item_type text not null check (item_type in ('docket_matter')),
    -- constrained to 'docket_matter' only in this migration -- see the
    -- scope-boundary note above. Constrained text (not an enum) so
    -- 'judgment'/'case_law' can be added later without a type change.
  item_id uuid not null references public.docket_matters (id) on delete restrict,
    -- genuine FK, not a polymorphic reference -- valid only because
    -- item_type is presently constrained to a single value. RESTRICT
    -- matches the Court-Anchored Docket's judicial-history convention.
  recipient_id uuid references public.profiles (id) on delete set null,
    -- nullable at the schema level ONLY for the profile-deletion FK
    -- action -- RLS WITH CHECK independently requires a real, non-null,
    -- non-self recipient at creation. See header commentary.
  granted_by uuid references public.profiles (id) on delete set null,
    -- provenance only, mirroring docket_matter_assignments.granted_by
    -- exactly -- never a source of special revocation privilege.
  permission text not null check (permission in ('view', 'edit')),
    -- immutable after creation -- see header commentary. No default:
    -- a meaningful access-level choice must always be explicit.
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
    -- NULL = active. Sole source of truth for share state, matching
    -- docket_matter_assignments.ended_at -- no redundant boolean.
  constraint shares_revoked_after_created check (revoked_at is null or revoked_at >= created_at),
  constraint shares_no_self_share check (
    recipient_id is null or granted_by is null or recipient_id <> granted_by
  )
    -- Structural (schema-level) defense in depth against a self-share,
    -- independent of and in addition to the RLS WITH CHECK below.
    -- Deliberately exempts rows where EITHER identity has already been
    -- nulled by ordinary profile-deletion offboarding (ON DELETE SET
    -- NULL, above) -- otherwise a historical row could become
    -- unmodifiable, or a later, unrelated FK SET NULL transition on the
    -- SAME row (nulling the second of the two identities, in a separate
    -- deletion event) could be rejected by this constraint after the
    -- first identity was already nulled, which would incorrectly block
    -- a lawful, unrelated profile deletion. The constraint only ever
    -- does real work at creation time, when the RLS WITH CHECK below
    -- has already guaranteed both columns are non-null real identities.
);

comment on table public.shares is
  'Explicit view/edit sharing -- an additional, independent access path to one Docket Matter for a named, registered recipient, extending to the institutional Docket children (docket_events/docket_matter_parties/docket_matter_tags) and the Docket side of three association tables'' SELECT predicates. Exceptional consultation only, never ordinary succession, never a replacement for Court/retained assignment. item_type is constrained to ''docket_matter'' only in this migration (a deliberate, disclosed scope boundary -- see migration header); item_id is a genuine FK to docket_matters. permission is ''view'' (read-only, per each table''s existing SELECT-equivalent access) or ''edit'' (also satisfies each table''s existing mutation rights, subject to that table''s own unchanged lifecycle -- no DELETE where none existed, no UPDATE where none existed). No resharing. No admin bypass anywhere. Soft-revocation only via revoked_at (no DELETE policy). At most one ACTIVE share per (item_type, item_id, recipient_id). SELECT on this table is granter-or-recipient-or-current-Docket-access-holder (see has_docket_matter_authority()) -- widened from an earlier draft after confirming, by direct testing against live PostgreSQL, that a narrower SELECT policy would silently make the revocation UPDATE policy unreachable for anyone but the recipient.';
comment on column public.shares.item_type is
  'Constrained to ''docket_matter'' only in this migration. Widening to ''judgment''/''case_law'' requires a follow-up migration that also extends judgments''/case_law''s own SELECT/UPDATE RLS to consume it and resolves polymorphic item_id existence-validation (no precedent yet in this codebase).';
comment on column public.shares.item_id is
  'Genuine FK to docket_matters(id), ON DELETE RESTRICT -- valid only because item_type is presently single-valued.';
comment on column public.shares.recipient_id is
  'Registered profile receiving the additional access path. RLS requires a real, non-null, non-self recipient at creation. ON DELETE SET NULL preserves the historical grant record through profile deletion -- see shares_guard() for the auto-revocation-on-null-recipient behavior.';
comment on column public.shares.granted_by is
  'Provenance only. Never a source of special revocation privilege beyond being an ordinary current Docket-access holder. ON DELETE SET NULL preserves history; does NOT auto-revoke the share (see shares_guard()).';
comment on column public.shares.permission is
  '''view'' or ''edit''. edit implies view everywhere it is checked (has_docket_share()); view never implies edit. Immutable after creation.';
comment on column public.shares.revoked_at is
  'NULL = active. Set once, never cleared. Mirrors docket_matter_assignments.ended_at exactly.';

-- 2. updated_at -- intentionally NOT added, matching every other
--    add/revoke-only table in this project (docket_matter_tags,
--    judgment_tags, the association tables) rather than the
--    standalone-record convention.

-- 3. Indexes --------------------------------------------------------------

create unique index shares_active_unique_idx
  on public.shares (item_type, item_id, recipient_id)
  where revoked_at is null;

create index shares_item_idx on public.shares (item_type, item_id);
create index shares_recipient_id_idx on public.shares (recipient_id);
create index shares_granted_by_idx on public.shares (granted_by);

-- Serves "all of my received shares, active only" and has_docket_share().
create index shares_recipient_active_idx
  on public.shares (recipient_id, item_type, item_id)
  where revoked_at is null;

-- 4. shares_guard() -- provenance + revocation-only immutability,
--    including the profile-deletion FK-nulling case. Directly mirrors
--    protect_docket_matter_assignment_history() (0022), with one
--    deliberate divergence: nulling granted_by alone does NOT auto-
--    revoke (only nulling recipient_id does) -- see header commentary
--    (E)/OFFBOARDING above.

create or replace function public.shares_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_recipient_nulled boolean;
  v_granted_by_nulled boolean;
begin
  if tg_op = 'INSERT' then
    new.granted_by := (select auth.uid());
    return new;
  end if;

  -- tg_op = 'UPDATE' from here on.

  v_recipient_nulled := old.recipient_id is not null and new.recipient_id is null;
  v_granted_by_nulled := old.granted_by is not null and new.granted_by is null;

  if v_recipient_nulled or v_granted_by_nulled then
    -- Profile-deletion path: allow exactly recipient_id and/or
    -- granted_by moving to NULL, nothing else, and auto-revoke ONLY if
    -- recipient_id is the one being nulled and the share was still
    -- active -- a share can never be left "active but recipientless."
    -- Losing granted_by alone never revokes -- the grant itself remains
    -- valid; only its provenance identity is gone.
    if new.item_type is distinct from old.item_type
       or new.item_id is distinct from old.item_id
       or new.permission is distinct from old.permission
       or new.created_at is distinct from old.created_at
       or (new.recipient_id is distinct from old.recipient_id and not v_recipient_nulled)
       or (new.granted_by is distinct from old.granted_by and not v_granted_by_nulled) then
      raise exception 'Unexpected combined change alongside a recipient/granter removal on a Share';
    end if;

    if v_recipient_nulled and old.revoked_at is null then
      new.revoked_at := now();
    end if;

    return new;
  end if;

  -- Ordinary client path: only revoked_at may be set, once, and never
  -- cleared. Every other field is immutable after creation.
  if old.revoked_at is not null then
    raise exception 'Cannot modify an already-revoked Share';
  end if;

  if new.item_type is distinct from old.item_type
     or new.item_id is distinct from old.item_id
     or new.recipient_id is distinct from old.recipient_id
     or new.granted_by is distinct from old.granted_by
     or new.permission is distinct from old.permission
     or new.created_at is distinct from old.created_at then
    raise exception 'A Share may only have revoked_at set to revoke it; no other field may change';
  end if;

  if new.revoked_at is null then
    raise exception 'Reactivating a revoked Share is not permitted; create a new Share instead, subject to the ordinary creation authorization at that time';
  end if;

  return new;
end;
$$;

comment on function public.shares_guard() is 'Forces granted_by at INSERT. On UPDATE: permits ONLY setting revoked_at (once, never cleared) via the ordinary client path, and separately permits the recipient_id/granted_by FK''s own ON DELETE SET NULL action -- auto-revoking a still-active share ONLY when recipient_id is the column being nulled, never merely because granted_by is nulled.';

create trigger shares_guard_trigger
  before insert or update on public.shares
  for each row execute function public.shares_guard();

-- 5. Helper functions -------------------------------------------------------
-- See header commentary (D) for the full design rationale, including the
-- specific RLS-recursion risk has_docket_matter_authority() exists to
-- avoid.

create or replace function public.has_docket_matter_authority(p_docket_matter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.docket_matters dm
    where dm.id = p_docket_matter_id
      and ((select public.can_access_court(dm.court_id))
           or (select public.has_retained_assignment(dm.id)))
  );
$$;

comment on function public.has_docket_matter_authority(uuid) is 'True if the authenticated user currently satisfies can_access_court() OR has_retained_assignment() for the given Docket Matter -- i.e. ordinary lawful Docket access, NEVER share-based. SECURITY DEFINER, deliberately: queries docket_matters directly, bypassing its own RLS, so this function can safely be called FROM WITHIN shares'' own RLS policies without re-triggering docket_matters'' policy (which itself calls has_docket_share(), which queries shares) -- breaking what would otherwise be a structurally circular RLS dependency. Returns only a boolean derived from auth.uid() and the given id; no row data (e.g. court_id) is ever exposed. Used ONLY for shares-management authority (create/revoke/see-for-management-purposes) -- NEVER used to grant Docket Matter access itself (that remains can_access_court()/has_retained_assignment() called directly, or has_docket_share() for the share path).';

create or replace function public.has_docket_share(p_docket_matter_id uuid, p_required_permission text default 'view')
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.shares s
    where s.item_type = 'docket_matter'
      and s.item_id = p_docket_matter_id
      and s.recipient_id = (select auth.uid())
      and s.revoked_at is null
      and (p_required_permission = 'view' or s.permission = 'edit')
  );
$$;

comment on function public.has_docket_share(uuid, text) is 'True if the authenticated user holds a currently-active (revoked_at IS NULL) Docket share on the given Docket Matter, at or above the required permission level. p_required_permission defaults to ''view'' -- pass ''edit'' to require edit specifically. edit implies view (satisfies a ''view'' check); view never satisfies an ''edit'' check. SECURITY INVOKER: queries shares as the calling user, subject to shares'' own RLS as normal -- safe from recursion because shares'' RLS only reaches back into docket_matters via the SECURITY DEFINER has_docket_matter_authority(), never through a normal RLS-filtered reference. Used by docket_matters and its institutional children/association tables to extend view/edit access via an active share, alongside (never replacing) can_access_court()/has_retained_assignment().';

-- 6. Row Level Security on shares itself -----------------------------------

alter table public.shares enable row level security;

create policy "Share visibility for management"
  on public.shares for select
  using (
    granted_by = (select auth.uid())
    or recipient_id = (select auth.uid())
    or (
      item_type = 'docket_matter'
      and (select public.has_docket_matter_authority(item_id))
    )
  );

create policy "Current Docket-access holders can create Shares"
  on public.shares for insert
  with check (
    item_type = 'docket_matter'
    and (select public.has_docket_matter_authority(item_id))
    and granted_by = (select auth.uid())
    and recipient_id is not null
    and recipient_id is distinct from (select auth.uid())
  );

create policy "Current Docket-access holders and recipients can revoke Shares"
  on public.shares for update
  using (
    (
      item_type = 'docket_matter'
      and (select public.has_docket_matter_authority(item_id))
    )
    or recipient_id = (select auth.uid())
  )
  with check (
    (
      item_type = 'docket_matter'
      and (select public.has_docket_matter_authority(item_id))
    )
    or recipient_id = (select auth.uid())
  );

-- No DELETE policy: revocation is soft, via revoked_at. No admin bypass,
-- anywhere on this table.
--
-- Resharing: NOT possible through this table's own INSERT policy --
-- holding a share (any permission level) does not itself satisfy
-- has_docket_matter_authority(), so a share recipient cannot create
-- further shares on the strength of their share alone.
--
-- Share-row enumeration: a user with NO relationship to a Docket Matter
-- (not granter, not recipient, no current Court/retained access to it)
-- satisfies none of the three SELECT branches -- item_id, recipient_id,
-- permission, grantor, and active/revoked history of a share on a
-- matter they have nothing to do with are never visible to them.

-- 7. Extend docket_matters RLS (SELECT/UPDATE only) ------------------------
-- Adds the third and final path to the two policies already extended
-- once in 0022. INSERT is unchanged. DELETE remains unimplemented.

alter policy "Magistrates can view Docket Matters at their current courts"
  on public.docket_matters
  using (
    (select public.can_access_court(court_id))
    or (select public.has_retained_assignment(id))
    or (select public.has_docket_share(id, 'view'))
  );

alter policy "Magistrates can update Docket Matters at their current courts"
  on public.docket_matters
  using (
    (select public.can_access_court(court_id))
    or (select public.has_retained_assignment(id))
    or (select public.has_docket_share(id, 'edit'))
  )
  with check (
    (select public.can_access_court(court_id))
    or (select public.has_retained_assignment(id))
    or (select public.has_docket_share(id, 'edit'))
  );

-- An edit share NEVER grants: DELETE (no policy exists for anyone),
-- ownership (docket_matters has none), Court assignment, retained
-- assignment, or resharing. It grants exactly the same blanket full-row
-- UPDATE capability the other two paths already have -- no column-level
-- restriction exists anywhere in this project's Docket RLS, so none is
-- invented for shares specifically. last_updated_by/district_id remain
-- entirely trigger-derived, never client-writable, regardless of access
-- path -- docket_matters_guard() is untouched by this migration.

-- 8. Extend docket_events RLS (SELECT/INSERT/UPDATE; no DELETE exists) -----
-- view share -> SELECT only. edit share -> SELECT/INSERT/UPDATE, same as
-- ordinary lawful Docket access. Existing created_by/presiding_
-- magistrate_id provenance requirements on INSERT/UPDATE, and
-- docket_events_guard()'s forcing/locking of those columns, are
-- completely untouched -- they apply identically regardless of which
-- access path (Court, retained, or share) admitted the request.

alter policy "Magistrates can view Docket Events for accessible Docket Matters"
  on public.docket_events
  using (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_events.docket_matter_id
        and (
          (select public.can_access_court(dm.court_id))
          or (select public.has_retained_assignment(dm.id))
        )
    )
    or (select public.has_docket_share(docket_events.docket_matter_id, 'view'))
  );

alter policy "Magistrates can create Docket Events for accessible Docket Matters"
  on public.docket_events
  with check (
    (
      exists (
        select 1 from public.docket_matters dm
        where dm.id = docket_events.docket_matter_id
          and (
            (select public.can_access_court(dm.court_id))
            or (select public.has_retained_assignment(dm.id))
          )
      )
      or (select public.has_docket_share(docket_events.docket_matter_id, 'edit'))
    )
    and created_by = (select auth.uid())
    and presiding_magistrate_id = (select auth.uid())
  );

alter policy "Magistrates can update Docket Events for accessible Docket Matters"
  on public.docket_events
  using (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_events.docket_matter_id
        and (
          (select public.can_access_court(dm.court_id))
          or (select public.has_retained_assignment(dm.id))
        )
    )
    or (select public.has_docket_share(docket_events.docket_matter_id, 'edit'))
  )
  with check (
    (
      exists (
        select 1 from public.docket_matters dm
        where dm.id = docket_events.docket_matter_id
          and (
            (select public.can_access_court(dm.court_id))
            or (select public.has_retained_assignment(dm.id))
          )
      )
      or (select public.has_docket_share(docket_events.docket_matter_id, 'edit'))
    )
    and presiding_magistrate_id is not null
  );

-- Still no DELETE policy on docket_events, for anyone, share or not.

-- 9. Extend docket_matter_parties RLS (SELECT/INSERT/UPDATE; no DELETE) ----
-- Identical treatment to docket_events. Existing created_by/last_
-- updated_by provenance and docket_matter_parties_guard() untouched.

alter policy "Magistrates can view Docket Matter Parties"
  on public.docket_matter_parties
  using (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_matter_parties.docket_matter_id
        and (
          (select public.can_access_court(dm.court_id))
          or (select public.has_retained_assignment(dm.id))
        )
    )
    or (select public.has_docket_share(docket_matter_parties.docket_matter_id, 'view'))
  );

alter policy "Magistrates can create Docket Matter Parties"
  on public.docket_matter_parties
  with check (
    (
      exists (
        select 1 from public.docket_matters dm
        where dm.id = docket_matter_parties.docket_matter_id
          and (
            (select public.can_access_court(dm.court_id))
            or (select public.has_retained_assignment(dm.id))
          )
      )
      or (select public.has_docket_share(docket_matter_parties.docket_matter_id, 'edit'))
    )
    and created_by = (select auth.uid())
  );

alter policy "Magistrates can update Docket Matter Parties"
  on public.docket_matter_parties
  using (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_matter_parties.docket_matter_id
        and (
          (select public.can_access_court(dm.court_id))
          or (select public.has_retained_assignment(dm.id))
        )
    )
    or (select public.has_docket_share(docket_matter_parties.docket_matter_id, 'edit'))
  )
  with check (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_matter_parties.docket_matter_id
        and (
          (select public.can_access_court(dm.court_id))
          or (select public.has_retained_assignment(dm.id))
        )
    )
    or (select public.has_docket_share(docket_matter_parties.docket_matter_id, 'edit'))
  );

-- Still no DELETE policy on docket_matter_parties, for anyone.

-- 10. Extend docket_matter_tags RLS (SELECT/INSERT/DELETE; no UPDATE) ------
-- view share -> SELECT only. edit share -> SELECT/INSERT/DELETE, same as
-- ordinary lawful Docket access (this table's own add/remove-only
-- lifecycle is untouched -- still no UPDATE policy, for anyone).
-- docket_matter_tags_guard()'s created_by forcing is untouched.

alter policy "Magistrates can view Docket Matter Tags"
  on public.docket_matter_tags
  using (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_matter_tags.docket_matter_id
        and ((select public.can_access_court(dm.court_id))
             or (select public.has_retained_assignment(dm.id)))
    )
    or (select public.has_docket_share(docket_matter_tags.docket_matter_id, 'view'))
  );

alter policy "Magistrates can add Docket Matter Tags"
  on public.docket_matter_tags
  with check (
    (
      exists (
        select 1 from public.docket_matters dm
        where dm.id = docket_matter_tags.docket_matter_id
          and ((select public.can_access_court(dm.court_id))
               or (select public.has_retained_assignment(dm.id)))
      )
      or (select public.has_docket_share(docket_matter_tags.docket_matter_id, 'edit'))
    )
    and created_by = (select auth.uid())
  );

alter policy "Magistrates can remove Docket Matter Tags"
  on public.docket_matter_tags
  using (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_matter_tags.docket_matter_id
        and ((select public.can_access_court(dm.court_id))
             or (select public.has_retained_assignment(dm.id)))
    )
    or (select public.has_docket_share(docket_matter_tags.docket_matter_id, 'edit'))
  );

-- 11. Extend docket_matter_judgments RLS -- SELECT ONLY, conservative ------
-- INSERT/DELETE remain completely untouched: they still require lawful
-- Docket access (Court/retained -- NOT share-based) AND Judgment
-- ownership specifically, exactly as approved when 0029 was built. A
-- Docket share broadens who may SEE an already-existing association --
-- and only when the Judgment side is independently satisfied too (owner
-- or discoverable) -- it never broadens who may create or remove one,
-- and it can NEVER expose a private (non-owned, non-discoverable)
-- Judgment merely because the Docket Matter is shared.

alter policy "Magistrates can view accessible Docket Matter Judgments"
  on public.docket_matter_judgments
  using (
    (
      exists (
        select 1 from public.docket_matters dm
        where dm.id = docket_matter_judgments.docket_matter_id
          and ((select public.can_access_court(dm.court_id))
               or (select public.has_retained_assignment(dm.id)))
      )
      or (select public.has_docket_share(docket_matter_judgments.docket_matter_id, 'view'))
    )
    and exists (
      select 1 from public.judgments j
      where j.id = docket_matter_judgments.judgment_id
        and (j.owner_id = (select auth.uid()) or j.is_discoverable = true)
    )
  );

-- 12. Extend docket_matter_case_law RLS -- SELECT ONLY, conservative -------
-- Identical treatment and identical rationale to docket_matter_
-- judgments above. INSERT/DELETE untouched -- still lawful Docket access
-- (Court/retained only) AND Case Law read access, exactly as approved
-- when 0030 was built.

alter policy "Magistrates can view accessible Docket Matter Case Law"
  on public.docket_matter_case_law
  using (
    (
      exists (
        select 1 from public.docket_matters dm
        where dm.id = docket_matter_case_law.docket_matter_id
          and ((select public.can_access_court(dm.court_id))
               or (select public.has_retained_assignment(dm.id)))
      )
      or (select public.has_docket_share(docket_matter_case_law.docket_matter_id, 'view'))
    )
    and exists (
      select 1 from public.case_law cl
      where cl.id = docket_matter_case_law.case_law_id
    )
  );

-- 13. Extend quick_code_docket_matters RLS -- SELECT/INSERT/DELETE --------
-- Per your explicit preferred rule: a VIEW share satisfies the Docket
-- side for SELECT only. An EDIT share additionally satisfies the Docket
-- side for INSERT/DELETE, but ONLY where the existing, completely
-- untouched Quick-Code-side condition (QuickCodeOwnership --
-- owner_id = auth.uid()) is independently met. A Docket share can NEVER
-- expose, link, or unlink another user's Quick Code -- Quick Codes
-- remain owner-only in every respect; this migration adds no shares.item
-- _type for them and does not alter quick_codes' own RLS at all.

alter policy "Owners can view accessible Quick Code Docket Matter links"
  on public.quick_code_docket_matters
  using (
    (
      exists (
        select 1 from public.docket_matters dm
        where dm.id = quick_code_docket_matters.docket_matter_id
          and ((select public.can_access_court(dm.court_id))
               or (select public.has_retained_assignment(dm.id)))
      )
      or (select public.has_docket_share(quick_code_docket_matters.docket_matter_id, 'view'))
    )
    and exists (
      select 1 from public.quick_codes qc
      where qc.id = quick_code_docket_matters.quick_code_id
        and qc.owner_id = (select auth.uid())
    )
  );

alter policy "Owners can link their Quick Codes to accessible Docket Matters"
  on public.quick_code_docket_matters
  with check (
    (
      exists (
        select 1 from public.docket_matters dm
        where dm.id = quick_code_docket_matters.docket_matter_id
          and ((select public.can_access_court(dm.court_id))
               or (select public.has_retained_assignment(dm.id)))
      )
      or (select public.has_docket_share(quick_code_docket_matters.docket_matter_id, 'edit'))
    )
    and exists (
      select 1 from public.quick_codes qc
      where qc.id = quick_code_docket_matters.quick_code_id
        and qc.owner_id = (select auth.uid())
    )
    and created_by = (select auth.uid())
  );

alter policy "Owners can unlink their Quick Codes from accessible Docket Matters"
  on public.quick_code_docket_matters
  using (
    (
      exists (
        select 1 from public.docket_matters dm
        where dm.id = quick_code_docket_matters.docket_matter_id
          and ((select public.can_access_court(dm.court_id))
               or (select public.has_retained_assignment(dm.id)))
      )
      or (select public.has_docket_share(quick_code_docket_matters.docket_matter_id, 'edit'))
    )
    and exists (
      select 1 from public.quick_codes qc
      where qc.id = quick_code_docket_matters.quick_code_id
        and qc.owner_id = (select auth.uid())
    )
  );

-- ================================================================
-- EXPLICITLY NOT BUILT / NOT TOUCHED IN 0037
-- ================================================================
-- - judgment/case_law shares.item_type support, and the corresponding
--   judgments'/case_law's own SELECT/UPDATE RLS extension -- future work.
-- - judgment_tags -- untouched. Judgment sharing is not live; there is
--   nothing for a Judgment child to inherit from yet.
-- - case_law_annotations -- untouched, deliberately, on principle: even
--   once Case Law sharing exists, annotations are separately private
--   owner work product and must NOT become visible merely because the
--   parent Case Law is shared. Not applicable to this migration at all
--   (0037 grants no Case-Law-side access of any kind), but recorded here
--   so the principle is not lost before that future migration is designed.
-- - quick_codes' own RLS -- untouched. Quick Codes remain owner-only,
--   full stop; only the Docket side of quick_code_docket_matters'
--   predicate is widened, as described in section 13 above.
-- - docket_matter_judgments/docket_matter_case_law INSERT/DELETE --
--   untouched; still Docket access (Court/retained only) AND
--   Judgment-ownership/Case-Law-read-access respectively.
-- - Any reusable can_view_docket_matter()/can_edit_docket_matter()
--   helper -- reserved for 0042_ownership_rls_helpers.sql.
-- - Any UI/frontend surface.
