-- ============================================================================
-- 0132_fix_profiles_self_update_recursion.sql
--
-- Bug found in a security audit: "Profiles are editable by owner or admin"
-- (0012) blocks its own owner-editing case. Its WITH CHECK reads the
-- caller's CURRENT role with a raw correlated subquery against `profiles`
-- itself:
--
--   role = (select p.role from public.profiles p where p.id = (select auth.uid()))
--
-- Every OTHER cross-reference in this same policy -- and everywhere else in
-- this schema -- goes through a SECURITY DEFINER helper (is_admin(), three
-- lines above this one in the identical policy) specifically so evaluating
-- it doesn't re-invoke RLS on the table the policy is defined on. This one
-- raw subquery didn't, and Postgres throws "infinite recursion detected in
-- policy for relation profiles" for it -- for ANY self-update, not only a
-- role change: a plain full_name edit hits the same WITH CHECK and fails
-- identically. Confirmed live and reproduced against a fresh db:reset with
-- three cases (benign full_name change, role no-op, role escalation) --
-- all three throw the same recursion error.
--
-- Currently dormant: no client code calls `.from("profiles").update(...)`
-- as the row owner anywhere in src/, so nothing in the shipped app hits
-- this today. It is fixed now, before any "edit your name" feature is
-- built on top of it, rather than after.
-- ============================================================================

create or replace function public.current_profile_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

comment on function public.current_profile_role() is
  'The caller''s own current role, read via SECURITY DEFINER so callers checking "is this update leaving my role unchanged" (0012''s profiles self-update policy) don''t recursively re-invoke RLS on profiles -- the bug this function was added to fix (0132). Mirrors is_admin()''s existing pattern in the same policy.';

alter policy "Profiles are editable by owner or admin"
  on public.profiles
  with check (
    (
      (select auth.uid()) = id
      and role = (select public.current_profile_role())
    )
    or (select public.is_admin())
  );
