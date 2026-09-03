-- 0125_feature_flags.sql
--
-- Admin-writable flags. Authenticated users may read them. Evaluation
-- (role / court / percentage) happens in the app so the same rule can
-- be unit-tested without a live database.

create table public.feature_flags (
  key text primary key,
  description text,
  enabled boolean not null default false,
  rollout_percentage integer not null default 100
    check (rollout_percentage between 0 and 100),
  court_ids uuid[] not null default '{}',
  roles text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

comment on table public.feature_flags is
  'Named feature gates. Empty court_ids and roles mean every court and every role. Percentage rollout is applied in the client.';

create trigger set_feature_flags_updated_at
  before update on public.feature_flags
  for each row execute function public.set_updated_at();

alter table public.feature_flags enable row level security;

create policy "Authenticated users can read feature flags"
  on public.feature_flags for select
  to authenticated
  using (true);

create policy "Admins can insert feature flags"
  on public.feature_flags for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins can update feature flags"
  on public.feature_flags for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete feature flags"
  on public.feature_flags for delete
  to authenticated
  using (public.is_admin());

insert into public.feature_flags (key, description, enabled)
values
  ('in_app_notifications', 'Notifications page and in-app notice rows', true),
  ('hearing_reminders', 'Device sitting-day reminders (web Notifications API)', true),
  ('audit_export', 'Admin CSV export of the activity ledger', true),
  ('download_my_data', 'Settings download of the caller''s own records', true),
  ('webhooks', 'Admin outbound webhook endpoints', true);
