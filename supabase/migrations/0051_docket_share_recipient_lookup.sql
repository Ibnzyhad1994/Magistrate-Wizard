-- 0051_docket_share_recipient_lookup.sql
--
-- STATUS: prepared for review. Rollback-only pretest required before
-- apply (see workflow notes at the end of this comment block). Renumbered
-- from 0050 to 0051 after 0050_fix_returning_visibility_rls_policies.sql
-- was discovered and inserted ahead of it in the same turn (unapplied
-- local renumbering only -- neither file had been applied yet, consistent
-- with the project's established renumbering-before-apply precedent).
--
-- PURPOSE: unblock Docket Share creation in the frontend. `profiles`
-- SELECT RLS is owner-or-admin only (0001/0012), so there has never been
-- an RLS-authorized way for a lawful Docket authority-holder to resolve
-- "who is this email address" before creating a Share. This migration
-- adds exactly one narrow, single-purpose lookup RPC -- it does NOT
-- broaden `profiles` SELECT, does NOT build a staff directory, and does
-- NOT expose arbitrary profile search. It resolves a proposed recipient
-- only; the existing `shares` INSERT policy (0037, unchanged) remains
-- the sole authority that actually creates a Share row.
--
-- AUTHORIZATION: reuses `has_docket_matter_authority(p_docket_matter_id)`
-- (0043 ownership_rls_helpers) verbatim -- the exact same predicate the
-- `shares` INSERT policy itself checks ("current Court assignment OR
-- retained assignment"). An existing view/edit Share is deliberately NOT
-- authority to look up further recipients (has_docket_matter_authority
-- does not consider shares at all, only can_access_court/
-- has_retained_assignment), so this does not create a resharing path.
-- No admin bypass: is_admin() is never referenced.
--
-- LOOKUP SEMANTICS: exact, case-insensitive email match only
-- (`lower(email) = lower(btrim(p_email))`) -- no prefix/partial/wildcard
-- matching, no list endpoint. The recipient must exist, be active
-- (`is_active`), and not be the caller. Every failure mode (unauthorized
-- caller, unknown email, inactive profile, self-lookup) collapses to the
-- same zero-row result via a single predicate -- there is no branching
-- that could let a caller distinguish "wrong email" from "not
-- authorized" from "recipient inactive".
--
-- RETURN SHAPE: exactly `(profile_id uuid, display_name text)` --
-- `display_name` is `profiles.full_name` with no fallback, matching the
-- existing `resolve_docket_share_identity`/`resolve_docket_assignment_
-- identity` convention exactly (0043/0044-era helpers). Email, role,
-- jurisdiction, court, and every other profile column are never
-- selected, so there is nothing in the function body that could later
-- leak by a careless SELECT * mistake.
--
-- SECURITY DEFINER: required (same reason as the two existing resolver
-- RPCs) -- reading another user's `profiles.full_name` requires
-- bypassing owner-or-admin RLS. STABLE, fixed `search_path = public`,
-- plain SQL (no dynamic SQL), EXECUTE revoked from PUBLIC and `anon`
-- explicitly, granted only to `authenticated`.
--
-- WORKFLOW: rollback-only pretest covers unauthorized caller (no
-- authority at all, view-share-only, edit-share-only, admin-without-
-- authority), authorized caller (current Court, retained-only), valid
-- vs unknown vs partial vs self email, inactive recipient,
-- case-insensitive exact match, and `anon` EXECUTE denial. Apply only
-- after 100% pass.

create or replace function public.resolve_docket_share_recipient(
  p_docket_matter_id uuid,
  p_email text
)
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
    p.id as profile_id,
    p.full_name as display_name
  from public.profiles p
  where (select public.has_docket_matter_authority(p_docket_matter_id))
    and p.is_active
    and p.id is distinct from (select auth.uid())
    and lower(p.email) = lower(btrim(p_email))
  limit 1;
$$;

revoke all on function public.resolve_docket_share_recipient(uuid, text) from public;
revoke all on function public.resolve_docket_share_recipient(uuid, text) from anon;
grant execute on function public.resolve_docket_share_recipient(uuid, text) to authenticated;
