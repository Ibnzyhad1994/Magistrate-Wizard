-- 0138_revoke_anon_search.sql
--
-- Postgres grants EXECUTE to PUBLIC by default. 0137's CREATE OR REPLACE
-- kept that, so the anon key could still call expensive search RPCs
-- (the limiter then raised Not authenticated). Revoke from public/anon;
-- authenticated keeps execute.

revoke all on function public.enforce_rpc_rate_limit(text, integer, integer) from public, anon;
revoke all on function public.global_search(text, integer) from public, anon;
revoke all on function public.search_docket_matters(text, integer) from public, anon;
revoke all on function public.search_case_law(text, integer) from public, anon;
revoke all on function public.search_case_law_scoped(text, integer, uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.search_judgments(text, integer) from public, anon;
revoke all on function public.search_statutes(text, integer) from public, anon;
revoke all on function public.search_bench_notes(text, integer) from public, anon;
revoke all on function public.download_my_data() from public, anon;

grant execute on function public.enforce_rpc_rate_limit(text, integer, integer) to authenticated;
grant execute on function public.global_search(text, integer) to authenticated;
grant execute on function public.search_docket_matters(text, integer) to authenticated;
grant execute on function public.search_case_law(text, integer) to authenticated;
grant execute on function public.search_case_law_scoped(text, integer, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.search_judgments(text, integer) to authenticated;
grant execute on function public.search_statutes(text, integer) to authenticated;
grant execute on function public.search_bench_notes(text, integer) to authenticated;
grant execute on function public.download_my_data() to authenticated;
