# Magistrate Wizard — Supabase backend

Everything under `supabase/migrations/` is the backend: schema, RLS,
functions, triggers, Storage buckets and policies, search, scheduled
jobs. Migrations are numbered `NNNN_description.sql`, applied in filename
order, and **forward-only** — an applied migration is never edited; a
defect is fixed by a new migration. Numbering is sequential with two
documented gaps (`0049`, `0140`). `ls supabase/migrations` is the
authoritative list; do not maintain a table of them here.

Every table has RLS enabled from the migration that creates it — there is
no window where a table exists without policies. Every function pins
`search_path`. The security and privacy invariants the policies encode are
recorded in `docs/adr/` and `DEVELOPMENT_WORKFLOW.md`; do not weaken them
"because a helper would be simpler".

`supabase/functions/` holds the two edge functions (`clerk-access-notify`,
`webhook-dispatch`). `supabase/seed.sql` is the synthetic local seed
(never real user content).

## Local development loop

```bash
npm run db:start      # docker: API on 127.0.0.1:56321 (see config.toml for the other ports)
npm run db:status     # prints the anon/service keys for .env
npm run db:reset      # drops, re-applies every migration, loads seed.sql
npm run dev           # Vite on 127.0.0.1:5373
npm run db:stop
```

`.env` needs `VITE_SUPABASE_URL=http://127.0.0.1:56321` and the anon key
from `db:status` (copy `.env.example`). Android emulators reach the host
as `http://10.0.2.2:56321`.

After the schema changes, regenerate the frontend types:

```bash
npm run supabase:types    # writes src/types/database.types.ts from the LOCAL schema
```

That file is pure generator output; hand-written aliases live in
`src/types/db-aliases.ts`, so regenerating is always safe.

Live-database tests (`npm run test:live`) run against this local stack and
refuse a remote host unless `ALLOW_REMOTE_SUPABASE=1` is set.

## Adding a migration

This mirrors the "Database change workflow" in `DEVELOPMENT_WORKFLOW.md`;
the PR template repeats it as a checklist. Stages are not skipped to save
time.

1. **Inspect live first.** Confirm the current schema, RLS, functions and
   triggers on the environment you are changing (`supabase db diff`, the
   Dashboard, or `list_migrations`) — do not assume from local files.
2. **Number it.** Next unused number, one number per file, reconciled
   against live migration history. Renumbering an *unapplied* migration is
   fine; renaming or editing an applied one never is.
3. **Design and threat-model it.** Who can read/write what afterwards? Any
   new `SECURITY DEFINER` function needs an explicit note: why DEFINER,
   fixed `search_path`, EXECUTE grants, what it exposes.
4. **Pretest locally.** `npm run db:reset` must apply cleanly from 0001.
   Run the behavioural pretest with disposable fixtures only — never the
   real admin profile. Migration CI does the same apply on every develop
   push.
5. **Review / approve**, then **apply** (`supabase db push` against the
   linked project, or `deploy-db.yml` for production from `main`).
6. **Verify live**: structure, behavioural regression (RLS/privacy changes
   get a rollback-only pass), Supabase advisors (security + performance) —
   call out any *new* finding explicitly.
7. **Update the architecture spec** (`docs/architecture/`), regenerate types,
   add the `CHANGELOG.md` line, commit the migration + spec + related docs
   together. Frontend changes go in a separate commit where practical.
8. **Never commit an unapplied migration to `main` as if it were live.**
   `main` must always reconstruct what is actually on production.

## Hosted projects

```bash
npm install -g supabase        # or use npx
supabase login
supabase link --project-ref <project-ref>
supabase db push --dry-run     # shows exactly what would apply
supabase db push               # applies every pending migration, in order
supabase functions deploy clerk-access-notify
supabase functions deploy webhook-dispatch
```

`<project-ref>` is the id in `https://<project-ref>.supabase.co`. The
production and develop-preview refs, and which branch feeds which, are in
`docs/environments.md`. On `main`, `.github/workflows/deploy-db.yml` runs
the same commands inside the `production` GitHub Environment.

## After the first migration run on a new project

1. **Promote your own account to admin.** Every new signup defaults to
   `role = 'magistrate'`. Sign up once through the app, then in the SQL
   editor:

   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```

   Admins are the only role that can write to `courts` and the curated
   legal library, approve court and clerk access requests, and read the
   audit log.

2. **Create at least one court** (Admin → Courts, or SQL):

   ```sql
   insert into public.courts (name, jurisdiction) values ('Georgetown Magistrates Court', 'Demerara');
   ```

   Magistrates then request a sitting from `/court-assignments` and an
   admin approves it from `/admin/court-assignments`. A magistrate without
   an approved court cannot open the docket or the library.

3. **Confirm the Storage buckets exist.** Dashboard → Storage should show
   `documents` (private) and `avatars` (public). The migrations create them
   with `on conflict do nothing`; this step is just to verify.

4. **Set Auth URLs.** Dashboard → Authentication → URL Configuration:
   Site URL → the deployed origin (or `http://127.0.0.1:5373` locally);
   add the same origin to Redirect URLs — `resetPasswordForEmail` depends on
   it for the forgot-password flow.

5. **Edge function secrets** (`supabase secrets set ...`): see the
   "Clerk access notifications" block in `.env.example`. Both functions
   no-op with a log line when unconfigured.

6. **Point the frontend at the project**: `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` in `.env` (local) or the Vercel project
   settings (hosted).

## Design notes worth knowing before you build on this

- **Court-anchored access.** Docket matter access is the three-path
  predicate: current court assignment OR retained assignment OR an active
  share. Judgments are owner-or-`is_discoverable`; bench notes are
  author-only; quick codes are owner-only with no admin bypass. Case law
  has canonical (`owner_id IS NULL`) and personal rows, and personal rows
  are private. Association tables are deliberately asymmetric
  (`docket_matter_case_law` vs `quick_code_docket_matters`).
- **`ON DELETE RESTRICT` on judicial content.** You cannot delete an auth
  user who has authored matters, judgments, notes or documents. Deactivate
  via `profiles.is_active = false` instead.
- **Curated library.** `statutes`, `case_law` (canonical), `legal_sources`
  and the taxonomy tables are shared across courts and writable only by
  admins; ingestion goes through `import_batches` / `import_jobs`.
- **Full-text search** uses generated `tsvector` columns with GIN indexes.
  Query through the search RPCs, not `search_vector` directly.
- **Audit log is admin-read, append-only and hash-chained.** Rows come only
  from the trigger function; nothing can update or delete them.
- **Scheduled jobs** (`pg_cron` where available): hourly docket bin purge,
  daily `run_scheduled_maintenance`. See `docs/backup-and-recovery.md`.
