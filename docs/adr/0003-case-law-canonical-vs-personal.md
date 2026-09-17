# 0003 — Case Law: canonical vs personal records

**Status:** Accepted

## Context

The Case Law library has two kinds of row in one table: canonical records
curated by administrators for every court, and personal records a
magistrate adds for their own reference (annotations, unreported decisions,
working notes). Treating them as one pool would either expose personal
research to everyone or force administrators to moderate private notes.

## Decision

`owner_id IS NULL` marks a canonical record; a set `owner_id` marks a
personal one. Canonical rows are readable by every authorised user and
writable only by admins. Personal rows are private to their owner. The
distinction is preserved in every policy, RPC, search and export that
touches `case_law` or `case_law_annotations`.

## Consequences

- Promoting a personal record to canonical is an explicit admin action
  that creates or rewrites a canonical row, not a flip of ownership that
  leaks history.
- Search results and "recently added" views must partition by this rule.
- Bulk ingestion (`import_batches` / `import_jobs`) only ever produces
  canonical rows.
