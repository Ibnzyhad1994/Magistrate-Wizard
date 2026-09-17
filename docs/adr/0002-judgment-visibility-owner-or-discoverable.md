# 0002 — Judgment visibility is owner-or-discoverable

**Status:** Accepted (lifecycle locking added in `0045`)

## Context

A judgment is authored by one magistrate and may later be shared with the
court or the platform by marking it discoverable. Separately, a judgment
moves through a lifecycle (draft → delivered → published) that decides
which fields may still change. Conflating the two — "published means
visible", "locked means hidden" — produced confusing rules and would let a
lifecycle change silently widen or narrow who can read a judgment.

## Decision

A judgment is visible to its owner, or to anyone else only when
`is_discoverable` is true. Lifecycle locking (migration `0045`) governs
**field mutability only**, never visibility. Neither rule reads the other.

## Consequences

- A locked (delivered/published) judgment that is not discoverable stays
  private to its owner.
- Making a judgment discoverable does not unlock any field, and locking
  does not hide it.
- Searches, dashboards and shares must apply the visibility rule
  themselves rather than assume lifecycle status implies it.
