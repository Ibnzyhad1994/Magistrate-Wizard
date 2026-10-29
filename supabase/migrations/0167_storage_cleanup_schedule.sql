-- Magistrate Wizard -- 0167: the storage-cleanup queue drains on a schedule
--
-- Problem (backend sweep BE-07)
--   0165 queues the file of every deleted `documents` row in
--   storage_cleanup_queue, and the storage-cleanup Edge Function removes
--   queued files through the Storage API. The only caller of that function
--   was the app, straight after a user's own delete. The hourly
--   purge_expired_docket_matters() job (0120, 0161) and any other
--   database-side delete queue files too, and nothing asked for a run after
--   them: the court documents of a matter purged from the bin stayed in
--   Storage until someone happened to delete something else in the app.
--   The function also took the oldest 100 rows with no attempts cap, so
--   100 rows that always fail would block every later file for good.
--
-- Change
--   1. storage_cleanup_queue gains next_attempt_at (when a row is next due)
--      and dead_lettered_at (set by the function once a row has failed
--      too many times; such a row is no longer retried). The function takes
--      only due, live rows, oldest due first, and backs off after a failure,
--      so failing rows cannot starve the rest of the queue.
--   2. request_storage_cleanup_run() asks the storage-cleanup function for
--      one run through pg_net, but only when a due row is waiting, so an
--      empty queue costs one index probe a minute. It reads the project URL
--      and the service-role key from Vault (`project_url`,
--      `service_role_key`, the names Supabase's scheduling guide uses) and
--      does nothing while pg_net or either secret is missing, so this file
--      is safe to apply before an operator has configured them.
--   3. pg_cron runs it every minute (skipped quietly where pg_cron is not
--      available, as 0120 and 0124 do).
--
-- This file does not enable pg_net. On a project where it is off, the
-- operator enables it and adds the two Vault secrets; until then the queue
-- behaves exactly as before (drained by the app after a user's delete).
--
-- Threat model
--   request_storage_cleanup_run() is SECURITY DEFINER because it reads
--   vault.decrypted_secrets and storage_cleanup_queue, neither of which a
--   client role may touch. It takes no input, returns only the pg_net
--   request id, and is executable by no client role: only pg_cron (as the
--   job owner) and the service role run it. The secret leaves the database
--   only as the Authorization header of a request to this project's own
--   Edge Functions URL. A run can only remove files that no `documents`
--   row references (the storage-cleanup function re-checks each one), so a
--   run nobody asked for removes nothing a user still has.
-- ============================================================================

-- ==================== 1. due and dead-lettered rows ====================

alter table public.storage_cleanup_queue
  add column next_attempt_at timestamptz not null default now(),
  add column dead_lettered_at timestamptz;

comment on column public.storage_cleanup_queue.next_attempt_at is
  'When the storage-cleanup function next takes this row (0167). now() when queued; pushed back after each failed removal.';
comment on column public.storage_cleanup_queue.dead_lettered_at is
  'Set by the storage-cleanup function when the row has failed too many times (0167). A dead-lettered row is kept for an operator and never retried automatically.';

create index storage_cleanup_queue_due_idx
  on public.storage_cleanup_queue (next_attempt_at)
  where dead_lettered_at is null;

-- ==================== 2. ask the function for a run ====================

create or replace function public.request_storage_cleanup_run()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  if not exists (
    select 1
    from public.storage_cleanup_queue q
    where q.dead_lettered_at is null
      and q.next_attempt_at <= now()
  ) then
    return null;
  end if;

  if to_regnamespace('net') is null or to_regnamespace('vault') is null then
    return null;
  end if;

  select s.decrypted_secret into v_url
  from vault.decrypted_secrets s
  where s.name = 'project_url';
  select s.decrypted_secret into v_key
  from vault.decrypted_secrets s
  where s.name = 'service_role_key';
  if nullif(btrim(coalesce(v_url, '')), '') is null
     or nullif(btrim(coalesce(v_key, '')), '') is null then
    return null;
  end if;

  return net.http_post(
    url := rtrim(btrim(v_url), '/') || '/functions/v1/storage-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || btrim(v_key),
      'apikey', btrim(v_key)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

comment on function public.request_storage_cleanup_run() is
  'Asks the storage-cleanup Edge Function for one run through pg_net when a due, live storage_cleanup_queue row is waiting (0167). Reads project_url and service_role_key from Vault; returns null and sends nothing while pg_net or either secret is missing. Run every minute by pg_cron. SECURITY DEFINER: reads Vault and the queue; executable by no client role.';

revoke all on function public.request_storage_cleanup_run() from public, anon, authenticated;
grant execute on function public.request_storage_cleanup_run() to service_role;

-- ==================== 3. every minute (skip quietly without pg_cron) ====================

do $cron$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'magistrate-wizard-storage-cleanup';
  perform cron.schedule(
    'magistrate-wizard-storage-cleanup',
    '* * * * *',
    'select public.request_storage_cleanup_run()'
  );
exception
  when others then
    raise notice 'pg_cron not scheduled for storage cleanup: %', sqlerrm;
end;
$cron$;
