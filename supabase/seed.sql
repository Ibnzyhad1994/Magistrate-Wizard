-- Local development seed. Applied after migrations on `supabase start`
-- / `supabase db reset`. Not for production.
--
-- Logins (email confirmation is disabled in config.toml):
--   admin@benchbook.local      / password123  (admin + Georgetown Court 1)
--   magistrate@benchbook.local / password123  (magistrate + Georgetown Court 1)

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
    'admin@benchbook.local',
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
    'magistrate@benchbook.local',
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
      'email', 'admin@benchbook.local',
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
      'email', 'magistrate@benchbook.local',
      'email_verified', true
    ),
    'email',
    now(),
    now(),
    now(),
    'b1ffcd00-8d1c-4ef8-bb6d-6bb9bd380a22'
  )
on conflict (id) do nothing;

update public.profiles
set role = 'admin'
where id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

-- ---------------------------------------------------------------------------
-- Court assignments (required for Docket access — admin bypass does not apply)
-- ---------------------------------------------------------------------------

insert into public.magistrate_courts (profile_id, court_id, assignment_type)
select u.id, c.id, 'regular'
from (
  values
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid),
    ('b1ffcd00-8d1c-4ef8-bb6d-6bb9bd380a22'::uuid)
) as u(id)
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
