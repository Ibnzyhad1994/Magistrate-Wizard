-- Magistrate Wizard -- 0201: administrators deactivate and reactivate accounts
--
-- Problem (backend sweep BE-09)
--   0200 makes is_active = false lock an account out of the data, but the
--   only way to set it was a direct profiles update (an administrator's
--   Data API session, or the Supabase dashboard). That left the account
--   signed in and able to sign in again, wrote no reason, and could leave
--   the platform with no active administrator.
--
-- Change
--   1. set_profile_active(p_profile_id, p_active, p_reason) is the one
--      client path. It needs an active administrator, and:
--        * deactivating needs a reason (500 characters at most) and is
--          refused when it would leave no active administrator, which can
--          only happen when the last one deactivates themselves;
--        * deactivating bans the user (auth.users.banned_until, the field
--          the Auth admin API's ban_duration sets) and deletes every one of
--          their sessions, which also deletes their refresh tokens. No
--          device can refresh or sign in again, and the access token
--          already issued expires within jwt_expiry (one hour), while 0200
--          denies it every table, file and helper-gated RPC;
--        * reactivating lifts the ban; the user signs in again;
--        * court assignments are NOT ended (owner decision, 2026-10-28):
--          the result lists the account's open magistrate and clerk court
--          assignments so the administrator can reassign each one;
--        * a change writes an audit_log event with the reason, next to the
--          row the profiles privilege trigger (0113) already records;
--        * it is idempotent: repeating a call changes nothing more, but
--          still re-applies the ban and deletes any session, so repeating
--          a deactivation repairs an account deactivated some other way.
--      Calls are serialised by an advisory lock, so two administrators
--      deactivating each other at once cannot leave none.
--   2. A BEFORE UPDATE trigger refuses an is_active change from a client
--      role (anon, authenticated), administrators included, exactly as
--      0168 does for role, court and email. The RPC, the service role and
--      the SQL editor are not client roles.
--   3. Accounts already inactive are banned and signed out now, so every
--      inactive account is in the state the RPC leaves it in.
--
-- Threat model
--   set_profile_active is SECURITY DEFINER because it writes auth.users and
--   auth.sessions, which no client role can touch. It trusts only
--   auth.uid() for the caller, re-checks is_admin() after taking the lock,
--   and touches only the one target account. EXECUTE is granted to
--   authenticated only. profiles_is_active_guard() is SECURITY INVOKER on
--   purpose: it reads current_user.
-- ============================================================================

-- 1. set_profile_active -------------------------------------------------------

create or replace function public.set_profile_active(
  p_profile_id uuid,
  p_active boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
  v_target public.profiles%rowtype;
  v_changed boolean;
  v_sessions integer := 0;
  v_assignments jsonb;
begin
  if p_profile_id is null or p_active is null then
    raise exception 'p_profile_id and p_active are required'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.set_profile_active'));

  if not (select public.is_admin()) then
    raise exception 'Only an active administrator can deactivate or reactivate an account'
      using errcode = '42501';
  end if;
  if not p_active and v_reason is null then
    raise exception 'Give a reason for deactivating this account'
      using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Keep the reason to 500 characters or fewer'
      using errcode = '22023';
  end if;

  select * into v_target from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception 'Account % not found', p_profile_id
      using errcode = 'P0002';
  end if;

  if not p_active
    and v_target.role = 'admin'
    and v_target.is_active
    and not exists (
      select 1 from public.profiles
      where role = 'admin' and is_active and id <> p_profile_id
    )
  then
    raise exception 'This is the last active administrator. Make another account an administrator before deactivating this one.'
      using errcode = 'P0001';
  end if;

  v_changed := v_target.is_active is distinct from p_active;
  if v_changed then
    update public.profiles set is_active = p_active where id = p_profile_id;

    insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
    values (
      (select auth.uid()),
      'update',
      'profiles',
      p_profile_id,
      jsonb_build_object(
        'event', case when p_active then 'account_reactivated' else 'account_deactivated' end,
        'reason', v_reason
      )
    );
  end if;

  if p_active then
    update auth.users set banned_until = null
    where id = p_profile_id and banned_until is not null;
  else
    update auth.users set banned_until = timestamptz '9999-12-31 00:00:00+00'
    where id = p_profile_id;
    delete from auth.sessions where user_id = p_profile_id;
    get diagnostics v_sessions = row_count;
  end if;

  select coalesce(jsonb_agg(a.assignment order by a.started_at, a.id), '[]'::jsonb)
  into v_assignments
  from (
    select
      mc.id,
      mc.started_at,
      jsonb_build_object(
        'kind', 'magistrate',
        'assignment_id', mc.id,
        'court_id', mc.court_id,
        'court_name', c.name,
        'assignment_type', mc.assignment_type,
        'occupies_primary_slot', mc.occupies_primary_slot,
        'can_manage_clerks', mc.can_manage_clerks,
        'started_at', mc.started_at
      ) as assignment
    from public.magistrate_courts mc
    join public.courts c on c.id = mc.court_id
    where mc.profile_id = p_profile_id and mc.ended_at is null
    union all
    select
      cc.id,
      cc.started_at,
      jsonb_build_object(
        'kind', 'clerk',
        'assignment_id', cc.id,
        'court_id', cc.court_id,
        'court_name', c.name,
        'started_at', cc.started_at
      )
    from public.clerk_courts cc
    join public.courts c on c.id = cc.court_id
    where cc.profile_id = p_profile_id and cc.ended_at is null
  ) a;

  return jsonb_build_object(
    'profile_id', p_profile_id,
    'is_active', p_active,
    'changed', v_changed,
    'sessions_revoked', v_sessions,
    'court_assignments', v_assignments
  );
end;
$$;

comment on function public.set_profile_active(uuid, boolean, text) is
  'Deactivates or reactivates one account (0201, BE-09). Active administrators only. Deactivating needs a reason, is refused for the last active administrator, bans the user and deletes their sessions; reactivating lifts the ban. Never ends court assignments: returns { profile_id, is_active, changed, sessions_revoked, court_assignments[] } listing the open magistrate and clerk assignments to reassign. Audited; idempotent.';

revoke all on function public.set_profile_active(uuid, boolean, text) from public, anon;
grant execute on function public.set_profile_active(uuid, boolean, text) to authenticated;

-- 2. is_active changes only through set_profile_active ------------------------

create or replace function public.profiles_is_active_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception
      'An account is deactivated or reactivated only through set_profile_active, which also signs it out.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.profiles_is_active_guard() is
  'BEFORE UPDATE on profiles (0201): refuses an is_active change from a client role (anon, authenticated), admins included, so it changes only through set_profile_active, the service role or the SQL editor. INVOKER on purpose: it reads current_user.';

revoke all on function public.profiles_is_active_guard() from public, anon, authenticated;

create trigger profiles_is_active_guard
  before update of is_active on public.profiles
  for each row
  when (old.is_active is distinct from new.is_active)
  execute function public.profiles_is_active_guard();

-- 3. Accounts already inactive ------------------------------------------------

update auth.users u set banned_until = timestamptz '9999-12-31 00:00:00+00'
from public.profiles p
where p.id = u.id and not p.is_active;

delete from auth.sessions s
using public.profiles p
where p.id = s.user_id and not p.is_active;
