-- ============================================================================
-- 0073_docket_event_calendar_links.sql
--
-- Per-user Google Calendar identity for a Docket Event. The Outlook
-- placeholder columns on docket_events (external_calendar_*) stay unused:
-- they are a single global pair, and two magistrates syncing the same
-- hearing to personal Gmail would collide on
-- docket_events_external_calendar_unique_idx.
--
-- Tokens never land in Postgres — only the Google event/calendar ids.
-- Google may update when/where (scheduled_date, scheduled_time, location)
-- via the existing docket_events UPDATE policy; it must never become
-- authoritative for charge, parties, orders, or outcome.
-- ============================================================================

create table public.docket_event_calendar_links (
  id uuid primary key default gen_random_uuid(),
  docket_event_id uuid not null references public.docket_events (id) on delete restrict,
  profile_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  provider text not null check (provider = 'google'),
  external_calendar_id text not null,
  external_event_id text not null,
  etag text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (profile_id, docket_event_id, provider),
  unique (provider, external_event_id)
);

comment on table public.docket_event_calendar_links is
  'Per-user Google Calendar mapping for a Docket Event. OAuth tokens are device-local, never stored here. Leave unused the docket_events.external_calendar_* placeholder columns.';
comment on column public.docket_event_calendar_links.profile_id is
  'The signed-in magistrate who owns this Google mapping. Forced to auth.uid().';
comment on column public.docket_event_calendar_links.external_event_id is
  'Google Calendar event id on that user''s dedicated Magistrate Wizard calendar.';

create index docket_event_calendar_links_event_idx
  on public.docket_event_calendar_links (docket_event_id);
create index docket_event_calendar_links_profile_idx
  on public.docket_event_calendar_links (profile_id);

create or replace function public.docket_event_calendar_links_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.profile_id := (select auth.uid());
  elsif tg_op = 'UPDATE' then
    new.profile_id := old.profile_id;
    new.docket_event_id := old.docket_event_id;
    new.provider := old.provider;
  end if;
  return new;
end;
$$;

create trigger docket_event_calendar_links_guard
  before insert or update on public.docket_event_calendar_links
  for each row
  execute function public.docket_event_calendar_links_guard();

alter table public.docket_event_calendar_links enable row level security;

create policy "Users select own calendar links for readable events"
  on public.docket_event_calendar_links for select
  using (
    profile_id = (select auth.uid())
    and exists (
      select 1
      from public.docket_events e
      where e.id = docket_event_id
        and public.can_view_docket_matter(e.docket_matter_id)
    )
  );

create policy "Users insert own calendar links for readable events"
  on public.docket_event_calendar_links for insert
  with check (
    profile_id = (select auth.uid())
    and exists (
      select 1
      from public.docket_events e
      where e.id = docket_event_id
        and public.can_view_docket_matter(e.docket_matter_id)
    )
  );

create policy "Users update own calendar links for readable events"
  on public.docket_event_calendar_links for update
  using (profile_id = (select auth.uid()))
  with check (
    profile_id = (select auth.uid())
    and exists (
      select 1
      from public.docket_events e
      where e.id = docket_event_id
        and public.can_view_docket_matter(e.docket_matter_id)
    )
  );

create policy "Users delete own calendar links"
  on public.docket_event_calendar_links for delete
  using (profile_id = (select auth.uid()));
