-- Magistrate Wizard -- 0210: administrator authority can require a second factor (aal2)
--
-- Problem (backend sweep BE-25)
--   An administrator's password alone opens every admin-only RPC and policy:
--   court assignments, clerk access, people, the activity ledger, feature
--   flags. config.toml now turns TOTP enrolment and verification on, but
--   nothing on the server asks for it.
--
-- Change
--   1. is_admin(), the one gate every admin-only RPC and policy calls, is
--      also true only for a session at assurance level aal2 (a verified
--      second factor, the access token's `aal` claim) while the
--      require_admin_mfa feature flag is on. With the flag off it is exactly
--      0200's is_admin(). Only the flag's `enabled` is read here; its
--      rollout, court and role fields mean nothing to this gate.
--   2. require_admin_mfa is seeded OFF. The app has no enrolment or
--      challenge screen yet, so an administrator cannot reach aal2 from it;
--      turning the gate on now would take administration away from every
--      administrator. It turns on once that screen ships.
--   3. A trigger refuses turning the flag on from a client session below
--      aal2. Whoever turns it on has therefore already verified a factor and
--      keeps their authority, and before the enrolment screen exists no
--      app session can turn it on at all. Turning it off needs is_admin(),
--      which with the gate on is aal2 already. The service role and the SQL
--      editor are not client sessions: they are the recovery path for an
--      administrator who loses their only factor.
--
-- Threat model
--   is_admin() stays SECURITY DEFINER (it reads profiles and feature_flags
--   for the caller, as before) with a fixed search_path; it trusts only
--   auth.uid() and the signed JWT's `aal`, which Supabase Auth sets and the
--   client cannot forge. feature_flags is already readable by every
--   authenticated user, so reading it exposes nothing new.
--   feature_flags_admin_mfa_guard() is SECURITY INVOKER: it reads
--   current_user and the caller's own claims, nothing else. A disabled or
--   missing flag row means no gate, so deleting the row is the same as
--   turning it off, which only an administrator can do.
-- ============================================================================

insert into public.feature_flags (key, description, enabled)
values (
  'require_admin_mfa',
  'Administrator authority needs a verified second factor (aal2). Turn on only from a session that has verified one; the server refuses it otherwise.',
  false
)
on conflict (key) do nothing;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  )
  and (
    coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    or not coalesce(
      (select f.enabled from public.feature_flags f where f.key = 'require_admin_mfa'),
      false
    )
  );
$$;

comment on function public.is_admin() is
  'True when the caller''s profile is an active administrator (0200) and, while the require_admin_mfa feature flag is on, the session has verified a second factor (aal2, 0210). The gate of every admin-only RPC and policy.';

create or replace function public.feature_flags_admin_mfa_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.key = 'require_admin_mfa'
    and new.enabled
    and not (tg_op = 'UPDATE' and old.key = 'require_admin_mfa' and old.enabled)
    and current_user in ('anon', 'authenticated')
    and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
  then
    raise exception 'Verify a second factor before requiring one for administrators'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.feature_flags_admin_mfa_guard() is
  'Refuses turning require_admin_mfa on from a client session below aal2, so the administrator who turns the gate on can still pass it (0210).';

revoke all on function public.feature_flags_admin_mfa_guard() from public, anon, authenticated;

create trigger feature_flags_admin_mfa_guard
  before insert or update on public.feature_flags
  for each row execute function public.feature_flags_admin_mfa_guard();
