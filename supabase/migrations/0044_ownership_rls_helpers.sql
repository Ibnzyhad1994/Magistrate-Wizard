-- 0044_ownership_rls_helpers.sql
--
-- PURPOSE: centralize already-established Docket/Judgment/Case-Law
-- access predicates into six narrow, reusable, boolean helper
-- functions, replacing duplicated inline policy logic across ~14
-- tables. This migration invents NO new access rights and changes NO
-- access outcome anywhere -- it is a pure semantic refactor, proven by
-- an exhaustive before/after regression matrix (run live, rollback-only,
-- prior to and after application). Deferred from 0037_shares.
--
-- HELPERS INTRODUCED:
--   can_view_docket_matter(p_docket_matter_id uuid)
--   can_edit_docket_matter(p_docket_matter_id uuid)
--   can_view_judgment(p_judgment_id uuid)
--   can_edit_judgment(p_judgment_id uuid)
--   can_view_case_law(p_case_law_id uuid)
--   can_edit_case_law(p_case_law_id uuid)
--
-- RECURSION ANALYSIS (proven live via rollback-only probe against a
-- disposable temp table + policy, not the real schema): a SECURITY
-- INVOKER helper that queries the SAME table whose RLS policy calls it
-- fails with "stack depth limit exceeded" -- confirmed empirically, not
-- assumed. The identical probe using a SECURITY DEFINER helper
-- succeeded, because SECURITY DEFINER changes the effective role for
-- the ENTIRE nested execution (including calls the helper itself makes
-- to lower-level SECURITY INVOKER helpers like can_access_court() or
-- has_docket_share()), so no query inside the helper ever re-triggers
-- RLS on the table it is protecting. Accordingly, all six helpers here
-- are SECURITY DEFINER with a fixed `search_path = public`, mirroring
-- the existing, already-accepted pattern used by has_docket_matter_-
-- authority() and is_admin().
--
-- DEPENDENCY GRAPH (mapped before writing SQL, to rule out the
-- can_view_docket_matter -> has_docket_share -> shares policy ->
-- has_docket_matter_authority -> docket_matters RLS -> back to
-- can_view_docket_matter cycle raised as a concern): can_view_docket_-
-- matter()/can_edit_docket_matter() are SECURITY DEFINER, so their
-- entire execution -- including the nested call to has_docket_share(),
-- which queries `shares` -- runs with RLS bypassed throughout. shares'
-- own SELECT policy (which calls the already-SECURITY-DEFINER has_-
-- docket_matter_authority()) is therefore never actually re-evaluated
-- as RLS during this call; the whole chain resolves as plain,
-- unfiltered lookups the entire way down. No cycle is possible.
--
-- WHICH SIX, AND WHY (not one more): live policy inspection found the
-- Docket view/edit and Judgment view/edit predicates duplicated
-- verbatim across 5+ and 3+ tables respectively -- clearly justified.
-- Case Law view is duplicated (some places textually, some via
-- plain-nested RLS pass-through) across 4 tables. Case Law edit's
-- asymmetric canonical-admin/personal-owner rule is used only by
-- case_law's own UPDATE/DELETE in practice, but is built anyway
-- because (a) it is needed for recursion-safety on case_law's own
-- self-referential policy exactly like the other five, and (b) it
-- documents the tricky asymmetric rule in one place rather than
-- leaving it inline. No seventh helper (e.g. a generic
-- can_view_quick_code()) was built: Quick Codes have exactly one
-- predicate everywhere (owner_id = auth.uid()), already trivial and
-- never duplicated in a form that benefits from a wrapper.
--
-- A NOTABLE MECHANISM CHANGE, DISCLOSED: several of the policies
-- rewritten here (`docket_matter_case_law`, `quick_code_case_law`,
-- `case_law_annotations`, and the case_law/judgment branches of
-- `documents`) currently use a "plain nested EXISTS" against the
-- protected table with no explicit owner/discoverable predicate
-- written out -- relying on Postgres re-applying that table's own RLS
-- transparently to the subquery (SECURITY INVOKER context). That
-- pattern auto-inherits any FUTURE change to the parent table's RLS
-- for free. Swapping in a SECURITY DEFINER helper is behavior-IDENTICAL
-- today (proven by the regression matrix) but changes the mechanism to
-- a decorated, explicit duplicate that must be kept in sync by hand if
-- the parent policy ever changes -- the same tradeoff already accepted
-- elsewhere in this codebase (e.g. 0040's decorated INSERT predicates).
-- This is disclosed, not hidden, and is what Part B asked this
-- migration to do (centralize duplicated logic).
--
-- WHAT IS DELIBERATELY NOT TOUCHED:
--   * has_docket_matter_authority() is REUSED, not replaced or
--     duplicated, for docket_matter_judgments and docket_matter_-
--     case_law's INSERT/DELETE Docket-side predicate. Live inspection
--     showed this predicate is can_access_court() OR has_retained_-
--     assignment() ONLY -- deliberately narrower than the full
--     can_edit_docket_matter() (which also accepts an active edit
--     Share). Substituting can_edit_docket_matter() there would have
--     been a genuine, unauthorized widening (Docket edit-share holders
--     would gain Judgment/Case-Law linking rights they do not have
--     today) -- caught by direct inspection, not assumed uniform.
--     quick_code_docket_matters' INSERT/DELETE, by contrast, DOES
--     already use the full edit-share-inclusive predicate today, so it
--     correctly uses can_edit_docket_matter() here -- these two
--     association families are NOT symmetric, and both are preserved
--     exactly as found.
--   * can_access_court(), has_retained_assignment(), has_docket_-
--     share(), has_docket_matter_authority(), is_admin() are all left
--     completely unmodified and are composed by the new helpers, not
--     duplicated.
--   * The 0043 identity resolvers (resolve_docket_assignment_identity,
--     resolve_docket_share_identity) are left unmodified. They could
--     technically call can_view_docket_matter() instead of their
--     inline three-path predicate, but doing so would add a second
--     SECURITY DEFINER hop and a redundant docket_matters re-lookup
--     (the resolvers already have court_id in scope from their own
--     JOIN) for zero behavioral benefit, on code reviewed and applied
--     in the immediately preceding migration -- left alone per
--     instruction not to touch working, already-verified code merely
--     for cleanliness.
--   * search_case_law() is left unmodified -- it is SECURITY INVOKER
--     and already relies on case_law's own RLS safely and directly;
--     inserting can_view_case_law() would be redundant, not safer.
--   * storage.objects' policy is NOT touched. 0040 was just verified
--     across 92 scenarios; no helper substitution there is worth the
--     risk of regressing it for this migration's purposes.
--   * documents' Quick Code/Bench Note/Legacy Case branches, DELETE
--     policy, and the parent-delete cascade trigger are unmodified --
--     only the Docket Matter/Judgment/Case Law SELECT and INSERT
--     branches are substituted, per instruction.
--   * judgments/docket_matters/case_law INSERT policies are left
--     inline (`created_by/owner_id = auth.uid()` plus a court/role
--     check) -- these govern creation of a NEW row with no existing id
--     to evaluate view/edit against, a fundamentally different shape
--     than the helpers below.
--
-- GRANTS (Part E, proven live, not assumed): has_table_privilege()
-- confirms `anon` already holds base-table SELECT on judgments,
-- case_law, and docket_matters today (this project's schema-wide
-- default table grant, unrelated to this migration), and both
-- judgments' and case_law's existing SELECT RLS already have an
-- is_discoverable=true branch with NO auth.uid() dependency --
-- meaning fully unauthenticated callers can ALREADY read complete
-- discoverable Judgment/Case-Law rows directly today, not merely a
-- boolean. Making these six helpers anon-executable therefore creates
-- NO new information-oracle: the strongest thing anon could learn via
-- can_view_judgment(uuid) (whether a discoverable Judgment exists at
-- that id) is strictly less revealing than what anon can already query
-- directly. can_view_docket_matter/can_edit_docket_matter/can_edit_-
-- judgment/can_edit_case_law are 100% auth.uid()-gated with no public
-- branch at all, so they return false for anon unconditionally --
-- exactly like the existing can_access_court()/has_retained_-
-- assignment()/has_docket_matter_authority(), which remain anon-
-- executable today by the same schema default and generate the same
-- accepted advisor WARN class. Consequently, and unlike 0043's
-- resolvers (which were introducing a brand-new capability), these six
-- helpers are left on the schema default grant -- explicitly revoking
-- EXECUTE from anon here would itself be an unintended behavior change
-- (anon querying these tables would start getting a hard "permission
-- denied for function" error instead of the current silent
-- empty/RLS-filtered result), which is exactly what this migration is
-- required not to introduce.
--
-- NULL/AUTH SAFETY: every helper returns a plain boolean computed from
-- an EXISTS(...) test -- false for NULL auth.uid(), false for a NULL or
-- nonexistent id (no row to match), false for an inaccessible row.
-- None can throw on an ordinary lookup miss.

create or replace function public.can_view_docket_matter(p_docket_matter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.docket_matters dm
    where dm.id = p_docket_matter_id
      and (
        public.can_access_court(dm.court_id)
        or public.has_retained_assignment(dm.id)
        or public.has_docket_share(dm.id, 'view')
      )
  );
$$;

comment on function public.can_view_docket_matter(uuid) is
  'Centralizes the current full lawful Docket read envelope: current Court assignment (can_access_court) OR retained/part-heard assignment (has_retained_assignment) OR an active view-or-edit Docket share (has_docket_share(id, ''view'')). No admin bypass. SECURITY DEFINER (required -- used inside docket_matters'' own SELECT policy; a SECURITY INVOKER version querying docket_matters from within docket_matters'' own policy causes "stack depth limit exceeded", proven live). Returns false for a nonexistent/inaccessible id or a NULL auth.uid().';

create or replace function public.can_edit_docket_matter(p_docket_matter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.docket_matters dm
    where dm.id = p_docket_matter_id
      and (
        public.can_access_court(dm.court_id)
        or public.has_retained_assignment(dm.id)
        or public.has_docket_share(dm.id, 'edit')
      )
  );
$$;

comment on function public.can_edit_docket_matter(uuid) is
  'Centralizes the current Docket edit envelope: current Court assignment OR retained assignment OR an active EDIT (not view) Docket share. A view-only share is insufficient. No admin bypass, no DELETE implication (Docket Matters have no DELETE policy at all). SECURITY DEFINER (required, same recursion reasoning as can_view_docket_matter). NOT the same predicate as has_docket_matter_authority() (which excludes shares entirely) -- docket_matter_judgments/docket_matter_case_law INSERT/DELETE deliberately keep using has_docket_matter_authority(), not this function, to preserve their existing, narrower mutation rule.';

create or replace function public.can_view_judgment(p_judgment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.judgments j
    where j.id = p_judgment_id
      and (j.owner_id = (select auth.uid()) or j.is_discoverable = true)
  );
$$;

comment on function public.can_view_judgment(uuid) is
  'Centralizes the current live Judgment read envelope: owner OR is_discoverable = true. No Judgment shares exist yet -- this function deliberately does not anticipate any future dormant share logic. SECURITY DEFINER (required -- used inside judgments'' own SELECT policy; recursion-safety proven live). is_discoverable has no auth.uid() dependency, so this can return true for anon -- disclosed as not a new oracle, since anon already has direct table-level SELECT on judgments today and this predicate is strictly less revealing than a direct query.';

create or replace function public.can_edit_judgment(p_judgment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.judgments j
    where j.id = p_judgment_id
      and j.owner_id = (select auth.uid())
  );
$$;

comment on function public.can_edit_judgment(uuid) is
  'Centralizes the current live Judgment edit envelope: owner only, no exceptions, no admin bypass, no discoverable-reader mutation. Deliberately does NOT anticipate 0045 lifecycle-locking state -- this describes present ownership authorization only; any future "can edit while draft" narrowing is a separate, later concern layered on top, not built here. SECURITY DEFINER for the same recursion-safety reasoning as the others.';

create or replace function public.can_view_case_law(p_case_law_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.case_law cl
    where cl.id = p_case_law_id
      and (cl.owner_id is null or cl.owner_id = (select auth.uid()) or cl.is_discoverable = true)
  );
$$;

comment on function public.can_view_case_law(uuid) is
  'Centralizes the current live Case Law read envelope: canonical (owner_id IS NULL) OR personal owner OR discoverable personal. No admin read bypass into another user''s private personal research -- canonical rows are readable by everyone regardless of admin status, and admin gains no special access to a non-owned, non-discoverable personal row. SECURITY DEFINER (required -- used inside case_law''s own SELECT policy; recursion-safety proven live). Canonical/discoverable branches have no auth.uid() dependency, so this can return true for anon on those rows -- not a new oracle, since anon already has direct table-level SELECT on case_law today.';

create or replace function public.can_edit_case_law(p_case_law_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.case_law cl
    where cl.id = p_case_law_id
      and (
        (cl.owner_id is null and public.is_admin())
        or cl.owner_id = (select auth.uid())
      )
  );
$$;

comment on function public.can_edit_case_law(uuid) is
  'Centralizes the current live, deliberately ASYMMETRIC Case Law edit envelope: admin may edit canonical (owner_id IS NULL) rows; an owner may edit their own personal row; admin may NOT edit another user''s personal Case Law merely by being admin. This is intentionally NOT collapsed into a generic is_admin() OR owner_id = auth.uid() -- that would incorrectly let admin edit any personal row. SECURITY DEFINER for the same recursion-safety reasoning as the others. In practice consumed only by case_law''s own UPDATE/DELETE policies today; built regardless for recursion-safety and to document this asymmetric rule in one place.';

-- ==================== docket_matters ====================

drop policy "Magistrates can view Docket Matters at their current courts" on public.docket_matters;
create policy "Magistrates can view Docket Matters at their current courts"
  on public.docket_matters for select
  using (public.can_view_docket_matter(id));

drop policy "Magistrates can update Docket Matters at their current courts" on public.docket_matters;
create policy "Magistrates can update Docket Matters at their current courts"
  on public.docket_matters for update
  using (public.can_edit_docket_matter(id))
  with check (public.can_edit_docket_matter(id));

-- INSERT policy (create-time, no existing row) intentionally left inline/untouched.

-- ==================== docket_events ====================

drop policy "Magistrates can view Docket Events for accessible Docket Matter" on public.docket_events;
create policy "Magistrates can view Docket Events for accessible Docket Matter"
  on public.docket_events for select
  using (public.can_view_docket_matter(docket_matter_id));

drop policy "Magistrates can create Docket Events for accessible Docket Matt" on public.docket_events;
create policy "Magistrates can create Docket Events for accessible Docket Matt"
  on public.docket_events for insert
  with check (
    public.can_edit_docket_matter(docket_matter_id)
    and created_by = (select auth.uid())
    and presiding_magistrate_id = (select auth.uid())
  );

drop policy "Magistrates can update Docket Events for accessible Docket Matt" on public.docket_events;
create policy "Magistrates can update Docket Events for accessible Docket Matt"
  on public.docket_events for update
  using (public.can_edit_docket_matter(docket_matter_id))
  with check (
    public.can_edit_docket_matter(docket_matter_id)
    and presiding_magistrate_id is not null
  );

-- ==================== docket_matter_parties ====================

drop policy "Magistrates can view Docket Matter Parties" on public.docket_matter_parties;
create policy "Magistrates can view Docket Matter Parties"
  on public.docket_matter_parties for select
  using (public.can_view_docket_matter(docket_matter_id));

drop policy "Magistrates can create Docket Matter Parties" on public.docket_matter_parties;
create policy "Magistrates can create Docket Matter Parties"
  on public.docket_matter_parties for insert
  with check (
    public.can_edit_docket_matter(docket_matter_id)
    and created_by = (select auth.uid())
  );

drop policy "Magistrates can update Docket Matter Parties" on public.docket_matter_parties;
create policy "Magistrates can update Docket Matter Parties"
  on public.docket_matter_parties for update
  using (public.can_edit_docket_matter(docket_matter_id))
  with check (public.can_edit_docket_matter(docket_matter_id));

-- ==================== docket_matter_tags ====================

drop policy "Magistrates can view Docket Matter Tags" on public.docket_matter_tags;
create policy "Magistrates can view Docket Matter Tags"
  on public.docket_matter_tags for select
  using (public.can_view_docket_matter(docket_matter_id));

drop policy "Magistrates can add Docket Matter Tags" on public.docket_matter_tags;
create policy "Magistrates can add Docket Matter Tags"
  on public.docket_matter_tags for insert
  with check (
    public.can_edit_docket_matter(docket_matter_id)
    and created_by = (select auth.uid())
  );

drop policy "Magistrates can remove Docket Matter Tags" on public.docket_matter_tags;
create policy "Magistrates can remove Docket Matter Tags"
  on public.docket_matter_tags for delete
  using (public.can_edit_docket_matter(docket_matter_id));

-- ==================== judgments ====================

drop policy "Owners and discoverable readers can view Judgments" on public.judgments;
create policy "Owners and discoverable readers can view Judgments"
  on public.judgments for select
  using (public.can_view_judgment(id));

drop policy "Owners can update Judgments" on public.judgments;
create policy "Owners can update Judgments"
  on public.judgments for update
  using (public.can_edit_judgment(id))
  with check (public.can_edit_judgment(id));

drop policy "Owners can delete Judgments" on public.judgments;
create policy "Owners can delete Judgments"
  on public.judgments for delete
  using (public.can_edit_judgment(id));

-- INSERT policy (create-time, no existing row) intentionally left inline/untouched.

-- ==================== judgment_tags ====================

drop policy "Owners and discoverable readers can view Judgment Tags" on public.judgment_tags;
create policy "Owners and discoverable readers can view Judgment Tags"
  on public.judgment_tags for select
  using (public.can_view_judgment(judgment_id));

drop policy "Owners can add Judgment Tags" on public.judgment_tags;
create policy "Owners can add Judgment Tags"
  on public.judgment_tags for insert
  with check (
    public.can_edit_judgment(judgment_id)
    and created_by = (select auth.uid())
  );

drop policy "Owners can remove Judgment Tags" on public.judgment_tags;
create policy "Owners can remove Judgment Tags"
  on public.judgment_tags for delete
  using (public.can_edit_judgment(judgment_id));

-- ==================== docket_matter_judgments ====================
-- Mutation deliberately keeps has_docket_matter_authority() (Court OR
-- retained ONLY, no share) on the Docket side -- NOT can_edit_docket_-
-- matter() -- to preserve the existing, narrower link-mutation rule.

drop policy "Magistrates can view accessible Docket Matter Judgments" on public.docket_matter_judgments;
create policy "Magistrates can view accessible Docket Matter Judgments"
  on public.docket_matter_judgments for select
  using (
    public.can_view_docket_matter(docket_matter_id)
    and public.can_view_judgment(judgment_id)
  );

drop policy "Judgment owners can link accessible Docket Matters" on public.docket_matter_judgments;
create policy "Judgment owners can link accessible Docket Matters"
  on public.docket_matter_judgments for insert
  with check (
    public.has_docket_matter_authority(docket_matter_id)
    and public.can_edit_judgment(judgment_id)
    and created_by = (select auth.uid())
  );

drop policy "Judgment owners can unlink accessible Docket Matters" on public.docket_matter_judgments;
create policy "Judgment owners can unlink accessible Docket Matters"
  on public.docket_matter_judgments for delete
  using (
    public.has_docket_matter_authority(docket_matter_id)
    and public.can_edit_judgment(judgment_id)
  );

-- ==================== docket_matter_case_law ====================
-- Same deliberate has_docket_matter_authority() preservation as above.
-- Case-Law side has no ownership requirement (reusable reference
-- authority) -- can_view_case_law(), not can_edit_case_law().

drop policy "Magistrates can view accessible Docket Matter Case Law" on public.docket_matter_case_law;
create policy "Magistrates can view accessible Docket Matter Case Law"
  on public.docket_matter_case_law for select
  using (
    public.can_view_docket_matter(docket_matter_id)
    and public.can_view_case_law(case_law_id)
  );

drop policy "Magistrates can link readable Case Law to accessible Docket Mat" on public.docket_matter_case_law;
create policy "Magistrates can link readable Case Law to accessible Docket Mat"
  on public.docket_matter_case_law for insert
  with check (
    public.has_docket_matter_authority(docket_matter_id)
    and public.can_view_case_law(case_law_id)
    and created_by = (select auth.uid())
  );

drop policy "Magistrates can unlink Case Law from accessible Docket Matters" on public.docket_matter_case_law;
create policy "Magistrates can unlink Case Law from accessible Docket Matters"
  on public.docket_matter_case_law for delete
  using (
    public.has_docket_matter_authority(docket_matter_id)
    and public.can_view_case_law(case_law_id)
  );

-- ==================== quick_code_docket_matters ====================
-- Unlike the two association tables above, this one's mutation ALREADY
-- uses the full edit-share-inclusive predicate today -- can_edit_-
-- docket_matter() is the correct, behavior-preserving substitution
-- here, not has_docket_matter_authority(). These two association
-- families are not symmetric; both are preserved exactly as found.

drop policy "Owners can view accessible Quick Code Docket Matter links" on public.quick_code_docket_matters;
create policy "Owners can view accessible Quick Code Docket Matter links"
  on public.quick_code_docket_matters for select
  using (
    public.can_view_docket_matter(docket_matter_id)
    and exists (select 1 from public.quick_codes qc where qc.id = quick_code_docket_matters.quick_code_id and qc.owner_id = (select auth.uid()))
  );

drop policy "Owners can link their Quick Codes to accessible Docket Matters" on public.quick_code_docket_matters;
create policy "Owners can link their Quick Codes to accessible Docket Matters"
  on public.quick_code_docket_matters for insert
  with check (
    public.can_edit_docket_matter(docket_matter_id)
    and exists (select 1 from public.quick_codes qc where qc.id = quick_code_docket_matters.quick_code_id and qc.owner_id = (select auth.uid()))
    and created_by = (select auth.uid())
  );

drop policy "Owners can unlink their Quick Codes from accessible Docket Matt" on public.quick_code_docket_matters;
create policy "Owners can unlink their Quick Codes from accessible Docket Matt"
  on public.quick_code_docket_matters for delete
  using (
    public.can_edit_docket_matter(docket_matter_id)
    and exists (select 1 from public.quick_codes qc where qc.id = quick_code_docket_matters.quick_code_id and qc.owner_id = (select auth.uid()))
  );

-- ==================== quick_code_judgments ====================
-- Judgment side requires READ only (can_view_judgment), never
-- ownership -- unchanged deliberate difference from the Docket-side
-- association tables, preserved exactly.

drop policy "Owners can view their Quick Code Judgment links" on public.quick_code_judgments;
create policy "Owners can view their Quick Code Judgment links"
  on public.quick_code_judgments for select
  using (
    exists (select 1 from public.quick_codes qc where qc.id = quick_code_judgments.quick_code_id and qc.owner_id = (select auth.uid()))
    and public.can_view_judgment(judgment_id)
  );

drop policy "Owners can link their Quick Codes to readable Judgments" on public.quick_code_judgments;
create policy "Owners can link their Quick Codes to readable Judgments"
  on public.quick_code_judgments for insert
  with check (
    exists (select 1 from public.quick_codes qc where qc.id = quick_code_judgments.quick_code_id and qc.owner_id = (select auth.uid()))
    and public.can_view_judgment(judgment_id)
    and created_by = (select auth.uid())
  );

drop policy "Owners can unlink their Quick Codes from Judgments" on public.quick_code_judgments;
create policy "Owners can unlink their Quick Codes from Judgments"
  on public.quick_code_judgments for delete
  using (
    exists (select 1 from public.quick_codes qc where qc.id = quick_code_judgments.quick_code_id and qc.owner_id = (select auth.uid()))
    and public.can_view_judgment(judgment_id)
  );

-- ==================== quick_code_case_law ====================
-- Case-Law side requires READ only, mirroring quick_code_judgments.

drop policy "Owners can view their Quick Code Case Law links" on public.quick_code_case_law;
create policy "Owners can view their Quick Code Case Law links"
  on public.quick_code_case_law for select
  using (
    exists (select 1 from public.quick_codes qc where qc.id = quick_code_case_law.quick_code_id and qc.owner_id = (select auth.uid()))
    and public.can_view_case_law(case_law_id)
  );

drop policy "Owners can link their Quick Codes to readable Case Law" on public.quick_code_case_law;
create policy "Owners can link their Quick Codes to readable Case Law"
  on public.quick_code_case_law for insert
  with check (
    exists (select 1 from public.quick_codes qc where qc.id = quick_code_case_law.quick_code_id and qc.owner_id = (select auth.uid()))
    and public.can_view_case_law(case_law_id)
    and created_by = (select auth.uid())
  );

drop policy "Owners can unlink their Quick Codes from Case Law" on public.quick_code_case_law;
create policy "Owners can unlink their Quick Codes from Case Law"
  on public.quick_code_case_law for delete
  using (
    exists (select 1 from public.quick_codes qc where qc.id = quick_code_case_law.quick_code_id and qc.owner_id = (select auth.uid()))
    and public.can_view_case_law(case_law_id)
  );

-- ==================== case_law (self) ====================

drop policy "Canonical, own, and discoverable Case Law is viewable" on public.case_law;
create policy "Canonical, own, and discoverable Case Law is viewable"
  on public.case_law for select
  using (public.can_view_case_law(id));

drop policy "Admins update canonical Case Law; owners update their personal " on public.case_law;
create policy "Admins update canonical Case Law; owners update their personal "
  on public.case_law for update
  using (public.can_edit_case_law(id))
  with check (public.can_edit_case_law(id));

drop policy "Admins delete canonical Case Law; owners delete their personal " on public.case_law;
create policy "Admins delete canonical Case Law; owners delete their personal "
  on public.case_law for delete
  using (public.can_edit_case_law(id));

-- INSERT policy (create-time, no existing row) intentionally left inline/untouched.

-- ==================== case_law_annotations ====================
-- Primary gate remains owner_id = auth.uid() (annotation isolation);
-- the case_law existence check becomes an explicit can_view_case_law()
-- call, behavior-identical to the current plain-nested pass-through.

drop policy "Owners can view their own Case Law Annotations" on public.case_law_annotations;
create policy "Owners can view their own Case Law Annotations"
  on public.case_law_annotations for select
  using (owner_id = (select auth.uid()) and public.can_view_case_law(case_law_id));

drop policy "Owners can create Case Law Annotations on readable Case Law" on public.case_law_annotations;
create policy "Owners can create Case Law Annotations on readable Case Law"
  on public.case_law_annotations for insert
  with check (owner_id = (select auth.uid()) and public.can_view_case_law(case_law_id));

drop policy "Owners can update their own Case Law Annotations" on public.case_law_annotations;
create policy "Owners can update their own Case Law Annotations"
  on public.case_law_annotations for update
  using (owner_id = (select auth.uid()) and public.can_view_case_law(case_law_id))
  with check (owner_id = (select auth.uid()) and public.can_view_case_law(case_law_id));

drop policy "Owners can delete their own Case Law Annotations" on public.case_law_annotations;
create policy "Owners can delete their own Case Law Annotations"
  on public.case_law_annotations for delete
  using (owner_id = (select auth.uid()) and public.can_view_case_law(case_law_id));

-- ==================== documents (Docket/Judgment/Case Law branches only) ====================
-- Quick Code, Bench Note, Legacy Case branches, DELETE policy, and the
-- parent-delete cascade trigger are all left completely untouched.

drop policy "Users can view documents they have access to" on public.documents;
create policy "Users can view documents they have access to"
  on public.documents for select
  using (
    uploaded_by = (select auth.uid())
    or (entity_type = 'docket_matter' and public.can_view_docket_matter(entity_id))
    or (entity_type = 'judgment' and public.can_view_judgment(entity_id))
    or (entity_type = 'case_law' and public.can_view_case_law(entity_id))
    or (entity_type = 'quick_code' and exists (select 1 from public.quick_codes qc where qc.id = documents.entity_id))
    or (entity_type = 'bench_note' and exists (select 1 from public.bench_notes bn where bn.id = documents.entity_id))
    or (entity_type = 'case' and exists (select 1 from public.cases c where c.id = documents.entity_id))
  );

drop policy "Users can attach documents to accessible parents" on public.documents;
create policy "Users can attach documents to accessible parents"
  on public.documents for insert
  with check (
    uploaded_by = (select auth.uid())
    and (
      entity_type is null
      or (entity_type = 'docket_matter' and public.can_edit_docket_matter(entity_id))
      or (entity_type = 'judgment' and public.can_edit_judgment(entity_id))
      or (entity_type = 'case_law' and public.can_edit_case_law(entity_id))
      or (entity_type = 'quick_code' and exists (select 1 from public.quick_codes qc where qc.id = documents.entity_id and qc.owner_id = (select auth.uid())))
      or (entity_type = 'bench_note' and exists (select 1 from public.bench_notes bn where bn.id = documents.entity_id and bn.author_id = (select auth.uid())))
      or (entity_type = 'case' and exists (select 1 from public.cases c where c.id = documents.entity_id and ((select public.is_admin()) or c.court_id = (select public.my_court_id()))))
    )
  );
