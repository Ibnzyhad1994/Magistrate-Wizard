-- 0050_fix_returning_visibility_rls_policies.sql
--
-- STATUS: prepared for review. Rollback-only pretest required before
-- apply (see workflow notes at the end of this comment block).
--
-- DEFECT (discovered this turn, while pretesting 0051's authorization
-- checks -- unrelated to that migration's own content): `docket_matters`,
-- `judgments`, and `case_law` each have a SELECT policy (and, for
-- `docket_matters`/`judgments`, an UPDATE policy) implemented as a call
-- to a SECURITY DEFINER helper (`can_view_docket_matter(id)`,
-- `can_edit_docket_matter(id)`, `can_view_judgment(id)`,
-- `can_edit_judgment(id)`, `can_view_case_law(id)`,
-- `can_edit_case_law(id)`) that RE-QUERIES THE SAME TABLE BY ID
-- internally (`select 1 from public.docket_matters dm where dm.id =
-- p_docket_matter_id and (...)`, etc.).
--
-- This self-referencing pattern is fine for ordinary SELECT/UPDATE
-- statements, but it breaks `INSERT ... RETURNING` (and, more subtly,
-- causes `UPDATE ... RETURNING` to evaluate against the PRE-update row
-- instead of the post-update one): the row being inserted in the
-- current command is not visible to the helper function's own nested
-- self-query at RETURNING-time, so the helper returns false, and
-- PostgreSQL reports "new row violates row-level security policy" --
-- for the row's own creator, who unambiguously has authority to see it.
-- Confirmed with a minimal, schema-independent repro (a throwaway table
-- with the identical SECURITY DEFINER self-referencing-SELECT-policy
-- shape reproduces the exact same 42501 error on `INSERT ... RETURNING`,
-- and a minimal UPDATE repro confirms `UPDATE ... RETURNING` silently
-- evaluates the self-check against stale, pre-update column values)
-- as well as directly against `docket_matters` itself in a rollback-only
-- transaction.
--
-- IMPACT: `supabase-js`'s `.insert(values).select()` (used throughout
-- the Milestone 1 Docket frontend, e.g. `useCreateDocketMatter`, and
-- about to be used for the Judgment/Case Law create flows) compiles to
-- exactly `INSERT ... RETURNING` in a single round trip. Before this
-- fix, creating a Docket Matter, a Judgment, or personal Case Law as a
-- fully authorized user would fail with an RLS error on the RETURNING
-- read, even though the row itself is inserted successfully and the
-- user unquestionably has access to it. This is a latent defect present
-- since the original 0020/0027/0035 policies -- not something 0051 (or
-- any other migration this session) introduced, and not a semantic/
-- access-control question: the fix below preserves the EXACT same
-- boolean predicates, only removing the self-referencing indirection.
--
-- FIX: rewrite the affected SELECT/UPDATE policies to reference the
-- row's own columns directly (available as ordinary correlated columns
-- in a USING/WITH CHECK expression, with no subquery against the same
-- table needed) instead of going through an id-only helper that
-- re-derives those columns via a self-join. `can_view_docket_matter`,
-- `can_edit_docket_matter`, `can_view_judgment`, `can_edit_judgment`,
-- `can_view_case_law`, `can_edit_case_law` are left completely
-- unchanged -- they are used correctly (cross-table, not self-
-- referencing) by `documents`' policies and are kept for that purpose
-- and for any future cross-table use. DELETE policies (which reference
-- these same helpers) are also left unchanged: a DELETE's target row
-- already existed before the statement began, so it does not have the
-- INSERT-time visibility problem, and this migration does not touch
-- DELETE semantics.
--
-- WORKFLOW: rollback-only pretest confirms (a) `INSERT ... RETURNING`
-- now succeeds for an authorized creator on all three tables, (b) the
-- exact same access decisions still hold for authorized vs unauthorized
-- viewers/editors after the rewrite (a regression pass, not just the
-- RETURNING fix), and (c) `UPDATE ... RETURNING` reflects the
-- post-update row. Apply only after 100% pass.

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

alter policy "Owners and discoverable readers can view Judgments"
  on public.judgments
  using (
    owner_id = (select auth.uid())
    or is_discoverable = true
  );

alter policy "Owners can update Judgments"
  on public.judgments
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

alter policy "Canonical, own, and discoverable Case Law is viewable"
  on public.case_law
  using (
    owner_id is null
    or owner_id = (select auth.uid())
    or is_discoverable = true
  );

alter policy "Admins update canonical Case Law; owners update their personal "
  on public.case_law
  using (
    (owner_id is null and (select public.is_admin()))
    or owner_id = (select auth.uid())
  )
  with check (
    (owner_id is null and (select public.is_admin()))
    or owner_id = (select auth.uid())
  );
