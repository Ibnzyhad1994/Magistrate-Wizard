-- 0127_data_retention.sql
--
-- Retention policy catalog plus a caller-scoped JSON export. Purge is
-- allowlisted to notifications only — judicial tables are never deleted
-- by this job. DSR is in-app JSON, not an email delivery.

create table public.data_retention_policies (
  table_name text primary key,
  retention_days integer not null check (retention_days >= 1),
  action text not null check (action in ('flag', 'purge')),
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

comment on table public.data_retention_policies is
  'How long operational rows are kept. purge is allowed only for notifications (see apply_data_retention).';

create trigger set_data_retention_policies_updated_at
  before update on public.data_retention_policies
  for each row execute function public.set_updated_at();

alter table public.data_retention_policies enable row level security;

create policy "Admins can read retention policies"
  on public.data_retention_policies for select
  to authenticated
  using (public.is_admin());

create policy "Admins can insert retention policies"
  on public.data_retention_policies for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins can update retention policies"
  on public.data_retention_policies for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

insert into public.data_retention_policies (table_name, retention_days, action, notes)
values
  ('notifications', 90, 'purge', 'Unread and read in-app notices older than 90 days.'),
  ('issue_reports', 365, 'flag', 'Keep for a year; admins review rather than auto-delete.'),
  ('auth_event_log', 730, 'flag', 'Sign-in history. No automatic delete.'),
  ('audit_log', 3650, 'flag', 'Compliance ledger. Hash-chained; never purged by apply_data_retention.');

create or replace function public.apply_data_retention()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer;
  v_count integer := 0;
begin
  select retention_days
    into v_days
  from public.data_retention_policies
  where table_name = 'notifications'
    and action = 'purge';

  if v_days is not null then
    delete from public.notifications
    where created_at < now() - make_interval(days => v_days);
    get diagnostics v_count = row_count;
  end if;

  return v_count;
end;
$$;

comment on function public.apply_data_retention() is
  'Purges allowlisted operational rows (notifications only). Never touches audit_log, docket, or judicial writing.';

revoke all on function public.apply_data_retention() from public, anon, authenticated;

create or replace function public.download_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  return jsonb_build_object(
    'exported_at', now(),
    'profile', (
      select to_jsonb(p) - 'avatar_url'
      from public.profiles p
      where p.id = uid
    ),
    'judgments', coalesce((
      select jsonb_agg(to_jsonb(j) - 'content' - 'search_vector' order by j.updated_at desc)
      from public.judgments j
      where j.owner_id = uid
    ), '[]'::jsonb),
    'bench_notes', coalesce((
      select jsonb_agg(to_jsonb(b) - 'content' - 'search_vector' order by b.updated_at desc)
      from public.bench_notes b
      where b.author_id = uid
    ), '[]'::jsonb),
    'case_law', coalesce((
      select jsonb_agg(to_jsonb(c) - 'full_text' - 'summary' - 'key_passages' - 'search_vector' order by c.updated_at desc)
      from public.case_law c
      where c.owner_id = uid
    ), '[]'::jsonb),
    'bookmarks', coalesce((
      select jsonb_agg(to_jsonb(b) order by b.created_at desc)
      from public.bookmarks b
      where b.user_id = uid
    ), '[]'::jsonb),
    'shares', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at desc)
      from public.shares s
      where s.granted_by = uid or s.recipient_id = uid
    ), '[]'::jsonb),
    'notifications', coalesce((
      select jsonb_agg(to_jsonb(n) order by n.created_at desc)
      from public.notifications n
      where n.user_id = uid
    ), '[]'::jsonb),
    'clerk_access_requests', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc)
      from public.clerk_access_requests r
      where r.profile_id = uid
    ), '[]'::jsonb),
    'magistrate_court_requests', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc)
      from public.magistrate_court_requests r
      where r.profile_id = uid
    ), '[]'::jsonb),
    'magistrate_courts', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.started_at desc)
      from public.magistrate_courts m
      where m.profile_id = uid
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.download_my_data() from public, anon;
grant execute on function public.download_my_data() to authenticated;

comment on function public.download_my_data() is
  'JSON export of the caller''s own profile-scoped records. Does not include other users'' data or binary documents.';
