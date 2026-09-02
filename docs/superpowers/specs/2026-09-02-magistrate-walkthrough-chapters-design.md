# Magistrate walkthrough chapters

Seated magistrates and admins get a **sitting-day** chapter, then a **Continue / Done** choice, then an optional **rest-of-app** chapter. Clerks stay on the two-step tour. Pending magistrates still have no tour.

## Sitting day

1. Home
2. Docket and New matter
3. Procedure board
4. Next date
5. Open a file (only if a docket row exists)
6. Hearing progress on Overview (only if a file was opened)
7. The file tabs (only if a file was opened)
8. Choice card: Continue or Done (no spotlight)

Empty Docket skips 5–7 and goes to the choice.

## Rest of app (Continue only)

1. Calendar
2. Case Law
3. Legislation
4. Bench Notes
5. Search (admins: this card also mentions Administration under More)

Auto-start still only runs for a magistrate who waited without a court, then was seated. It stops at the choice. Skip anywhere marks the tour complete. Replay from Account or Settings starts sitting-day again.

## Engine

- Steps carry `chapter: "sitting" | "rest"`, optional `requiresMatter`, optional `kind: "choice"`.
- `visibleWalkthroughSteps(all, chapter, hasMatter)` drops rest while sitting, drops sitting while in rest, and drops `requiresMatter` steps when `hasMatter` is false.
- First matter href comes from `a[data-tour="docket-first-matter"]` on the list (sheet, cards, or tiles). Matter-bound steps navigate to that path.
- Choice overlay: dimmed, no ring, Continue and Done. Back from the first rest step returns to the choice.

No em dashes in tour copy.
