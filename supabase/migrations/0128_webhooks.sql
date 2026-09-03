-- 0128_webhooks.sql
--
-- Outbound webhook registry + signed outbox. Delivery uses pg_net when
-- that extension is available; otherwise rows stay pending for an Edge
-- Function or operator to send. Secrets never leave the table via
-- non-admin RLS.

create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  secret text not null,
  events text[] not null default '{}',
  active boolean not null default true,
  court_id uuid references public.courts (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webhook_endpoints_url_http check (url like 'https://%' or url like 'http://localhost%' or url like 'http://127.0.0.1%')
);

comment on table public.webhook_endpoints is
  'Admin-managed outbound endpoints. HMAC-SHA256 over the JSON body; header X-Magistrate-Wizard-Signature.';

create trigger set_webhook_endpoints_updated_at
  before update on public.webhook_endpoints
  for each row execute function public.set_updated_at();

create table public.webhook_outbox (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.webhook_endpoints (id) on delete cascade,
  event text not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index webhook_outbox_pending_idx
  on public.webhook_outbox (created_at)
  where status = 'pending';

alter table public.webhook_endpoints enable row level security;
alter table public.webhook_outbox enable row level security;

create policy "Admins can select webhook endpoints"
  on public.webhook_endpoints for select to authenticated using (public.is_admin());
create policy "Admins can insert webhook endpoints"
  on public.webhook_endpoints for insert to authenticated with check (public.is_admin());
create policy "Admins can update webhook endpoints"
  on public.webhook_endpoints for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins can delete webhook endpoints"
  on public.webhook_endpoints for delete to authenticated using (public.is_admin());

create policy "Admins can select webhook outbox"
  on public.webhook_outbox for select to authenticated using (public.is_admin());

create or replace function public.enqueue_webhook_event(p_event text, p_payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  insert into public.webhook_outbox (endpoint_id, event, payload)
  select e.id, p_event, p_payload
  from public.webhook_endpoints e
  where e.active
    and p_event = any (e.events);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.enqueue_webhook_event(text, jsonb) from public, anon, authenticated;

create or replace function public.webhook_signature(p_secret text, p_body text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.hmac(convert_to(p_body, 'utf8'), convert_to(p_secret, 'utf8'), 'sha256'), 'hex');
$$;

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
         set status = 'delivered',
             attempts = attempts + 1,
             delivered_at = now(),
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

-- Enqueue from the same in-app events, without email.
create or replace function public.notifications_enqueue_webhook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event text;
begin
  v_event := case new.type
    when 'share_granted' then 'share.granted'
    when 'share_revoked' then 'share.revoked'
    when 'judgment_final' then 'judgment.final'
    when 'hearing_tomorrow' then 'hearing.tomorrow'
    when 'clerk_request' then 'clerk_request.created'
    else null
  end;
  if v_event is not null then
    perform public.enqueue_webhook_event(
      v_event,
      jsonb_build_object(
        'type', new.type,
        'title', new.title,
        'body', new.body,
        'link', new.link,
        'created_at', new.created_at
      )
    );
  end if;
  return new;
end;
$$;

create trigger notifications_enqueue_webhook_trigger
  after insert on public.notifications
  for each row execute function public.notifications_enqueue_webhook();
