# Environments

Where each copy of Magistrate Wizard runs, which database it talks to, and
how it gets updated. Compiled from `docs/develop-preview-followup.md`
(31 Aug 2026 check) and the workflows under `.github/workflows/`. Items
marked _unverified_ could not be confirmed from the repository alone —
check the Vercel and Supabase dashboards.

| Environment             | Web host                                                          | Vercel project / team                                         | Supabase project                                                                                               | Git branch     | Who deploys                                                                                                                 | How                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Production**          | `https://magistrate-wizard.vercel.app`                            | `magistrate-wizard` (team _unverified_; not `teriq-projects`) | `gipijpeahkznfwitjccy.supabase.co`                                                                             | `main`         | Nobody by hand: `develop-ci-automerge.yml` fast-forwards `main` when develop is green; Vercel Git integration builds `main` | Frontend: Vercel on push to `main`. Database and edge functions: `deploy-db.yml` on push to `main` touching `supabase/**` (inside the `production` GitHub Environment, required reviewers to be configured in repo settings). Before that workflow existed: manual `supabase db push` / `functions deploy`. |
| **Develop preview**     | `https://magistrate-wizard-git-develop-teriq-projects.vercel.app` | `magistrate-wizard` on team `teriq-projects`                  | `kmfjejfsbtvbhvpoxvhb.supabase.co`                                                                             | `develop`      | Vercel Git integration on push to `develop` (was found serving a stale bundle; confirm the built SHA after each push)       | Frontend: Vercel. Database: manual `supabase link --project-ref kmfjejfsbtvbhvpoxvhb && supabase db push`; `schema-alignment.yml` reports (read-only) when it lags git.                                                                                                                                     |
| **Local**               | `http://127.0.0.1:5373` (`npm run dev`)                           | —                                                             | Docker via `npm run db:start`, API `http://127.0.0.1:56321` (Android emulator: `http://10.0.2.2:56321`)        | any            | You                                                                                                                         | `npm run db:reset` applies every migration + `supabase/seed.sql`; `npm run test:live` and the Playwright auth smokes run here.                                                                                                                                                                              |
| **CI (GitHub Actions)** | Vite dev server on the runner                                     | —                                                             | Fresh `supabase start` per job (`e2e.yml`, `migration-ci.yml`); no hosted database                             | `develop`, PRs | Workflows                                                                                                                   | See the CI/CD table in `README.md`.                                                                                                                                                                                                                                                                         |
| **Native shells**       | Android APK / iOS (compile check only) / Windows NSIS             | —                                                             | Whatever `VITE_SUPABASE_URL` was at build time (release workflows use the repository secrets, i.e. production) | `v*` tags      | Whoever pushes the tag                                                                                                      | `release-android.yml`, `release-electron.yml`, `build-check-ios.yml`.                                                                                                                                                                                                                                       |

## Secrets and variables

| Name                                                                                                | Where                                                     | Used by                                                                   |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`                                                       | repo secrets; Vercel project env                          | build steps, Vercel builds                                                |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`                             | GitHub Environment `production`                           | `deploy-db.yml`                                                           |
| `SUPABASE_ACCESS_TOKEN`, `SCHEMA_ALIGN_PREVIEW_URL`, `SCHEMA_ALIGN_PREVIEW_ANON_KEY`                | repo secrets                                              | `schema-alignment.yml`                                                    |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | repo secrets (optional)                                   | `release-android.yml` — without them the APK is unsigned and not released |
| `PROD_URL`                                                                                          | repo variable (optional, defaults to the production host) | `smoke-prod.yml`                                                          |
| `VITE_SENTRY_DSN`, Google OAuth client ids                                                          | Vercel env / `.env.local`                                 | runtime                                                                   |

Only `VITE_*` values enter the browser bundle. Service-role keys are never
set anywhere the frontend or CI build can read them; live-database tests
read `SUPABASE_SERVICE_ROLE_KEY` from the local `.env` only.

## Rules of thumb

- Preview data is not production data: check assignments and requests on
  the project the Vercel env `VITE_SUPABASE_URL` points at.
- The local database must be reset (`npm run db:reset`) before debugging
  anything that depends on a recent migration; an old local stack is not
  evidence of a preview bug.
- Production only ever moves forward: Vercel can promote a previous
  deployment, migrations cannot be rolled back (see
  `docs/backup-and-recovery.md` → Rollback).
