-- 0048_audit_extensions.sql
--
-- STATUS: APPLIED and verified live. Rollback-only pretest passed
-- 27/27 assertions (one real defect caught and fixed pre-apply: an
-- earlier draft redacted only content/content_text/description/
-- summary/full_text/annotation_text but not the GENERATED
-- `search_vector` column derived from those same fields, which still
-- leaked the private text via its lowercased/stemmed lexemes -- fixed
-- by also stripping `search_vector` everywhere its source table is
-- redacted). Applied exactly as reviewed. Live advisors: zero new
-- findings (security and performance advisor sets unchanged from
-- pre-0048, modulo the audit_log_table_record_idx INFO finding
-- disappearing because it's now actually exercised).
--
-- PURPOSE: extend the audit trail (0009_audit_log) to the institutional,
-- security-relevant, and lifecycle-relevant tables built since 0009,
-- while enforcing a hard privacy boundary: private substantive judicial
-- work product must never be duplicated in full into audit_log, which
-- is centrally admin-readable. This migration does NOT edit 0009 --
-- `audit_trigger_fn()` is CREATE OR REPLACE'd (a new migration replacing
-- a function body, exactly the forward-modification pattern already
-- used by 0046 for protect_judgment_lifecycle()); the trigger objects
-- created by 0009 (audit_cases/audit_bench_notes/audit_statutes/
-- audit_case_law/audit_documents) are untouched and automatically pick
-- up the new function body with no re-creation needed, same as 0046.
--
-- SCOPE DECISIONS (resolved this turn from an explicit tiered
-- specification -- not invented):
--
-- Full/unredacted audit (institutional, shared, not personally-owned
-- work product -- consistent with the treatment already given to
-- cases/statutes/documents in 0009): docket_matters, docket_events,
-- docket_matter_assignments, magistrate_courts, shares. None of these
-- tables' columns are private substantive judicial reasoning; they are
-- court-anchored institutional record or access-control state.
-- docket_matter_parties is ALSO added full, with ONE disclosed
-- exception: `contact_info` (a party/witness's raw phone/email) is
-- redacted -- pure PII-minimization, not a judicial-privacy boundary;
-- `full_name`/`attorney_name`/`role` remain, since a party's identity
-- in an open matter is already part of the institutional record, not
-- confidential the way Judgment reasoning or a private note is.
--
-- Redacted audit (private substantive work product -- audited for
-- lifecycle/security metadata and provenance, never raw payload).
-- Wherever a table below has a GENERATED tsvector `search_vector`
-- column derived from a redacted field, `search_vector` is ALSO
-- stripped -- caught live during this migration's own rollback-only
-- pretest, where an earlier draft that redacted only the source text
-- columns still leaked the private content through the tsvector's
-- lowercased/stemmed lexeme representation:
--   judgments: `content`, `content_text` redacted. Lifecycle transitions
--     (draft/final, finalized_at/finalized_by, is_discoverable) are
--     fully visible via the surviving columns -- exactly the
--     information an audit trail needs, with zero draft judicial
--     reasoning ever duplicated into an admin-readable table.
--   bench_notes: `content`, `content_text` redacted (author-only private
--     notes; this is the redaction this project has carried as an
--     explicitly deferred decision since early in the project -- now
--     resolved).
--   quick_codes: `content`, `description` redacted (fully private
--     personal snippets; `code_word`/`title` retained as harmless
--     identifying metadata).
--   case_law_annotations: `annotation_text` redacted (private personal
--     research notes).
--   case_law: CONDITIONAL on `owner_id`. Canonical rows (`owner_id IS
--     NULL`, admin-curated institutional reference material, already
--     globally readable to every authenticated user regardless of audit)
--     are captured in FULL -- `summary`/`full_text` included, since
--     there is no privacy boundary to protect for canonical material.
--     Personal rows (`owner_id IS NOT NULL`, private research) have
--     `summary`/`full_text` redacted, matching bench_notes/annotations
--     treatment. This is the one table needing a per-row branch rather
--     than a static per-table field list, implemented as a plain
--     `if new.owner_id is not null` check inside the trigger -- no
--     dynamic SQL anywhere in this function.
--
-- Deliberately NOT touched (Tier 4 / explicitly out of scope, per the
-- same reasoning already applied to the original five audited tables
-- and disclosed rather than silently omitted): bookmarks (metadata,
-- E-category, no substantive content); quick_code_docket_matters /
-- quick_code_judgments / quick_code_case_law (private associations --
-- auditing them centrally would itself be a privacy-boundary problem,
-- since the mere existence of the link discloses a private Quick Code's
-- association); docket_matter_judgments / docket_matter_case_law
-- (institutional associations, low audit value, deferred, not built
-- here); docket_matter_tags / judgment_tags / case_law_tags /
-- bench_note_tags / statute_tags / case_tags / tags (organizational
-- metadata, no content); comments / case_parties (legacy tables
-- discovered live outside the original five -- comments carries the
-- same free-text-privacy shape as bench_notes and case_parties carries
-- PII, both flagged as candidates for a FUTURE migration, deliberately
-- not expanded into this one to avoid uncontrolled scope growth);
-- profiles (role-change auditing -- e.g. who was promoted to admin --
-- is real security value but was not included in the tiered scope this
-- migration was authorized against; explicitly flagged here as a
-- follow-up candidate, not silently dropped); courts /
-- magisterial_districts (low-frequency admin reference data, no
-- security/privacy value).
--
-- READER MODEL: unchanged from 0009 -- `audit_log` SELECT remains
-- admin-only (`is_admin()`), and admin visibility is now, by
-- construction, ALREADY limited to redacted/safe payloads for every
-- private-content table -- there is no separate "admin sees more"
-- carve-out to build, since the redaction happens before the row is
-- ever written, not at read time.
--
-- IMMUTABILITY HARDENING: `audit_log` already has zero INSERT/UPDATE/
-- DELETE RLS policy (0009), so ordinary authenticated users and admins
-- alike cannot mutate audit history through RLS today -- confirmed live
-- before writing this migration. The one gap found live: the schema's
-- default table-level GRANTs still hand `anon`/`authenticated` raw
-- INSERT/UPDATE/DELETE/TRUNCATE table privileges on `audit_log` (the
-- same default-grant pattern 0043 found and revoked for its functions).
-- RLS already blocks all of it, but this migration closes the grant
-- itself as defense-in-depth, mirroring the 0043 precedent exactly.
-- SELECT grant is deliberately left alone -- admins are members of the
-- `authenticated` role and need it; RLS (`is_admin()`) is the correct
-- and sufficient enforcement layer for SELECT, matching every other
-- admin-gated table in this project.
--
-- ACTOR / OFFBOARDING: unchanged from 0009 and confirmed still correct
-- live -- `actor_id references profiles(id) on delete set null`, so a
-- deleted profile nulls its historical `actor_id` but never deletes the
-- audit rows themselves; audit history is never cascade-destroyed by
-- source-row or actor deletion, confirmed for both existing and newly
-- audited tables (none of the new triggers change this FK or add any
-- new one).
--
-- SECURITY DEFINER: `audit_trigger_fn()` remains `SECURITY DEFINER`
-- (unavoidable -- ordinary users have no direct INSERT grant path into
-- audit_log by design, so the trigger must run with elevated privilege
-- to write it) with `search_path` still pinned to `public` (unchanged,
-- was already correct pre-0048) and EXECUTE still granted only to
-- `service_role`/`postgres` -- confirmed live neither `anon` nor
-- `authenticated` can call it directly, so it carries zero direct-RPC
-- exposure and does not appear in the SECURITY DEFINER EXECUTE advisor
-- WARNs. No new SECURITY DEFINER function is introduced by this
-- migration.

create or replace function public.audit_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old);
  end if;

  -- Table-specific redaction. Only the fields listed here are ever
  -- removed from the captured JSON; every other column, and every
  -- other table, is captured exactly as before -- this branch is a
  -- pure subtraction, never an addition or transformation.
  --
  -- `search_vector` is ALSO stripped everywhere its source table is
  -- redacted below. It is a GENERATED tsvector column derived from the
  -- very fields being redacted -- its lexemes are lowercased/stemmed
  -- but still substantially reconstruct the redacted text. Caught live
  -- during this migration's own rollback-only pretest (an earlier
  -- draft that stripped only content/content_text still leaked private
  -- text through search_vector's lexeme representation) and fixed here
  -- before ever being applied.
  if tg_table_name = 'judgments' then
    v_old := v_old - 'content' - 'content_text' - 'search_vector';
    v_new := v_new - 'content' - 'content_text' - 'search_vector';
  elsif tg_table_name = 'bench_notes' then
    v_old := v_old - 'content' - 'content_text' - 'search_vector';
    v_new := v_new - 'content' - 'content_text' - 'search_vector';
  elsif tg_table_name = 'quick_codes' then
    v_old := v_old - 'content' - 'description' - 'search_vector';
    v_new := v_new - 'content' - 'description' - 'search_vector';
  elsif tg_table_name = 'case_law_annotations' then
    v_old := v_old - 'annotation_text';
    v_new := v_new - 'annotation_text';
  elsif tg_table_name = 'docket_matter_parties' then
    v_old := v_old - 'contact_info';
    v_new := v_new - 'contact_info';
  elsif tg_table_name = 'case_law' then
    -- Canonical (owner_id IS NULL) rows are institutional/public
    -- reference material -- captured in full, same as always. Personal
    -- (owner_id IS NOT NULL) rows are private research -- redacted.
    if (tg_op = 'DELETE' and old.owner_id is not null)
       or (tg_op in ('INSERT', 'UPDATE') and new.owner_id is not null) then
      v_old := v_old - 'summary' - 'full_text' - 'search_vector';
      v_new := v_new - 'summary' - 'full_text' - 'search_vector';
    end if;
  end if;

  if tg_op = 'INSERT' then
    insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
    values (auth.uid(), 'insert', tg_table_name, new.id, v_new);
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    values (auth.uid(), 'update', tg_table_name, new.id, v_old, v_new);
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (actor_id, action, table_name, record_id, old_data)
    values (auth.uid(), 'delete', tg_table_name, old.id, v_old);
    return old;
  end if;
  return null;
end;
$$;

comment on function public.audit_trigger_fn() is
  'Generic AFTER INSERT/UPDATE/DELETE audit trigger, SECURITY DEFINER, search_path pinned to public, EXECUTE restricted to service_role/postgres (no anon/authenticated RPC exposure). As of 0048: redacts private substantive payload fields per table before insertion into audit_log (judgments/bench_notes: content+content_text; quick_codes: content+description; case_law_annotations: annotation_text; docket_matter_parties: contact_info only; case_law: summary+full_text ONLY when owner_id is not null, i.e. personal rows -- canonical rows remain unredacted). All other tables/columns are captured exactly as in the original 0009 version -- this is a pure additive redaction, not a redesign.';

-- ==================== New audit coverage: institutional / access-control (unredacted) ====================

create trigger audit_docket_matters
  after insert or update or delete on public.docket_matters
  for each row execute function public.audit_trigger_fn();

create trigger audit_docket_events
  after insert or update or delete on public.docket_events
  for each row execute function public.audit_trigger_fn();

create trigger audit_docket_matter_parties
  after insert or update or delete on public.docket_matter_parties
  for each row execute function public.audit_trigger_fn();

create trigger audit_docket_matter_assignments
  after insert or update or delete on public.docket_matter_assignments
  for each row execute function public.audit_trigger_fn();

create trigger audit_magistrate_courts
  after insert or update or delete on public.magistrate_courts
  for each row execute function public.audit_trigger_fn();

create trigger audit_shares
  after insert or update or delete on public.shares
  for each row execute function public.audit_trigger_fn();

-- ==================== New audit coverage: private work product (redacted via audit_trigger_fn above) ====================

create trigger audit_judgments
  after insert or update or delete on public.judgments
  for each row execute function public.audit_trigger_fn();

create trigger audit_quick_codes
  after insert or update or delete on public.quick_codes
  for each row execute function public.audit_trigger_fn();

create trigger audit_case_law_annotations
  after insert or update or delete on public.case_law_annotations
  for each row execute function public.audit_trigger_fn();

-- ==================== audit_log immutability hardening ====================
-- RLS already permits no INSERT/UPDATE/DELETE for any role (0009) --
-- this closes the underlying default table-level GRANT as
-- defense-in-depth, the same pattern 0043 already established for
-- function EXECUTE grants. SELECT is deliberately left untouched (RLS
-- via is_admin() is the correct, sufficient enforcement layer there).

revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;

-- ==================== Explicitly NOT touched / NOT added in 0048 ====================
-- bookmarks, quick_code_docket_matters, quick_code_judgments,
--   quick_code_case_law, docket_matter_judgments, docket_matter_case_law,
--   docket_matter_tags, judgment_tags, case_law_tags, bench_note_tags,
--   statute_tags, case_tags, tags -- association/organizational
--   metadata, no substantive content, no audit added.
-- comments, case_parties -- legacy tables discovered live outside the
--   original five; comments has the same free-text-privacy shape as
--   bench_notes, case_parties carries PII -- both flagged as follow-up
--   candidates, deliberately not expanded into this migration.
-- profiles -- role-change auditing (who became admin, when) has real
--   security value but was not part of the authorized scope for this
--   migration; flagged as a follow-up candidate, not silently dropped.
-- courts, magisterial_districts -- low-frequency reference data, no
--   security/privacy value, not audited.
-- audit_log SELECT policy -- unchanged, still admin-only.
-- cases, statutes, documents -- unmodified triggers, unmodified
--   (unredacted) capture behavior, per "no unrelated cleanup" and
--   because none of their columns are private substantive work product.
