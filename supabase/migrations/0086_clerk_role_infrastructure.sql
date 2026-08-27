-- ============================================================================
-- 0086_clerk_role_infrastructure.sql
--
-- Foundation for the Court Clerk access system. Adds nothing that grants
-- Docket access by itself -- this migration only prepares the pieces
-- later migrations (0087-0092) compose into the actual clerk workflow.
--
-- Sections:
--   1. handle_new_user() -- safely read a self-declared account type at
--      signup, without creating any privilege-escalation path.
--   2. is_magistrate() / is_clerk() -- role-check helpers, mirroring the
--      existing is_admin() shape exactly (0001).
--   3. magistrate_courts.can_manage_clerks -- a new, narrow, additive
--      column resolving the "more than one magistrate at a court" case.
--      Does NOT repurpose assignment_type (0017) -- that column's
--      existing meaning (regular/acting/relief/other, purely
--      descriptive, never permission-bearing) is untouched.
--   4. can_manage_clerk_access(court_id) -- the actual approver-
--      resolution rule.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. handle_new_user() -- add a SAFE, NARROW account-type signal
--
-- `role` has never been read from signup metadata (0001/0002) -- it has
-- always taken the table default ('magistrate'). This migration adds
-- exactly one new capability: a self-registering user MAY end up with
-- role='clerk' if, and only if, they explicitly requested it. The
-- literal string match below is the entire security boundary -- there is
-- no other path from client-supplied signup data to a `role` value.
--
-- Specifically:
--   * raw_user_meta_data->>'requested_role' = 'clerk'  -> role = 'clerk'
--   * anything else (absent, 'admin', 'magistrate', garbage, an array,
--     an attempted SQL/JSON injection string) -> role = 'magistrate',
--     the exact same safe default as before this migration.
-- 'admin' can NEVER be reached this way, regardless of what a client
-- sends -- there is no branch that produces it. Choosing "Magistrate" at
-- signup is therefore exactly as inert as today: role='magistrate' alone
-- grants zero Court access (magistrate_courts INSERT is admin-only since
-- 0052) and zero special treatment anywhere in this migration.
--
-- court_id continues to be read from signup metadata completely
-- unchanged from 0002 -- not touched, not newly trusted, pre-existing
-- behavior this migration has no reason to alter.
-- ----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, court_id, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    nullif(new.raw_user_meta_data ->> 'court_id', '')::uuid,
    case
      when new.raw_user_meta_data ->> 'requested_role' = 'clerk' then 'clerk'::public.user_role
      else 'magistrate'::public.user_role
    end
  );
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Auto-provisions a profiles row on signup (trigger only -- EXECUTE revoked from public/anon/authenticated since 0012). role is ''clerk'' ONLY when raw_user_meta_data->>''requested_role'' is the exact literal string ''clerk''; every other value, including any attempt to request ''admin'', falls through to the safe ''magistrate'' default. This is the entire self-registration security boundary for role (0086) -- magistrate/admin Court access is never granted merely by role and always requires a separate admin-provisioned magistrate_courts row (0052) or an approved clerk_courts row (0087).';

-- ----------------------------------------------------------------------------
-- 2. is_magistrate() / is_clerk() -- mirror is_admin() (0001) exactly
-- ----------------------------------------------------------------------------

create or replace function public.is_magistrate()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'magistrate'
  );
$$;

comment on function public.is_magistrate() is
  'True if the authenticated user''s profiles.role is ''magistrate''. Mirrors is_admin() (0001). A role check only -- carries no Court access by itself; see can_access_court().';

create or replace function public.is_clerk()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'clerk'
  );
$$;

comment on function public.is_clerk() is
  'True if the authenticated user''s profiles.role is ''clerk''. A role check only -- carries no Court access by itself; see has_active_clerk_assignment() (0087).';

-- ----------------------------------------------------------------------------
-- 3. magistrate_courts.can_manage_clerks
--
-- Purely additive column. No RLS change needed: magistrate_courts
-- INSERT/UPDATE are already admin-only ("Admins can create/manage Court
-- assignments", 0052), so the existing policies already govern this
-- column exactly like every other one -- only an admin can set it.
-- ----------------------------------------------------------------------------

alter table public.magistrate_courts
  add column can_manage_clerks boolean not null default false;

comment on column public.magistrate_courts.can_manage_clerks is
  'Admin-set (0086). Used only to resolve which magistrate may review Clerk access requests when MORE THAN ONE magistrate currently sits at the same court (see can_manage_clerk_access()). When exactly one magistrate is currently assigned to a court, that magistrate may always manage clerk access there regardless of this flag. Distinct from, and never repurposes, assignment_type (0017) -- that column remains purely descriptive.';

-- ----------------------------------------------------------------------------
-- 4. can_manage_clerk_access(p_court_id) -- the approver-resolution rule
--
-- SECURITY DEFINER is required here for correctness, not merely
-- convention: the inner count(*) must see EVERY current magistrate_courts
-- row at the court, not just the caller's own (magistrate_courts SELECT
-- RLS is self-or-admin, 0017/0052) -- a SECURITY INVOKER version would
-- have each magistrate's own count always evaluate to 1 (they can only
-- ever see their own row), incorrectly granting universal approval
-- rights at every multi-magistrate court. SECURITY DEFINER with a fixed
-- search_path avoids that entirely by seeing the true table-wide count.
-- ----------------------------------------------------------------------------

create or replace function public.can_manage_clerk_access(p_court_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.magistrate_courts mc
    where mc.court_id = p_court_id
      and mc.profile_id = auth.uid()
      and mc.ended_at is null
      and (
        mc.can_manage_clerks = true
        or (
          select count(*) from public.magistrate_courts mc2
          where mc2.court_id = p_court_id and mc2.ended_at is null
        ) = 1
      )
  );
$$;

comment on function public.can_manage_clerk_access(uuid) is
  'True if the authenticated user is a magistrate currently authorized to review/approve Clerk access requests for this exact court: they must have a CURRENT magistrate_courts assignment to it, AND either be the sole currently-assigned magistrate at that court, or be explicitly flagged can_manage_clerks=true (needed only when multiple magistrates are current at the same court). If no current magistrate satisfies either condition, this returns false for everyone -- a request at such a court is never auto-approved; it surfaces to the admin fallback view instead (0092). SECURITY DEFINER for correctness (see migration header) -- returns only a boolean, never row data, and never accepts a caller-supplied profile id (uses auth.uid() exclusively).';

grant execute on function public.is_magistrate() to authenticated;
grant execute on function public.is_clerk() to authenticated;
grant execute on function public.can_manage_clerk_access(uuid) to authenticated;
