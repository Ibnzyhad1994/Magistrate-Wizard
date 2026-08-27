-- ============================================================================
-- 0096_clerk_profile_lookup_for_review.sql
--
-- Real gap caught by live UI testing: `profiles` SELECT RLS (0001/0012)
-- is self-or-admin only. A magistrate reviewing a clerk_access_requests
-- row for a court they manage can see the REQUEST (0088's RLS correctly
-- permits that), but any embedded/joined read of the requesting clerk's
-- `profiles` row (full_name, email) is silently filtered to nothing by
-- profiles' own RLS — the feature spec explicitly requires the magistrate
-- see "Clerk's full name, Clerk's verified email."
--
-- Rather than add a branch to `profiles`' own RLS (a foundational,
-- widely-used table — broadening it is a larger blast radius than this
-- narrow need justifies), this adds one SECURITY DEFINER function scoped
-- to exactly the legitimate case: a magistrate may look up the name/email
-- of a clerk who has a request OR an assignment at a court that
-- magistrate currently manages. Nothing else about `profiles` access
-- changes. Admins (already full profiles visibility via existing RLS)
-- get the same rows through this function too, for a single consistent
-- lookup path in the frontend.
-- ============================================================================

create or replace function public.clerk_profiles_for_review(p_profile_ids uuid[])
returns table(id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.email
  from public.profiles p
  where p.id = any (p_profile_ids)
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.clerk_access_requests r
        where r.profile_id = p.id and public.can_manage_clerk_access(r.court_id)
      )
      or exists (
        select 1 from public.clerk_courts cc
        where cc.profile_id = p.id and public.can_manage_clerk_access(cc.court_id)
      )
    );
$$;

comment on function public.clerk_profiles_for_review(uuid[]) is
  'Returns id/full_name/email for each requested profile id that is (a) a clerk with a request or assignment at a court the CALLER currently manages, or (b) any profile at all if the caller is_admin(). Every other id is silently omitted, not erroring. Never exposes role, court_id, staff_id, or any field beyond name/email. Does not alter profiles'' own RLS.';

grant execute on function public.clerk_profiles_for_review(uuid[]) to authenticated;
