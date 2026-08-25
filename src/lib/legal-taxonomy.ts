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

/**
 * Optional synonym / phrase variants that should propose the canonical
 * topic. Keys must be members of `LEGAL_TAXONOMY_TOPICS`. Matching is
 * case-insensitive and word-boundary based (see proposeTags).
 */
export const LEGAL_TAXONOMY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  Hearsay: ["hearsay evidence", "hearsay rule", "hearsay objection"],
  Admissions: ["admission of guilt", "voluntary admission"],
  Confessions: [
    "confession evidence",
    "confessional statement",
    "judges' rules",
    "judges rules",
  ],
  "Oral Admissions": ["oral admission"],
  Identification: [
    "identification evidence",
    "dock identification",
    "dock id",
    "turnbull",
    "turnbull guidelines",
  ],
  "Visual Identification": ["visual id", "eye-witness identification", "eyewitness identification"],
  "Documentary Evidence": ["documents in evidence"],
  "Expert Evidence": ["expert testimony", "expert witness"],
  "Similar Fact Evidence": ["similar fact", "similar-fact evidence"],
  "Character Evidence": ["bad character", "good character evidence"],
  "Burden and Standard of Proof": ["burden of proof", "standard of proof", "beyond reasonable doubt"],
  Corroboration: ["corroborative evidence"],
  "Competence and Compellability": ["competence and compellability", "compellability"],
  "Electronic and Digital Evidence": ["digital evidence", "electronic evidence", "computer evidence"],
  Bail: [
    "bail application",
    "bail conditions",
    "refusal of bail",
    "recognizance",
    "surety",
    "cash bail",
    "own recognizance",
  ],
  "No-Case Submission": [
    "no case to answer",
    "no-case submission",
    "prima facie case",
    "no case submission",
    "submission of no case",
  ],
  "Voir Dire": ["voir dire", "trial within a trial", "voluntariness voir dire"],
  "Preliminary Inquiry": ["preliminary enquiry", "committal proceedings"],
  Committal: ["committed for trial"],
  Disclosure: ["disclosure obligations", "unused material"],
  "Abuse of Process": ["abuse of process"],
  Jurisdiction: ["want of jurisdiction", "territorial jurisdiction"],
  Admissibility: ["admissible evidence", "inadmissible"],
  "Search and Seizure": ["search and seizure", "unlawful search", "warrantless search"],
  "Confession and Voluntariness": ["voluntariness", "involuntary confession"],
  Sentencing: ["sentence imposed", "sentencing guidelines"],
  "Guilty Plea": ["plea of guilty", "pleaded guilty", "guilty plea"],
  Possession: ["in possession", "simple possession", "possession of cannabis", "cannabis sativa"],
  Trafficking: [
    "drug trafficking",
    "trafficking in narcotics",
    "dangerous drugs",
    "trafficking in dangerous drugs",
  ],
  Knowledge: ["mens rea of knowledge", "wilful blindness"],
  "Custody and Control": ["custody or control", "custody and control"],
  Search: ["personal search", "search of premises"],
  Quantity: ["street value", "quantity of drugs"],
  "Joint Possession": ["joint possession"],
  "Dangerous Driving": ["dangerous driving"],
  "Causing Death": ["causing death by dangerous driving"],
  "Identification of Driver": ["identity of the driver"],
  "Careless Driving": ["driving without due care", "careless driving"],
  "Alcohol and Impairment": ["excess alcohol", "drink driving", "impaired driving"],
  Licensing: ["driving licence", "driving license", "unlicensed driver"],
  Mitigation: ["mitigating factors", "in mitigation"],
  "Aggravating Factors": ["aggravating feature", "aggravating factors"],
  "Time Served": ["time spent on remand", "credit for time served"],
  Rehabilitation: ["prospects of rehabilitation"],
  Deterrence: ["deterrent sentence"],
  Proportionality: ["proportionate sentence"],
  Maintenance: [
    "child maintenance",
    "maintenance order",
    "arrears of maintenance",
    "affiliation order",
    "affiliation",
  ],
  Paternity: ["declaration of paternity"],
  "Domestic Violence": [
    "protection order",
    "domestic violence",
    "occupation order",
    "dva application",
  ],
  Custody: ["custody of the child", "care and control"],
  "Juvenile Justice": ["juvenile offender", "young offender"],
  "Best Interests of the Child": ["best interests of the child", "welfare of the child"],
  "Landlord and Tenant": ["landlord and tenant", "recovery of possession"],
  Debt: ["judgment debt", "debt claim"],
  Service: ["service of process", "service of the summons"],
  "Substituted Service": ["substituted service"],
  "Default Judgment": ["judgment in default", "default judgment"],
  Enforcement: ["warrant of execution", "enforcement of judgment"],
};

export interface TaxonomyPhraseEntry {
  /** Canonical topic name (what goes into proposed_tags). */
  topic: string;
  /** Lowercased phrase that was compiled into `pattern`. */
  phrase: string;
  /** True when `phrase` is an alias rather than the topic itself. */
  isAlias: boolean;
  /** Word/phrase-boundary regex, case-insensitive, global. */
  pattern: RegExp;
  /** Token count of the phrase (spaces + 1). */
  tokenCount: number;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Build a word/phrase-boundary regex for a taxonomy phrase.
 * Uses non-letter edges so hyphenated legal terms still match.
 */
export const compileTaxonomyPhrasePattern = (phrase: string): RegExp => {
  const escaped = escapeRegExp(phrase.trim().toLowerCase()).replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|[^a-z0-9])(${escaped})(?=[^a-z0-9]|$)`, "gi");
};

const tokenCountOf = (phrase: string): number =>
  phrase
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

/**
 * Precompiled matcher index: every canonical topic plus its aliases.
 * Built once at module load for proposeTags (negligible vs OCR).
 */
export const LEGAL_TAXONOMY_PHRASE_INDEX: readonly TaxonomyPhraseEntry[] = (() => {
  const entries: TaxonomyPhraseEntry[] = [];
  const seen = new Set<string>();

  const push = (topic: string, phrase: string, isAlias: boolean) => {
    const normalized = phrase.trim().toLowerCase();
    if (!normalized) return;
    const key = `${topic.toLowerCase()}::${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({
      topic,
      phrase: normalized,
      isAlias,
      pattern: compileTaxonomyPhrasePattern(normalized),
      tokenCount: tokenCountOf(normalized),
    });
  };

  for (const topic of LEGAL_TAXONOMY_TOPICS) {
    push(topic, topic, false);
    const aliases = LEGAL_TAXONOMY_ALIASES[topic];
    if (!aliases) continue;
    for (const alias of aliases) {
      push(topic, alias, true);
    }
  }

  // Longer phrases first helps specificity demotion callers that iterate in order.
  entries.sort((a, b) => b.phrase.length - a.phrase.length || a.topic.localeCompare(b.topic));
  return entries;
})();

/**
 * Ambiguous single-token topics that need ≥2 bounded hits or a longer
 * alias/phrase match before they clear the proposal floor (avoids
 * `Search`⊂`research`, stray `service`/`debt`/`knowledge`, etc.).
 */
export const AMBIGUOUS_SHORT_TAXONOMY_TOPICS: ReadonlySet<string> = new Set([
  "Search",
  "Bail",
  "Debt",
  "Service",
  "Knowledge",
  "Quantity",
  "Possession",
  "Custody",
  "Maintenance",
]);

/** Bare single-token hits required for an ambiguous topic when no multi-word/alias phrase matched. */
export const AMBIGUOUS_BARE_HIT_FLOOR = 3;

/** @deprecated Prefer AMBIGUOUS_SHORT_TAXONOMY_TOPICS — kept as alias for callers. */
export const SHORT_TAXONOMY_TOPICS = AMBIGUOUS_SHORT_TAXONOMY_TOPICS;

/**
 * Best-effort map from a proposed tag TOPIC (this file's vocabulary, used
 * for judgment_tags/docket_matter_tags suggestions) to the closest
 * `legal_case_categories` NAME (the separate, admin-curated Case Law/
 * Legislation/Judgment classification catalogue, 0073/0075). Deliberately
 * partial — only topics with a confident, unambiguous correspondence are
 * listed; a topic absent here (e.g. "Landlord and Tenant", which could
 * reasonably be either a Contract or Tort dispute) is left for the
 * magistrate to classify by hand rather than guessed. Never authoritative
 * on its own — see `suggestCategoryFromTopics` below, which only ever
 * proposes a category for confirmation, exactly like tag proposals
 * themselves are never silently applied.
 */
export const TOPIC_TO_CASE_CATEGORY: Readonly<Record<string, string>> = {
  Bail: "Bail & Remand",
  Sentencing: "Sentencing",
  Mitigation: "Sentencing",
  "Aggravating Factors": "Sentencing",
  "Guilty Plea": "Sentencing",
  "Time Served": "Sentencing",
  Rehabilitation: "Sentencing",
  Deterrence: "Sentencing",
  Proportionality: "Sentencing",
  Possession: "Narcotics",
  Trafficking: "Narcotics",
  "Joint Possession": "Narcotics",
  "Dangerous Driving": "Traffic / Road Traffic Offences",
  "Causing Death": "Traffic / Road Traffic Offences",
  "Careless Driving": "Traffic / Road Traffic Offences",
  "Alcohol and Impairment": "Traffic / Road Traffic Offences",
  Licensing: "Traffic / Road Traffic Offences",
  "Domestic Violence": "Domestic Violence",
  Maintenance: "Family Law",
  Paternity: "Family Law",
  Custody: "Family Law",
  "Juvenile Justice": "Family Law",
  "Best Interests of the Child": "Family Law",
  Hearsay: "Evidence & Procedure",
  Admissions: "Evidence & Procedure",
  Confessions: "Evidence & Procedure",
  "Oral Admissions": "Evidence & Procedure",
  Identification: "Evidence & Procedure",
  "Visual Identification": "Evidence & Procedure",
  "Documentary Evidence": "Evidence & Procedure",
  "Expert Evidence": "Evidence & Procedure",
  "Similar Fact Evidence": "Evidence & Procedure",
  "Character Evidence": "Evidence & Procedure",
  "Burden and Standard of Proof": "Evidence & Procedure",
  Corroboration: "Evidence & Procedure",
  "Competence and Compellability": "Evidence & Procedure",
  "Electronic and Digital Evidence": "Evidence & Procedure",
  "No-Case Submission": "Evidence & Procedure",
  "Voir Dire": "Evidence & Procedure",
  "Preliminary Inquiry": "Evidence & Procedure",
  Committal: "Evidence & Procedure",
  Disclosure: "Evidence & Procedure",
  "Abuse of Process": "Evidence & Procedure",
  Admissibility: "Evidence & Procedure",
  "Search and Seizure": "Evidence & Procedure",
  "Confession and Voluntariness": "Evidence & Procedure",
};

/**
 * Picks the best `legal_case_categories` NAME to suggest from a set of
 * scored tag proposals (highest score first, per `proposeTagsScored`'s own
 * sort) — the first proposal with a confident mapping wins; `null` when
 * nothing maps or the caller passed nothing. A suggestion only, same as
 * the tags themselves — callers must never overwrite an already-set
 * category with this.
 */
export function suggestCategoryFromTopics(
  proposals: ReadonlyArray<{ name: string }>,
): string | null {
  for (const p of proposals) {
    const category = TOPIC_TO_CASE_CATEGORY[p.name];
    if (category) return category;
  }
  return null;
}
