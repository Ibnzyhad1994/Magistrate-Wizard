-- 0149_lock_down_anon_rpcs_and_clerk_bench_notes.sql
--
-- Local adversarial assessment (Composer 2.5):
--
-- 1. Postgres grants EXECUTE to PUBLIC by default. Clerk/court decision
--    RPCs granted EXECUTE to authenticated in 0089/0107/0108 but never
--    revoked PUBLIC, so the anon key could invoke the body (it then
--    failed on is_admin() / can_manage_clerk_access() / "not found").
--    Mirror 0138: revoke public/anon, keep authenticated.
--
-- 2. bench_notes INSERT was author_id = auth.uid() with no clerk guard.
--    UI already hides the workbench from clerks (0093 comment); the API
--    still allowed a clerk to create a note. Match case_law/judgments.

revoke all on function public.decide_clerk_access_request(uuid, public.clerk_access_decision, text) from public, anon;
revoke all on function public.revoke_clerk_court_access(uuid, text) from public, anon;
revoke all on function public.decide_magistrate_court_request(uuid, public.magistrate_court_decision, text) from public, anon;
revoke all on function public.admin_assign_magistrate_court(uuid, uuid, text) from public, anon;
revoke all on function public.admin_bootstrap_self_approve_magistrate_court_request(uuid, text) from public, anon;

grant execute on function public.decide_clerk_access_request(uuid, public.clerk_access_decision, text) to authenticated;
grant execute on function public.revoke_clerk_court_access(uuid, text) to authenticated;
grant execute on function public.decide_magistrate_court_request(uuid, public.magistrate_court_decision, text) to authenticated;
grant execute on function public.admin_assign_magistrate_court(uuid, uuid, text) to authenticated;
grant execute on function public.admin_bootstrap_self_approve_magistrate_court_request(uuid, text) to authenticated;

drop policy if exists "Authors can create their own bench notes" on public.bench_notes;
create policy "Authors can create their own bench notes"
  on public.bench_notes for insert
  with check (
    author_id = (select auth.uid())
    and not (select public.is_clerk())
  );
