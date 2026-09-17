-- Local e2e personas (not applied by supabase db reset). Password: password123
-- pending.magistrate@magistrate-wizard.local — magistrate, no court
-- clerk@magistrate-wizard.local — clerk, approved at Georgetown Court 1
-- pending.clerk@magistrate-wizard.local — clerk, no court

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
    'c2aabb11-9c0b-4ef8-bb6d-6bb9bd380a33',
    'authenticated',
    'authenticated',
    'pending.magistrate@magistrate-wizard.local',
    crypt('password123', gen_salt('bf')),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Pending Magistrate"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'd3bbcc22-8d1c-4ef8-bb6d-6bb9bd380a44',
    'authenticated',
    'authenticated',
    'clerk@magistrate-wizard.local',
    crypt('password123', gen_salt('bf')),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Approved Clerk","requested_role":"clerk"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'e4ccdd33-7e2d-4ef8-bb6d-6bb9bd380a55',
    'authenticated',
    'authenticated',
    'pending.clerk@magistrate-wizard.local',
    crypt('password123', gen_salt('bf')),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Pending Clerk","requested_role":"clerk"}'::jsonb,
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
    'c2aabb11-9c0b-4ef8-bb6d-6bb9bd380a33',
    'c2aabb11-9c0b-4ef8-bb6d-6bb9bd380a33',
    jsonb_build_object(
      'sub', 'c2aabb11-9c0b-4ef8-bb6d-6bb9bd380a33',
      'email', 'pending.magistrate@magistrate-wizard.local',
      'email_verified', true
    ),
    'email',
    now(),
    now(),
    now(),
    'c2aabb11-9c0b-4ef8-bb6d-6bb9bd380a33'
  ),
  (
    'd3bbcc22-8d1c-4ef8-bb6d-6bb9bd380a44',
    'd3bbcc22-8d1c-4ef8-bb6d-6bb9bd380a44',
    jsonb_build_object(
      'sub', 'd3bbcc22-8d1c-4ef8-bb6d-6bb9bd380a44',
      'email', 'clerk@magistrate-wizard.local',
      'email_verified', true
    ),
    'email',
    now(),
    now(),
    now(),
    'd3bbcc22-8d1c-4ef8-bb6d-6bb9bd380a44'
  ),
  (
    'e4ccdd33-7e2d-4ef8-bb6d-6bb9bd380a55',
    'e4ccdd33-7e2d-4ef8-bb6d-6bb9bd380a55',
    jsonb_build_object(
      'sub', 'e4ccdd33-7e2d-4ef8-bb6d-6bb9bd380a55',
      'email', 'pending.clerk@magistrate-wizard.local',
      'email_verified', true
    ),
    'email',
    now(),
    now(),
    now(),
    'e4ccdd33-7e2d-4ef8-bb6d-6bb9bd380a55'
  )
on conflict (id) do nothing;

update public.profiles
set role = 'clerk'
where id in (
  'd3bbcc22-8d1c-4ef8-bb6d-6bb9bd380a44',
  'e4ccdd33-7e2d-4ef8-bb6d-6bb9bd380a55'
);

insert into public.clerk_courts (profile_id, court_id, approved_by)
select
  'd3bbcc22-8d1c-4ef8-bb6d-6bb9bd380a44'::uuid,
  c.id,
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid
from public.courts c
where c.name = 'Georgetown Magistrates'' Court 1'
  and not exists (
    select 1
    from public.clerk_courts cc
    where cc.profile_id = 'd3bbcc22-8d1c-4ef8-bb6d-6bb9bd380a44'
      and cc.court_id = c.id
      and cc.ended_at is null
  )
limit 1;
