-- ============================================================================
-- 0115_admin_see_unconfirmed_magistrate_court_requests.sql
--
-- Court Assignment Administrators must see pending magistrate court
-- requests even before the requester confirms email. Testers (and real
-- magistrates whose confirmation mail is delayed) were otherwise
-- invisible on Pending Requests, so admins fell back to Roster search.
--
-- Pending requests still grant zero Docket access; visibility is for
-- review only. Approval remains decide_magistrate_court_request() (0107).
-- Magistrates still only see their own rows.
-- ============================================================================

drop policy if exists "Magistrates can view their own court requests"
  on public.magistrate_court_requests;

create policy "Magistrates can view their own court requests"
  on public.magistrate_court_requests for select
  using (
    profile_id = (select auth.uid())
    or (select public.is_admin())
  );

comment on policy "Magistrates can view their own court requests"
  on public.magistrate_court_requests is
  'Own rows for the requester at any verification status. is_admin() sees every row, including unconfirmed signups (0115). Docket access is still only granted by decide_magistrate_court_request() (0107).';

-- Batch confirmation flags for the admin review UI. Does not expose
-- auth.users to the client; only (request_id, email_confirmed).
create or replace function public.list_magistrate_court_request_email_confirmation()
returns table (request_id uuid, email_confirmed boolean)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, (u.email_confirmed_at is not null)
  from public.magistrate_court_requests r
  join auth.users u on u.id = r.profile_id
  where r.profile_id = (select auth.uid())
     or (select public.is_admin());
$$;

comment on function public.list_magistrate_court_request_email_confirmation() is
  'Returns (request_id, email_confirmed) for magistrate_court_requests the caller may see: own rows, or all rows if is_admin(). Does not expose auth.users.';

grant execute on function public.list_magistrate_court_request_email_confirmation() to authenticated;
