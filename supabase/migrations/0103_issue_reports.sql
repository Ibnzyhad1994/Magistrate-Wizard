-- In-app bug/suggestion reporting. Any authenticated user can file a
-- report from the "Report an issue" button in the header; only admins
-- triage them via /admin/issue-reports. Self-contained -- no external
-- service or credential required, unlike clerk-access-notify's email path.

create table public.issue_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('bug', 'suggestion')),
  title text not null check (char_length(title) between 1 and 200),
  description text not null check (char_length(description) between 1 and 5000),
  -- Context captured client-side at submission time, not re-derived --
  -- purely descriptive metadata for whoever triages the report, so a
  -- stale/spoofed value here can't grant or hide anything.
  page_path text,
  app_version text,
  reporter_role text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'wont_fix')),
  admin_notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null
);

create index issue_reports_status_idx on public.issue_reports (status, created_at desc);
create index issue_reports_reporter_idx on public.issue_reports (reporter_id);

alter table public.issue_reports enable row level security;

create policy "Reporters can submit issue reports"
  on public.issue_reports for insert
  with check (reporter_id = auth.uid());

create policy "Reporters can view their own issue reports"
  on public.issue_reports for select
  using (reporter_id = auth.uid());

create policy "Admins can view all issue reports"
  on public.issue_reports for select
  using (public.is_admin());

create policy "Admins can update issue reports"
  on public.issue_reports for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete issue reports"
  on public.issue_reports for delete
  using (public.is_admin());
