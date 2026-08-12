-- ============================================================================
-- 0065_case_law_citation_unique_idx_exclude_blank.sql
--
-- BenchBook Legal Library stabilization pass, Section 30/34/50-C.
--
-- REAL DEFECT FOUND during this session's synthetic 13-item bulk lifecycle
-- test (not the user-reported batch-accounting bug -- a separate, latent
-- one uncovered while building a "low confidence metadata" fixture item).
--
-- `case_law_citation_canonical_unique_idx` (migration 0035) is:
--   CREATE UNIQUE INDEX ... ON case_law (citation) WHERE (owner_id IS NULL)
-- i.e. a canonical (owner_id IS NULL) row's citation must be globally
-- unique -- but citation is NOT NULL text, and BOTH the single-import and
-- bulk-import pipelines legitimately create a canonical DRAFT with
-- citation = '' when nothing usable could be extracted yet (a blank
-- citation is an expected, common, and correct early-review-queue state --
-- publish-time validation, not draft-creation, is where "Citation is
-- missing" is meant to be enforced; see 0061). Because the index does not
-- exclude the empty string, only ONE canonical draft in the ENTIRE
-- database may ever hold citation = '' at a time -- confirmed live: a
-- pre-existing legacy draft ("Untitled (pending review)", created
-- 2026-08-12 18:33, citation = '') caused a second, unrelated synthetic
-- test draft with citation = '' to fail with a raw
-- case_law_citation_canonical_unique_idx violation, surfaced to the user
-- as a generic "That already exists." (or, after this session's utils.ts
-- fix, the still-misleading "A canonical case with this citation already
-- exists.") -- neither message is true or actionable: the two drafts are
-- not duplicates of each other in any legal sense, they simply both have
-- no citation yet. checkCanonicalCitationConflict (use-import-jobs.ts)
-- deliberately skips this check for a blank citation (`if (!trimmed)
-- return null`) precisely because a blank citation is NOT a meaningful
-- conflict signal -- so nothing upstream currently prevents this collision
-- before it hits the raw constraint.
--
-- FIX: narrow the partial index's WHERE clause to also exclude blank
-- citations, matching what the application logic already treats as "not a
-- real value to compare." This is a pure relaxation (fewer rows
-- participate in uniqueness, never more), so it cannot make any
-- previously-valid state invalid, and it does not touch, weaken, or
-- replace the separate publish-time "Citation is missing" gate (0061),
-- which still independently blocks any blank-citation record from ever
-- being published regardless of this change.
--
-- Additive/corrective only. Drops and recreates ONE index; no table,
-- column, RLS, or function changes. Does not edit migration 0035 (already
-- applied) -- this is the next sequential migration.
-- ============================================================================

drop index if exists public.case_law_citation_canonical_unique_idx;

create unique index case_law_citation_canonical_unique_idx
  on public.case_law (citation)
  where (owner_id is null and citation <> '');

comment on index public.case_law_citation_canonical_unique_idx is
  'Canonical (owner_id IS NULL) case law rows must have a unique citation -- but a blank citation (common for an early-stage draft before a citation has been extracted or entered) is deliberately excluded from this uniqueness check (0065), since many such drafts may legitimately coexist with citation = '''' at once. Publish-time validation (0061) independently requires a non-blank citation before a record can ever be published.';
