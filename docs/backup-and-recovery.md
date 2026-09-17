# Backup and disaster recovery

Magistrate Wizard stores application data in Supabase Postgres (with
Storage buckets for documents and avatars). This runbook is the restore
path. It does not replace platform backups.

## What Supabase already keeps

Hosted projects include daily backups and, on eligible plans, point-in-time
recovery (PITR). Confirm the current retention window in the Supabase
Dashboard under **Project Settings → Database → Backups** before you need
it.

Local `supabase start` is not a backup. Dump it if you care about a
developer database:

```bash
npx supabase db dump --local -f backups/local-$(date +%Y%m%d).sql
```

## Restore a hosted project (PITR)

1. Put the app in a maintenance window (pause writes if you can).
2. In the Dashboard, open **Backups** and choose the recovery timestamp.
3. Restore to a **new** project first when the blast radius is high.
4. Point a preview environment at the restored project and check:
   - login for `admin` and a magistrate
   - docket list and one matter
   - a judgment with version history
   - Storage download of one document
5. Only then cut DNS / `VITE_SUPABASE_URL` to the restored project.

## Restore from a SQL dump

```bash
psql "$DATABASE_URL" -f backups/local-YYYYMMDD.sql
```

Do not restore a dump onto production unless you intend to replace it.
Prefer restoring into an empty database and swapping projects.

## Storage

SQL dumps do not include Storage objects. Document files live in the
`documents` and `avatars` buckets. After a database-only restore, signed
URLs will 404 until the matching objects are copied back.

## What this app does not do

There is no application-level nightly dump into a second bucket in this
slice. Hash-chained `audit_log` rows prove whether the ledger was rewritten
after insert; they are not a substitute for backups.

## Rollback

Production only moves forward. There are three layers and each rolls back
differently:

- **Frontend (Vercel).** Open the Vercel project → Deployments, pick the
  last known-good Production deployment and **Promote to Production**
  (`vercel promote <deployment-url>` from the CLI does the same). This is
  instant and does not touch the database. Then fix forward on `develop`;
  the next green develop run fast-forwards `main` and redeploys.
- **Database (migrations).** Migrations are forward-only
  (`DEVELOPMENT_WORKFLOW.md`): an applied migration is never reverted or
  edited. A bad migration is fixed by a **new forward migration** that
  repairs it, taken through the same 13-stage workflow and applied by
  `deploy-db.yml` (or `supabase db push`). If the frontend cannot run
  against the current schema, promote the previous Vercel deployment first
  so users are on a build that matches. Restoring a PITR snapshot is the
  last resort and loses every write after the timestamp.
- **Edge functions.** Redeploy the previous version:
  `git checkout <previous-tag-or-sha> -- supabase/functions && supabase functions deploy <name>`
  from a linked checkout, or run `deploy-db.yml` manually from the
  previous commit via workflow_dispatch on a branch that carries it.

Record what was rolled back and why in the "develop CI failing" issue (if
open) or a new issue, so the forward fix has a trail.

## Restore drills

Run a restore drill **quarterly**: restore the latest backup (or a PITR
point) into a scratch project, point a preview environment at it, and walk
the checklist under "Restore a hosted project". Note the wall-clock time it
took and the age of the newest row recovered; those two numbers are the
measured RTO and RPO below. File the result as an issue titled
`Restore drill YYYY-QN`.

## RTO / RPO

| Objective                                    | Target                                                                         | Measured (last drill) |
| -------------------------------------------- | ------------------------------------------------------------------------------ | --------------------- |
| RTO (time to a working app on restored data) | **TBC** — proposed 4 hours                                                     | not yet measured      |
| RPO (maximum data loss)                      | **TBC** — PITR granularity if enabled, otherwise the daily backup (up to 24 h) | not yet measured      |

Confirm whether PITR is enabled on the production project (Dashboard →
Project Settings → Database → Backups) and replace the placeholders after
the first drill. Storage objects are not covered by PITR: see "Storage".

## Related jobs

- Docket bin purge: `purge_expired_docket_matters` (hourly when `pg_cron` exists).
- Daily maintenance: `run_scheduled_maintenance` (past hearings, stale-draft
  notices, tomorrow hearing notices, notification retention). It does not
  send email.
