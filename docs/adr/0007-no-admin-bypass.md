# 0007 — Established "no admin bypass" decisions are not reopened

**Status:** Accepted

## Context

Administrators can see and do a great deal (courts, access approvals,
the curated library, the audit log). For three areas the design
deliberately gives them nothing: Judgments that are not discoverable, Case
Law personal rows, and Quick Codes. Each time a cross-cutting helper is
proposed — an "is_admin() OR ..." predicate, a global search, an audit
export that reads the rows, a simpler RLS function — the pressure returns
to add an admin path "just for this".

## Decision

The no-admin-bypass decisions for Judgments (ADR 0002), Case Law personal
rows (ADR 0003) and Quick Codes (ADR 0001) — and the author-only rule for
Bench Notes (ADR 0004) — are not reopened merely because a helper
function, audit mechanism or simplification would be easier with one.
Reopening any of them requires a new superseding ADR agreed in review.

## Consequences

- Shared helpers must be written to exclude these tables, even when that
  makes them longer.
- Support tooling works from metadata and the audit log.
- Migrations that touch these policies get a threat-model note in the PR
  stating explicitly that no admin path was added.
