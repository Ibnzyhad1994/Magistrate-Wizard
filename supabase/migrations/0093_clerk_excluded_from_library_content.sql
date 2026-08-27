-- ============================================================================
-- 0093_clerk_excluded_from_library_content.sql
--
-- Two real gaps surfaced by live RLS testing (test-clerk-access-security.mjs)
-- against the actual running database, not merely inferred from reading
-- policy text:
--
--   1. can_view_case_law() / can_view_judgment() / can_view_statute()
--      grant visibility of CANONICAL/PUBLISHED/DISCOVERABLE rows to any
--      authenticated user, by design (0035/0027/0055 -- a deliberate,
--      pre-existing "shared library" model, unrelated to clerks). Since
--      these are also the exact predicates storage.objects now calls
--      (0091), a clerk who is otherwise correctly denied everywhere else
--      could still read published Case Law/Judgment/Statute rows and
--      files through this pre-existing, role-agnostic branch. The
--      feature spec is explicit and unqualified here ("a clerk must not
--      be able to access... Case law... Judgments") -- this migration adds
--      one clerk exclusion at the single centralized point each of these
--      three functions is already the sole gatekeeper for, rather than
--      hunting down every consuming table individually.
--
--   2. case_law's and judgments' own INSERT policies ("Admins create
--      canonical Case Law; magistrates create personal Case Law",
--      0035; "Owners can create Judgments", 0027) never actually checked
--      role despite their names -- `owner_id = auth.uid()` alone lets ANY
--      authenticated profile, clerk included, create a personal research
--      row or a Judgment today. Adding the same clerk exclusion closes it.
--
-- Deliberately NOT touched: can_edit_case_law()/can_edit_judgment() were
-- already fully owner-gated (a clerk could only ever edit a row it
-- somehow owns) -- with INSERT now closed, a clerk cannot come to own one
-- in the first place, so no separate edit-side change is needed beyond
-- adding the same exclusion for defense-in-depth completeness below.
--
-- Also NOT touched: quick_codes and bench_notes remain exactly as they
-- are (owner-scoped, no cross-user leakage possible either way) -- the
-- feature spec's explicit forbidden list (Case Law, Judgments, judicial
-- research/Legislation, private magistrate resources, admin functions)
-- does not name these, and they carry no shared-library visibility
-- branch to begin with. Clerks are kept away from them at the interface/
-- route layer instead (nav-config.ts, router.tsx) -- see the completion
-- report for this explicit scoping decision.
-- ============================================================================

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
      and not (select public.is_clerk())
      and (cl.owner_id is null or cl.owner_id = (select auth.uid()) or cl.is_discoverable = true)
  );
$$;

comment on function public.can_view_case_law(uuid) is
  'Case Law read envelope: canonical OR personal owner OR discoverable personal -- EXCEPT for a clerk, who is always denied regardless of the row''s own visibility settings (0093). This is a deliberate, explicit exception to the otherwise role-agnostic "shared library" model, required by the Clerk feature spec.';

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
      and not (select public.is_clerk())
      and (
        (cl.owner_id is null and public.is_admin())
        or cl.owner_id = (select auth.uid())
      )
  );
$$;

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
      and not (select public.is_clerk())
      and (j.owner_id = (select auth.uid()) or j.is_discoverable = true)
  );
$$;

comment on function public.can_view_judgment(uuid) is
  'Judgment read envelope: owner OR discoverable -- EXCEPT for a clerk, who is always denied (0093), a deliberate exception to the otherwise role-agnostic discoverable-reader model.';

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
      and not (select public.is_clerk())
      and j.owner_id = (select auth.uid())
  );
$$;

create or replace function public.can_view_statute(p_statute_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.statutes s
    where s.id = p_statute_id
      and not (select public.is_clerk())
      and (s.review_status = 'published' or public.is_admin())
  );
$$;

comment on function public.can_view_statute(uuid) is
  'Statute (Legislation) read envelope: published OR admin -- EXCEPT for a clerk, who is always denied (0093), matching the same explicit exclusion applied to Case Law and Judgments.';

-- ----------------------------------------------------------------------------
-- INSERT policies -- add the same exclusion where the existing policy
-- name already implied "magistrate"/"owner" but the check clause never
-- actually verified it.
-- ----------------------------------------------------------------------------

drop policy "Admins create canonical Case Law; magistrates create personal Case Law" on public.case_law;
create policy "Admins create canonical Case Law; magistrates create personal Case Law"
  on public.case_law for insert
  with check (
    (owner_id is null and (select public.is_admin()))
    or (owner_id = (select auth.uid()) and not (select public.is_clerk()))
  );

drop policy "Owners can create Judgments" on public.judgments;
create policy "Owners can create Judgments"
  on public.judgments for insert
  with check (owner_id = (select auth.uid()) and not (select public.is_clerk()));
