# 0004 — Bench Notes are author-only

**Status:** Accepted

## Context

Bench notes are the magistrate's own working notes taken during and around
hearings. They can contain provisional views on credibility, sentencing
ranges and matters not yet decided. Exposure to clerks, court colleagues
or administrators would chill note-taking and could prejudice proceedings.
(An earlier `is_private` flag that opened notes to the author's court has
been withdrawn.)

## Decision

A bench note is readable and writable by its author only. No court path,
no docket share path, no admin path, and no clerk access (`0149` locks
clerks out at the policy level as well as in the UI).

## Consequences

- Any "matter pack" or export that could include bench notes is generated
  by the author and includes only their own notes.
- Support and audit questions are answered from the audit log, not by
  reading the note.
- A future "share a note" feature must be a deliberate copy or a new share
  mechanism reviewed against this ADR, not a relaxation of the policy.
