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

## Related jobs

- Docket bin purge: `purge_expired_docket_matters` (hourly when `pg_cron` exists).
- Daily maintenance: `run_scheduled_maintenance` (past hearings, stale-draft
  notices, tomorrow hearing notices, notification retention). It does not
  send email.
