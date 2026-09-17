# 0008 — Deliberately asymmetric association tables

**Status:** Accepted

## Context

Some many-to-many links look like mirror images and invite "normalising"
into one generic table: `docket_matter_case_law` (a matter cites case law;
governed by matter access, ADR 0005) versus `quick_code_docket_matters` (a
private code points at matters; governed by code ownership, ADR 0001) are
the standing example. They differ in which side owns the row, which
policies apply, what cascades on delete, and who may see the link at all.

## Decision

Association tables that were built asymmetric stay asymmetric. They are not
merged, generalised or given a shared policy without an explicit design
review that re-derives the access rule for each direction.

## Consequences

- A new link table states in its migration which side owns the row and
  which ADR governs its visibility.
- Generic "links" or "relations" abstractions in the frontend must not
  assume both directions are readable by the same people.
- Refactors that reduce table count are welcome elsewhere; here the
  duplication is the security boundary.
