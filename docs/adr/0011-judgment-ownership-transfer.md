# 0011 - An administrator may transfer a judgment's ownership, never read it

**Status:** Accepted, pending product sign-off on the transfer semantics (`0220_court_handover`; backend sweep BE-26).
Narrows "ownership never transfers" (`0027_judgments`, architecture specification §6) and the judgments part of ADR 0007; ADR 0002 is otherwise unchanged.

## Context

`0027` made `judgments.owner_id` immutable: "ownership never transfers when a magistrate leaves a Court".
In practice a departing magistrate leaves judgments that nobody else can ever open, the court's successor cannot finish or rely on them, and the author's profile can never be deleted because `owner_id` is `ON DELETE RESTRICT`.
Sharing does not solve it: only the owner can share, and the owner has gone.
The hand-over also left judgment pins (`docket_matter_judgments`) that nobody could see or remove.

## Decision

- `transfer_judgment_ownership(judgment, to, court, reason)` is the only way `owner_id` changes.
  An active administrator calls it with a reason.
  The new owner must be an active magistrate (or administrator) who sits at `court` now, and the current owner must sit or have sat there.
- It changes `owner_id` only.
  Content, status, finalisation, versions, tags, shares, pins and documents stay as they are, and nothing is deleted.
- Authorship is kept: `judgment_ownership_transfers` records each transfer with the original author, and `audit_log` records the event.
  Both magistrates are notified.
- The administrator never sees the judgment: the function returns ids only, and every admin-facing read in `0220` returns ids, statuses and dates, never titles or content.
- `judgments_guard` refuses an `owner_id` change from `anon`, `authenticated` and `service_role`, so a direct write cannot bypass the record.
- A pin of a judgment that only its owner can see is unlinked, with an audit row, when the owner loses the last access path to the matter (court assignment ended, retained assignment ended).
  `relinquish_preflight` lists those pins, and the un-retained part-heard matters, before the assignment ends, so a transfer can happen first.

## Consequences

- A transferred judgment is the new owner's in every rule of ADR 0002: visibility, discoverability, lifecycle and deletion while a draft.
  The previous owner loses access unless the judgment is discoverable or shared with them.
- Transfers are limited to one court's bench, so an administrator cannot move a judgment to a magistrate the author never sat with.
- Bench notes stay author-only (ADR 0004): a transfer moves no notes.
- Open for the owner to redirect: whether the previous owner should keep a view share, and whether a transfer should need the current owner to have left the court first.
- Migrations that change who may call the transfer, or what it returns, need a threat-model note stating that no read path was added.
