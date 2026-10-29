-- Magistrate Wizard -- 0180: webhooks are delivered every minute, with the
-- real HTTP result recorded, retries with backoff and no starvation
--
-- Problem (backend sweep BE-06)
--   dispatch_pending_webhooks() (0128, 0156) was the only sender in use. It
--   ran once a day inside run_scheduled_maintenance() (0124), took 25 rows,
--   and marked each 'sent' as soon as pg_net had queued the request, so the
--   HTTP result was never read: integrations heard of an event up to a day
--   late, never once more than 25 a day queued up, and the Operations page
--   could not tell a delivery from a failure. The webhook-dispatch Edge
--   Function records the real result but nothing ever called it, and it
--   would have starved too: it took the oldest 25 pending rows, passed over
--   those of inactive endpoints and left them pending for ever. Neither had
--   a claim step, so overlapping runs could send a row twice, and pg_net
--   sent from the database host to any URL the loose LIKE check allowed
--   (`http://localhost@anywhere`, `http://localhost.example.com`).
--
-- Change
--   1. webhook_outbox gains next_attempt_at (when a row is next due),
--      locked_at (when a run claimed it), dead_lettered_at, last_attempt_at
--      and last_status_code, and two states: 'sending' (claimed by a run)
--      and 'skipped' (its endpoint was inactive when it fell due). 'failed'
--      now means dead-lettered after the last attempt; a failed attempt
--      before that puts the row back to 'pending' with a growing delay.
--   2. claim_webhook_deliveries(limit) marks due rows of inactive endpoints
--      'skipped', then moves up to `limit` due rows of active endpoints to
--      'sending' under FOR UPDATE SKIP LOCKED and returns them with their
--      endpoint's URL and secret. A row left 'sending' by a run that died
--      is due again after five minutes. Only the service role runs it.
--   3. request_edge_function_run(name) holds the Vault and pg_net plumbing
--      that 0167 wrote for the storage-cleanup function, so both scheduled
--      calls share it: it reads `project_url` and `service_role_key` from
--      Vault and posts to that project's Edge Function, and it sends
--      nothing and raises nothing while pg_net or either secret is missing.
--      request_storage_cleanup_run() is restated on it, unchanged in
--      behaviour.
--   4. request_webhook_dispatch_run() asks webhook-dispatch for a run when
--      a row is due, and pg_cron runs it every minute. The webhook-dispatch
--      function is now the only sender: dispatch_pending_webhooks() no
--      longer posts through pg_net and only asks for a run, so the daily
--      maintenance job keeps working unchanged.
--   5. retry_webhook_delivery() also makes the row due at once.
--   6. Endpoint URLs must be https, or plain http to localhost, 127.0.0.1
--      or host.docker.internal (the host as the local Edge Functions see
--      it), with no user info. The function applies the same rule before
--      every post, so a legacy row the constraint cannot reach is refused
--      too.
--
-- Operator step: none beyond 0167's (pg_net plus the two Vault secrets in
-- supabase/README.md "Scheduled Edge Function calls"). Until an operator
-- adds them, webhooks stay queued as 'pending' and nothing is sent.
--
-- Threat model
--   request_edge_function_run() and the two request_* functions are
--   SECURITY DEFINER because they read vault.decrypted_secrets and the
--   queues, which no client role may touch. They take no client input
--   (the function name comes only from these definitions and is checked
--   against a slug pattern), return only the pg_net request id, and are
--   executable by no client role. The service-role key leaves the
--   database only as the Authorization header of a request to this
--   project's own Edge Functions URL. claim_webhook_deliveries() is
--   SECURITY INVOKER and executable only by the service role, which
--   already reads both webhook tables; it returns endpoint secrets, so no
--   client role may run it. Rows and endpoints are still written only by
--   admins (RLS, 0128), so a run can only post what an admin registered.
-- ============================================================================

-- ==================== 1. delivery state on the outbox ====================

alter table public.webhook_outbox
  add column next_attempt_at timestamptz not null default now(),
  add column locked_at timestamptz,
  add column dead_lettered_at timestamptz,
  add column last_attempt_at timestamptz,
  add column last_status_code integer;

alter table public.webhook_outbox
  drop constraint if exists webhook_outbox_status_check;
alter table public.webhook_outbox
  add constraint webhook_outbox_status_check
  check (status in ('pending', 'sending', 'sent', 'delivered', 'failed', 'skipped'));

comment on column public.webhook_outbox.status is
  'pending = queued, due at next_attempt_at. sending = claimed by a webhook-dispatch run (locked_at). delivered = a 2xx was received. failed = dead-lettered after the last attempt, or a URL the delivery rule refuses; retry_webhook_delivery() re-queues it. skipped = the endpoint was inactive when the row fell due. sent = legacy (before 0180): handed to pg_net, HTTP result unknown.';
comment on column public.webhook_outbox.next_attempt_at is
  'When the row is next due (0180). now() when queued; pushed back after each failed attempt.';
comment on column public.webhook_outbox.locked_at is
  'When a webhook-dispatch run claimed the row (0180). A row still sending five minutes later is claimed again.';
comment on column public.webhook_outbox.dead_lettered_at is
  'When the row failed its last attempt (0180). Never retried automatically.';
comment on column public.webhook_outbox.last_attempt_at is
  'When the last delivery attempt finished (0180).';
comment on column public.webhook_outbox.last_status_code is
  'HTTP status of the last attempt (0180); null when no response came back.';

drop index if exists public.webhook_outbox_pending_idx;
create index webhook_outbox_due_idx
  on public.webhook_outbox (next_attempt_at)
  where status = 'pending';
create index webhook_outbox_sending_idx
  on public.webhook_outbox (locked_at)
  where status = 'sending';

-- ==================== 2. claim due rows ====================

create or replace function public.claim_webhook_deliveries(p_limit integer default 25)
returns table (
  id uuid,
  event text,
  payload jsonb,
  attempts integer,
  url text,
  secret text
)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  update public.webhook_outbox o
     set status = 'skipped',
         locked_at = null,
         last_error = 'Endpoint inactive when the delivery fell due'
    from public.webhook_endpoints e
   where e.id = o.endpoint_id
     and not e.active
     and (
       (o.status = 'pending' and o.next_attempt_at <= now())
       or (o.status = 'sending' and o.locked_at < now() - interval '5 minutes')
     );

  return query
  with due as (
    select o.id
    from public.webhook_outbox o
    join public.webhook_endpoints e on e.id = o.endpoint_id and e.active
    where (o.status = 'pending' and o.next_attempt_at <= now())
       or (o.status = 'sending' and o.locked_at < now() - interval '5 minutes')
    order by o.next_attempt_at, o.created_at
    limit v_limit
    for update of o skip locked
  ),
  claimed as (
    update public.webhook_outbox o
       set status = 'sending',
           locked_at = now()
      from due
     where o.id = due.id
    returning o.id, o.endpoint_id, o.event, o.payload, o.attempts
  )
  select c.id, c.event, c.payload, c.attempts, e.url, e.secret
  from claimed c
  join public.webhook_endpoints e on e.id = c.endpoint_id;
end;
$$;

comment on function public.claim_webhook_deliveries(integer) is
  'Called by the webhook-dispatch Edge Function (0180). Marks due rows of inactive endpoints skipped, then moves up to p_limit (1-100) due rows of active endpoints to sending under FOR UPDATE SKIP LOCKED and returns them with the endpoint URL and secret. A row sending for over five minutes is due again. Service role only.';

revoke all on function public.claim_webhook_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_webhook_deliveries(integer) to service_role;

-- ==================== 3. one way to ask an Edge Function for a run ====================

create or replace function public.request_edge_function_run(p_function text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  if p_function is null or p_function !~ '^[a-z0-9][a-z0-9-]*$' then
    raise exception 'Invalid Edge Function name';
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
    url := rtrim(btrim(v_url), '/') || '/functions/v1/' || p_function,
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

comment on function public.request_edge_function_run(text) is
  'Asks one of this project''s Edge Functions for a run through pg_net (0180). Reads project_url and service_role_key from Vault; returns null and sends nothing while pg_net or either secret is missing. Called only by the scheduled request_* functions. SECURITY DEFINER: reads Vault; executable by no client role.';

revoke all on function public.request_edge_function_run(text) from public, anon, authenticated;

-- Restated from 0167 on the shared helper; same behaviour.
create or replace function public.request_storage_cleanup_run()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.storage_cleanup_queue q
    where q.dead_lettered_at is null
      and q.next_attempt_at <= now()
  ) then
    return null;
  end if;

  return public.request_edge_function_run('storage-cleanup');
end;
$$;

revoke all on function public.request_storage_cleanup_run() from public, anon, authenticated;
grant execute on function public.request_storage_cleanup_run() to service_role;

-- ==================== 4. webhook-dispatch every minute ====================

create or replace function public.request_webhook_dispatch_run()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.webhook_outbox o
    where (o.status = 'pending' and o.next_attempt_at <= now())
       or (o.status = 'sending' and o.locked_at < now() - interval '5 minutes')
  ) then
    return null;
  end if;

  return public.request_edge_function_run('webhook-dispatch');
end;
$$;

comment on function public.request_webhook_dispatch_run() is
  'Asks the webhook-dispatch Edge Function for one run through pg_net when a webhook_outbox row is due (0180). Returns null and sends nothing while no row is due or pg_net or the Vault secrets are missing. Run every minute by pg_cron. SECURITY DEFINER: reads Vault and the outbox; executable by no client role.';

revoke all on function public.request_webhook_dispatch_run() from public, anon, authenticated;
grant execute on function public.request_webhook_dispatch_run() to service_role;

-- Re-declared from 0156. The pg_net send path is gone: the webhook-dispatch
-- function is the only sender. run_scheduled_maintenance() (0124) still
-- calls this, so it stays, and only asks for a run.
create or replace function public.dispatch_pending_webhooks()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.request_webhook_dispatch_run() is null then
    return 0;
  end if;
  return 1;
end;
$$;

comment on function public.dispatch_pending_webhooks() is
  'Asks the webhook-dispatch Edge Function for a run when a row is due (0180); returns the number of runs requested (0 or 1). Sends nothing itself.';

revoke all on function public.dispatch_pending_webhooks() from public, anon, authenticated;

do $cron$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'magistrate-wizard-webhook-dispatch';
  perform cron.schedule(
    'magistrate-wizard-webhook-dispatch',
    '* * * * *',
    'select public.request_webhook_dispatch_run()'
  );
exception
  when others then
    raise notice 'pg_cron not scheduled for webhook dispatch: %', sqlerrm;
end;
$cron$;

-- ==================== 5. an admin retry is due at once ====================

-- Re-declared from 0156. Also clears the dead-letter mark and makes the row
-- due now; attempts are kept so the history stays honest.
create or replace function public.retry_webhook_delivery(p_outbox_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not (select public.is_admin()) then
    raise exception 'Only administrators can retry webhook deliveries';
  end if;

  update public.webhook_outbox
     set status = 'pending',
         last_error = null,
         dead_lettered_at = null,
         locked_at = null,
         next_attempt_at = now()
   where id = p_outbox_id
     and status = 'failed'
  returning id into v_id;

  return v_id is not null;
end;
$$;

comment on function public.retry_webhook_delivery(uuid) is
  'Admin-only. Re-queues one failed webhook_outbox row (status -> pending, due now). Returns false when the row is not failed or does not exist.';

revoke all on function public.retry_webhook_delivery(uuid) from public, anon;
grant execute on function public.retry_webhook_delivery(uuid) to authenticated;

-- ==================== 6. endpoint URLs ====================

-- NOT VALID first so a legacy row cannot block this migration; validated
-- straight after where every row already passes. webhook-dispatch applies
-- the same rule before each post either way.
alter table public.webhook_endpoints
  drop constraint if exists webhook_endpoints_url_http;
alter table public.webhook_endpoints
  add constraint webhook_endpoints_url_allowed check (
    url ~ '^https://[^/?#@[:space:]]+(/[^[:space:]]*)?$'
    or url ~ '^http://(localhost|127\.0\.0\.1|host\.docker\.internal)(:[0-9]{1,5})?(/[^[:space:]]*)?$'
  ) not valid;

do $validate$
begin
  alter table public.webhook_endpoints validate constraint webhook_endpoints_url_allowed;
exception
  when check_violation then
    raise notice 'webhook_endpoints_url_allowed left NOT VALID: an existing endpoint URL breaks it';
end;
$validate$;
