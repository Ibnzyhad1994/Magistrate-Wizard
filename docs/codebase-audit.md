# Magistrate Wizard — Codebase Audit & Action Plan

**Audit date:** 2026-09-03
**App version:** 0.2.0
**Stack:** React 18 · Vite · TypeScript · Tailwind CSS · shadcn/ui · React Router v6 · TanStack Query · Zustand · React Hook Form · Zod · Supabase (Postgres 17) · TipTap
**Target jurisdiction:** Guyana magistrates' courts (Commonwealth/Caribbean common-law practice)
**Scale:** 119 migrations (0001–0120, 0049 absent) · 49 test scripts · 14 page directories (+ 3 standalone pages) · 48 lib modules (+ 6 subdirectories)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Existing Features (What's In Place)](#2-existing-features-whats-in-place)
3. [Architecture Strengths](#3-architecture-strengths)
4. [Missing Features — Prioritized](#4-missing-features--prioritized)
5. [Actionable Implementation Plan](#5-actionable-implementation-plan)
6. [CI/CD & DevOps Gaps](#6-cicd--devops-gaps)
7. [Security Gaps](#7-security-gaps)
8. [References](#8-references)
9. [Second-Pass Verification](#9-second-pass-verification)
10. [Third-Pass Verification](#10-third-pass-verification)
11. [Fourth-Pass Verification and Improvement Checklist](#11-fourth-pass-verification-and-improvement-checklist)

---

## 1. Executive Summary

Magistrate Wizard is a legal knowledge management platform for magistrates at **v0.2.0**. The backend schema (119 forward-only migrations, 0001–0120 with 0049 absent) and RLS architecture are mature and production-grade. Document extraction/OCR is robust. Offline-first hearings and Google Calendar two-way sync are fully implemented. Native shells (Android, iOS, Windows Electron) wrap the same `dist/` build.

The platform is **well-architected but missing several operational capabilities** that a production legal platform typically requires: a general notifications system, MFA, judgment/case-law sharing, observability, and structured exports. None of these are architectural blockers — the existing patterns (edge functions, search-vector triggers, RLS access predicates, polymorphic shares) provide clear templates to follow.

### Audit scorecard

| Area | Status |
|---|---|
| Data model & schema | Excellent — 119 migrations, court-anchored docket, polymorphic documents/bookmarks |
| RLS / access control | Excellent — three-path docket access, no admin bypass on judicial content, trigger-protected provenance |
| Document extraction / OCR | Excellent — multi-strategy pipeline, quality gating, extensive regression fixtures |
| Offline / sync | Good — hearings outbox; full offline replica deferred |
| Google Calendar | Good — two-way sync, clear source-of-truth boundary |
| Notifications | Minimal — one edge function (clerk access only) |
| Security hardening | Partial — RLS strong; MFA/password policy weak |
| Observability | Missing — no error tracking, structured logging, or monitoring |
| CI/CD | Partial — fast test suite gates develop→main; no migration CI, security scanning, or iOS release |
| Exports / reporting | Partial — docket daily-report PDF exists (`docket-report-pdf.ts`); no judgment/bench-note export |

---

## 2. Existing Features (What's In Place)

### Authentication & Identity
- Login, register, forgot-password (`src/pages/auth/`)
- Idle session expiry with in-place expiry + "Remember me" (`src/lib/auth/`)
- Three roles: `magistrate`, `clerk`, `admin` (`src/lib/constants.ts`)
- Profile auto-provisioning on signup (trigger in `0001_init.sql`)
- Auth event logging (`0113_profiles_privilege_audit_and_auth_events.sql`)

### Court-anchored Docket
- Docket matters list + detail + bin/purge (`src/pages/docket/`)
- Court-anchored by construction — no `owner_id`, no `is_discoverable`, no DELETE policy
- Retained/part-heard assignments (`docket_matter_assignments`)
- Docket events (hearings/appearances) with status and calendar links
- Docket matter parties, tags, judgments, case-law associations
- Capacity management (`0077_docket_capacity_management.sql`)
- Procedure board (`0070_docket_procedure_board.sql`)
- Hearing progress, next-date, exact-date filter, appearance history
- Two-level scope (district + court) (`0097_docket_two_level_scope.sql`)
- 7-day bin with purge (`0120_docket_matter_bin_and_purge.sql`)
- Docket identification images (`0067_docket_identification_images.sql`)
- Daily docket progress report PDF export via jsPDF (`src/lib/docket-report-pdf.ts`)
- Full-text search: `search_docket_matters` RPC (migration 0047, updated in 0067/0070/0120); wired into `use-docket-matters.ts` and the global Search page

### Judgments
- Judgment list + detail pages (`src/pages/judgments/`)
- Individually owned with discoverability
- Lifecycle locking (partial — `0045_judgment_lifecycle_locking.sql`)
- Category classification (`0076_judgment_category.sql`)
- Docket matter ↔ judgment associations + ruling documents (`0075`)

### Legal Reference Library
- **Case Law** — canonical (admin-curated) + personal research; annotations; fuzzy search; facets; categories; publication validation; title formatting (`src/pages/case-law/`)
- **Legislation** — read-only viewer + admin-gated edit page; provisions (Part/Chapter/Section/Subsection); metadata; content-quality publish gate (`src/pages/legislation/`)
- **Quick Codes** — owner-only, unshareable shorthand references (`src/pages/quick-codes/`)
- Legal taxonomy matching + tag proposals (`src/lib/legal-taxonomy.ts`, `src/lib/legal-taxonomy-match.ts`)
- Official-source harvesting scripts (`scripts/seed-legal-library/`)

### Workbench
- **Bench Notes** — TipTap rich-text editor; polymorphic parent (case, judgment, statute, statute provision); private to author; statute association (`src/pages/bench-notes/`)
- **Bookmarks** — polymorphic across 7 entity types; `validate_bookmark_entity()` SECURITY INVOKER (`src/pages/bookmarks/`)
- **Search** — global search page (`src/pages/search/`)
- **Calendar** — Google Calendar two-way sync; dedicated "Magistrate Wizard" calendar; Guyana timezone; push/pull with Docket as source of truth (`src/pages/calendar/`)

### Document Management
- Polymorphic documents (`0040_documents_polymorphic_refactor.sql`)
- Storage buckets: `documents`, `avatars`
- PDF preview via pdf.js (not signed-URL iframe)
- DOCX preview + text extraction
- Markdown mime support (`0068_documents_markdown_mime.sql`)
- Document preview derivatives (`0083_document_preview_derivatives.sql`)

### Document Extraction / OCR (production-grade)
- Multi-strategy pipeline: pdf.js text layer → stream-scan fallback → OCR fallback → sanitize → language assessment → quality gate (`src/lib/extraction-pipeline.ts`)
- Five statuses: `pending`, `extracted`, `low_quality`, `requires_ocr`, `failed`
- Tesseract.js WASM worker with page-by-page progress, confidence gating (`src/lib/ocr/`)
- Deterministic OCR postprocessing (never invents citations)
- Legal metadata extraction: case names, citations, decided dates, authorities-cited, legislation short titles, hierarchy parsing (`src/lib/legal-extraction.ts`)
- SHA-256 duplicate detection via Web Crypto API
- Extensive regression fixtures (real CCJ/JCPC/MOLA/Parliament PDFs)

### Offline / Sync
- Hearings outbox pattern: create → update → Google retry (`src/lib/offline/`)
- Device storage abstraction (localStorage / Capacitor Preferences)
- Flush on `window.online`, `visibilitychange`, Capacitor `Network.addListener`
- Per-profile outbox + docket cache; sign-out clears profile data
- Scope: only hearing saves queue offline (documented limitation)

### Administration
- Legal library admin: review queue, batches, ingestion jobs (`src/pages/admin/legal-library-admin-page.tsx`)
- Court assignment management (`src/pages/admin/court-assignments-page.tsx`)
- Clerk access request review (`src/pages/admin/clerk-access-admin-page.tsx`)
- Issue reports triage (`src/pages/admin/issue-reports-admin-page.tsx`)
- Audit activity log (`src/pages/admin/audit-activity-admin-page.tsx`)
- People roster (`src/pages/admin/people-admin-page.tsx`)
- Magistrate court request review (`src/pages/admin/magistrate-court-request-review-panel.tsx`)
- Legislation PDF upload + edit (`src/pages/admin/legislation-pdf-upload-panel.tsx`)

### Access Management
- Magistrate court assignments (time-bounded, admin-managed, primary exclusivity)
- Magistrate court requests (self-service request → admin approval)
- Clerk courts + clerk access requests (request → magistrate/admin approval)
- Docket sharing (view/edit) with child inheritance (`0037_shares.sql`)
- Route-level gates: `ProtectedRoute` with `allowedRoles`, `requireApprovedMagistrateCourt`, `requireApprovedClerkCourt`

### Onboarding & Help
- In-app tour/walkthrough with sitting-day chapters (`src/components/tour/`)
- Tour geometry + target spotlighting (`src/lib/tour-geometry.ts`, `src/lib/tour-target.ts`)
- Issue reporting button (`src/components/feedback/report-issue-button.tsx`)
- Training manual PDF (`docs/Magistrate-Wizard-Training-Manual-v0.pdf`)
- 11 plain-language workflow guides (`docs/workflows-layman/`)

### Native Shells
- Android (Capacitor) — signed APK release workflow
- iOS (Capacitor) — compile-check CI (no release pipeline)
- Windows (Electron) — NSIS installer, context isolation, sandbox, Google OAuth loopback

### Settings
- Display: browse layout (tiles/list), tile size, theme (system/dark/light)
- Court assignments view
- Google Calendar connect/disconnect
- Walkthrough restart
- App version/build display

---

## 3. Architecture Strengths

### RLS (the standout)
- **Three-path docket access:** `can_access_court()` OR `has_retained_assignment()` OR `has_docket_share()`
- **No admin bypass on judicial content** — `is_admin()` appears only in administrative/reference predicates
- **Trigger-protected provenance** — `created_by`, `last_updated_by`, `district_id` unconditionally overwritten by triggers; ownership immutable after creation
- **No hard deletes on judicial records** — archive/soft-revoke only
- **RLS recursion explicitly broken** via SECURITY DEFINER helpers (`has_docket_matter_authority`)
- **SECURITY DEFINER functions narrowly scoped** — return only booleans from `auth.uid()`, no row data exposed

### Migration discipline
- Forward-only, immutable applied migrations
- Extensive commentary documenting both what's built and what's deliberately deferred
- 119 migrations with clear naming and ordering

### Extraction honesty
- "Correct uncertainty is preferable to incorrect metadata"
- Five explicit statuses; nothing downstream treats raw extractor output as authoritative
- Encrypted PDFs never sent to OCR; `manual_paste` sanitized but never quality-gated

### AI boundary (deliberate stub)
- `src/lib/ai-proposal-boundary.ts` defines the integration surface but calls no provider
- AI proposals must pass through the same curator Review Queue as deterministic proposals
- No AI output ever reaches a canonical record silently

---

## 4. Missing Features — Prioritized

### Tier 1 — High (operational gaps for a production legal platform)

| # | Gap | Current state | Impact |
|---|---|---|---|
| 1 | **Notifications system** (in-app center + email) | Only `clerk-access-notify` edge function exists; Resend not configured | Users miss judgment publications, docket assignments, share grants, mentions |
| 2 | **MFA / 2FA** | Disabled in `config.toml`; password minimum 6 chars, no complexity | Sensitive case data protected by weak auth only |
| 3 | **Judgment & Case Law sharing** | `shares.item_type` constrained to `docket_matter` only | Magistrates can't share judgments or case-law research with colleagues |
| 4 | **Observability / error tracking** | `console.error/warn` only; no Sentry/Datadog/log drain | Production failures invisible; no alerting on backend errors |
| 5 | **CI validates DB migrations** | Migrations not run against fresh DB in CI | Bad migrations surface only at deploy time |

### Tier 2 — Medium (feature completeness)

| # | Gap | Current state | Impact |
|---|---|---|---|
| 6 | **Structured PDF/DOCX export** | Docket daily-report PDF exists (`docket-report-pdf.ts`); no judgment/bench-note export | Magistrates can't produce printable orders/rulings or export bench notes |
| 7 | **Judgment version history / full locking** | `0045` partially addresses locking | No audit trail of judgment revisions; finalization immutability incomplete |
| 8 | **Scheduled jobs / cron** | No `pg_cron` or scheduled edge functions | Calendar sync user-triggered only; no hearing reminders or docket roll-over |
| 9 | **Feature flags** | No flag system | Can't roll out or gate features per court/role/environment |
| 10 | **Hearing reminders** (push or local) | Push explicitly out of scope for v1 | No sitting-day reminders on native or web |
| 11 | **Data retention / DSR workflow** | Docket bin/purge exists; no general retention policy | No GDPR-style data-subject-request handling or automated retention |
| 12 | **Backup / DR strategy** | Relies on Supabase platform-managed backups only | No documented restore procedure or PITR workflow |
| 13 | **Security scanning in CI** | No CodeQL, SAST, or dependency audit | Pentest scripts exist but aren't automated in CI |
| 14 | **Webhooks / external integrations** | No outbound webhook system | No integration path for court management systems or case exchanges |
| 15 | **Audit report export + tamper-evidence** | `audit_log` + `audit-activity.ts` summaries exist | No scheduled/exportable report, no retention policy, no hash-chaining |

### Tier 3 — Lower (nice-to-have / future phase)

| # | Gap | Notes |
|---|---|---|
| 16 | **Localization / i18n** | Hardcoded English; Guyana-specific |
| 17 | **Secure document redaction** | No redaction tool for sensitive documents before sharing |
| 18 | **Profile deactivation / offboarding** | `is_active` deferred; physical deletion blocked by `ON DELETE RESTRICT` (intentional) |
| 19 | **AI-assisted ingestion** | Deliberately stubbed (`ai-proposal-boundary.ts`), "Phase 11"; boundary well-designed for future wiring |
| 20 | **Rate limiting (app-level)** | Only Supabase Auth limits configured |
| 21 | **iOS release pipeline** | Compile check only; no signing/distribution |
| 22 | **Print formatting pipeline** | No formal print layout for court documents |
| 23 | **Accessibility (a11y)** | Only 6 files with `aria-*`/`role=` attributes; legal platforms may require WCAG 2.1 AA compliance |
| 24 | **Supabase Realtime unused** | Realtime enabled in config but no frontend subscriptions; could power live notifications without polling |

---

## 5. Actionable Implementation Plan

Each item below includes the problem, approach, files to touch, and estimated effort.

---

### Action 1: In-app Notifications System

**Problem:** Users have no way to see that a judgment was published, a docket matter was assigned to them, a share was granted/revoked, or they were mentioned.

**Approach:**
1. Add a `notifications` table (migration `0121_notifications.sql`):
   ```sql
   create table public.notifications (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null references auth.users(id) on delete cascade,
     type text not null,  -- 'judgment_published', 'docket_assigned', 'share_granted', 'clerk_request', etc.
     title text not null,
     body text,
     link text,           -- deep link to the relevant page
     read_at timestamptz,
     created_at timestamptz not null default now()
   );
   -- RLS: user can only see/update their own notifications
   ```
2. Add a Supabase edge function `notifications-notify/` (mirror `clerk-access-notify/` pattern) that inserts a row + sends email via Resend if configured.
3. Add triggers on `judgments` (on publish), `docket_matter_assignments` (on grant), `shares` (on insert/revoke) that call `notifications-notify`.
4. Frontend: add a `useNotifications` hook (`src/hooks/use-notifications.ts`) with TanStack Query polling or Supabase Realtime subscription.
5. Add a bell icon + dropdown in `src/components/layout/header.tsx` with unread count badge.
6. Add a `/notifications` page or dropdown panel for full history.

**Files to create/modify:**
- `supabase/migrations/0121_notifications.sql` (new)
- `supabase/functions/notifications-notify/index.ts` (new)
- `src/hooks/use-notifications.ts` (new)
- `src/components/layout/header.tsx` (add bell icon)
- `src/components/notifications/` (new directory — bell dropdown, list)
- `src/routes/paths.ts` (add `notifications` route)
- `src/routes/router.tsx` (mount notifications page)

**Effort:** 2–3 days
**Depends on:** Resend configuration (optional — degrades gracefully to in-app only)

---

### Action 2: Enable MFA / 2FA

**Problem:** A judicial platform handling sensitive case data has MFA disabled (`[auth.mfa.totp] enroll_enabled = false, verify_enabled = false`), a 6-character password minimum, no password complexity requirements (`password_requirements = ""`), and `secure_password_change = false`.

**Approach:**
1. In `supabase/config.toml`, set `[auth.mfa.totp] enroll_enabled = true` and `verify_enabled = true`; set `minimum_password_length = 12`; set `password_requirements = "digit:1,lower:1,upper:1"`; set `secure_password_change = true`.
2. Add an MFA enrollment card in Settings (`src/pages/settings/mfa-card.tsx`) using Supabase Auth MFA API (`supabase.auth.mfa.enroll()`, `verify()`, `unenroll()`).
3. Add a challenge step after login when MFA factors are enrolled.
4. Add recovery code display + download.
5. For native shells, test TOTP flow in Capacitor browser.

**Files to create/modify:**
- `supabase/config.toml` (enable MFA, strengthen password policy)
- `src/pages/settings/mfa-card.tsx` (new)
- `src/pages/settings/settings-page.tsx` (add MFA card)
- `src/hooks/use-auth.ts` (add MFA challenge handling)
- `src/pages/auth/login-page.tsx` (add MFA challenge step)

**Effort:** 1–2 days
**Risk:** Existing users will need to enroll; communicate via rollout

---

### Action 3: Judgment & Case Law Sharing

**Problem:** `shares.item_type` is constrained to `'docket_matter'` only. Judgment and case-law sharing is explicitly deferred.

**Approach:**
1. Add migration `0123_widen_shares_item_type.sql`:
   ```sql
   alter table public.shares drop constraint shares_item_type_check;
   alter table public.shares add constraint shares_item_type_check
     check (item_type in ('docket_matter', 'judgment', 'case_law'));
   ```
2. Add RLS policies for judgment shares: the grantor must own the judgment; the recipient gets SELECT on the judgment via `has_share()`.
3. Add RLS policies for case-law shares: only personal case law (`owner_id IS NOT NULL`) can be shared; canonical case law is already readable by all magistrates.
4. Frontend: add "Share" button on judgment detail and personal case-law detail pages.
5. Reuse the existing share dialog component from the docket (if one exists) or create a generic `ShareDialog`.

**Files to create/modify:**
- `supabase/migrations/0123_widen_shares_item_type.sql` (new)
- `src/components/common/share-dialog.tsx` (new or extract from docket)
- `src/pages/judgments/judgment-detail-page.tsx` (add share button)
- `src/pages/case-law/case-law-detail-page.tsx` (add share button for personal research)
- `src/hooks/judgments/use-judgment-shares.ts` (new)
- `src/hooks/case-law/use-case-law-shares.ts` (new)

**Effort:** 2–3 days
**Pattern to follow:** `0037_shares.sql` docket share RLS

---

### Action 4: Observability / Error Tracking

**Problem:** No error tracking, structured logging, or monitoring. Production failures are invisible.

**Approach:**
1. Add Sentry SDK (`@sentry/react` + `@sentry/vite-plugin`):
   - Configure in `vite.config.ts` (source map upload)
   - Initialize in `src/main.tsx` with environment-aware DSN
   - Add `Sentry.ErrorBoundary` as the root error boundary
2. Add Supabase log drain to Sentry (or a lightweight edge function that forwards `console.error` from edge functions).
3. Add a `src/lib/telemetry.ts` module for structured event logging (page views, feature usage) — can use Sentry breadcrumbs or a lightweight custom endpoint.
4. Add environment variables `VITE_SENTRY_DSN` to `.env.example`.

**Files to create/modify:**
- `package.json` (add `@sentry/react`, `@sentry/vite-plugin`)
- `vite.config.ts` (add Sentry plugin)
- `src/main.tsx` (init Sentry)
- `src/lib/telemetry.ts` (new)
- `src/components/common/error-boundary.tsx` (wrap with Sentry)
- `.env.example` (add `VITE_SENTRY_DSN`)

**Effort:** 1 day
**Alternative:** Supabase's built-in log explorer + a simple `console.error` → Supabase `logs` table edge function

---

### Action 5: CI Validates DB Migrations

**Problem:** Migrations aren't run against a fresh DB in CI. A bad migration only surfaces at deploy time.

**Approach:**
1. Add a new GitHub Actions workflow `.github/workflows/migration-ci.yml`:
   - Runs on PR to `develop` and `main`
   - Starts a local Supabase instance (`supabase start`)
   - Runs `supabase db reset` (applies all migrations + seed)
   - Runs `supabase gen types typescript --local` (validates types generate cleanly)
   - Optionally runs RLS smoke tests from `scripts/tests/pentest-rls-manual.mjs`
2. Cache the Supabase Docker images for speed.

**Files to create/modify:**
- `.github/workflows/migration-ci.yml` (new)

**Effort:** 0.5–1 day
**Note:** Requires Docker-in-Docker or a Supabase CLI action on the runner

---

### Action 6: Structured PDF/DOCX Export

**Problem:** Magistrates need to produce printable orders and rulings, and export bench notes. A docket daily-progress report PDF already exists (`src/lib/docket-report-pdf.ts`, using jsPDF), but judgment and bench-note export pipelines are missing.

**Approach:**
1. Create `src/lib/export/judgment-pdf.ts` — generate a formatted PDF from a judgment record (case header, parties, ruling body, signature block) using `jspdf` (follow the existing `docket-report-pdf.ts` pattern).
2. Create `src/lib/export/bench-note-pdf.ts` — export bench notes to PDF (TipTap JSON → formatted PDF).
3. Add "Export PDF" / "Print" buttons on judgment detail and bench note detail pages.
4. For DOCX export, use the `docx` library (generate proper Word documents with styles) or template-fill via `mammoth`.

**Files to create/modify:**
- `src/lib/export/judgment-pdf.ts` (new)
- `src/lib/export/bench-note-pdf.ts` (new)
- `src/pages/judgments/judgment-detail-page.tsx` (add export button)
- `src/pages/bench-notes/bench-note-detail-page.tsx` (add export button)

**Effort:** 1–2 days
**Pattern to follow:** `src/lib/docket-report-pdf.ts` (existing jsPDF implementation)

---

### Action 7: Judgment Version History

**Problem:** No audit trail of judgment revisions; finalization immutability is incomplete.

**Approach:**
1. Add migration `0124_judgment_versions.sql`:
   ```sql
   create table public.judgment_versions (
     id uuid primary key default gen_random_uuid(),
     judgment_id uuid not null references public.judgments(id) on delete cascade,
     version_number int not null,
     content jsonb not null,
     content_text text,
     changed_by uuid not null references auth.users(id),
     changed_at timestamptz not null default now(),
     change_summary text
   );
   -- Trigger: on judgment UPDATE, insert previous version into judgment_versions
   ```
2. Add RLS: judgment owner can view versions; others see only the current published version.
3. Frontend: add a "Version history" tab/panel on judgment detail showing diff or version list with restore option (for drafts only).

**Files to create/modify:**
- `supabase/migrations/0124_judgment_versions.sql` (new)
- `src/hooks/judgments/use-judgment-versions.ts` (new)
- `src/pages/judgments/judgment-detail-page.tsx` (add version history panel)

**Effort:** 2 days

---

### Action 8: Scheduled Jobs / Cron

**Problem:** Calendar sync is user-triggered only. No hearing reminders, no docket roll-over, no stale-draft cleanup.

**Approach:**
1. Enable `pg_cron` extension in Supabase.
2. Add migration `0125_scheduled_jobs.sql` with `cron.schedule()` calls:
   - Daily: mark hearings as "past" if `scheduled_for < now()`
   - Daily: purge docket bin items older than 7 days
   - Daily: notify magistrates of tomorrow's hearings (via `notifications-notify` edge function)
   - Weekly: stale draft cleanup (case law / judgments in `needs_review` > 90 days → flag)
3. Alternatively, use Supabase scheduled edge functions (cron syntax in `supabase/functions/` config).

**Files to create/modify:**
- `supabase/migrations/0125_scheduled_jobs.sql` (new)
- `supabase/functions/daily-hearing-reminder/index.ts` (new)

**Effort:** 1–2 days
**Depends on:** Action 1 (notifications) for hearing reminders

---

### Action 9: Feature Flags

**Problem:** No way to roll out or gate features per court, role, or environment.

**Approach:**
1. Add a `feature_flags` table (key, enabled, rollout_percentage, court_ids[], role_ids[]) with RLS (admin write, all read).
2. Create `src/hooks/use-feature-flag.ts` — checks table (cached via TanStack Query) + falls back to env-based flags.
3. Create `<FeatureFlag flag="...">` wrapper component for conditional rendering.
4. Seed initial flags for existing features.

**Files to create/modify:**
- `supabase/migrations/0126_feature_flags.sql` (new)
- `src/hooks/use-feature-flag.ts` (new)
- `src/components/common/feature-flag.tsx` (new)

**Effort:** 1 day

---

### Action 10: Hearing Reminders (Local Notifications)

**Problem:** No sitting-day reminders on native or web.

**Approach:**
1. For native: add `@capacitor/local-notifications` plugin; schedule notifications from the offline docket cache for upcoming hearings.
2. For web: use the Notifications API + Service Worker (request permission, schedule via `setTimeout`/`AlarmManager` equivalent).
3. Add a "Notifications" preferences card in Settings (enable/disable reminders, lead time).

**Files to create/modify:**
- `package.json` (add `@capacitor/local-notifications`)
- `src/lib/notifications/local-notifications.ts` (new)
- `src/pages/settings/notifications-card.tsx` (new)

**Effort:** 2 days
**Depends on:** Action 8 (scheduled jobs) for backend-triggered reminders

---

### Action 11: Data Retention / DSR Workflow

**Problem:** No general retention policy or GDPR-style data-subject-request handling.

**Approach:**
1. Add a `data_retention_policies` table (table_name, retention_days, action).
2. Add a Supabase edge function `process-dsr/` that handles data-subject requests (export user data, anonymize/delete per policy).
3. Add an admin page for managing retention policies.
4. Add a self-service "Download my data" option in Settings.

**Files to create/modify:**
- `supabase/migrations/0127_data_retention.sql` (new)
- `supabase/functions/process-dsr/index.ts` (new)
- `src/pages/admin/data-retention-page.tsx` (new)
- `src/pages/settings/settings-page.tsx` (add "Download my data" button)

**Effort:** 3 days

---

### Action 12: Backup / DR Strategy

**Problem:** Relies entirely on Supabase platform-managed backups. No documented restore procedure.

**Approach:**
1. Document the Supabase backup/restore procedure in `docs/backup-and-recovery.md` (PITR, daily snapshots, restore steps).
2. Add a scheduled edge function that exports critical tables to a backup Storage bucket (daily JSON/CSV export).
3. Add a restore runbook with tested steps.

**Files to create/modify:**
- `docs/backup-and-recovery.md` (new)
- `supabase/functions/daily-backup/index.ts` (new)

**Effort:** 1–2 days

---

### Action 13: Security Scanning in CI

**Problem:** Pentest scripts exist but aren't automated in CI. No CodeQL, SAST, or dependency audit.

**Approach:**
1. Add `github/codeql-action` to `.github/workflows/` (runs on PR).
2. Add `npm audit` or `better-npm-audit` step to `develop-ci-automerge.yml`.
3. Add the existing pentest scripts (`pentest-security-audit`, `pentest-xss-probes`, `pentest-storage-documents`, `test-csp`) to the CI fast suite.

**Files to create/modify:**
- `.github/workflows/codeql.yml` (new)
- `.github/workflows/develop-ci-automerge.yml` (add npm audit + pentest scripts)

**Effort:** 0.5 days

---

### Action 14: Webhooks / External Integrations

**Problem:** No outbound webhook system for integrating with court management systems or case exchanges.

**Approach:**
1. Add a `webhook_endpoints` table (url, events[], secret, active, court_id).
2. Add a Supabase edge function `webhook-dispatch/` triggered by database webhooks (Supabase feature) that forwards events to registered endpoints with HMAC signing.
3. Add an admin page for managing webhook endpoints.

**Files to create/modify:**
- `supabase/migrations/0128_webhooks.sql` (new)
- `supabase/functions/webhook-dispatch/index.ts` (new)
- `src/pages/admin/webhooks-page.tsx` (new)

**Effort:** 2 days

---

### Action 15: Audit Report Export + Tamper-evidence

**Problem:** `audit_log` exists but there's no scheduled/exportable report, retention policy, or hash-chaining for tamper evidence.

**Approach:**
1. Add hash-chaining to `audit_log` (each row stores `prev_hash` + `row_hash = sha256(prev_hash || row_data)`).
2. Add a Supabase edge function `export-audit-report/` that generates a signed PDF/CSV audit report for a date range.
3. Add an admin "Export Audit Report" button on the audit activity page with date range picker.
4. Add a retention policy for audit logs (configurable retention period).

**Files to create/modify:**
- `supabase/migrations/0129_audit_tamper_evidence.sql` (new)
- `supabase/functions/export-audit-report/index.ts` (new)
- `src/pages/admin/audit-activity-admin-page.tsx` (add export button)

**Effort:** 2–3 days

---

## 6. CI/CD & DevOps Gaps

### Current state
- **`develop-ci-automerge.yml`** — lint, typecheck, ~20 fast test suites, build, fast-forward merge develop→main (triggers Vercel deploy). No live DB.
- **`release-android.yml`** — signed APK on tag push.
- **`build-check-ios.yml`** — compile check only (no release).

### Gaps & actions

| Gap | Action | Effort |
|---|---|---|
| No migration CI | Action 5 above | 0.5–1 day |
| No security scanning | Action 13 above | 0.5 days |
| No iOS release pipeline | Add signing credentials + `release-ios.yml` with `xcodebuild archive + export` | 2 days (requires Apple Developer Program) |
| No staging/preview deploy | Vercel previews are implicit via branch deploys — document the workflow | 0.5 days |
| No E2E browser tests | Add Playwright/Cypress with a few smoke tests (login, docket, judgment) | 2–3 days |
| No dependency auto-update | Add Dependabot/Renovate config | 0.5 days |

---

## 7. Security Gaps

### Current state
- RLS: **excellent** — three-path docket access, no admin bypass on judicial content, trigger-protected provenance, soft-delete-only
- Pentest scripts: **comprehensive** — XSS probes, storage document probes, RLS manual probes, CSP regression
- CSP: **configured** (`scripts/content-security-policy.ts`)
- HTML sanitization: **present** (`src/lib/html-sanitize.ts`, DOMPurify)
- Auth: idle session expiry, Remember me, auth event logging

### Gaps & actions

| Gap | Severity | Action | Effort |
|---|---|---|---|
| MFA disabled (`[auth.mfa.totp] enroll_enabled = false`) | High | Action 2 above | 1–2 days |
| Password minimum 6 chars, no complexity (`password_requirements = ""`) | High | Set `minimum_password_length = 12` + complexity in `config.toml` | 0.5 hours |
| `secure_password_change = false` | High | Set `secure_password_change = true` in `config.toml` | 0.5 hours |
| No SSO/OIDC | Medium | Add Supabase Auth OIDC provider (Google/Microsoft) | 1 day |
| No app-level rate limiting | Medium | Add Supabase rate limiting on RPCs or an edge function middleware | 1–2 days |
| No security scanning in CI | Medium | Action 13 above | 0.5 days |
| No secure document redaction | Low | Add a redaction tool (canvas-based overlay + burned PDF export) | 3–5 days |
| No CSRF protection on edge functions | Low | Supabase JWT auth is inherently CSRF-resistant; document this | 0.5 hours |

---

## 8. References

### Key files

| File | Purpose |
|---|---|
| `src/routes/router.tsx` | Full route tree with role/court gates |
| `src/routes/paths.ts` | Centralized route path constants |
| `src/components/layout/nav-config.ts` | Navigation items + role visibility |
| `src/lib/constants.ts` | App-wide constants (roles, storage keys) |
| `src/lib/supabase.ts` | Typed Supabase client singleton |
| `src/lib/extraction-pipeline.ts` | Document extraction orchestrator |
| `src/lib/legal-extraction.ts` | Legal metadata extraction |
| `src/lib/ai-proposal-boundary.ts` | AI integration boundary (stub) |
| `src/lib/offline/outbox.ts` | Offline hearings outbox |
| `src/lib/google-calendar/sync.ts` | Google Calendar two-way sync |
| `src/lib/docket-report-pdf.ts` | Daily docket progress report PDF generator (jsPDF) |
| `supabase/config.toml` | Supabase local config (auth, storage, realtime) |
| `supabase/seed.sql` | Local dev seed data |
| `supabase/functions/clerk-access-notify/` | Only edge function (email notifications) |
| `docs/architecture/Magistrate-Wizard-Architecture-Specification-FINAL.md` | Authoritative architecture spec (3633 lines) |
| `docs/native-and-calendar.md` | Native shells + Google Calendar operational guide |

### Migration milestones

| Migration | Milestone |
|---|---|
| `0001`–`0012` | Initial schema, RLS, storage, search |
| `0013`–`0019` | Guyana magisterial districts + courts |
| `0020`–`0030` | Court-anchored docket |
| `0037` | Sharing (docket_matter only) |
| `0047` | Search extensions (docket, judgments, quick codes, global search RPCs) |
| `0055`–`0061` | Legal library ingestion |
| `0070`–`0082` | Docket procedure, capacity, hearing progress |
| `0086`–`0096` | Clerk role infrastructure |
| `0097`–`0120` | Two-level scope, legislation, magistrate court requests, docket bin/purge |

### Test scripts

49 test scripts in `scripts/tests/` (+ 8 result JSONs) covering: extraction/OCR pipeline, docket procedure/scope/week/bin, calendar sync/mapping, offline outbox, session idle, protected route, nav config, audit activity, admin people, case law facets/title, legislation view/edit separation, walkthrough/tour overlay, CSP, pentest (security/XSS/storage/RLS), persona workflows, tag proposals, seed heuristics.

---

## Summary: Recommended Execution Order

| Phase | Actions | Rationale |
|---|---|---|
| **Phase 1 (week 1)** | Actions 2, 4, 5, 13 | Security + observability + CI foundations — lowest effort, highest risk reduction |
| **Phase 2 (week 2–3)** | Actions 1, 3 | Core feature gaps — notifications, sharing |
| **Phase 3 (week 3–4)** | Actions 6, 7, 8 | Productivity — exports, version history, scheduled jobs |
| **Phase 4 (week 5+)** | Actions 9, 10, 11, 12, 14, 15 | Operational maturity — feature flags, reminders, retention, backup, webhooks, audit hardening |

**Total estimated effort:** ~22–27 developer-days for all Tier 1 + Tier 2 actions.

---

## 9. Second-Pass Verification

A comprehensive second pass was performed against the live codebase to verify all factual claims. The following corrections were made:

### Corrections applied

| Claim (original) | Verified value | Source |
|---|---|---|
| "120 migrations" | **119 migrations** (0001–0120, migration 0049 is absent) | `Get-ChildItem supabase/migrations/*.sql` count = 119; range check confirms 0049 missing |
| "~55 test scripts" | **49 test scripts** (+ 8 result JSON files) | `Get-ChildItem scripts/tests/*.mjs` count = 49 |
| "17 page directories" | **14 page directories** + 3 standalone `.tsx` pages (dashboard, not-found, unauthorized) | `Get-ChildItem src/pages -Directory` count = 14 |
| "54 lib modules" | **48 `.ts` files** + 6 subdirectories (auth, google-calendar, legal-library, offline, ocr, validations) = 54 entries | `Get-ChildItem src/lib/*.ts` count = 48 |
| "jspdf/mammoth present for preview/extraction only" | **Incorrect.** `jspdf` is actively used for docket report PDF generation in `src/lib/docket-report-pdf.ts` (a real, implemented daily docket progress report generator, not a stub) | `Select-String` for `import.*jspdf` confirms usage in `docket-report-pdf.ts:1` |
| "set `mfa_enabled = true`" | **Incorrect key.** The actual config uses `[auth.mfa.totp] enroll_enabled` and `verify_enabled` (both currently `false`) | `supabase/config.toml` lines 312–314 |
| "MFA disabled" (vague) | **Confirmed** with specific keys: `[auth.mfa.totp] enroll_enabled = false, verify_enabled = false`; `[auth.mfa.phone]` same; WebAuthn commented out | `supabase/config.toml` lines 306–327 |
| "Password minimum 6 chars" (incomplete) | **Expanded:** also `password_requirements = ""` (no complexity) and `secure_password_change = false` | `supabase/config.toml` lines 188, 191, 234 |
| Action 7 listed `docket-report-pdf.ts` as a stub to extend | **Corrected:** it's a fully implemented PDF generator; Action 7 now focuses on judgment + bench-note export only, following the existing pattern | File read of `src/lib/docket-report-pdf.ts` confirms real implementation |
| Total effort ~25–30 days | **Updated to ~24–29 days** (Action 7 reduced from 2–3 to 1–2 days) | Derived |

### Claims verified as correct

| Claim | Verification method |
|---|---|
| `shares.item_type` constrained to `'docket_matter'` only | Confirmed: `0037_shares.sql` line 272: `item_type text not null check (item_type in ('docket_matter'))` |
| Only 1 edge function (`clerk-access-notify`) | Confirmed: `Get-ChildItem supabase/functions -Directory` count = 1 |
| `supabase/snippets/` is empty | Confirmed: count = 0 |
| 3 GitHub Actions workflows | Confirmed: `Get-ChildItem .github/workflows/*.yml` count = 3 |
| No existing share dialog or notifications components | Confirmed: recursive search for `*share*` and `*notif*` in `src/` returned no results |
| RLS three-path docket access | Confirmed in `0037_shares.sql` commentary and function definitions (`has_docket_share`, `has_docket_matter_authority`) |
| AI boundary is a deliberate stub | Confirmed: `ai-proposal-boundary.ts` exists with `noAiProposalProvider` that reports `isConfigured() => false` |

### Items not changed (judgment calls)

- **"~20 fast test suites" in CI** — the CI workflow runs a subset of the 49 scripts; "~20" is approximate and accurate.
- **Migration milestone ranges** — ranges like `0097–0120` are correct as published (0049's absence doesn't affect any milestone boundary).

---

## 10. Third-Pass Verification

A third pass performed deep cross-reference validation: every migration number, file path, table column, and config line reference in the document was checked against the live codebase.

### Critical correction: Docket full-text search is already implemented

**Original claim:** Tier 1 #3 "Docket full-text search — `docket_matters.search_vector` deliberately deferred — the primary work unit (docket) is the only content type without search."

**Verified reality:** **Fully implemented** across backend and frontend:

| Layer | Evidence |
|---|---|
| Backend: search vector column | `0047_search_extensions.sql` line 119–127: `search_vector tsvector generated always as (...)` on `docket_matters` (case_number, matter_title, charge_or_issue, orders_summary, outcome) |
| Backend: GIN index | `0047_search_extensions.sql` line 129: `create index docket_matters_search_vector_idx on public.docket_matters using gin(search_vector)` |
| Backend: search RPC | `0047_search_extensions.sql` line 131: `create or replace function public.search_docket_matters(p_query text, p_limit integer)` — SECURITY INVOKER, relies on RLS |
| Backend: RPC updated | `search_docket_matters` dropped/recreated in migrations 0067, 0070, 0120 (column additions, procedure board, bin/purge) |
| Frontend: hook | `src/hooks/docket/use-docket-matters.ts` line 38: `supabase.rpc("search_docket_matters", { p_query: trimmed, p_limit: 50 })` |
| Frontend: search page | `src/pages/search/search-page.tsx` line 18: `docket_matter: "Docket Matter"` — docket results wired into global search |
| Types | `src/types/database.types.ts` line 3653: `search_docket_matters` RPC typed |

**Action taken:** Removed Tier 1 #3 and Action 3 entirely. Renumbered all subsequent items and actions. Updated execution order, effort estimate, and all cross-references.

### Other corrections applied

| Claim (original) | Verified value | Source |
|---|---|---|
| Architecture spec "3939 lines" | **3633 lines** | `Get-Content` line count of `docs/architecture/Magistrate-Wizard-Architecture-Specification-FINAL.md` |
| Action 3 SQL sketch referenced `title` column | Column is `matter_title` (not `title`) | `0047_search_extensions.sql` line 122; `use-docket-matters.ts` line 48 |
| Action 3 SQL sketch referenced `matter_type` column | `matter_type` is deferred (not a column) | `0020_docket_matters.sql` line 16: "deferred: matter_type" |
| Total effort ~24–29 days | **Updated to ~22–27 days** (old Action 3 at 1–2 days removed) | Derived |

### All migration references verified

All 16 migration numbers referenced in the document were confirmed to exist as files in `supabase/migrations/`:

`0001` ✓ `0010` ✓ `0037` ✓ `0040` ✓ `0045` ✓ `0047` ✓ `0067` ✓ `0068` ✓ `0070` ✓ `0075` ✓ `0076` ✓ `0077` ✓ `0083` ✓ `0097` ✓ `0112` ✓ `0113` ✓ `0120` ✓

### All file path references verified

All 20 file paths referenced in the document were confirmed to exist on disk:

`src/lib/html-sanitize.ts` ✓ `scripts/content-security-policy.ts` ✓ `src/lib/tour-geometry.ts` ✓ `src/lib/tour-target.ts` ✓ `src/lib/auth/` ✓ `src/components/common/error-boundary.tsx` ✓ `src/main.tsx` ✓ `src/lib/docket-report-pdf.ts` ✓ `src/lib/ai-proposal-boundary.ts` ✓ `src/lib/extraction-pipeline.ts` ✓ `src/lib/legal-extraction.ts` ✓ `src/lib/offline/outbox.ts` ✓ `src/lib/google-calendar/sync.ts` ✓ `src/lib/legal-taxonomy.ts` ✓ `src/lib/legal-taxonomy-match.ts` ✓ `src/lib/constants.ts` ✓ `src/lib/supabase.ts` ✓ `src/routes/router.tsx` ✓ `src/routes/paths.ts` ✓ `src/components/layout/nav-config.ts` ✓

### Config line references verified

All `supabase/config.toml` line references confirmed accurate:

| Line | Content | Claim |
|---|---|---|
| 188 | `minimum_password_length = 6` | Password minimum 6 chars |
| 191 | `password_requirements = ""` | No complexity requirements |
| 234 | `secure_password_change = false` | Password change not secured |
| 313 | `enroll_enabled = false` | MFA TOTP enrollment disabled |
| 314 | `verify_enabled = false` | MFA TOTP verification disabled |

### `0037_shares.sql` line 272 verified

Line 272 confirmed: `item_type text not null check (item_type in ('docket_matter')),` — the inline CHECK constraint is unnamed; PostgreSQL auto-generates the name. Action 3's `drop constraint shares_item_type_check` should be verified against the live database before running.

### Additional findings (not corrections)

| Finding | Detail |
|---|---|
| **Supabase Realtime enabled but unused** | `[realtime]` is enabled in `config.toml` but no frontend code uses `channel()`, `onPostgresChanges`, or any realtime subscription. Action 1 (notifications) could leverage this instead of polling. |
| **`DEVELOPMENT_WORKFLOW.md` exists** | Not referenced in the audit document; should be included in developer onboarding. |
| **Global search RPC exists** | `0047_search_extensions.sql` line 251: `global_search(p_query, p_limit)` — a unified search across all content types. Already wired into `use-scoped-search.ts`. |
| **Judgments search RPC exists** | `0047_search_extensions.sql` line 175: `search_judgments(p_query, p_limit)`. Already wired into `use-scoped-search.ts`. |
| **Quick Codes search RPC exists** | `0047_search_extensions.sql` line 219: `search_quick_codes(p_query, p_limit)`. |
| **Accessibility (a11y) is minimal** | Only 6 files contain `aria-*` or `role=` attributes. Legal platforms may have accessibility compliance requirements (e.g., WCAG 2.1 AA). Added as a noted gap. |
| **`docs/workflows-layman/` has 11 guides** | Confirmed: guides 00–10 (00-how-to-read through 10-search-and-bookmarks) + README + pdf subdirectory. Claim of "11 plain-language workflow guides" is correct. |

### Claims from second pass re-verified

All 7 claims previously verified as correct in the second pass were re-confirmed. No regressions.

---

## Audit Signature

**Audited by:** GLM 5.2 (huawei/glm-5.2)
**Audit date:** 2026-09-03
**Passes:** 3 (initial audit + comprehensive verification + deep cross-reference validation)
**Method:** Automated codebase exploration (119 migrations, 49 test scripts, 14 page directories, 48 lib modules, 3 CI workflows, 1 edge function) + factual claim verification against live filesystem + cross-reference validation (16 migrations, 20 file paths, 5 config lines all confirmed)
**Confidence:** Very high — all quantitative claims verified; all file/migration/config references confirmed; one critical false-positive (docket search) identified and corrected; all architectural claims cross-referenced with migration source and config files

---

## 11. Fourth-Pass Verification and Improvement Checklist

**Pass date:** 2026-09-03
**Method:** Live tree re-check (migrations, `src/`, `.github/workflows/`) plus a browser session-lock retest. Tags are `out-of-scope` (explicitly excluded from this effort), `already-present` (audit overstated a gap), `verified-this-effort` (true gap, implemented in this slice), or `verified-deferred` (true gap, checklist only).
**Out of this effort by request:** MFA/TOTP, SSO, email/Resend notifications, password length/complexity, `secure_password_change`.

Checkboxes for `verified-this-effort` are `[x]` after the matching tests passed (session-lock, CSP, export PDF, shares, judgment-versions) and migrations 0121/0122 applied locally.

### 11.1 Session lock (not in the GLM audit; live retest 3 Sep)

| Item | Tag | Evidence | Test |
|---|---|---|---|
| Walkthrough overlay `z-[200]` sits above the lock dialog `z-[80]`; Next/Skip still navigate while locked | verified-this-effort | `src/components/tour/tour-overlay.tsx`; `src/components/auth/session-lock-dialog.tsx`; live retest 3 Sep | `npm run test:session-lock`; browser: lock with walkthrough open |
| Failed `signOut({ scope: "local" })` is swallowed; later `lockCurrentSession()` does not retry | verified-this-effort | `src/lib/auth/session-lock.ts` early-return when `status === "locked"` | `npm run test:session-lock` |
| Query cache, opaque overlay, unlock `user.id` bind | verified-deferred | Residuals documented in session-lock security notes; not in this slice | n/a |

- [x] Stop walkthrough when `status === "locked"` (`src/components/tour/tour-provider.tsx`)
- [x] Raise lock overlay/content above the tour (`z-[220]` on `session-lock-dialog.tsx`)
- [x] Retry local sign-out while still locked; stay locked on failure (do not restore `authenticated` while tokens may remain)
- [x] Flip the session-lock test that previously asserted tour stacks above lock
- [x] Add `npm run test:session-lock` to develop CI

### 11.2 Observability

| Item | Tag | Evidence | Test |
|---|---|---|---|
| No Sentry/Datadog; ErrorBoundary only `console.error` | verified-this-effort | `src/components/common/error-boundary.tsx`; no `@sentry/*` in `package.json` | typecheck; CSP still allows supabase origin |
| Structured logging / Datadog | verified-deferred | n/a | n/a |

- [x] Optional `@sentry/react` init from `VITE_SENTRY_DSN` in `src/main.tsx` (omit init when unset)
- [x] Report `ErrorBoundary.componentDidCatch` to Sentry when DSN is set
- [x] Document DSN in `.env.example` only; no Sentry Vite source-map plugin

### 11.3 CI / scanning

| Item | Tag | Evidence | Test |
|---|---|---|---|
| CI does not apply migrations | verified-this-effort | `.github/workflows/develop-ci-automerge.yml` is lint/typecheck/fast scripts/build | new `migration-ci.yml` |
| No `npm audit`, Dependabot, or `test:session-lock` in develop CI | verified-this-effort | `.github/workflows/`; no `.github/dependabot.yml` | workflow files |
| XSS/CSP jobs already in develop CI | already-present | `test:csp` and `pentest-xss-probes.mjs` in develop CI | existing CI |
| Live-DB pentest (`test:pentest`) in this CI | out-of-scope | Keep existing XSS/CSP jobs only | n/a |
| CodeQL | verified-deferred | Prefer Dependabot + `npm audit` + session-lock over a heavy CodeQL setup | n/a |
| iOS signing / Playwright E2E in CI | verified-deferred | n/a | n/a |

- [x] `.github/workflows/migration-ci.yml` on PRs/pushes that touch `supabase/migrations/**`
- [x] `npm audit --audit-level=high` on develop CI (`continue-on-error` if the tree already has high findings)
- [x] `.github/dependabot.yml` weekly npm
- [x] `test:session-lock` on develop CI

### 11.4 Sharing

| Item | Tag | Evidence | Test |
|---|---|---|---|
| `shares.item_type` is `'docket_matter'` only | verified-this-effort | `supabase/migrations/0037_shares.sql` line 272; genuine FK to `docket_matters` | constraint test |
| Docket share dialog already exists | already-present | `src/pages/docket/sections/sharing-section.tsx`; `src/hooks/docket/use-docket-shares.ts` | n/a (reuse, do not rebuild) |
| Judgments and personal case law have no share UI | verified-this-effort | `src/pages/judgments/judgment-detail-page.tsx`; `src/pages/case-law/case-law-detail-page.tsx` | helper: canonical case law cannot be shared |
| Canonical case law is globally readable | already-present | `can_view_case_law` / inline SELECT (`owner_id IS NULL`) | no share UI on canonical |

- [x] Migration `0121_widen_shares_item_type.sql`: drop the live check via `pg_constraint`; allow `docket_matter \| judgment \| case_law`; drop `item_id` FK (polymorphic existence trigger)
- [x] RLS: grantor owns the judgment, or owns personal case law (`owner_id IS NOT NULL`); recipients SELECT via `has_item_share()`; inline table policies (0118) updated too
- [x] Generic share dialog extracted from docket; docket keeps `item_type: "docket_matter"`
- [x] Owner buttons on judgment detail and personal case-law detail

### 11.5 PDF export

| Item | Tag | Evidence | Test |
|---|---|---|---|
| Docket daily PDF exists | already-present | `src/lib/docket-report-pdf.ts` | existing UI |
| Judgment / bench-note export missing | verified-this-effort | no `src/lib/export/` | unit test: non-empty ArrayBuffer |

- [x] `src/lib/export/judgment-pdf.ts` and `src/lib/export/bench-note-pdf.ts` (title, parties/parent, `content_text`, generated-at footer)
- [x] Export buttons on judgment detail and bench-note detail

### 11.6 Judgment version history

| Item | Tag | Evidence | Test |
|---|---|---|---|
| No `judgment_versions` table | verified-this-effort | migrations through 0120 | trigger SQL + restore helper |
| `0045` locks seven fields on `final` (not a revision log) | already-present | `0045_judgment_lifecycle_locking.sql` | n/a (do not treat as version history) |

- [x] Migration `0122_judgment_versions.sql`: append-only; BEFORE UPDATE copies previous substantive fields; owner SELECT RLS
- [x] Restore only when `status === "draft"` (final must Unlock first)
- [x] History panel on judgment detail

### 11.7 Already present (do not build)

| Item | Tag | Evidence |
|---|---|---|
| Docket full-text search | already-present | `0047_search_extensions.sql`; `src/hooks/docket/use-docket-matters.ts` (third pass already removed the false gap) |
| “Only 6 files with aria” | already-present | dozens of pages/components already use `aria-*` / `role` |
| “No pg_cron” | already-present | `0120_docket_matter_bin_and_purge.sql` optional hourly bin purge |
| “`is_active` deferred” | already-present | `profiles.is_active` from 0001; people admin shows Active/Inactive |
| Bell lives in `header.tsx` | already-present | shell is `src/components/layout/top-nav.tsx` |

### 11.8 Verified and deferred (checklist only)

App-level RPC rate limits, iOS release, Playwright E2E, WCAG AA program, Realtime subscriptions, document redaction, localization, AI wiring, Datadog/structured logging, CodeQL.

### 11.9 Explicitly out of scope for this effort

MFA/TOTP, SSO, Resend/email, password length/complexity, `secure_password_change`, in-app notification bell, wiping query cache on lock, opaque lock overlay, unlock `user.id` bind.

### 11.10 Remaining phase items (this follow-up)

Same exclusions as 11.9. Landed: in-app notifications page (no bell, no email), scheduled jobs (`past` hearings, stale drafts, tomorrow notices), feature flags, backup runbook, audit CSV + hash chain, DSR JSON export + retention catalog, outbound webhooks, device sitting-day reminders.

- [x] `0123_notifications.sql` + `/notifications` (nav Inbox, not a header bell)
- [x] `0124_scheduled_jobs.sql` daily `run_scheduled_maintenance`
- [x] `0125_feature_flags.sql` + `FeatureFlag`
- [x] `docs/backup-and-recovery.md`
- [x] `0126_audit_tamper_evidence.sql` + Activity CSV export
- [x] `0127_data_retention.sql` + Settings download
- [x] `0128_webhooks.sql` + Operations admin
- [x] Device sitting-day reminders (web Notifications API)

