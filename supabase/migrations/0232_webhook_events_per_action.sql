-- Magistrate Wizard -- 0232: one webhook event per domain action, with its
-- court and the people it notified, scoped to the endpoint's court
--
-- Problem (backend sweep, low priority; follows BE-06, 0180)
--   notifications_enqueue_webhook() (0128) queued a webhook for every row
--   inserted into notifications. One action that notifies several people
--   (a hearing tomorrow at a court with three staff, a clerk request seen by
--   the court and every administrator, a judgment finalised for four share
--   recipients) sent one webhook per recipient, all alike, each carrying no
--   court, no recipient and no id of the thing that happened, only the
--   notice's title, body and link. A receiver could neither count the
--   actions nor tell whom they concerned. The body also carried content:
--   the case number and matter title of a hearing, the title of a
--   finalised judgment. Those went to an endpoint an administrator
--   registered, which is an administrator read path to judicial content
--   that ADR 0007 and the Docket admin exclusion rule out. And
--   webhook_endpoints.court_id, which suggests an endpoint can be limited to
--   one court, was ignored: every endpoint received every court's events.
--
-- Change
--   1. enqueue_webhook_event(event, court, recipients, data) queues ONE
--      event for each active endpoint subscribed to it whose court_id is
--      null (every court) or the event's court. The payload is
--        { "id": <event id, the same for every endpoint>,
--          "event": "share.granted", "occurred_at": <timestamp>,
--          "court_id": <uuid or null>, "recipient_ids": [<profile ids>],
--          "data": { <ids, statuses and the in-app link> } }
--      Metadata only, as the audit log records for these rows (ADR 0007,
--      0162): ids, permissions, dates and the in-app link, never a title,
--      case number, case name or body. webhook_event_wanted(event) lets
--      the producers skip building a payload no endpoint wants.
--   2. Each domain action queues its own event, once:
--        share.granted / share.revoked  a share with a recipient is created
--          or revoked (shares trigger); court = the docket matter's court,
--          null for a judgment or Case Law research, which are never
--          court-owned; recipients = [the recipient].
--        judgment.final  a judgment with recipients who can read it becomes
--          final (judgments trigger); court null; recipients = those
--          share recipients (the people judgments_notify_final tells).
--        hearing.tomorrow  notify_tomorrows_hearings(), per hearing; court =
--          the matter's court; recipients = the court's current magistrates
--          and clerks. A hearing is announced once even if the job runs
--          twice in a day, as its notice is.
--        clerk_request.created  a clerk asks for court access
--          (clerk_access_requests trigger); court = the requested court;
--          recipients = that court's staff and every active administrator.
--      Each fires only when its notice is addressed to someone, as before.
--   3. The notifications trigger and enqueue_webhook_event(text, jsonb) are
--      dropped; notices are unchanged.
--
-- Delivery is unchanged: webhook-dispatch (0180) is the only sender, and
-- until the operator adds the Vault secrets (supabase/README.md "Scheduled
-- Edge Function calls") nothing is sent and events wait as 'pending'.
--
-- Threat model
--   The new functions are SECURITY DEFINER because the triggers run as the
--   acting user, who may not write webhook_outbox or read every staff
--   assignment. They take no client input beyond the row that fired them,
--   and are executable by no client role. Payloads carry ids only, so an
--   endpoint learns that an action happened, to whom and at which court,
--   never the content; no admin read path to a judgment, Case Law research
--   or a docket matter is added. An endpoint limited to a court receives
--   only that court's events and none without a court.
-- ============================================================================

-- ==================== 1. queueing one event ====================

drop trigger if exists notifications_enqueue_webhook_trigger on public.notifications;
drop function if exists public.notifications_enqueue_webhook();
drop function if exists public.enqueue_webhook_event(text, jsonb);

create or replace function public.webhook_event_wanted(p_event text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.webhook_endpoints e
    where e.active
      and p_event = any (e.events)
  );
$$;

comment on function public.webhook_event_wanted(text) is
  'True when an active webhook endpoint subscribes to the event (0232), so a producer can skip building its payload. SECURITY DEFINER; executable by no client role.';

revoke all on function public.webhook_event_wanted(text) from public, anon, authenticated;

create or replace function public.enqueue_webhook_event(
  p_event text,
  p_court_id uuid,
  p_recipient_ids uuid[],
  p_data jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_count integer := 0;
begin
  v_payload := jsonb_build_object(
    'id', gen_random_uuid(),
    'event', p_event,
    'occurred_at', now(),
    'court_id', p_court_id,
    'recipient_ids', coalesce(
      (select jsonb_agg(r order by r) from (select distinct unnest(p_recipient_ids) as r) u
       where r is not null),
      '[]'::jsonb
    ),
    'data', coalesce(p_data, '{}'::jsonb)
  );

  insert into public.webhook_outbox (endpoint_id, event, payload)
  select e.id, p_event, v_payload
  from public.webhook_endpoints e
  where e.active
    and p_event = any (e.events)
    and (e.court_id is null or e.court_id = p_court_id);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.enqueue_webhook_event(text, uuid, uuid[], jsonb) is
  'Queues one webhook event for each active endpoint subscribed to it whose court_id is null or the event''s court (0232). Payload: id (shared by every endpoint''s copy), event, occurred_at, court_id, recipient_ids (sorted, distinct) and data (ids and the in-app link only, never content). Returns the number of rows queued. SECURITY DEFINER; executable by no client role.';

revoke all on function public.enqueue_webhook_event(text, uuid, uuid[], jsonb)
  from public, anon, authenticated;

create or replace function public.court_staff_ids(p_court_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct s.profile_id order by s.profile_id), '{}')
  from (
    select mc.profile_id
    from public.magistrate_courts mc
    where mc.court_id = p_court_id
      and mc.ended_at is null
    union
    select cc.profile_id
    from public.clerk_courts cc
    where cc.court_id = p_court_id
      and cc.ended_at is null
  ) s;
$$;

comment on function public.court_staff_ids(uuid) is
  'The court''s current magistrates and clerks, the people notify_court_staff() addresses (0232). SECURITY DEFINER; executable by no client role.';

revoke all on function public.court_staff_ids(uuid) from public, anon, authenticated;

-- ==================== 2a. shares ====================

create or replace function public.shares_enqueue_webhook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event text;
  v_court_id uuid;
begin
  if new.recipient_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' and new.revoked_at is null then
    v_event := 'share.granted';
  elsif tg_op = 'UPDATE' and old.revoked_at is null and new.revoked_at is not null then
    v_event := 'share.revoked';
  else
    return new;
  end if;

  if not public.webhook_event_wanted(v_event) then
    return new;
  end if;

  if new.item_type = 'docket_matter' then
    select dm.court_id into v_court_id
    from public.docket_matters dm
    where dm.id = new.item_id;
  end if;

  perform public.enqueue_webhook_event(
    v_event,
    v_court_id,
    array[new.recipient_id],
    jsonb_build_object(
      'share_id', new.id,
      'item_type', new.item_type,
      'item_id', new.item_id,
      'permission', new.permission,
      'granted_by', new.granted_by,
      'link', case new.item_type
        when 'docket_matter' then '/docket/' || new.item_id::text
        when 'judgment' then '/judgments/' || new.item_id::text
        when 'case_law' then '/case-law/' || new.item_id::text
      end
    )
  );
  return new;
end;
$$;

comment on function public.shares_enqueue_webhook() is
  'AFTER INSERT OR UPDATE OF revoked_at on shares (0232): one share.granted or share.revoked webhook event per share with a recipient, with the docket matter''s court (null for a judgment or Case Law) and the recipient. SECURITY DEFINER: writes webhook_outbox.';

revoke all on function public.shares_enqueue_webhook() from public, anon, authenticated;

create trigger shares_enqueue_webhook_trigger
  after insert or update of revoked_at on public.shares
  for each row execute function public.shares_enqueue_webhook();

-- ==================== 2b. judgments ====================

create or replace function public.judgments_enqueue_webhook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipients uuid[];
begin
  if old.status is not distinct from new.status
     or new.status is distinct from 'final'
     or not public.webhook_event_wanted('judgment.final') then
    return new;
  end if;

  -- The recipients judgments_notify_final() (0165) tells.
  select array_agg(s.recipient_id) into v_recipients
  from public.shares s
  where s.item_type = 'judgment'
    and s.item_id = new.id
    and s.revoked_at is null
    and s.recipient_id is not null
    and public.can_receive_research_share(s.recipient_id);

  if coalesce(cardinality(v_recipients), 0) = 0 then
    return new;
  end if;

  perform public.enqueue_webhook_event(
    'judgment.final',
    null,
    v_recipients,
    jsonb_build_object(
      'judgment_id', new.id,
      'owner_id', new.owner_id,
      'finalized_at', new.finalized_at,
      'link', '/judgments/' || new.id::text
    )
  );
  return new;
end;
$$;

comment on function public.judgments_enqueue_webhook() is
  'AFTER UPDATE OF status on judgments (0232): one judgment.final webhook event when a judgment with recipients who can read it becomes final, listing them. No court (judgments are never court-owned) and no content. SECURITY DEFINER: reads shares and writes webhook_outbox.';

revoke all on function public.judgments_enqueue_webhook() from public, anon, authenticated;

create trigger judgments_enqueue_webhook_trigger
  after update of status on public.judgments
  for each row execute function public.judgments_enqueue_webhook();

-- ==================== 2c. clerk access requests ====================

create or replace function public.clerk_access_requests_enqueue_webhook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipients uuid[];
begin
  if new.status <> 'pending'
     or not public.webhook_event_wanted('clerk_request.created') then
    return new;
  end if;

  -- The people clerk_access_requests_notify() (0123) tells: the court's
  -- staff and every active administrator.
  v_recipients := public.court_staff_ids(new.court_id)
    || coalesce(
      (select array_agg(p.id) from public.profiles p where p.role = 'admin' and p.is_active),
      '{}'
    );

  if cardinality(v_recipients) = 0 then
    return new;
  end if;

  perform public.enqueue_webhook_event(
    'clerk_request.created',
    new.court_id,
    v_recipients,
    jsonb_build_object(
      'clerk_access_request_id', new.id,
      'profile_id', new.profile_id,
      'requested_at', new.requested_at,
      'link', '/clerk-access-requests'
    )
  );
  return new;
end;
$$;

comment on function public.clerk_access_requests_enqueue_webhook() is
  'AFTER INSERT on clerk_access_requests (0232): one clerk_request.created webhook event per pending request, with its court and the court staff and administrators it notifies. SECURITY DEFINER: reads assignments and writes webhook_outbox.';

revoke all on function public.clerk_access_requests_enqueue_webhook() from public, anon, authenticated;

create trigger clerk_access_requests_enqueue_webhook_trigger
  after insert on public.clerk_access_requests
  for each row execute function public.clerk_access_requests_enqueue_webhook();

-- ==================== 2d. hearings tomorrow ====================

-- Finds an earlier hearing.tomorrow event for the same sitting.
create index webhook_outbox_hearing_tomorrow_idx
  on public.webhook_outbox ((payload #>> '{data,docket_event_id}'))
  where event = 'hearing.tomorrow';

-- Re-declared from 0124: unchanged but for the webhook event per hearing.
create or replace function public.notify_tomorrows_hearings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  r record;
  v_tomorrow date := public.guyana_today() + 1;
  v_wanted boolean := public.webhook_event_wanted('hearing.tomorrow');
  v_staff uuid[];
begin
  for r in
    select
      de.id,
      de.docket_matter_id,
      dm.court_id,
      dm.case_number,
      dm.matter_title
    from public.docket_events de
    join public.docket_matters dm on dm.id = de.docket_matter_id
    where de.event_status = 'scheduled'
      and de.scheduled_date = v_tomorrow
      and dm.deleted_at is null
  loop
    perform public.notify_court_staff(
      r.court_id,
      'hearing_tomorrow',
      'Hearing tomorrow',
      coalesce(r.case_number || ' — ', '') || coalesce(r.matter_title, 'A matter is listed tomorrow.'),
      '/docket/' || r.docket_matter_id::text
    );

    if v_wanted then
      v_staff := public.court_staff_ids(r.court_id);
      if cardinality(v_staff) > 0 and not exists (
        select 1
        from public.webhook_outbox o
        where o.event = 'hearing.tomorrow'
          and (o.payload #>> '{data,docket_event_id}') = r.id::text
          and (o.payload #>> '{data,scheduled_date}') = v_tomorrow::text
      ) then
        perform public.enqueue_webhook_event(
          'hearing.tomorrow',
          r.court_id,
          v_staff,
          jsonb_build_object(
            'docket_event_id', r.id,
            'docket_matter_id', r.docket_matter_id,
            'scheduled_date', v_tomorrow,
            'link', '/docket/' || r.docket_matter_id::text
          )
        );
      end if;
    end if;

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.notify_tomorrows_hearings() from public, anon, authenticated;
