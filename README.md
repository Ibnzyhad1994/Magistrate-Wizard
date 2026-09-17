# Magistrate Wizard

[![Develop CI](https://github.com/Ibnzyhad1994/Magistrate-Wizard/actions/workflows/develop-ci-automerge.yml/badge.svg?branch=develop)](https://github.com/Ibnzyhad1994/Magistrate-Wizard/actions/workflows/develop-ci-automerge.yml)

A legal knowledge management platform for magistrates: a court-anchored
docket (matters, parties, hearings, callovers, capacity), judgments with
version history, bench notes, a curated legal library (legislation and case
law with OCR ingestion), quick codes, sharing, notifications, Google
Calendar mirroring, and native shells for Android, iOS and Windows around
the same React build. Backend is Supabase (Postgres, RLS, Storage, edge
functions).

## Stack

React 18 · Vite · TypeScript · Tailwind CSS · shadcn/ui · React Router v6 ·
TanStack Query · Zustand · React Hook Form · Zod · Supabase · TipTap ·
pdf.js · Tesseract · Capacitor · Electron · Playwright

Node 24 and npm 11 (`engines` in `package.json`, `.nvmrc`).

## Getting started

```bash
npm install            # also installs the husky git hooks
cp .env.example .env   # local Supabase URL + anon key (see below)
npm run db:start       # local Supabase (Docker) on 127.0.0.1:56321
npm run db:reset       # apply every migration + the synthetic seed
npm run dev            # http://127.0.0.1:5373
```

The backend walkthrough (local loop, hosted projects, adding a migration,
one-time admin/court setup) is in **`supabase/README.md`**. Environments
(production, develop preview, local) are tabulated in
**`docs/environments.md`**. The permanent working rules — migration
integrity, the database change workflow, git safety, secrets, the security
and privacy invariants — are in **`DEVELOPMENT_WORKFLOW.md`**; the
invariants are also recorded one per file under **`docs/adr/`**.

Other scripts: `npm run build`, `npm run lint`, `npm run typecheck`,
`npm run format`, `npm run supabase:types`.

`npm run supabase:types` regenerates `src/types/database.types.ts` from the
running local schema. That file is **pure generator output** and safe to
overwrite: every hand-written alias (`Profile`, `DocketMatter`, …) lives in
`src/types/db-aliases.ts` and is re-exported, together with the generated
helpers, from `@/types`. Import from `@/types`, not from
`@/types/database.types`.

Native Android/iOS (Capacitor) and Windows (Electron) wrap the same `dist/`
build. Google Calendar sync, versioning and the release flow are in
**`docs/native-and-calendar.md`**.

## Running tests

| Command               | What it runs                                                                                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`            | Every `scripts/tests/test-*.mjs` (plus the XSS probes and the propose-tags comparison) that needs no database, each in its own Node process with the `@/` alias loader. This is the CI gate.                                |
| `npm run test:live`   | The same, plus scripts tagged `// @live-db` — they open a real Supabase connection (local Docker by default; `assertLocalSupabase` refuses a remote host unless `ALLOW_REMOTE_SUPABASE=1`). Start `npm run db:start` first. |
| `npm run test:slow`   | Adds the scripts tagged `// @slow` (brutal ingest circuit, slow-system OCR, persona simulations, stress audit).                                                                                                             |
| `npm run test:e2e`    | Playwright smokes (`e2e/`). `test:e2e:unauth` needs only Vite; `test:e2e:auth` needs local Supabase and the seed admin.                                                                                                     |
| `npm run test:<name>` | One script. Every file has an alias (`npm run` lists them); the runner also takes `--filter <substr>`, `--jobs <n>`, `--verbose`, `--list`.                                                                                 |

Adding a test: drop a `test-<name>.mjs` in `scripts/tests/`, tag it
`// @live-db` or `// @slow` in the first 20 lines if applicable, and it is
discovered automatically. Add an npm alias too so it can be run by name.
The runner is `scripts/test-support/run-all.mjs`.

## CI/CD

| Workflow                                                             | Trigger                                                                             | Gates                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `develop-ci-automerge.yml`                                           | push to `develop`                                                                   | `npm audit` (critical), lint, typecheck, `npm test`, schema-alignment (repo half), build, then the Playwright smokes (reused from `e2e.yml`). All green → `main` is fast-forwarded to `develop`, which is the production Vercel deploy. Any failure opens or updates the issue **"develop CI failing"**; the next green run closes it. |
| `e2e.yml`                                                            | pull requests, and called by the develop gate                                       | Playwright unauth + auth smokes.                                                                                                                                                                                                                                                                                                       |
| `migration-ci.yml`                                                   | every push to `develop`; PRs touching `supabase/**`                                 | Applies every migration to a fresh local Postgres.                                                                                                                                                                                                                                                                                     |
| `schema-alignment.yml`                                               | PRs, develop pushes                                                                 | Read-only: git migrations unique and hosted preview/prod not behind. Never blocks the merge.                                                                                                                                                                                                                                           |
| `main-drift.yml`                                                     | daily, manual                                                                       | Fails (and comments on the CI issue) when `main` trails `develop` by more than 3 commits.                                                                                                                                                                                                                                              |
| `deploy-db.yml`                                                      | push to `main` touching `supabase/migrations/**` or `supabase/functions/**`; manual | `db push --dry-run` → `db push` → edge function deploys, inside the `production` GitHub Environment (configure required reviewers in repo settings).                                                                                                                                                                                   |
| `smoke-prod.yml`                                                     | successful Production deployment, daily, manual                                     | `GET /login` is 200 and sends CSP + HSTS.                                                                                                                                                                                                                                                                                              |
| `codeql.yml`                                                         | pushes/PRs on develop and main                                                      | Static analysis.                                                                                                                                                                                                                                                                                                                       |
| `release-android.yml`, `release-electron.yml`, `build-check-ios.yml` | `v*` tags                                                                           | APK (attached to a GitHub Release only when signed), unsigned NSIS installer artifact, iOS compile check.                                                                                                                                                                                                                              |

Local hooks (husky): `pre-commit` runs lint-staged (ESLint at zero warnings
and Prettier on staged files), `pre-push` runs `npm run typecheck`.

`vercel.json` is generated: `npm run csp:sync` writes the full hashed CSP,
HSTS and cache headers from `scripts/content-security-policy.ts` and
`index.html`; `npm test` fails if it is out of sync.

## Architecture

```
src/
  App.tsx                  Composition root: AppProviders + RouterProvider
  main.tsx                 React DOM entry
  providers/               Theme, TanStack Query client, auth bootstrap
  store/                   Zustand: auth-store (session/profile), ui-store
  routes/                  router.tsx (lazy route tree), paths.ts (ROUTES), guards
  layouts/                 app-layout (sidebar + header), auth-layout
  components/
    ui/                    shadcn/ui primitives
    common/                Error boundary, loaders, document viewer, link dialog, route announcer
    layout/                Sidebar, header, mobile nav, nav-config, user menu
    browse/  dashboard/    Browse-page shell; dashboard widgets
    admin/  auth/  brand/  feedback/  legal-library/  legislation/
    notifications/  sharing/  theme/  tour/
  hooks/                   TanStack Query hooks, one folder per feature:
                           admin/ bench-notes/ bookmarks/ case-law/ clerk/ docket/
                           google-calendar/ judgments/ legal-library/ legislation/
                           offline/ quick-codes/ search/ shares/
                           + use-auth, use-dashboard, use-notifications, use-page-title, ...
  pages/                   One folder per feature (a page imports only its own folder):
                           admin/ auth/ bench-notes/ bookmarks/ calendar/ case-law/ clerk/
                           court-assignments/ docket/ judgments/ legislation/ notifications/
                           quick-codes/ search/ settings/
                           + home-page, dashboard-page, not-found-page, unauthorized-page
  lib/                     Framework-free domain logic; what scripts/tests exercise directly.
                           Must not import components/hooks/pages (ESLint enforces it).
                           docket-*, callover, dashboard-insights, extraction-pipeline, ocr/,
                           legal-extraction, redaction*, export/, offline/, google-calendar/,
                           html-sanitize, validations/ (zod), supabase.ts, query-client.ts, utils.ts
  types/
    database.types.ts      Generated by `npm run supabase:types` — never edit
    db-aliases.ts          Hand-written row aliases (Profile, DocketMatter, ...)
    index.ts               Re-exports both + app types (NavItem, ApiError)

supabase/
  migrations/              Forward-only SQL, 0001–0153 at the time of writing
                           (0049 and 0140 were never used) — see supabase/README.md
  functions/               Edge functions: clerk-access-notify, webhook-dispatch
  seed.sql                 Synthetic local seed (personas, courts, sample matters)

scripts/
  tests/                   Script-based regression suite (plain Node) — `npm test`
  test-support/            run-all.mjs runner, `@/` alias loader, fixtures, Supabase stub
  content-security-policy.ts, sync-vercel-csp.mjs, native-*.mjs, seed-legal-library/

e2e/                       Playwright smokes
electron/  android/  ios/  Native shells around dist/
docs/                      Runbooks, architecture spec + addenda, ADRs, audits, layman guides
```

### Auth flow

`AuthProvider` calls `supabase.auth.getSession()` on mount, subscribes to
`onAuthStateChange` for the app's lifetime, and writes the session/profile
into `useAuthStore`. `ProtectedRoute` and `PublicRoute` read that store to
gate the router tree; `requireApprovedMagistrateCourt` additionally keeps a
magistrate without an approved court on `/court-assignments`. `useAuth()` is
the mutation surface (sign in/up/out, password reset).

### Data model

`profiles` (1:1 with `auth.users`, auto-provisioned on signup, `role` of
magistrate / clerk / admin) sits at the centre. A magistrate sits a court
through `magistrate_courts` (requested and approved via
`magistrate_court_requests`); clerks are attached through `clerk_courts`
and `clerk_access_requests`. `docket_matters` (+ parties, events, tags,
assignments, callovers, capacity settings) are the primary work unit and
are court-anchored: access is the three-path predicate (current court
assignment OR retained assignment OR active share). `judgments` (owner-or-
discoverable, with `judgment_versions`), `bench_notes` (author-only),
`quick_codes` (owner-only) and `shares` hang off those. The legal library
(`statutes`, `statute_provisions`, `case_law`, `legal_sources`, taxonomy
tables, `import_batches`/`import_jobs`) is admin-curated; case law
distinguishes canonical (`owner_id IS NULL`) from personal rows.
`notifications`, `audit_log` (hash-chained, append-only) and
`auth_event_log` round it out. Every table has RLS from the migration that
creates it. The invariants behind these rules are in `docs/adr/`.

### Conventions

- Path alias `@/*` maps to `src/*` (`vite.config.ts`, `tsconfig.app.json`,
  and `scripts/test-support/at-alias-loader.mjs` for the script tests).
- Route paths live in `src/routes/paths.ts` — never hardcode a path string.
- Query/mutation errors surface globally as toasts (`src/lib/query-client.ts`);
  opt out per-call with `meta: { silent: true }`.
- Role checks use the `UserRole` union in `src/lib/constants.ts`, which
  mirrors the `user_role` Postgres enum.
- Layering is enforced by ESLint: `src/lib` imports no React layer; a page
  imports only its own feature folder.
- British spelling in user-facing copy and docs.
- Prettier (`.prettierrc.json`): semicolons, double quotes, trailing commas,
  100 columns. Run `npm run format` in its own commit, never mixed with logic.
