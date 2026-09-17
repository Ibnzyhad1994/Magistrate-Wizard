# Changelog

All notable changes to Magistrate Wizard. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
`package.json` (`native/version.json` carries the native build number).
Tags are `vX.Y.Z`; the release flow is in `docs/native-and-calendar.md`.

## [Unreleased]

System audit of 2026-09-17 (`docs/system-audit-2026-09-17.md`). The
coordinator fills in specifics per area; headline changes:

### Added

- `npm test` script runner (`scripts/test-support/run-all.mjs`) that
  discovers every `scripts/tests/test-*.mjs`, skips `// @live-db` and
  `// @slow` scripts unless asked, and replaces the hand-listed CI steps.
- Husky + lint-staged hooks, `.nvmrc`, `engines`, `.editorconfig`, and a
  Prettier config matching the majority style (semicolons, 100 columns).
- ESLint: `jsx-a11y/recommended`, layering rules (`src/lib` never imports
  React layers; pages import only their own feature folder), and linting of
  `e2e/` and the Vite/Playwright configs.
- `src/types/db-aliases.ts`: hand-written row aliases moved out of the
  generated `database.types.ts`, so `npm run supabase:types` is safe.
- Workflows: `main-drift.yml`, `deploy-db.yml` (production environment,
  dry-run then push, edge function deploys), `smoke-prod.yml`,
  `release-electron.yml`; Playwright smokes now gate the develop → main
  fast-forward; failure opens the "develop CI failing" issue.
- `vercel.json` generated from the CSP source of truth (`npm run csp:sync`)
  with the full hashed CSP, HSTS, immutable asset caching and no-cache
  `index.html`, asserted by `test-vercel-headers`.
- Root `CLAUDE.md`, `docs/adr/` (one record per security/privacy
  invariant), `docs/environments.md`, a pull request template, this file.
- Accessibility, security, performance and UX fixes from the audit
  (details to be filled in by area).

### Security

- Migration 0154: profiles self-update now pins `court_id`, `is_active` and `email` (only admin RPCs move a user between courts); judgment lifecycle changes (`status`, `is_discoverable`) and deletes require the owner even with an edit share; PUBLIC EXECUTE revoked on six RPCs; audit hash chain serialised with an advisory lock; RPC rate limiter takes an allowlist; `source_url` columns must be http(s).
- Edge functions verify the caller (`clerk-access-notify`: the request's clerk or an approver; `webhook-dispatch`: service role or `WEBHOOK_DISPATCH_SECRET`) and escape HTML in emails.
- Electron 44 with an allowlisted `openExternal` and navigation guards; Android cleartext only for emulator hosts, `allowBackup` off; Google OAuth `state` nonce; `SafeExternalLink` for stored URLs; internal-path guard on notification links; global sign-out after password reset; Sentry PII scrubbing; CSV formula neutralisation; DOCX previews re-sanitised.

### Accessibility

- Per-route page titles, a route announcer and focus reset to main; labelled form fields (shared `Field` wrapper, admin inputs); global focus ring; input borders at 3:1 and a contrast-tested token set; tour overlay is a real dialog; named sheets, tables and navigation; keyboard redaction boxes and a PDF text view; accessible rich-text toolbar and link dialog; reduced-motion block; axe smoke spec.

### Performance

- Lazy routes and vendor chunks (entry 2.87 MB → 349 kB); jsPDF, JSZip, mammoth and the editor load on demand; one pdf.js build; `public/tesseract` 54 MB → 22 MB; batched signed URLs and identity RPCs (migration 0155); narrow provision selects; parallel bootstrap; realtime-aware notification polling; self-hosted fonts.

### Workflows

- Migration 0156: displaced magistrates and admins are notified on eviction, replace, co-sit and transfer; stale-draft notices dedupe for 30 days; honest webhook delivery states with retry and audited secret reveal; issue reporters are notified of decisions.
- Migration 0157: a magistrate can read back the draft Act they inserted (0114's Add flow failed on `INSERT ... RETURNING` because the only SELECT policy was published-or-admin), still gated on an active Court and never visible to clerks; `search_statutes` no longer raises `column reference "id" is ambiguous` (the 0137 PL/pgSQL wrapper left its CTE columns unqualified). Found once the local stack was rebuilt from scratch; the two legislation live tests now give their magistrate a Court, as 0117 requires.
- Duplicate case-number pre-check; confirmations on matter close/reopen, unlink, capacity clear, unlock and discoverability; owner-only judgment lifecycle controls; draft PDF watermark; bulk import survives tab switches and stuck rows can be cleared; offline outbox survives the idle lock, replay failures are shown, replayed updates carry an `updated_at` guard; Help menu links the manual and guides.

### UI

- Single error-toast layer; dirty-form dialogs resist accidental dismissal; mobile-first control sizes; sane radius scale; registered status tokens with `Alert` and `Progress` primitives; named z-index tiers; British spelling in judgment copy.

### Changed

- Develop CI: workflow-level `contents: read`, 30-minute timeout,
  concurrency group, npm cache, `npm audit` blocks on critical.
- Migration CI runs on every develop push, not only when `supabase/**`
  changes.
- Android release attaches the APK to a GitHub Release only when a signing
  keystore is configured; unsigned builds are artifacts only.
- `README.md` and `supabase/README.md` rewritten to describe the current
  system (151 migrations, generated types, real `src/` tree, CI/CD).
- Dashboard derived collections memoised (fixes the eight
  `react-hooks/exhaustive-deps` warnings that kept lint red).

### Removed

- `--experimental-strip-types` from every npm script (a no-op on Node 24).
- `docs/diagrams/tools/__pycache__/`.

## [0.3.0] — unreleased tag

`package.json` moved to 0.3.0 ahead of tagging. The last published tag is
`v0.2.0-alpha.2`.

## [0.2.0-alpha.2]

Earlier history is in `git log` and the dated notes under `docs/`.
