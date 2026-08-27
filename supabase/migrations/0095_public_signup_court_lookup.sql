-- ============================================================================
-- 0095_public_signup_court_lookup.sql
--
-- Real gap caught by live UI testing: the public registration page (no
-- session yet — the visitor isn't authenticated) needs to show the
-- Magisterial District / Court picker for a clerk sign-up, but
-- `magisterial_districts`/`courts` SELECT RLS (0002/0013) is scoped to
-- the `authenticated` role only — an anonymous request returns nothing.
--
-- Rather than widen those tables' own RLS to anon (which would be a
-- genuine, if low-risk, WEAKENING of an existing restriction, and this
-- feature must not weaken any existing policy), this adds two narrow
-- SECURITY DEFINER functions that expose ONLY the minimal public fields
-- (id, name, and for courts, district_id) needed to populate that one
-- picker, for currently-active rows only. The underlying tables' RLS is
-- completely unchanged — every other consumer (admin Court Assignments,
-- the Docket "New matter" court picker, etc.) still goes through the
-- real tables under the real, unmodified `authenticated`-only policies.
-- ============================================================================

create or replace function public.list_active_magisterial_districts_for_signup()
returns table(id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select id, name
  from public.magisterial_districts
  where is_active = true
  order by name;
$$;

comment on function public.list_active_magisterial_districts_for_signup() is
  'Anon-callable (0095): id/name of currently-active Magisterial Districts only, for the public clerk-registration picker. Deliberately does not expose is_active/created_at/updated_at, and does not alter magisterial_districts'' own RLS (still authenticated-only).';

create or replace function public.list_active_courts_for_signup()
returns table(id uuid, name text, district_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select id, name, district_id
  from public.courts
  where is_active = true
  order by name;
$$;

comment on function public.list_active_courts_for_signup() is
  'Anon-callable (0095): id/name/district_id of currently-active courts only, for the public clerk-registration picker. Deliberately does not expose jurisdiction/address/created_at/updated_at, and does not alter courts'' own RLS (still authenticated-only).';

grant execute on function public.list_active_magisterial_districts_for_signup() to anon, authenticated;
grant execute on function public.list_active_courts_for_signup() to anon, authenticated;
