-- 0123_notifications.sql
--
-- In-app notifications only. No email, no Resend, no header bell.
-- Rows are inserted by SECURITY DEFINER helpers from table triggers.
-- Recipients SELECT their own rows and may set read_at; they cannot
-- insert, delete, or rewrite type/title/body/link/user_id.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_type_check check (type in (
    'share_granted',
    'share_revoked',
    'judgment_final',
    'court_assigned',
    'clerk_request',
    'clerk_request_decided',
    'court_request',
    'hearing_tomorrow',
    'stale_draft'
  ))
);

comment on table public.notifications is
  'Per-user in-app notices. Inserts are DEFINER-only; users may mark their own rows read.';

create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index notifications_user_unread_idx
  on public.notifications (user_id)
  where read_at is null;

alter table public.notifications enable row level security;

create policy "Users can view their own notifications"
  on public.notifications for select
  using (user_id = (select auth.uid()));

create policy "Users can mark their own notifications read"
  on public.notifications for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.notifications_protect()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.user_id is distinct from old.user_id
      or new.type is distinct from old.type
      or new.title is distinct from old.title
      or new.body is distinct from old.body
      or new.link is distinct from old.link
      or new.created_at is distinct from old.created_at
    then
      raise exception 'Notifications are immutable except for read_at';
    end if;
  end if;
  return new;
end;
$$;

create trigger notifications_protect_trigger
  before update on public.notifications
  for each row execute function public.notifications_protect();

create or replace function public.notify_user(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text default null,
  p_link text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_user_id is null or p_type is null or p_title is null then
    return null;
  end if;

  if exists (
    select 1
    from public.notifications n
    where n.user_id = p_user_id
      and n.type = p_type
      and coalesce(n.link, '') = coalesce(p_link, '')
      and n.created_at > now() - interval '20 hours'
  ) then
    return null;
  end if;

  insert into public.notifications (user_id, type, title, body, link)
  values (p_user_id, p_type, p_title, p_body, p_link)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.notify_user(uuid, text, text, text, text) is
  'Insert an in-app notification for one user. Dedupes identical type+link rows within 20 hours. No email.';

revoke all on function public.notify_user(uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public.notify_court_staff(
  p_court_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_link text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select profile_id
    from public.magistrate_courts
    where court_id = p_court_id
      and ended_at is null
    union
    select profile_id
    from public.clerk_courts
    where court_id = p_court_id
      and ended_at is null
  loop
    perform public.notify_user(r.profile_id, p_type, p_title, p_body, p_link);
  end loop;
end;
$$;

revoke all on function public.notify_court_staff(uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public.notify_admins(
  p_type text,
  p_title text,
  p_body text,
  p_link text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select id
    from public.profiles
    where role = 'admin'
      and is_active = true
  loop
    perform public.notify_user(r.id, p_type, p_title, p_body, p_link);
  end loop;
end;
$$;

revoke all on function public.notify_admins(text, text, text, text) from public, anon, authenticated;

-- Shares -------------------------------------------------------------------

create or replace function public.shares_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_noun text;
  v_link text;
begin
  v_noun := case new.item_type
    when 'docket_matter' then 'docket matter'
    when 'judgment' then 'judgment'
    when 'case_law' then 'case law research'
    else 'item'
  end;
  v_link := case new.item_type
    when 'docket_matter' then '/docket/' || new.item_id::text
    when 'judgment' then '/judgments/' || new.item_id::text
    when 'case_law' then '/case-law/' || new.item_id::text
    else null
  end;

  if tg_op = 'INSERT' and new.revoked_at is null and new.recipient_id is not null then
    perform public.notify_user(
      new.recipient_id,
      'share_granted',
      'A ' || v_noun || ' was shared with you',
      'You were granted ' || new.permission || ' access.',
      v_link
    );
  elsif tg_op = 'UPDATE'
    and old.revoked_at is null
    and new.revoked_at is not null
    and new.recipient_id is not null
  then
    perform public.notify_user(
      new.recipient_id,
      'share_revoked',
      'A share was revoked',
      'Your access to a ' || v_noun || ' was revoked.',
      v_link
    );
  end if;

  return new;
end;
$$;

create trigger shares_notify_trigger
  after insert or update on public.shares
  for each row execute function public.shares_notify();

-- Judgments finalized ------------------------------------------------------

create or replace function public.judgments_notify_final()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if old.status is not distinct from new.status or new.status is distinct from 'final' then
    return new;
  end if;

  for r in
    select recipient_id
    from public.shares
    where item_type = 'judgment'
      and item_id = new.id
      and revoked_at is null
      and recipient_id is not null
  loop
    perform public.notify_user(
      r.recipient_id,
      'judgment_final',
      'A judgment was finalized',
      coalesce(new.title, 'A shared judgment is now final.'),
      '/judgments/' || new.id::text
    );
  end loop;

  return new;
end;
$$;

create trigger judgments_notify_final_trigger
  after update on public.judgments
  for each row execute function public.judgments_notify_final();

-- Court assignment ---------------------------------------------------------

create or replace function public.magistrate_courts_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_court text;
begin
  if new.ended_at is not null then
    return new;
  end if;

  select name into v_court from public.courts where id = new.court_id;

  perform public.notify_user(
    new.profile_id,
    'court_assigned',
    'You were assigned to a court',
    coalesce(v_court, 'A court assignment is now active.'),
    '/court-assignments'
  );

  return new;
end;
$$;

create trigger magistrate_courts_notify_trigger
  after insert on public.magistrate_courts
  for each row execute function public.magistrate_courts_notify();

-- Clerk access requests ----------------------------------------------------

create or replace function public.clerk_access_requests_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_court text;
begin
  select name into v_court from public.courts where id = new.court_id;

  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.notify_court_staff(
      new.court_id,
      'clerk_request',
      'Clerk access request',
      coalesce(v_court, 'A clerk requested court access.'),
      '/clerk-access-requests'
    );
    perform public.notify_admins(
      'clerk_request',
      'Clerk access request',
      coalesce(v_court, 'A clerk requested court access.'),
      '/admin/clerk-access'
    );
  elsif tg_op = 'UPDATE'
    and old.status = 'pending'
    and new.status in ('approved', 'rejected')
  then
    perform public.notify_user(
      new.profile_id,
      'clerk_request_decided',
      'Your clerk access request was ' || new.status,
      coalesce(v_court, 'See Clerk Access for details.'),
      '/clerk-access'
    );
  end if;

  return new;
end;
$$;

create trigger clerk_access_requests_notify_trigger
  after insert or update on public.clerk_access_requests
  for each row execute function public.clerk_access_requests_notify();

-- Magistrate court requests (admins) ---------------------------------------

create or replace function public.magistrate_court_requests_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_court text;
begin
  if tg_op = 'INSERT' and new.status::text = 'pending' then
    select name into v_court from public.courts where id = new.court_id;
    perform public.notify_admins(
      'court_request',
      'Magistrate court request',
      coalesce(v_court, 'A magistrate requested a court assignment.'),
      '/admin/court-assignments'
    );
  end if;
  return new;
end;
$$;

create trigger magistrate_court_requests_notify_trigger
  after insert on public.magistrate_court_requests
  for each row execute function public.magistrate_court_requests_notify();
