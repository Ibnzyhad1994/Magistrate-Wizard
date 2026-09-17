# Architecture decision records

Short records of the decisions that must not be reopened casually. They are
seeded from the "Security / privacy invariants" section of
`DEVELOPMENT_WORKFLOW.md`, which remains the normative text; each ADR adds
the context and consequences so a future change can be judged against the
reason, not only the rule.

Format: **Status · Context · Decision · Consequences**. Statuses are
_Accepted_ or _Superseded by NNNN_. A decision is changed by adding a new
ADR that supersedes it, after the design review the invariant calls for —
never by editing the old one.

| #                                                         | Decision                                                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [0001](0001-quick-codes-owner-only.md)                    | Quick Codes are owner-only, with no Court/Docket/admin bypass                                      |
| [0002](0002-judgment-visibility-owner-or-discoverable.md) | Judgment visibility is owner-or-discoverable; lifecycle locking governs mutability, not visibility |
| [0003](0003-case-law-canonical-vs-personal.md)            | Case Law keeps the canonical vs personal distinction, and personal rows are private                |
| [0004](0004-bench-notes-author-only.md)                   | Bench Notes are author-only                                                                        |
| [0005](0005-docket-matter-three-path-access.md)           | Docket Matter access is the three-path predicate                                                   |
| [0006](0006-share-view-vs-edit.md)                        | Share `view` vs `edit` is preserved wherever it gates behaviour                                    |
| [0007](0007-no-admin-bypass.md)                           | Established "no admin bypass" decisions are not reopened for convenience                           |
| [0008](0008-asymmetric-association-tables.md)             | Deliberately asymmetric association tables are not normalised without design review                |

Adding one: copy the shortest existing file, take the next number, add a
row here, and link it from the migration or PR that relies on it.
