-- ============================================================================
-- 0062_narrow_generic_court_alias.sql
--
-- Magistrate Wizard real-PDF Case Law metadata extraction repair pass, §8.
--
-- Audit of legal_authority_courts.aliases (live query) found one alias
-- that is exactly the kind of generic, ambiguous token the instructions
-- warn against: "Court of Appeal of Guyana" carried the bare alias
-- "Court of Appeal" -- a phrase that could appear in almost ANY
-- Commonwealth Caribbean judgment discussing appellate courts generally,
-- not just Guyana's. Combined with a text-matching scorer, a generic
-- alias like this can still win a false-positive match against an
-- unrelated jurisdiction's judgment. The deterministic matcher
-- (src/lib/legal-taxonomy-match.ts) was hardened with header-region +
-- specificity scoring in this same pass, but that scoring alone cannot
-- fully neutralize a token this generic -- removing it at the data layer
-- is the correct fix, per the explicit "if necessary, update aliases in
-- a forward migration" instruction.
--
-- "Guyana Court of Appeal" and "CoA Guyana" remain -- both are already
-- distinctive (name the country) and unaffected.
--
-- Additive/corrective data-only migration, CREATE OR REPLACE-equivalent
-- via UPDATE. Does not edit any previously applied migration.
-- ============================================================================

update public.legal_authority_courts
set aliases = array(
  select alias from unnest(aliases) as alias
  where lower(trim(alias)) <> 'court of appeal'
)
where canonical_name = 'Court of Appeal of Guyana';
