# Official Legal Library seeding

Local harvest → heuristic filter → Review Queue **drafts**. Nothing here auto-publishes.

There is no in-app crawler. These scripts catalog official public indexes, keep only items that look like real Guyana legislation or official judgments, then create drafts a curator still has to vet.

**Running a bulk import? Use [`INGESTION_CHECKLIST.md`](./INGESTION_CHECKLIST.md)** — the full harvest → prepare → ingest → automated quality gate → curator review → publish workflow as a literal checklist, including how to verify the quality gate actually worked (not just trust the summary line). Added after a real bulk-legislation run published 18 content-empty Acts and 74 heavily OCR-garbled ones because the ingest path was fabricating a fixed "perfect quality" result instead of running the real quality pipeline — that gap is closed, but the checklist is what keeps the next import honest.

## Layout

| Path | What belongs there |
|---|---|
| `harvest-*.mjs` | Fetch official indexes. Write **unfiltered** JSON to `raw/`. |
| `raw/` | Scratch harvest output. **Gitignored.** Re-run harvest to regenerate. |
| `prepare-catalogs.mjs` | Apply [seed heuristics](#seed-heuristics). Writes eligible items to `catalogs/`. |
| `catalogs/` | Numbered JSON that is allowed to become drafts (`01-…json`, `02-…`). Commit these when they are curated. |
| `ingest-harvest.mjs` | Creates Review Queue drafts from `catalogs/` via the same RPCs as New Import — runs the REAL `assessExtractionQuality()`/`extractLegislationMetadataWithConfidence()` pipeline (via the `@/` alias loader, same as `scripts/tests/`), not a fabricated envelope. |
| `ingest-quality.mjs` | Pure, DB-free quality/title-decision helpers factored out of `ingest-harvest.mjs` so they're directly unit-testable (`scripts/tests/test-ingest-harvest-quality.mjs`). |
| `text-cleanup.mjs` | HTML-entity decoding + OCR token-swap cleanup for titles/codes before insert. |
| `seed-heuristics.mjs` | The rules below, shared by prepare + ingest. |

Scratch HTML, PDFs, `_tmp_mola/`, GBA volume dumps, and `_inspect` JSON stay on disk for debugging and are not committed.

## Prerequisites

1. Local Supabase and the app running (`npm run db:start`, `npm run dev`).
2. Admin login: `admin@magistrate-wizard.local` / `password123`  
   Override with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` if needed.

## How to run

```bash
# 1. Catalog official indexes (writes scripts/seed-legal-library/raw/)
npm run seed:harvest-indexes     # MoLA HTML pager + Parliament Acts
npm run seed:harvest-mola        # MoLA AJAX catalog (preferred for Laws of Guyana)

# 2. Keep only items that pass seed heuristics (writes catalogs/)
npm run seed:prepare-catalogs

# 3. Create Review Queue drafts (never published)
npm run seed:ingest
```

Then open **More → Legal Library → Review Queue**. Catalog-only rows (empty `full_text`) still need the official PDF pasted or attached before publish.

`prepare-catalogs` also writes `catalogs/<name>.rejected.json` (gitignored) so you can see why an item was dropped.

## Seed heuristics

An item becomes a draft only if **all** of the following hold. Failures are skipped, not invented.

### Every item

- Has a non-empty `title`.
- Has an official `source_url` (or `pdf_url`) that parses as a URL.
- Host is not a volume dump / association archive (`guyanabarassociation.org`, etc.).
- `full_text`, if present, is not a cookie wall / Access Denied / Cloudflare page.

### Legislation (Guyana only)

- `jurisdiction` is Guyana (or omitted, treated as Guyana).
- Host is `mola.gov.gy` or `parliament.gov.gy`.
- Identity is a **Chapter** (`Cap. 5:03`), an **Act number** (`13 of 2025` / `act_no._5_of_2025.pdf`), **or** an official MoLA/Parliament URL whose title contains “Act”.
- Not a budget / appropriation / estimates Act (annual money bills, not library law).
- Empty body text is allowed: that is an index catalog row. The curator attaches the official PDF in Review Queue.

### Case law

- Host is an official court or CCJ site (`ccj.org`, `supremecourt.gy`, `guyanacourts.gy`).
- Has a reported or neutral **citation** (`(1995) 54 WIR 233`, `[2017] CCJ 8`).
- `title` looks like **Party v Party**, not a mid-sentence fragment from a year-volume PDF.

Year-level Bar Association PDFs with titles like “unsel to the defendants…” are **not** seed data. Use Review Queue **Re-run extraction** on a stored original for those files instead.

### After ingest (still not published)

- Duplicate `case_law.citation` or `statutes.code` is skipped.
- Drafts stay `draft` / `needs_review`. Publish remains a human action with the usual placeholder gates.

## Harvest JSON shape

Numbered files only: `NN-short-name.json`.

```json
{
  "harvested_at": "2026-08-15T00:00:00.000Z",
  "source": {
    "name": "Ministry of Legal Affairs — Laws of Guyana",
    "base_url": "https://www.mola.gov.gy/laws-of-guyana",
    "source_type": "legislation",
    "jurisdiction": "Guyana",
    "connector_type": "index_page"
  },
  "items": [
    {
      "kind": "legislation",
      "title": "Evidence Act",
      "code": "Cap. 5:03",
      "jurisdiction": "Guyana",
      "source_url": "https://www.mola.gov.gy/laws/005-03-Evidence-Act.pdf",
      "full_text": ""
    }
  ]
}
```

Case law items use `kind: "case_law"` plus `citation`, `court`, `decided_date`, and `source_url` on an allowed host.

## What not to seed

- Foreign statutes (legislation is Guyana-only).
- Headnote authorities cited inside a WIR report (that is not this document’s identity).
- OCR junk, HTML chrome, or files with no official URL.
- One-off local reruns of a Downloads folder — use the Review Queue **Re-run extraction** button.

Tests: `npm run test:seed-heuristics`.
