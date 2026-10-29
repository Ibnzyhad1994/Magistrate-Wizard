-- Magistrate Wizard -- 0168: role, court and email change only through their RPCs
--
-- Problem (backend sweep BE-10)
--   0154 pinned role, court_id, is_active and email in the self branch of
--   "Profiles are editable by owner or admin", but its `or is_admin()`
--   branch lets an administrator's own session write any column of any
--   profile straight through the Data API. That bypasses every rule the
--   RPCs enforce: correct_unassigned_account_type (0136) refuses to change
--   the type of an account that still holds a court, refuses the caller's
--   own account and never converts to or from admin. A direct
--   `update profiles set role = 'clerk'` did all three (docs/
--   daylife-30-findings.md, Degrades 4), leaving a "clerk" with open
--   magistrate_courts rows; a direct email write desynchronises
--   profiles.email from the sign-in address. The 0113 trigger audited
--   those writes but did not prevent them.
--
-- Change
--   A BEFORE UPDATE trigger refuses a change to role, court_id or email
--   when the statement runs as a client role (anon or authenticated),
--   whoever the caller is. Every legitimate path still works, because none
--   of them runs as a client role:
--     * the RPCs are SECURITY DEFINER, so their UPDATE runs as the
--       function owner (correct_unassigned_account_type, 0136);
--     * sign-up writes the row in handle_new_user(), also DEFINER;
--     * the service role and the SQL editor (operators, fixtures,
--       first-admin bootstrap in supabase/README.md) are not client roles.
--   is_active, full_name and every other column are unchanged: an admin
--   may still write them directly (deactivation is BE-09, a separate
--   decision). The self branch of the policy is unchanged.
--
-- Threat model
--   profiles_identity_columns_guard() is SECURITY INVOKER on purpose: it
--   reads current_user, which must be the role the statement runs as. It
--   reads no table and takes no input beyond the row. It cannot widen
--   access; it only refuses writes RLS already allowed.
-- ============================================================================

create or replace function public.profiles_identity_columns_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception
      'An account''s type, court and email cannot be edited directly. Use Correct account type or the court assignment screens.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.profiles_identity_columns_guard() is
  'BEFORE UPDATE on profiles (0168): refuses a change to role, court_id or email from a client role (anon, authenticated), admins included, so they change only through SECURITY DEFINER RPCs, sign-up, the service role or the SQL editor. INVOKER on purpose: it reads current_user.';

revoke all on function public.profiles_identity_columns_guard() from public, anon, authenticated;

create trigger profiles_identity_columns_guard
  before update of role, court_id, email on public.profiles
  for each row
  when (
    old.role is distinct from new.role
    or old.court_id is distinct from new.court_id
    or old.email is distinct from new.email
  )
  execute function public.profiles_identity_columns_guard();
