-- 0043_narrow_professional_identity.sql
--
-- PREPARED FOR REVIEW ONLY. NOT APPLIED.
--
-- PURPOSE: BenchBook needs to render professional attribution such as
-- "retained by [Name]", "shared by [Name]", and the recipient of a
-- Docket share, without turning `profiles` into a general directory.
-- `profiles` today is self-only under RLS ("Profiles are viewable by
-- owner or admin" -- SELECT using ((select auth.uid()) = id) or
-- is_admin()), confirmed live and NOT changed by this migration. This
-- migration adds exactly two narrow, context-gated lookup functions;
-- it does not widen `profiles` SELECT access in any way.
--
-- FIELDS EXPOSED: `full_name` only, as `display_name`. Live schema
-- inspection of `profiles` found no field that safely represents a
-- "professional title": the only role-like column is `role`
-- (user_role enum: magistrate | clerk | admin), and exposing it would
-- directly leak the admin flag this migration is explicitly required
-- not to expose (role='admin' *is* the admin flag; is_admin() itself
-- reads this same column). Per instruction, since no suitable
-- professional-title field exists, both functions return name only --
-- no professional_title field is included in either return shape, not
-- even as an always-NULL placeholder. `email`, `phone` (not present),
-- `jurisdiction`, `court_name`, `court_id`, `role`, `is_active`, and
-- `id`-as-a-free-lookup-key are all deliberately excluded.
--
-- MECHANISM: two separate, narrow, context-specific functions -- not
-- one polymorphic identity oracle. Neither accepts a bare profile_id;
-- each takes the id of a context row (a Docket assignment or a Share)
-- and re-derives the identity/identities relevant to that row. This
-- makes "supply a random profile UUID and get a name back" structurally
-- impossible -- there is no code path that accepts a profile_id as
-- input.
--
--   * resolve_docket_assignment_identity(p_assignment_id uuid)
--     -> table(profile_id uuid, display_name text)
--     Resolves the identity of the magistrate referenced by a
--     docket_matter_assignments row (retained/part-heard authority),
--     including ended/historical rows. docket_matter_assignments' own
--     SELECT RLS is self-view-only (profile_id = auth.uid()) -- other
--     magistrates sharing Docket access to the same matter currently
--     have no way to see who holds a retained assignment beyond the
--     boolean has_retained_assignment() check baked into
--     docket_matters' own RLS. This function is the first mechanism to
--     expose that identity, deliberately scoped: it discloses nothing
--     beyond (profile_id, display_name) for one named assignment row,
--     and only to a caller who can already read the assignment's
--     parent Docket Matter.
--
--     Authorization replicates the exact, current three-path
--     docket_matters SELECT envelope (can_access_court(dm.court_id) OR
--     has_retained_assignment(dm.id) OR has_docket_share(dm.id,
--     'view')) as a decorated condition against the assignment's
--     parent docket_matter_id -- the same "full Docket read envelope"
--     named in the request, not the narrower
--     has_docket_matter_authority() used for Share management. No
--     ended_at filter is applied: an ended/historical assignment
--     resolves identically to an active one, as long as the caller can
--     read the parent Docket Matter (matches "historical ended
--     assignments... if shown in authorized Docket history").
--
--   * resolve_docket_share_identity(p_share_id uuid)
--     -> table(recipient_id uuid, recipient_display_name text,
--              granted_by uuid, grantor_display_name text)
--     Resolves both identities on one Share row (recipient and
--     grantor) in a single call, gated by exactly the live "Share
--     visibility for management" SELECT policy predicate (granted_by =
--     auth.uid() OR recipient_id = auth.uid() OR (item_type =
--     'docket_matter' AND has_docket_matter_authority(item_id))) --
--     the caller must already be able to see the share row itself
--     under that policy. That policy does not filter on revoked_at, so
--     neither does this function -- a revoked-but-still-visible Share
--     resolves identically to an active one, matching current Share
--     history visibility exactly (confirmed live during pre-testing).
--
-- Both functions are SECURITY DEFINER (necessary, not merely
-- convenient: docket_matter_assignments' SELECT RLS is self-only and
-- profiles' SELECT RLS is self-only, so a SECURITY INVOKER version
-- could only ever see the caller's own rows -- the join would be
-- empty for every case this migration exists to solve). Each has a
-- fixed `set search_path = public`, no dynamic SQL, an explicit
-- RETURNS TABLE naming every field (never profiles.*, never
-- SELECT *), and STABLE volatility. Neither references is_admin() --
-- no admin bypass -- consistent with the governing principle already
-- recorded in this spec that is_admin() is never used, by itself, to
-- grant access to another magistrate's private/collaboration content.
--
-- GRANTS: this schema's default privileges (confirmed live via
-- pg_default_acl) auto-grant EXECUTE on every new function in `public`
-- to anon, authenticated, and service_role at creation time -- the
-- same default responsible for the pre-existing
-- anon_security_definer_function_executable advisor warnings on
-- is_admin(), has_docket_matter_authority(), etc. `revoke all ... from
-- public` alone does NOT reach that per-role default grant; it must be
-- revoked from `anon` by name (confirmed live: a REVOKE naming only
-- `public` left anon able to execute and receive an empty, not
-- denied, result). Both functions here explicitly `revoke all ... from
-- public, anon` and then `grant execute ... to authenticated` only --
-- confirmed via live rollback-only probe to produce "permission denied
-- for function" for anon, not merely an empty result. This is stricter
-- than most existing functions in this codebase (which remain
-- anon-executable by the same default and were not touched here, per
-- the "do not auto-fix unrelated findings" instruction), and is a
-- deliberate exception: these two functions are meant to be called
-- directly by authenticated end users (unlike trigger functions, whose
-- anon-executable warning is not practically exploitable), so their
-- grants are hardened explicitly rather than left on the schema
-- default.
--
-- NULL / OFFBOARDING: docket_matter_assignments.profile_id and
-- shares.recipient_id/granted_by are all ON DELETE SET NULL. Both
-- functions use LEFT JOINs to profiles, so a caller who is authorized
-- to see the context row always gets exactly one row back, with
-- profile_id/display_name (or recipient/grantor fields) simply NULL
-- when the referenced profile no longer exists -- never an error,
-- never a guess. An unauthorized caller or a nonexistent context row
-- both produce zero rows, indistinguishable from each other by design
-- (existence of a Docket assignment or Share is never disclosed to a
-- caller who cannot already see it).
--
-- SCOPE DECISIONS, EXPLICIT:
--   * Court assignments (magistrate_courts) identity resolution is
--     NOT included. No current UI/spec requirement was found for
--     rendering court-roster magistrate names beyond what's already
--     self-visible; adding it now would broaden scope beyond what's
--     needed today, contrary to instruction. A successor migration can
--     add a third narrow function the same way if that requirement
--     appears.
--   * docket_matters.created_by / last_updated_by attribution ("created
--     by [Name]") was not in the three named contexts for this
--     migration and is left out for the same reason -- noted here as a
--     related, plausible future use of this same pattern, not decided
--     now.
--   * profiles' own RLS is untouched -- no new SELECT policy, no
--     collaboration-context carve-out at the row level. The two
--     functions below are the only sanctioned path to another
--     magistrate's display name.

create or replace function public.resolve_docket_assignment_identity(p_assignment_id uuid)
returns table (
  profile_id uuid,
  display_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    dma.profile_id,
    p.full_name as display_name
  from public.docket_matter_assignments dma
  join public.docket_matters dm on dm.id = dma.docket_matter_id
  left join public.profiles p on p.id = dma.profile_id
  where dma.id = p_assignment_id
    and (
      (select public.can_access_court(dm.court_id))
      or (select public.has_retained_assignment(dm.id))
      or (select public.has_docket_share(dm.id, 'view'))
    );
$$;

revoke all on function public.resolve_docket_assignment_identity(uuid) from public, anon;
grant execute on function public.resolve_docket_assignment_identity(uuid) to authenticated;

comment on function public.resolve_docket_assignment_identity(uuid) is
  'Narrow identity lookup for one docket_matter_assignments row (retained/part-heard authority), including ended/historical rows. Returns (profile_id, display_name) -- display_name from profiles.full_name only, NULL-safe if the profile has been offboarded (ON DELETE SET NULL) or has no full_name set. Returns zero rows if the assignment does not exist OR the caller cannot read its parent Docket Matter under the current three-path docket_matters SELECT envelope (can_access_court OR has_retained_assignment(own) OR has_docket_share view) -- these two cases are indistinguishable by design. SECURITY DEFINER (required: docket_matter_assignments and profiles are both self-only under ordinary RLS). No is_admin() bypass. EXECUTE revoked from anon (schema-default grant explicitly reversed) and from public; granted only to authenticated. Does not itself grant Docket access -- it discloses identity only to a caller who already, independently, has it.';

create or replace function public.resolve_docket_share_identity(p_share_id uuid)
returns table (
  recipient_id uuid,
  recipient_display_name text,
  granted_by uuid,
  grantor_display_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.recipient_id,
    pr.full_name as recipient_display_name,
    s.granted_by,
    pg2.full_name as grantor_display_name
  from public.shares s
  left join public.profiles pr on pr.id = s.recipient_id
  left join public.profiles pg2 on pg2.id = s.granted_by
  where s.id = p_share_id
    and (
      s.granted_by = (select auth.uid())
      or s.recipient_id = (select auth.uid())
      or (
        s.item_type = 'docket_matter'
        and (select public.has_docket_matter_authority(s.item_id))
      )
    );
$$;

revoke all on function public.resolve_docket_share_identity(uuid) from public, anon;
grant execute on function public.resolve_docket_share_identity(uuid) to authenticated;

comment on function public.resolve_docket_share_identity(uuid) is
  'Narrow identity lookup for one shares row: returns both the recipient''s and the grantor''s (recipient_id, recipient_display_name, granted_by, grantor_display_name) in a single call -- display names from profiles.full_name only, NULL-safe if either party has been offboarded (ON DELETE SET NULL). Gated by the exact live "Share visibility for management" SELECT policy predicate (granted_by = caller OR recipient_id = caller OR (item_type=''docket_matter'' AND has_docket_matter_authority(item_id))) -- including revoked-but-visible shares, since that policy does not filter on revoked_at either. Returns zero rows if the share does not exist OR the caller cannot see it under that policy -- indistinguishable by design. SECURITY DEFINER (required: profiles is self-only under ordinary RLS). No is_admin() bypass. EXECUTE revoked from anon (schema-default grant explicitly reversed) and from public; granted only to authenticated.';
