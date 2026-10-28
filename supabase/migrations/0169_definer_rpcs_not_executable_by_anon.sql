-- Magistrate Wizard -- 0169: signed-in-only SECURITY DEFINER RPCs refuse anon
--
-- Problem (backend sweep BE-12)
--   Earlier migrations closed these functions with a bare
--   `revoke execute ... from public`. Supabase's default privileges grant
--   EXECUTE to anon by name, so that revoke left anon able to run every
--   one of them. Each body refuses or returns nothing to a caller with no
--   auth.uid() (none is exploitable), but anon could still run them, read
--   their error text and spend database time. 0138, 0149 and 0154 fixed
--   this class piecemeal; nothing stopped it recurring.
--
-- Change
--   EXECUTE is revoked from public and anon on the SECURITY DEFINER RPCs
--   below, and kept for authenticated. Each was checked for an anonymous
--   caller first: none is called before sign-in by the app (src/), by an
--   Edge Function with the anon key, by an RLS policy, or by an INVOKER
--   function anon can reach. Every app call site runs signed in.
--     apply_case_law_tags, apply_statute_tags              curators tagging
--     finalize_legislation_document                         Act upload
--     publish_case_law_import, reject_case_law_import       import review
--     publish_legislation_import, reject_legislation_import import review
--     set_case_law_review_status, set_legislation_review_status
--     set_docket_matter_next_date                           Docket, offline outbox
--     relinquish_magistrate_court                           court assignments
--     list_courts_for_magistrate_request                    signed-in request page
--     clerk_profiles_for_review                             clerk access review
--     list_clerk_access_requests_needing_admin_attention    admin fallback
--     list_magistrate_court_request_email_confirmation      admin review
--     is_sole_admin_bootstrap_available                     admin review
--
--   Kept anon-executable, on purpose:
--     * RLS helpers that policies applying to PUBLIC evaluate (is_admin,
--       is_clerk, is_magistrate, my_court_id, can_view_* / can_edit_*,
--       has_item_share, has_item_share_authority, has_docket_matter_authority,
--       has_active_magistrate_court, user_can_access_case,
--       user_can_access_bench_note, can_attach_preview_derivative,
--       can_access_callover, clerk_access_request_email_confirmed,
--       magistrate_court_request_email_confirmed). Revoking one turns an
--       anonymous request's empty result into "permission denied for
--       function ...", which 0130 fixed for can_access_callover; each
--       returns false for a caller with no auth.uid().
--     * The sign-up surface: list_active_courts_for_signup,
--       list_active_magisterial_districts_for_signup,
--       list_active_courts_for_magistrate_signup and
--       court_has_active_primary_magistrate (0107 grants it to anon).
--     * record_auth_event: the sign-in screen reports a failed sign-in and
--       a reset request before there is a session (BE-11, 0170).
--
--   anon_executable_definer_functions() lists what anon can still run, for
--   the live test that keeps this list from growing unnoticed. Only the
--   service role may call it.
--
-- Threat model
--   No access is widened: authenticated keeps exactly the EXECUTE it had.
--   anon_executable_definer_functions() is SECURITY DEFINER only so it can
--   read pg_proc ACLs consistently; it takes no input, returns function
--   signatures (already public in this repository) and is executable by
--   the service role alone.
-- ============================================================================

do $$
declare
  v_names constant text[] := array[
    'apply_case_law_tags',
    'apply_statute_tags',
    'finalize_legislation_document',
    'publish_case_law_import',
    'reject_case_law_import',
    'publish_legislation_import',
    'reject_legislation_import',
    'set_case_law_review_status',
    'set_legislation_review_status',
    'set_docket_matter_next_date',
    'relinquish_magistrate_court',
    'list_courts_for_magistrate_request',
    'clerk_profiles_for_review',
    'list_clerk_access_requests_needing_admin_attention',
    'list_magistrate_court_request_email_confirmation',
    'is_sole_admin_bootstrap_available'
  ];
  v_fn regprocedure;
  v_found integer := 0;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosecdef
      and p.proname = any (v_names)
  loop
    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
    v_found := v_found + 1;
  end loop;

  -- Every name must exist as a SECURITY DEFINER function: a rename or an
  -- INVOKER rewrite should fail here, not pass quietly.
  if v_found < cardinality(v_names) then
    raise exception '0169: expected at least % SECURITY DEFINER functions, found %',
      cardinality(v_names), v_found;
  end if;
end $$;

create or replace function public.anon_executable_definer_functions()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select p.oid::regprocedure::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and p.prosecdef
    and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('anon', p.oid, 'execute')
  order by 1;
$$;

comment on function public.anon_executable_definer_functions() is
  'Signatures of the public SECURITY DEFINER functions (triggers excluded) that anon can execute (0169). For the live test that keeps that set to its reviewed allowlist. Service role only.';

revoke all on function public.anon_executable_definer_functions() from public, anon, authenticated;
grant execute on function public.anon_executable_definer_functions() to service_role;
