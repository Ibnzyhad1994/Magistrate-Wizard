-- Magistrate Wizard -- 0200: a deactivated account has no access
--
-- Problem (backend sweep BE-09)
--   profiles.is_active was enforced nowhere. is_admin(), is_magistrate()
--   and is_clerk() read only role; my_court_id() and the court helpers
--   read only the assignment tables; no policy read the flag. A magistrate
--   who had left, or an administrator marked Inactive on Admin People,
--   kept full access, and offboarding needed the Supabase dashboard.
--
-- Decision (owner, 2026-10-28)
--   is_active = false locks the account out immediately. Its court
--   assignments are NOT ended: set_profile_active (0201) returns them so an
--   administrator can reassign each one.
--
-- Change
--   1. is_active_account(): the caller's profile exists and is active.
--      False for anon and for a caller with no profile.
--   2. The role helpers (is_admin, is_magistrate, is_clerk), my_court_id()
--      and the court and docket helpers (can_access_court,
--      has_active_clerk_assignment, has_active_magistrate_court,
--      can_manage_clerk_access, has_retained_assignment, has_docket_share)
--      answer false (my_court_id null) for a deactivated caller, so every
--      SECURITY DEFINER RPC that gates on them refuses too. Bodies are
--      otherwise unchanged; `create or replace` keeps their grants and
--      comments.
--   3. A RESTRICTIVE policy for authenticated on every public table with
--      RLS, and on storage.objects, ANDs is_active_account() into every
--      permissive policy. That covers the policies that key on ownership
--      alone (bench notes, judgments, bookmarks, notifications, including
--      Realtime's notification feed) without touching each one. profiles
--      is the one exception: a deactivated caller still reads their own
--      row, so the app can tell them their account is deactivated rather
--      than show an empty app; every write is refused.
--   test-account-deactivation.mjs fails if a public table with RLS lacks
--   the restrictive policy, so a new table cannot miss it.
--
-- What this does not cover
--   A SECURITY DEFINER RPC that gates only on auth.uid() bypasses RLS. 0201
--   closes that path at the auth layer: deactivation bans the user and
--   deletes their sessions, so no new token is issued and the access token
--   already issued expires within jwt_expiry (one hour).
--
-- Threat model
--   Only narrows access: each helper gains an extra AND, and a restrictive
--   policy can only remove rows. is_active_account() is SECURITY DEFINER so
--   policies (including profiles' own) can call it without recursing
--   through profiles' RLS; it takes no input and returns one boolean about
--   the caller. anon may execute it because the INVOKER court helpers that
--   policies applying to PUBLIC evaluate call it (0169's allowlist rule).
-- ============================================================================

-- 1. The caller's account is active ------------------------------------------

create or replace function public.is_active_account()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_active from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

comment on function public.is_active_account() is
  'True when the caller has a profile and it is active (0200, BE-09). False for anon and for a deactivated account. Every role, court and docket helper ANDs it in, and the restrictive "Deactivated accounts have no access" policies call it.';

revoke all on function public.is_active_account() from public;
grant execute on function public.is_active_account() to anon, authenticated;

-- 2. Role helpers -------------------------------------------------------------

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
  );
$$;

create or replace function public.is_magistrate()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'magistrate' and is_active
  );
$$;

create or replace function public.is_clerk()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'clerk' and is_active
  );
$$;

create or replace function public.my_court_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.court_id
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_active
    and (
      exists (
        select 1 from public.magistrate_courts mc
        where mc.profile_id = p.id and mc.court_id = p.court_id and mc.ended_at is null
      )
      or exists (
        select 1 from public.clerk_courts cc
        where cc.profile_id = p.id and cc.court_id = p.court_id and cc.ended_at is null
      )
    );
$$;

-- 3. Court and docket helpers -------------------------------------------------

create or replace function public.can_access_court(p_court_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select (select public.is_active_account()) and exists (
    select 1 from public.magistrate_courts mc
    where mc.court_id = p_court_id
      and mc.profile_id = auth.uid()
      and mc.ended_at is null
  );
$$;

create or replace function public.has_active_clerk_assignment(p_court_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select (select public.is_active_account()) and exists (
    select 1 from public.clerk_courts cc
    where cc.court_id = p_court_id
      and cc.profile_id = auth.uid()
      and cc.ended_at is null
  );
$$;

create or replace function public.has_active_magistrate_court()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select public.is_active_account()) and exists (
    select 1 from public.magistrate_courts
    where profile_id = (select auth.uid())
      and ended_at is null
  );
$$;

create or replace function public.can_manage_clerk_access(p_court_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select public.is_admin()) or ((select public.is_active_account()) and exists (
    select 1 from public.magistrate_courts mc
    where mc.court_id = p_court_id
      and mc.profile_id = (select auth.uid())
      and mc.ended_at is null
      and (
        mc.can_manage_clerks = true
        or (
          select count(*) from public.magistrate_courts mc2
          where mc2.court_id = p_court_id and mc2.ended_at is null
        ) = 1
        or (
          mc.assignment_type = 'regular'
          and (
            select count(*) from public.magistrate_courts mc3
            where mc3.court_id = p_court_id
              and mc3.ended_at is null
              and mc3.assignment_type = 'regular'
          ) = 1
        )
      )
  ));
$$;

create or replace function public.has_retained_assignment(p_docket_matter_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select (select public.is_active_account()) and exists (
    select 1 from public.docket_matter_assignments dma
    where dma.docket_matter_id = p_docket_matter_id
      and dma.profile_id = auth.uid()
      and dma.ended_at is null
  );
$$;

create or replace function public.has_docket_share(
  p_docket_matter_id uuid,
  p_required_permission text default 'view'
)
returns boolean
language sql
stable
set search_path = public
as $$
  select (select public.is_active_account()) and exists (
    select 1 from public.shares s
    where s.item_type = 'docket_matter'
      and s.item_id = p_docket_matter_id
      and s.recipient_id = (select auth.uid())
      and s.revoked_at is null
      and (p_required_permission = 'view' or s.permission = 'edit')
  );
$$;

-- 4. Restrictive policies -----------------------------------------------------

do $$
declare
  v_table text;
begin
  for v_table in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and c.relname <> 'profiles'
    order by c.relname
  loop
    execute format(
      'create policy "Deactivated accounts have no access" on public.%I '
      'as restrictive for all to authenticated '
      'using ((select public.is_active_account())) '
      'with check ((select public.is_active_account()))',
      v_table
    );
  end loop;
end;
$$;

create policy "Deactivated accounts see only their own profile" on public.profiles
  as restrictive for select to authenticated
  using ((select public.is_active_account()) or id = (select auth.uid()));

create policy "Deactivated accounts cannot add profiles" on public.profiles
  as restrictive for insert to authenticated
  with check ((select public.is_active_account()));

create policy "Deactivated accounts cannot change profiles" on public.profiles
  as restrictive for update to authenticated
  using ((select public.is_active_account()))
  with check ((select public.is_active_account()));

create policy "Deactivated accounts cannot delete profiles" on public.profiles
  as restrictive for delete to authenticated
  using ((select public.is_active_account()));

create policy "Deactivated accounts have no file access" on storage.objects
  as restrictive for all to authenticated
  using ((select public.is_active_account()))
  with check ((select public.is_active_account()));
