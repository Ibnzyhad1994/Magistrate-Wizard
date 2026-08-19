# Official Legal Library seeding

How to turn official Guyana public-law indexes into **Review Queue drafts**, and which harvested rows are allowed to become seed data.

The scripts, heuristics, and curated catalogs live in [`scripts/seed-legal-library/`](../scripts/seed-legal-library/README.md). That README is the working copy (commands, JSON shape, host allowlists).

## Why this is separate from New Import

New Import and bulk upload are for a file the curator already has. Harvest seeding is for **cataloging official indexes** (MoLA Laws of Guyana, Parliament Acts, CCJ Guyana appeals) when we do not want to commit megabytes of scratch HTML/PDFs.

Ingest still uses `create_case_law_import` / `create_legislation_import`. Drafts are never auto-published.

## Seed heuristics (summary)

Keep an item only when it is:

1. **Official** — URL on MoLA, Parliament, CCJ, or the Guyana Supreme Court sites — not a Bar Association year-volume PDF.
2. **Identifiable** — legislation has `Cap. N:N`, `N of YYYY`, or an official Act title on MoLA/Parliament; case law has a real citation and a `Party v Party` name.
3. **In scope** — legislation is Guyana-only; budget/estimates Acts are skipped.
4. **Not chrome** — body text is not an access-denied or cookie page.

Empty statute text is allowed (index row). The curator pastes or attaches the official PDF before publish.

Rejected examples: GBA `1968.pdf` rows whose “title” is a sentence fragment; appropriation Acts; Trinidad statutes.

## Commands

```bash
npm run seed:harvest-mola
npm run seed:harvest-indexes
npm run seed:prepare-catalogs
npm run seed:ingest
npm run test:seed-heuristics
```

Admin login for ingest: `admin@magistrate-wizard.local` / `password123`.

After ingest, vet in **Legal Library → Review Queue**. For PDFs already attached to a draft, use **Re-run extraction** rather than a Downloads-folder script.
