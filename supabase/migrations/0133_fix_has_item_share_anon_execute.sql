-- ============================================================================
-- 0133_fix_has_item_share_anon_execute.sql
--
-- Bug found in a security audit: has_item_share() and
-- has_item_share_authority() (0121) are called directly inside live
-- policies on judgments, case_law, and shares -- but 0121 revoked anon
-- EXECUTE on both, unlike every comparable RLS-evaluated helper in this
-- schema (is_admin(), can_access_court(), can_view_docket_matter(), ...
-- all anon-executable; see 0012's own comment on exactly this point, and
-- the 0130 migration that fixed the identical mistake for
-- can_access_callover()).
--
-- Postgres checks function EXECUTE privilege at plan time, not per row, so
-- this doesn't filter rows -- it fails the ENTIRE query with
-- "42501 permission denied for function has_item_share" for any anonymous
-- PostgREST request against judgments, case_law, or shares. Fail-closed
-- (no extra data exposed by this bug), but it's a function-name disclosure
-- to an unauthenticated caller and a live regression of a pattern this
-- codebase already paid to fix once.
--
-- Both functions derive their answer from a shares row keyed to auth.uid()
-- (null for anon), so granting anon EXECUTE cannot expose anything --
-- an anonymous caller gets back false, exactly like every other
-- RLS-evaluated helper already does.
-- ============================================================================

grant execute on function public.has_item_share(text, uuid, text) to anon;
grant execute on function public.has_item_share_authority(text, uuid) to anon;
