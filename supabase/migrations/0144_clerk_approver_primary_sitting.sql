-- 0144_clerk_approver_primary_sitting.sql
--
-- Covering magistrates (acting/relief/other) used to freeze clerk
-- approval: can_manage_clerk_access() treated EVERY current
-- magistrate_courts row as a competing reviewer, so a court with a
-- primary plus anyone covering had "several magistrates and none
-- flagged can_manage_clerks". That flag defaults false and had no UI.
--
-- New rule (still never auto-approves):
--   * A currently assigned magistrate may review clerks at that court if
--     they are flagged can_manage_clerks, OR they are the sole current
--     sitting of any type, OR they are the unique current primary
--     (assignment_type = 'regular') even when acting/relief also sit.
--   * Two current primaries at the same court (pre-0105 leftovers only;
--     0105 blocks new ones) still need the flag.
--   * Two coverings with no primary still need the flag or a sole sitting.
--
-- court_has_no_clerk_approver() matches the same predicate so the admin
-- unresolved list only shows courts that genuinely have nobody who could
-- review — not courts whose primary is merely covering-accompanied.

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
  );
$$;

comment on function public.can_manage_clerk_access(uuid) is
  'True if the authenticated user is a magistrate currently authorized to review Clerk access requests for this exact court. They must have a CURRENT magistrate_courts assignment to it, AND either be flagged can_manage_clerks, be the sole currently-assigned magistrate at that court, or be the unique current primary (regular) sitting even when acting/relief/other also sit. If no current magistrate satisfies any of those, this returns false for everyone -- the request stays pending and surfaces on the admin unresolved list (0092), never auto-approved. SECURITY DEFINER so the inner counts see every current row, not only the caller''s (magistrate_courts SELECT is self-or-admin).';

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
  );
$$;

comment on function public.court_has_no_clerk_approver(uuid) is
  'True if NO currently-assigned magistrate at this court would satisfy can_manage_clerk_access() for it today (no current magistrate, several coverings with no unique primary and none flagged can_manage_clerks, or several primaries with none flagged). Used only to flag orphaned pending requests for the admin fallback view -- never used to auto-approve anything.';

comment on column public.magistrate_courts.can_manage_clerks is
  'Admin-set (0086). Needed only when more than one CURRENT primary (regular) sits at the same court, or when several coverings sit with no unique primary. A unique current primary may always review clerk access there even if acting/relief also sit (0144). Distinct from assignment_type (0017).';
