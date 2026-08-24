# Legal Library bulk-ingestion checklist

Full harvest → prepare → ingest → automated quality gate → curator review →
publish workflow, with the safeguards added after a real bulk-legislation
audit (18/184 published Acts with zero real text, 74/184 with heavy OCR
noise, 1 with a corrupted title, all 184 missing act-number/year/instrument
metadata). Reusable for any future bulk import, not a one-off task list —
work through it top to bottom every time `catalogs/` changes or a new
source is added.

## 0. Before you start

- [ ] Local Supabase is running (`npm run db:start`) and migrations are
      current (`npm run db:reset` if unsure — reapplies everything +
      both seed files).
- [ ] `npm run test:ingestion` passes clean on `main` before you touch
      anything (establishes your baseline — if it's red before you start,
      that's not your bug to inherit silently). This chain now includes
      `test:ingest-ocr-robustness` and bulk-queue tests. For the gated
      brutal subset plus the rest of the adversarial circuit, run
      `npm run test:ingestion:full`.

## 1. Harvest

- [ ] `npm run seed:harvest-indexes` / `npm run seed:harvest-mola` — writes
      unfiltered JSON to `raw/` (gitignored scratch).
- [ ] Confirm `raw/*.json` items have real `full_text`, not just index
      metadata — a harvest that only scrapes titles/URLs and leaves
      `full_text: ""` for every item needs a real extraction pass before
      it's useful (there is currently no committed script that does this;
      see "Known gap" below).

## 2. Prepare catalogs

- [ ] `npm run seed:prepare-catalogs` — applies `seed-heuristics.mjs`'s
      eligibility rules, writes only eligible items to `catalogs/`.
- [ ] Check `catalogs/<name>.rejected.json` (gitignored) — spot-read a
      few rejection reasons to confirm the filter isn't silently dropping
      good items for the wrong reason.
- [ ] `npm run test:seed-heuristics` passes.

## 3. Ingest — the automated quality gate runs here, not after

- [ ] `npm run seed:ingest` — runs through the SAME real quality pipeline
      as the browser's "New Import" flow (`assessExtractionQuality()`,
      `extractLegislationMetadataWithConfidence()`), not a fabricated
      envelope. Read the summary object it prints:
      `{ legislation, case_law, skipped, errors, quality_failed, title_recovered }`.
  - [ ] `errors` should be 0 — anything else is a real RPC/DB failure,
        investigate before moving on.
  - [ ] `quality_failed` is expected to be non-zero for a real historical
        corpus — those items were still created as drafts
        (`content_quality_status='failed'`, `review_status='needs_review'`),
        never silently skipped and never auto-published. They need a
        curator, not a re-run.
  - [ ] `title_recovered` should be small relative to total volume — a
        large fraction (we once saw 125/184 from a bug: comparing a
        title against a code value that had already silently fallen back
        to the title itself) means the suspect-title heuristic is
        over-firing. Investigate before trusting the run.

## 4. Verify the gate actually worked — don't just trust the summary line

This is the step that was skipped the first time and let 18 content-empty
Acts reach `published`. Do not skip it.

- [ ] Spot-query the DB directly for the worst cases:
      ```sql
      select code, title, content_quality_status, length(full_text)
      from statutes where content_quality_status = 'failed' order by code;
      ```
      Read a couple of `full_text` values for `failed` rows — confirm
      they're genuinely empty/boilerplate-only, not a false positive.
- [ ] Also spot-query the OPPOSITE direction — a few `good`/`fair` rows
      with unusually large `full_text` — confirm nothing genuinely bad
      slipped through as "good" (character-count alone is not a quality
      signal; a document can be long AND empty of real content if it's
      mostly a repeated page header).
- [ ] Live-verify the publish gate with a real RPC call, not just by
      reading the migration file:
      ```bash
      curl -X POST "$SUPABASE_URL/rest/v1/rpc/publish_legislation_import" \
        -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ADMIN_TOKEN" \
        -d '{"p_statute_id":"<a content_quality_status=failed id>"}'
      # must return an error, not 200
      ```

## 5. Curator review (Review Queue)

- [ ] Open **More → Legal Library → Review Queue**.
- [ ] Use the **"Lowest quality first"** sort toggle on a large batch —
      don't rely on paging through 184 items in creation order to find
      the ones that need attention.
- [ ] For each `failed` item: "Re-check extraction quality" (Legislation)
      or "Re-run extraction" (Case Law, if an original file is attached)
      re-assesses whatever text is currently on record — it never
      re-fetches from the source URL. If the harvested text is genuinely
      unusable, paste the corrected text into the full-text field first,
      then re-check.
- [ ] Check the **Batch Detail** quality badge row ("Good N · Fair N ·
      Poor N · Failed N") for the batch this run created — that's the
      184-row audit at a glance; don't re-derive it by hand.
- [ ] `poor`/`fair` items are NOT blocked from publish automatically —
      that's a deliberate design choice (an automated block on every
      borderline case would be too strict for genuinely short/unusual
      legislative text). A human still has to look at them before
      Publish.

## 6. Publish

- [ ] Publish only after `failed` count for the batch is at zero, or you
      have deliberately decided to leave specific items in Review Queue
      for later remediation (that's fine — nothing forces a batch to be
      "complete" before its good items go live).
- [ ] `publish_legislation_import`/`publish_case_law_import` will reject
      any remaining `content_quality_status='failed'` row even if you
      try — that's the safety net, not the primary workflow. Don't rely
      on hitting it in normal use.

## 7. After publish

- [ ] `npm run typecheck && npm run lint && npm run test:ingestion`.
- [ ] If you touched `src/lib/extraction-quality.ts` or
      `src/lib/legal-extraction.ts` for this batch, re-run
      `npm run test:extraction-pipeline`-adjacent suites too (they're
      already in `test:ingestion`) — a change tuned for one document
      shape can silently regress another; the existing PDF-fixture tests
      exist specifically to catch that.

## Known gap (not fixed by this pass)

The two committed harvest scripts (`harvest-official-indexes.mjs`,
`harvest-mola-ajax.mjs`) both explicitly leave `full_text: ""` — they only
scrape index/catalog metadata, never fetch or parse a PDF. The `full_text`
that IS present in the committed `catalogs/*.json` files was populated by
some other, uncommitted, one-off process outside this repository. If you
need to harvest a genuinely NEW source from scratch, there is currently no
script here that will fetch and extract the PDF body for you — you'll need
to either extend the harvest scripts to do real PDF extraction (reusing
`src/lib/extraction-pipeline.ts`'s `runPdfExtractionPipeline`, which is
already callable from a plain Node script via the `@/` alias loader — see
`scripts/tests/test-extraction-pipeline.mjs` for the pattern) or populate
`full_text` by some other means before running `prepare-catalogs`/`ingest`.
