/**
 * Curated legal-topic taxonomy for Magistrates' Court / Commonwealth
 * Caribbean practice (Part G).
 *
 * IMPORTANT — this reuses, and does not duplicate, TWO existing and
 * DELIBERATELY SEPARATE tagging architectures discovered on inspection
 * (per the "inspect before building" operating instruction):
 *
 *   1. A global, admin-curated `tags` table (0006) joined via
 *      `case_tags`/`bench_note_tags`/`statute_tags`/`case_law_tags`.
 *      INSERT/DELETE on `case_law_tags` is admin-only by RLS; the
 *      frontend (`use-case-law-tags.ts`) is correctly read-only and is
 *      NOT touched by this file or by `TagInput` — that system already
 *      IS a real, backend-enforced canonical taxonomy and needs no
 *      frontend suggestion layer.
 *   2. `docket_matter_tags` (0026) and `judgment_tags` (0028) — each
 *      migration explicitly states it is "deliberately NOT connected to
 *      the existing global `tags` table," a plain free-text `tag_name`
 *      column instead, owner-scoped, no admin bypass.
 *
 * This file/`TagInput` (src/components/common/tag-input.tsx) is a
 * frontend-only SUGGESTION layer over case #2 only (Docket Matter and
 * Judgment tags) — it never writes to `tags`/`case_law_tags`, and never
 * changes docket_matter_tags/judgment_tags' deliberate free-text-only
 * design. "Tags should become a meaningful legal classification
 * system... design so tags/categories can be added later without
 * migrations if possible" is satisfied by keeping this a versioned
 * constant: extending or correcting the taxonomy is a code change, not a
 * migration, and no existing tag (however it was entered) is ever
 * invalidated, hidden, or silently rewritten by adding to this list.
 * Canonical terms are encouraged via autocomplete, never mandatory.
 *
 * A future AI/ingestion classification pipeline (Part H, currently
 * architecture-only — no AI provider is connected in this project)
 * should propose tags FROM this same list (for docket_matter_tags/
 * judgment_tags) or from the real `tags` table (for case_law_tags, via
 * an admin-authorized write path, not a frontend bypass of its
 * admin-only INSERT policy) rather than inventing near-duplicate
 * synonyms in either system.
 */

export interface TaxonomyDomain {
  domain: string;
  topics: readonly string[];
}

export const LEGAL_TAXONOMY: readonly TaxonomyDomain[] = [
  {
    domain: "Evidence",
    topics: [
      "Hearsay",
      "Admissions",
      "Confessions",
      "Oral Admissions",
      "Identification",
      "Visual Identification",
      "Documentary Evidence",
      "Expert Evidence",
      "Similar Fact Evidence",
      "Character Evidence",
      "Burden and Standard of Proof",
      "Corroboration",
      "Competence and Compellability",
      "Electronic and Digital Evidence",
    ],
  },
  {
    domain: "Criminal Procedure",
    topics: [
      "Bail",
      "No-Case Submission",
      "Voir Dire",
      "Preliminary Inquiry",
      "Committal",
      "Disclosure",
      "Abuse of Process",
      "Jurisdiction",
      "Admissibility",
      "Search and Seizure",
      "Confession and Voluntariness",
      "Sentencing",
      "Guilty Plea",
    ],
  },
  {
    domain: "Narcotics",
    topics: [
      "Possession",
      "Trafficking",
      "Knowledge",
      "Custody and Control",
      "Search",
      "Quantity",
      "Joint Possession",
    ],
  },
  {
    domain: "Road Traffic",
    topics: [
      "Dangerous Driving",
      "Causing Death",
      "Identification of Driver",
      "Careless Driving",
      "Alcohol and Impairment",
      "Licensing",
    ],
  },
  {
    domain: "Sentencing",
    topics: [
      "Mitigation",
      "Aggravating Factors",
      "Guilty Plea",
      "Time Served",
      "Rehabilitation",
      "Deterrence",
      "Proportionality",
    ],
  },
  {
    domain: "Family and Children",
    topics: [
      "Maintenance",
      "Paternity",
      "Domestic Violence",
      "Custody",
      "Juvenile Justice",
      "Best Interests of the Child",
    ],
  },
  {
    domain: "Civil and Summary Jurisdiction",
    topics: [
      "Landlord and Tenant",
      "Debt",
      "Service",
      "Substituted Service",
      "Default Judgment",
      "Enforcement",
    ],
  },
];

/** Flat, de-duplicated list of every canonical topic across all domains. */
export const LEGAL_TAXONOMY_TOPICS: readonly string[] = Array.from(
  new Set(LEGAL_TAXONOMY.flatMap((d) => d.topics)),
);
