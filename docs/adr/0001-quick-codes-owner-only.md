# 0001 — Quick Codes are owner-only

**Status:** Accepted (baseline `0047_search_extensions`)

## Context

Quick Codes are a magistrate's private shorthand: personal references to
matters, judgments and case law, written for their own recall. They were
never designed as court records. An admin, a court colleague or a docket
share gives no legitimate reason to read another magistrate's shorthand,
and any helper that could would make the feature untrustworthy.

## Decision

Every Quick Code row, and every association row hanging off it
(`quick_code_docket_matters`, `quick_code_judgments`,
`quick_code_case_law`), is readable and writable by its owner only. There
is no Court path, no Docket-share path and no admin bypass in the RLS
policies or in any RPC that touches them.

## Consequences

- Admin tooling (audit, support) works from the audit log, not from the
  rows themselves.
- A "list everything for court X" or "admin sees all" helper must exclude
  Quick Codes even if it would be simpler to include them (see ADR 0007).
- Transferring codes between accounts is a deliberate export/import, not a
  policy change.
