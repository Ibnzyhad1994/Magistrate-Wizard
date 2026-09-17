# 0006 — Share `view` vs `edit` is preserved

**Status:** Accepted

## Context

Shares (`shares`, polymorphic over docket matters, judgments and other
items) carry a permission of `view` or `edit`. It is tempting, when adding
a new mutation, to check only "is there a share" and forget the level; or
to collapse the two because most shares are `view`.

## Decision

Wherever a share currently gates behaviour, the `view` / `edit`
distinction is kept: `view` never grants a write, and every new write path
that honours shares must check for `edit` explicitly. Reads may be granted
by either level.

## Consequences

- RPCs and policies test `permission = 'edit'` for writes; the UI hides or
  disables edit affordances for `view` shares but the database is the
  enforcement point.
- Tests that cover shares assert both the positive `edit` case and the
  negative `view` case (`test-shares-item-type`).
- Introducing a third level (for example `comment`) is a new ADR, not an
  interpretation of these two.
