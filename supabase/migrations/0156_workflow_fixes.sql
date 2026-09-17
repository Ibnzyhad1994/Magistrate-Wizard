-- ============================================================================
-- 0156_workflow_fixes.sql
--
-- End-user workflow repairs from the 2026-09-17 system audit (§7):
--
--   1. Court access (§7.1): a magistrate whose regular sitting is ended by
--      the first-sign-in occupancy trigger (0152) or by an administrator's
--      replace / co-sit / transfer now receives a 'court_ended' notice that
--      carries the end_reason. Auto-eviction also notifies administrators.
--   2. Stale drafts (§7.6): 'stale_draft' notices are deduped per record
--      for 30 days via a dedicated stamp table, so the daily cron no longer
--      re-fires every day and Dismiss no longer resets the dedupe.
--   3. Webhooks (§7.8): delivery honesty ('sent' when enqueued through
--      pg_net, 'delivered'/'failed' only from a real HTTP status), an
--      admin-only retry RPC for failed rows, and an audited admin-only
--      secret reveal so endpoints can actually verify the HMAC.
--   4. Issue reports (§7.9): the reporter is notified when an
--      administrator changes the report's status.
--
-- No judicial table is written by anything here. The stale-draft stamp
-- lives in its own table precisely so judgments/case_law rows (and their
-- updated_at / version triggers) are never touched by a maintenance job.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. New notification kinds
-- ----------------------------------------------------------------------------

alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (type in (
    'share_granted',
    'share_revoked',
    'judgment_final',
    'court_assigned',
    'court_ended',
    'clerk_request',
    'clerk_request_decided',
    'court_request',
    'court_request_decided',
    'account_type_corrected',
    'hearing_tomorrow',
    'stale_draft',
    'issue_report_decided'
  ));

-- ----------------------------------------------------------------------------
-- 1. Court access: notify on displacement
-- ----------------------------------------------------------------------------

-- Re-declared from 0152 §1. Logic identical; the ended rows are now
-- captured (RETURNING) so the displaced magistrate and the administrators
-- are told, with the end_reason in the body.
create or replace function public.claim_primary_slot_on_first_sign_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_ended record;
  v_court_name text;
  v_person text;
begin
  if new.event_type is distinct from 'login_success' then
    return new;
  end if;

  v_profile_id := new.actor_id;
  if v_profile_id is null and new.email is not null then
    select p.id into v_profile_id
    from public.profiles p
    where lower(p.email) = lower(new.email)
    limit 1;
  end if;
  if v_profile_id is null then
    return new;
  end if;

  for v_ended in
    update public.magistrate_courts mc
    set ended_at = now(),
        ended_by = v_profile_id,
        end_reason = 'Ended automatically: this court already has a signed-in primary magistrate'
    where mc.profile_id = v_profile_id
      and mc.assignment_type = 'regular'
      and mc.ended_at is null
      and exists (
        select 1
        from public.magistrate_courts o
        where o.court_id = mc.court_id
          and o.assignment_type = 'regular'
          and o.ended_at is null
          and o.occupies_primary_slot
          and o.profile_id is distinct from v_profile_id
      )
    returning mc.id, mc.court_id, mc.profile_id, mc.end_reason
  loop
    select c.name into v_court_name from public.courts c where c.id = v_ended.court_id;
    select coalesce(p.full_name, p.email) into v_person
    from public.profiles p where p.id = v_ended.profile_id;

    perform public.notify_user(
      v_ended.profile_id,
      'court_ended',
      'Your court assignment ended',
      coalesce(v_court_name, 'A court') || ': ' || v_ended.end_reason
        || '. Request the court again as a special exception, or another court, under Court Assignments.',
      '/court-assignments'
    );
    perform public.notify_admins(
      'court_ended',
      'A court assignment ended automatically',
      coalesce(v_person, 'A magistrate') || ' was not seated at ' || coalesce(v_court_name, 'a court')
        || ' on first sign-in: ' || v_ended.end_reason || '.',
      '/admin/court-assignments?court=' || v_ended.court_id::text
    );
  end loop;

  update public.magistrate_courts mc
  set updated_at = now()
  where mc.profile_id = v_profile_id
    and mc.assignment_type = 'regular'
    and mc.ended_at is null;

  return new;
end;
$$;

-- Re-declared from 0152 §2. Same signature, same UPDATE; the ended rows
-- are captured so each displaced regular is told why. Callers (replace,
-- co-sit, transfer RPCs) are unchanged.
create or replace function public.end_other_regular_assignments_at_court(
  p_court_id uuid,
  p_keep_profile_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ended record;
  v_court_name text;
begin
  select c.name into v_court_name from public.courts c where c.id = p_court_id;

  for v_ended in
    update public.magistrate_courts
    set ended_at = now(),
        ended_by = (select auth.uid()),
        end_reason = coalesce(nullif(trim(p_reason), ''), 'Replaced by administrator')
    where court_id = p_court_id
      and assignment_type = 'regular'
      and ended_at is null
      and profile_id is distinct from p_keep_profile_id
    returning profile_id, end_reason
  loop
    perform public.notify_user(
      v_ended.profile_id,
      'court_ended',
      'Your court assignment ended',
      coalesce(v_court_name, 'A court') || ': ' || v_ended.end_reason
        || '. See Court Assignments for the ended sitting and to request a court.',
      '/court-assignments'
    );
  end loop;
end;
$$;

revoke all on function public.end_other_regular_assignments_at_court(uuid, uuid, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Stale drafts: 30-day dedupe stamp
-- ----------------------------------------------------------------------------

create table if not exists public.stale_draft_notices (
  item_type text not null check (item_type in ('judgment', 'case_law')),
  item_id uuid not null,
  notified_at timestamptz not null default now(),
  primary key (item_type, item_id)
);

comment on table public.stale_draft_notices is
  'When each draft was last flagged stale. Written only by flag_stale_drafts(); never read by clients. Keeps the daily cron from re-notifying more than once per 30 days, independently of whether the user dismissed the notice.';

alter table public.stale_draft_notices enable row level security;
-- No policies: DEFINER-only.
revoke all on table public.stale_draft_notices from public, anon, authenticated;

-- Re-declared from 0124. Same candidate queries; a record is skipped when it
-- was flagged in the last 30 days, and stamped when it is flagged.
create or replace function public.flag_stale_drafts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select j.id, j.owner_id, j.title
    from public.judgments j
    left join public.stale_draft_notices n
      on n.item_type = 'judgment' and n.item_id = j.id
    where j.status = 'draft'
      and j.updated_at < now() - interval '90 days'
      and j.owner_id is not null
      and (n.notified_at is null or n.notified_at < now() - interval '30 days')
  loop
    perform public.notify_user(
      r.owner_id,
      'stale_draft',
      'A judgment draft is stale',
      coalesce(r.title, 'This draft has not been edited in 90 days.'),
      '/judgments/' || r.id::text
    );
    insert into public.stale_draft_notices (item_type, item_id, notified_at)
    values ('judgment', r.id, now())
    on conflict (item_type, item_id) do update set notified_at = excluded.notified_at;
    v_count := v_count + 1;
  end loop;

  for r in
    select c.id, c.owner_id, c.case_name
    from public.case_law c
    left join public.stale_draft_notices n
      on n.item_type = 'case_law' and n.item_id = c.id
    where c.owner_id is not null
      and c.review_status in ('draft', 'needs_review')
      and c.updated_at < now() - interval '90 days'
      and (n.notified_at is null or n.notified_at < now() - interval '30 days')
  loop
    perform public.notify_user(
      r.owner_id,
      'stale_draft',
      'Case law research is stale',
      coalesce(r.case_name, 'This draft has not been edited in 90 days.'),
      '/case-law/' || r.id::text
    );
    insert into public.stale_draft_notices (item_type, item_id, notified_at)
    values ('case_law', r.id, now())
    on conflict (item_type, item_id) do update set notified_at = excluded.notified_at;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.flag_stale_drafts() is
  'Daily: notifies owners of judgment / personal case-law drafts untouched for 90 days, at most once per 30 days per record (stale_draft_notices). Called by run_scheduled_maintenance(); no email.';

revoke all on function public.flag_stale_drafts() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Webhooks: honest delivery state, retry, secret reveal
-- ----------------------------------------------------------------------------

-- 'sent' = handed to pg_net; the HTTP outcome is not known to the database.
-- 'delivered' / 'failed' are only ever set from a real HTTP status by the
-- webhook-dispatch Edge Function.
alter table public.webhook_outbox
  drop constraint if exists webhook_outbox_status_check;
alter table public.webhook_outbox
  add constraint webhook_outbox_status_check
  check (status in ('pending', 'sent', 'delivered', 'failed'));

comment on column public.webhook_outbox.status is
  'pending = queued. sent = handed to pg_net (HTTP result unknown). delivered / failed = HTTP result observed by the webhook-dispatch Edge Function. Failed rows can be re-queued with retry_webhook_delivery().';

-- Re-declared from 0128. Identical except that a successful net.http_post
-- enqueue marks the row 'sent', not 'delivered', and leaves delivered_at
-- null.
create or replace function public.dispatch_pending_webhooks()
returns integer
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare
  r record;
  v_body text;
  v_sig text;
  v_sent integer := 0;
begin
  if to_regprocedure('net.http_post(jsonb)') is null
     and to_regnamespace('net') is null then
    return 0;
  end if;

  for r in
    select o.id, o.payload, o.event, e.url, e.secret
    from public.webhook_outbox o
    join public.webhook_endpoints e on e.id = o.endpoint_id
    where o.status = 'pending'
      and e.active
    order by o.created_at
    limit 25
  loop
    v_body := r.payload::text;
    v_sig := public.webhook_signature(r.secret, v_body);
    begin
      perform net.http_post(
        url := r.url,
        body := r.payload,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Magistrate-Wizard-Signature', 'sha256=' || v_sig,
          'X-Magistrate-Wizard-Event', r.event
        )
      );
      update public.webhook_outbox
         set status = 'sent',
             attempts = attempts + 1,
             last_error = null
       where id = r.id;
      v_sent := v_sent + 1;
    exception
      when others then
        update public.webhook_outbox
           set status = 'failed',
               attempts = attempts + 1,
               last_error = sqlerrm
         where id = r.id;
    end;
  end loop;

  return v_sent;
end;
$$;

revoke all on function public.dispatch_pending_webhooks() from public, anon, authenticated;

-- Admin-only: put one failed row back in the queue. Attempts are kept so
-- the history stays honest; last_error is cleared for the new attempt.
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
         last_error = null
   where id = p_outbox_id
     and status = 'failed'
  returning id into v_id;

  return v_id is not null;
end;
$$;

comment on function public.retry_webhook_delivery(uuid) is
  'Admin-only. Re-queues one failed webhook_outbox row (status -> pending). Returns false when the row is not failed or does not exist.';

revoke all on function public.retry_webhook_delivery(uuid) from public, anon;
grant execute on function public.retry_webhook_delivery(uuid) to authenticated;

-- Admin-only, audited: return the endpoint's signing secret so the receiving
-- system can be configured to verify X-Magistrate-Wizard-Signature.
--
-- Threat model. SECURITY DEFINER so the audit_log row (append-only, hashed
-- chain, no client INSERT) can be written in the same call as the read;
-- the secret itself is already admin-readable under webhook_endpoints RLS,
-- so this exposes nothing new -- it only makes every reveal leave a trace.
-- Fixed search_path; EXECUTE granted to authenticated with the is_admin()
-- check inside; anon revoked.
create or replace function public.reveal_webhook_secret(p_endpoint_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  if not (select public.is_admin()) then
    raise exception 'Only administrators can reveal a webhook secret';
  end if;

  select e.secret into v_secret
  from public.webhook_endpoints e
  where e.id = p_endpoint_id;

  if v_secret is null then
    raise exception 'Webhook endpoint not found';
  end if;

  insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
  values (
    (select auth.uid()),
    'update',
    'webhook_endpoints',
    p_endpoint_id,
    jsonb_build_object('event', 'secret_revealed')
  );

  return v_secret;
end;
$$;

comment on function public.reveal_webhook_secret(uuid) is
  'Admin-only. Returns the HMAC signing secret for one endpoint and writes an audit_log row (table webhook_endpoints, new_data.event = secret_revealed) for every reveal.';

revoke all on function public.reveal_webhook_secret(uuid) from public, anon;
grant execute on function public.reveal_webhook_secret(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Issue reports: tell the reporter when the status changes
-- ----------------------------------------------------------------------------

-- Inserts directly (DEFINER) rather than via notify_user(): that helper
-- dedupes on type+link for 20 hours, and two of a person's reports decided
-- the same day must both be announced. Nothing about the report body is
-- copied; only the title and the new status.
create or replace function public.issue_reports_notify_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status_label text;
begin
  if tg_op <> 'UPDATE' or new.status is not distinct from old.status then
    return new;
  end if;

  v_status_label := case new.status
    when 'open' then 'reopened'
    when 'in_progress' then 'in progress'
    when 'resolved' then 'resolved'
    when 'wont_fix' then 'closed (will not fix)'
    else replace(new.status, '_', ' ')
  end;

  insert into public.notifications (user_id, type, title, body, link)
  values (
    new.reporter_id,
    'issue_report_decided',
    'Your ' || new.type || ' report is ' || v_status_label,
    left(new.title, 200),
    null
  );

  return new;
end;
$$;

drop trigger if exists issue_reports_notify_status_trigger on public.issue_reports;
create trigger issue_reports_notify_status_trigger
  after update of status on public.issue_reports
  for each row execute function public.issue_reports_notify_status();
