-- ============================================================================
-- 0090_clerk_docket_access.sql
--
-- Grants the actual Docket access a clerk earns by holding a CURRENT
-- clerk_courts assignment (0087) to a specific court -- and nowhere else.
--
-- Because docket_events, docket_matter_parties, docket_matter_tags, and
-- documents' docket_matter branch all already dispatch through the two
-- centralized helpers can_view_docket_matter()/can_edit_docket_matter()
-- (0044), adding ONE new OR-branch to those two functions cascades the
-- clerk pathway correctly to every one of those tables automatically --
-- no per-table policy edits needed there. Only docket_matters' OWN three
-- policies are inline (0050 deliberately rewrote them off the helpers to
-- fix an INSERT...RETURNING bug) and need the same branch added directly.
--
-- Deliberately NOT touched, preserving every stated boundary:
--   * can_view_judgment / can_edit_judgment / can_view_case_law /
--     can_edit_case_law / can_view_statute -- no clerk branch, ever. This
--     is what structurally guarantees a clerk cannot reach Case Law or
--     Judgments through any Docket-adjacent path.
--   * has_retained_assignment() / has_docket_share() / has_docket_matter_-
--     authority() -- untouched. A clerk's access is a wholly separate,
--     independent pathway; it never composes with or inherits a
--     magistrate's retained/shared-matter access.
--   * docket_matter_judgments / docket_matter_case_law / quick_code_-
--     docket_matters -- untouched (still has_docket_matter_authority() /
--     owner_id-gated). A clerk cannot satisfy the Case-Law/Judgment/
--     Quick-Code side of these links regardless, since those tables never
--     gain a clerk branch -- linking naturally stays unreachable for a
--     clerk without needing any extra exclusion logic here.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. can_view_docket_matter() / can_edit_docket_matter() -- add the clerk
--    branch. Still SECURITY DEFINER (unchanged reasoning, 0044).
-- ----------------------------------------------------------------------------

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
        or public.has_active_clerk_assignment(dm.court_id)
      )
  );
$$;

comment on function public.can_view_docket_matter(uuid) is
  'Docket read envelope: current magistrate Court assignment OR retained/part-heard assignment OR an active view/edit Docket share OR (0090) an active clerk_courts assignment to the matter''s exact court. No admin bypass. The clerk branch is a wholly separate, additive pathway -- it never grants Case Law/Judgment access, which have no equivalent branch.';

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
        or public.has_active_clerk_assignment(dm.court_id)
      )
  );
$$;

comment on function public.can_edit_docket_matter(uuid) is
  'Docket edit envelope: current magistrate Court assignment OR retained assignment OR an active EDIT Docket share OR (0090) an active clerk_courts assignment to the matter''s exact court -- an approved clerk has full operational edit parity at their approved court, exactly like a magistrate, via this one additive branch. No admin bypass, no DELETE implication (Docket Matters have no DELETE policy).';

-- ----------------------------------------------------------------------------
-- 2. docket_matters' own inline SELECT/UPDATE/INSERT policies (0020,
--    rewritten off the helpers by 0050) -- same branch added directly.
-- ----------------------------------------------------------------------------

alter policy "Magistrates can view Docket Matters at their current courts"
  on public.docket_matters
  using (
    (select public.can_access_court(court_id))
    or (select public.has_retained_assignment(id))
    or (select public.has_docket_share(id, 'view'))
    or (select public.has_active_clerk_assignment(court_id))
  );

alter policy "Magistrates can update Docket Matters at their current courts"
  on public.docket_matters
  using (
    (select public.can_access_court(court_id))
    or (select public.has_retained_assignment(id))
    or (select public.has_docket_share(id, 'edit'))
    or (select public.has_active_clerk_assignment(court_id))
  )
  with check (
    (select public.can_access_court(court_id))
    or (select public.has_retained_assignment(id))
    or (select public.has_docket_share(id, 'edit'))
    or (select public.has_active_clerk_assignment(court_id))
  );

alter policy "Magistrates can create Docket Matters at their current courts"
  on public.docket_matters
  with check (
    (
      (select public.can_access_court(court_id))
      or (select public.has_active_clerk_assignment(court_id))
    )
    and created_by = (select auth.uid())
  );

-- ----------------------------------------------------------------------------
-- 3. docket_events INSERT/UPDATE -- presiding_magistrate_id relaxation
--
-- The existing INSERT check forces presiding_magistrate_id = auth.uid()
-- unconditionally -- correct for a magistrate creating their own hearing,
-- but a clerk is never presiding over anything. Adds ONE alternative: a
-- clerk may create/keep an event with presiding_magistrate_id left NULL
-- (not yet assigned). A magistrate's own requirement is completely
-- unchanged -- they must still set it to themselves on insert, and (per
-- the existing UPDATE check) may still never null it back out once set.
-- A magistrate can later UPDATE a clerk-created event to assign a real
-- presiding magistrate, satisfying the unchanged "not null" UPDATE check.
-- ----------------------------------------------------------------------------

alter policy "Magistrates can create Docket Events for accessible Docket Matt"
  on public.docket_events
  with check (
    public.can_edit_docket_matter(docket_matter_id)
    and created_by = (select auth.uid())
    and (
      presiding_magistrate_id = (select auth.uid())
      or (presiding_magistrate_id is null and (select public.is_clerk()))
    )
  );

alter policy "Magistrates can update Docket Events for accessible Docket Matt"
  on public.docket_events
  using (public.can_edit_docket_matter(docket_matter_id))
  with check (
    public.can_edit_docket_matter(docket_matter_id)
    and (
      presiding_magistrate_id is not null
      or (select public.is_clerk())
    )
  );
