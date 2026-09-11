-- Local development seed. Applied after migrations on `supabase start`
-- / `supabase db reset`. Not for production.
--
-- Logins (email confirmation is disabled in config.toml):
--   admin@magistrate-wizard.local      / password123  (admin + acting at Georgetown Court 1)
--   magistrate@magistrate-wizard.local / password123  (magistrate + primary at Georgetown Court 1)
--   calendar@magistrate-wizard.local   / password123  (magistrate at Vigilance 1 + Kamarang; 2053/26 on 9 Sep 2026)

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Auth users (confirmed). handle_new_user() creates matching profiles.
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'authenticated',
    'authenticated',
    'admin@magistrate-wizard.local',
    crypt('password123', gen_salt('bf')),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Local Administrator"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'b1ffcd00-8d1c-4ef8-bb6d-6bb9bd380a22',
    'authenticated',
    'authenticated',
    'magistrate@magistrate-wizard.local',
    crypt('password123', gen_salt('bf')),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Local Magistrate"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'c2aade11-9e2d-4ef8-bb6d-6bb9bd380a33',
    'authenticated',
    'authenticated',
    'calendar@magistrate-wizard.local',
    crypt('password123', gen_salt('bf')),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Calendar Dummy Magistrate"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  )
on conflict (id) do nothing;

insert into auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at,
  provider_id
)
values
  (
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    jsonb_build_object(
      'sub', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      'email', 'admin@magistrate-wizard.local',
      'email_verified', true
    ),
    'email',
    now(),
    now(),
    now(),
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
  ),
  (
    'b1ffcd00-8d1c-4ef8-bb6d-6bb9bd380a22',
    'b1ffcd00-8d1c-4ef8-bb6d-6bb9bd380a22',
    jsonb_build_object(
      'sub', 'b1ffcd00-8d1c-4ef8-bb6d-6bb9bd380a22',
      'email', 'magistrate@magistrate-wizard.local',
      'email_verified', true
    ),
    'email',
    now(),
    now(),
    now(),
    'b1ffcd00-8d1c-4ef8-bb6d-6bb9bd380a22'
  ),
  (
    'c2aade11-9e2d-4ef8-bb6d-6bb9bd380a33',
    'c2aade11-9e2d-4ef8-bb6d-6bb9bd380a33',
    jsonb_build_object(
      'sub', 'c2aade11-9e2d-4ef8-bb6d-6bb9bd380a33',
      'email', 'calendar@magistrate-wizard.local',
      'email_verified', true
    ),
    'email',
    now(),
    now(),
    now(),
    'c2aade11-9e2d-4ef8-bb6d-6bb9bd380a33'
  )
on conflict (id) do nothing;

update public.profiles
set role = 'admin'
where id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

-- ---------------------------------------------------------------------------
-- Court assignments (required for Docket access — admin bypass does not apply)
-- Only one active assignment_type='regular' row is allowed per court (0105).
-- ---------------------------------------------------------------------------

insert into public.magistrate_courts (profile_id, court_id, assignment_type)
select u.id, c.id, u.assignment_type
from (
  values
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid, 'acting'),
    ('b1ffcd00-8d1c-4ef8-bb6d-6bb9bd380a22'::uuid, 'regular')
) as u(id, assignment_type)
cross join lateral (
  select id
  from public.courts
  where name = 'Georgetown Magistrates'' Court 1'
  limit 1
) c
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Sample docket matter so the dashboard is not empty after first login
-- ---------------------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'role', 'authenticated'
  )::text,
  true
);

insert into public.docket_matters (
  court_id,
  case_number,
  matter_title,
  charge_or_issue,
  status
)
select
  c.id,
  'GEO-2026-001',
  'Police v. Demo Defendant',
  'Theft contrary to the Criminal Law (Offences) Act',
  'active'
from public.courts c
where c.name = 'Georgetown Magistrates'' Court 1'
  and not exists (
    select 1 from public.docket_matters where case_number = 'GEO-2026-001'
  )
limit 1;

-- ---------------------------------------------------------------------------
-- Calendar mismatch persona: sits Vigilance 1 and Kamarang. 2053/26 is a
-- completed Criminal-trial sitting on 2026-09-09 at Vigilance, with a real
-- next date on 2026-11-09. Capacity tiles count every court they sit (1/10
-- on 9 Sep even while Docket is headed Kamarang). Clicking that day must
-- switch to All My Courts so the file appears.
-- Login: calendar@magistrate-wizard.local / password123
-- ---------------------------------------------------------------------------

-- 'relief', not 'regular': only ONE active regular magistrate is allowed
-- per court (0105), and that slot at Vigilance 1 is already taken on any
-- machine that also has the gitignored seed.local.sql (real data pulled
-- from the cloud project). Seeding aborted there with "This court already
-- has an active primary magistrate assignment" -- and the `on conflict do
-- nothing` below could not save it, because the exclusivity is enforced by
-- a BEFORE-INSERT trigger that raises before conflict handling is ever
-- reached. CI never saw this (seed.local.sql is gitignored), so it only
-- broke `npm run db:reset` for developers holding local data.
--
-- Access is identical either way: can_access_court() (0020) keys only on
-- court_id/profile_id/ended_at and never reads assignment_type. Same
-- substitution 8c0921e already made in the pentest harness for this exact
-- constraint.
insert into public.magistrate_courts (profile_id, court_id, assignment_type)
select 'c2aade11-9e2d-4ef8-bb6d-6bb9bd380a33'::uuid, c.id, 'relief'
from public.courts c
where c.name in (
  'Vigilance Magistrates'' Court 1',
  'Kamarang Magistrate''s Court'
)
on conflict do nothing;

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', 'c2aade11-9e2d-4ef8-bb6d-6bb9bd380a33',
    'role', 'authenticated'
  )::text,
  true
);

insert into public.docket_matters (
  court_id,
  case_number,
  matter_title,
  charge_or_issue,
  status,
  category_id
)
select
  c.id,
  '2053/26',
  'E. Haynes Const. #27481 vs Mohan Ramnarine',
  'Criminal trial',
  'active',
  cat.id
from public.courts c
cross join public.docket_matter_categories cat
where c.name = 'Vigilance Magistrates'' Court 1'
  and cat.name = 'Criminal trial'
  and not exists (
    select 1 from public.docket_matters where case_number = '2053/26'
  )
limit 1;

insert into public.docket_capacity_settings (category_id, daily_capacity)
select cat.id, 10
from public.docket_matter_categories cat
where not exists (
  select 1
  from public.docket_capacity_settings s
  where s.owner_id = 'c2aade11-9e2d-4ef8-bb6d-6bb9bd380a33'
    and s.category_id = cat.id
);

insert into public.docket_events (
  docket_matter_id,
  scheduled_date,
  event_status,
  event_type,
  category_id
)
select
  m.id,
  d.scheduled_date::date,
  d.event_status,
  'Criminal trial',
  cat.id
from public.docket_matters m
cross join public.docket_matter_categories cat
cross join (
  values
    ('2026-09-09', 'completed'),
    ('2026-11-09', 'scheduled')
) as d(scheduled_date, event_status)
where m.case_number = '2053/26'
  and cat.name = 'Criminal trial'
  and not exists (
    select 1
    from public.docket_events e
    where e.docket_matter_id = m.id
      and e.scheduled_date = d.scheduled_date::date
  );
