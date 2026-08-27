-- ============================================================================
-- 0092_clerk_admin_fallback.sql
--
-- Surfaces requests that no currently-assigned magistrate can act on --
-- e.g. a court with no current magistrate at all, or one with several
-- current magistrates none of whom is flagged can_manage_clerks -- so an
-- administrator can correct the underlying magistrate_courts roster
-- (assign a magistrate, or set can_manage_clerks) rather than the request
-- being silently stuck forever. Such a request is NEVER auto-approved --
-- it simply stays 'pending' (the existing default) until either a
-- qualifying magistrate exists or an admin acts directly (both
-- clerk_courts and clerk_access_requests already grant admin full
-- fallback visibility/action via the `is_admin()` branches added in
-- 0087/0088 -- this migration adds a targeted FINDER on top of that
-- existing access, not new access itself).
--
-- Deliberately a SECURITY DEFINER FUNCTION, not a plain VIEW: a view
-- owned by the migration role would evaluate the underlying tables'
-- RLS as the OWNER (who bypasses RLS as the table owner), not as the
-- querying user -- silently exposing every orphaned request across
-- every court to ANY authenticated caller who queries it, admin or not.
-- The function instead checks is_admin() explicitly in its own WHERE
-- clause and returns zero rows for anyone else, exactly like every
-- other admin-gated predicate in this schema.
-- ============================================================================

create or replace function public.court_has_no_clerk_approver(p_court_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.magistrate_courts mc
    where mc.court_id = p_court_id
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

comment on function public.court_has_no_clerk_approver(uuid) is
  'True if NO currently-assigned magistrate at this court would satisfy can_manage_clerk_access() for it today (no current magistrate at all, or several with none flagged can_manage_clerks). Used only to flag orphaned pending requests for the admin fallback view -- never used to auto-approve anything.';

grant execute on function public.court_has_no_clerk_approver(uuid) to authenticated;

create or replace function public.list_clerk_access_requests_needing_admin_attention()
returns setof public.clerk_access_requests
language sql
stable
security definer
set search_path = public
as $$
  select r.*
  from public.clerk_access_requests r
  where (select public.is_admin())
    and r.status = 'pending'
    and (select public.clerk_access_request_email_confirmed(r.id))
    and (select public.court_has_no_clerk_approver(r.court_id));
$$;

comment on function public.list_clerk_access_requests_needing_admin_attention() is
  'Admin-only (returns zero rows for any non-admin caller, rather than raising): every verified, still-pending clerk access request whose court currently has no magistrate who could review it. Surfaces exactly the "no authorized approving magistrate can be identified" case the feature spec requires be exposed to an administrator, never silently or automatically approved.';

grant execute on function public.list_clerk_access_requests_needing_admin_attention() to authenticated;
