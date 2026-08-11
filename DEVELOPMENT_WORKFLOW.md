# BenchBook Development Workflow

Permanent working rules for this repository, established at the GitHub onboarding baseline (search extensions checkpoint, `0047_search_extensions`). These rules govern all future work regardless of who or what (human or agent) is making changes.

## Migration integrity

- Applied migrations are **never** edited after the fact. A defect discovered in an already-applied migration is fixed by a **new forward migration**, not by rewriting history.
- One migration number maps to exactly one migration file. Numbers are never silently reused.
- Migration numbering stays sequential and reconciled against live Supabase migration history (`list_migrations`), not inferred from local filenames alone.
- Renumbering an *unapplied* migration is fine and has happened several times in this project (e.g. the 0039 repair, the 0041/0042 Bookmark split, the 0046 lifecycle-search-path repair) — but nothing that has already been applied to Supabase is ever renamed or edited.
- Live migration history is the source of truth for what actually happened; local files must remain reproducible from Git and reconciled against it before every push.

## Database change workflow

Every security-sensitive or schema-changing migration follows this full sequence — stages are not skipped to save time:

1. Live inspection (schema, RLS, functions, triggers — confirmed, not assumed)
2. Dependency inventory
3. Design
4. Threat model
5. Rollback-only DDL pretest
6. Behavioral pretest (rollback-only, disposable fixtures only — never the real admin profile)
7. Review / explicit approval
8. Apply
9. Structural verification
10. Live behavioral regression
11. Supabase advisors (security + performance)
12. Rollback/baseline check
13. Architecture spec update
14. Git commit / push

Efficiency comes from not repeating already-verified work, never from removing a safeguard.

## Git safety

Never run, without explicit user authorization of a specific destructive operation after being shown the consequences:

- `git reset --hard`
- `git clean -fd`
- force checkout that discards local changes
- `git push --force` / `git push --force-with-lease`

Never silently resolve merge conflicts, discard unfamiliar files, or rewrite legitimate history to "make it look cleaner."

## Secrets

- No `.env`, credentials, service-role keys, or production data are ever committed. `.gitignore` covers `.env`/`.env.local`/`.env.*.local`; only `.env.example` (placeholder values) is tracked.
- Any credential that is discovered in history must trigger a STOP before push and a rotation/history-cleanup discussion — never a silent push.

## Security / privacy invariants

These access-control decisions are established and must not be casually reopened or weakened by future migrations, refactors, or "simpler" implementations:

- Quick Codes are owner-only, with no Court/Docket/admin bypass.
- Judgment visibility is owner-or-`is_discoverable` only; lifecycle locking (0045) governs field mutability, not visibility.
- Case Law's canonical (`owner_id IS NULL`) vs. personal (`owner_id` set) distinction, and personal-record privacy, is preserved.
- Bench Notes are author-only.
- Docket Matter access is the three-path predicate (current Court assignment OR retained assignment OR active Docket share).
- Share `view` vs `edit` distinction is preserved wherever it currently gates behavior.
- Established "no admin bypass" decisions (Judgment, Case Law personal rows, Quick Codes) are not reopened merely because a helper function or audit mechanism would be simpler with one.
- Deliberately asymmetric association-table designs (e.g. `docket_matter_case_law` vs `quick_code_docket_matters`) are not "normalized" without an explicit design review — they were built asymmetric on purpose.

## Commit policy going forward

- One verified logical milestone per commit, generally.
- A normal database milestone commit contains: the migration file(s) + the architecture-spec changes it required + directly related documentation. Frontend and backend changes are kept in separate commits where practical.
- Small forward-repair migrations may get their own commit, separate from the feature migration they repair.
- A migration is only committed as a verified production milestone after: apply → live verification → advisors reviewed → architecture spec reconciled. Unverified/unapplied migration SQL prepared for review is not committed to `main` as if it were production state — see the note below on in-review migrations.
- Failed experiments are never represented as completed work in commit messages or the architecture spec.
- Privacy/RLS-affecting changes require a behavioral regression pass (rollback-only) before being described as done.
- Any new `SECURITY DEFINER` function requires an explicit threat-model note (why DEFINER instead of INVOKER, fixed `search_path`, EXECUTE grants, what it exposes) before being treated as approved.
- Supabase advisors (security + performance) are reviewed after every security-sensitive migration, and any *new* finding is called out explicitly rather than folded silently into "no new findings."
- Git commit messages describe the verified state that resulted, not just which files changed.
- GitHub history should not be allowed to drift many migrations behind live Supabase — reconcile local files against `list_migrations` before any push that touches `supabase/migrations/`.

## In-review (unapplied) migrations

A migration file that has been designed and is staged for human review, but not yet applied to Supabase, is kept local (and may be committed on a review/feature branch) but is not merged into `main` as though it were verified production state. `main` should always be reconstructable to "what is actually live on Supabase" for everything under `supabase/migrations/`.
