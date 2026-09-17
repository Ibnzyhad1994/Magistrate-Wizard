# 0005 — Docket Matter access is the three-path predicate

**Status:** Accepted (court-anchored docket, architecture addendum 3)

## Context

Matters belong to a court, not to a person, and magistrates move between
courts. A magistrate who moved must still be able to finish what they
started; a colleague may need to see a matter for a callover; but nobody
should read a docket merely because they once sat somewhere.

## Decision

A user can access a docket matter if and only if at least one of these is
true:

1. they currently sit the matter's court (an active `magistrate_courts`
   assignment, or the equivalent clerk attachment for clerks);
2. they hold a retained assignment on that specific matter
   (`docket_matter_assignments`), which survives leaving the court;
3. there is an active Docket share granting them the matter.

Every policy, RPC and board query that returns matters (and their parties,
events, tags, judgment links and case-law links) is built from this single
predicate.

## Consequences

- Ending a sitting removes path 1 immediately; retained assignments and
  shares are the only ways back in, and both are explicit.
- Admin views of the docket are scoped the same way unless a separate,
  reviewed admin-scoping decision applies (see `test-admin-magistrate-docket-access`).
- Child tables never carry their own broader rule; they defer to the
  matter's.
