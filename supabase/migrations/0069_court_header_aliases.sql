-- ============================================================================
-- 0069_court_header_aliases.sql
--
-- WIR / Eastern Caribbean headers print longer court phrases than the
-- catalogue aliases. "FULL COURT OF THE HIGH COURT OF GUYANA" was losing
-- to the substring "High Court of Guyana". Add the phrases WIR actually
-- prints onto existing rows — no new courts.
-- ============================================================================

update public.legal_authority_courts
set aliases = (
  select array_agg(distinct trim(alias))
  from unnest(
    aliases || array[
      'Full Court of the High Court of Guyana',
      'Full Court of the High Court'
    ]
  ) as alias
  where trim(alias) <> ''
)
where canonical_name = 'Full Court of Guyana';

update public.legal_authority_courts
set aliases = (
  select array_agg(distinct trim(alias))
  from unnest(
    aliases || array[
      'Court of Appeal of the Eastern Caribbean States',
      'Court of Appeal of the Eastern Caribbean'
    ]
  ) as alias
  where trim(alias) <> ''
)
where canonical_name = 'Eastern Caribbean Court of Appeal';
