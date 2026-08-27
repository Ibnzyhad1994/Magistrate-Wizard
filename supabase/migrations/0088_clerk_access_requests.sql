-- ============================================================================
-- 0088_clerk_access_requests.sql
--
-- The clerk court-access REQUEST structure -- one row per (clerk, court)
-- request. Every requested court generates its own independent row/
-- decision (enforced by the partial unique index below scoping "no
-- duplicate active pending request" to the exact court, never the
-- district). Ordinary clerks can only ever reach this table through two
-- narrow SECURITY DEFINER RPCs (submit/cancel) and extended
-- handle_new_user() at signup -- there is deliberately NO direct client
-- INSERT/UPDATE policy for clerks or magistrates, so "call Supabase
-- directly" cannot mutate status, reviewer, or decision fields no matter
-- what a crafted request sends.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Status enum + table
-- ----------------------------------------------------------------------------

create type public.clerk_access_request_status as enum (
  'pending', 'approved', 'rejected', 'cancelled', 'expired'
);

create table public.clerk_access_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  court_id uuid not null references public.courts (id) on delete restrict,
  status public.clerk_access_request_status not null default 'pending',
  staff_id text,
  note text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  rejection_reason text,
  cancelled_at timestamptz,
  expires_at timestamptz,
  notified_magistrate_at timestamptz,
  notified_clerk_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint clerk_access_requests_reviewed_iff_decided check (
    (status in ('approved', 'rejected') and reviewed_at is not null and reviewed_by is not null)
    or (status not in ('approved', 'rejected') and reviewed_at is null and reviewed_by is null)
  ),
  constraint clerk_access_requests_rejection_reason_iff_rejected check (
    (rejection_reason is null) or (status = 'rejected')
  ),
  constraint clerk_access_requests_cancelled_iff_cancelled check (
    (cancelled_at is not null) = (status = 'cancelled')
  ),
  constraint clerk_access_requests_expiry_only_while_relevant check (
    expires_at is null or status in ('pending', 'expired')
  )
);

comment on table public.clerk_access_requests is
  'One row per (clerk, court) court-access request -- every requested court is reviewed and decided independently (see the partial unique index below). Ordinary clerks reach this table only through submit_clerk_access_request()/cancel_clerk_access_request() (SECURITY DEFINER) and signup-time creation in handle_new_user() -- there is no direct client INSERT/UPDATE policy for clerks or magistrates, so status/reviewer/decision fields cannot be altered by a raw Supabase call.';
comment on column public.clerk_access_requests.staff_id is 'Optional employee/staff identification number, as supplied at request time.';
comment on column public.clerk_access_requests.note is 'Optional short free-text note (e.g. clerk''s office or the magistrate they expect to work under).';
comment on column public.clerk_access_requests.notified_magistrate_at is 'Set by the clerk-access-notify Edge Function after it independently re-verifies and sends the magistrate notification email -- never client-writable.';
comment on column public.clerk_access_requests.notified_clerk_at is 'Set by the clerk-access-notify Edge Function after it independently re-verifies and sends the clerk decision notification email -- never client-writable.';

create trigger set_clerk_access_requests_updated_at
  before update on public.clerk_access_requests
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Indexes -- prevents duplicate ACTIVE pending requests for the exact
--    same (clerk, court) pair. Scoped to court_id, never district_id --
--    approval for one court in a district must never imply another.
-- ----------------------------------------------------------------------------

create unique index clerk_access_requests_pending_pair_idx
  on public.clerk_access_requests (profile_id, court_id)
  where status = 'pending';

create index clerk_access_requests_profile_id_idx on public.clerk_access_requests (profile_id);
create index clerk_access_requests_court_id_idx on public.clerk_access_requests (court_id);
create index clerk_access_requests_status_idx on public.clerk_access_requests (status);
create index clerk_access_requests_pending_court_idx on public.clerk_access_requests (court_id) where status = 'pending';

-- ----------------------------------------------------------------------------
-- 3. clerk_access_request_email_confirmed(request_id)
--
-- A verified clerk's request must not be reviewable/notifiable before
-- email verification. This is deliberately scoped to a specific EXISTING
-- request id (not a free profile-id lookup) -- it only ever answers "is
-- the owner of THIS request verified", not a general email-status oracle
-- against arbitrary profiles. SECURITY DEFINER is required to read
-- auth.users.email_confirmed_at, which `authenticated` has no direct
-- grant on.
-- ----------------------------------------------------------------------------

create or replace function public.clerk_access_request_email_confirmed(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.clerk_access_requests r
    join auth.users u on u.id = r.profile_id
    where r.id = p_request_id and u.email_confirmed_at is not null
  );
$$;

comment on function public.clerk_access_request_email_confirmed(uuid) is
  'True only if the clerk who owns clerk_access_requests row p_request_id has a confirmed email (auth.users.email_confirmed_at is not null). Scoped to one specific existing request id, not a general profile-email-status lookup. Used to keep an unverified clerk''s request invisible to the reviewing magistrate and un-notified, regardless of the project''s auth confirmation setting.';

grant execute on function public.clerk_access_request_email_confirmed(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. handle_new_user() -- extended to create one request per requested,
--    currently-active court, ONLY for a resolved role of 'clerk'. Invalid
--    or inactive court ids are silently skipped (never raised as an
--    error that would abort the whole signup) -- courts are sourced
--    entirely from the existing public.courts table, never hard-coded.
--    A malformed requested_court_ids payload degrades to "no requests
--    created", never a broken signup.
-- ----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_requested_court_ids uuid[];
begin
  v_role := case
    when new.raw_user_meta_data ->> 'requested_role' = 'clerk' then 'clerk'::public.user_role
    else 'magistrate'::public.user_role
  end;

  insert into public.profiles (id, email, full_name, avatar_url, court_id, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    nullif(new.raw_user_meta_data ->> 'court_id', '')::uuid,
    v_role
  );

  if v_role = 'clerk' then
    begin
      select array_agg(elem::uuid)
      into v_requested_court_ids
      from jsonb_array_elements_text(
        coalesce(new.raw_user_meta_data -> 'requested_court_ids', '[]'::jsonb)
      ) as elem;
    exception when others then
      v_requested_court_ids := null;
    end;

    if v_requested_court_ids is not null and array_length(v_requested_court_ids, 1) > 0 then
      insert into public.clerk_access_requests (profile_id, court_id, staff_id, note)
      select
        new.id,
        c.id,
        nullif(trim(new.raw_user_meta_data ->> 'staff_id'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'note'), '')
      from public.courts c
      where c.id = any (v_requested_court_ids) and c.is_active = true
      on conflict (profile_id, court_id) where status = 'pending' do nothing;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Auto-provisions a profiles row on signup, and -- only when the account resolves to role=''clerk'' (0086''s safe requested_role check) -- creates one PENDING clerk_access_requests row per valid, currently-active requested court id. These requests are inert/invisible to any magistrate and un-notified until the clerk''s email is confirmed (clerk_access_request_email_confirmed()) -- no separate "activation" write is needed; visibility itself is gated on confirmation. Invalid court ids or a malformed payload are silently skipped, never a failed signup.';

-- ----------------------------------------------------------------------------
-- 5. submit_clerk_access_request(court_id, staff_id, note) -- an already-
--    authenticated clerk requesting an ADDITIONAL court later. Requires
--    role=''clerk''; the partial unique index (above) rejects a duplicate
--    active pending request for the same (clerk, court) pair.
-- ----------------------------------------------------------------------------

create or replace function public.submit_clerk_access_request(
  p_court_id uuid,
  p_staff_id text default null,
  p_note text default null
)
returns public.clerk_access_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.clerk_access_requests;
begin
  if not (select public.is_clerk()) then
    raise exception 'Only a clerk account may submit a court access request';
  end if;

  insert into public.clerk_access_requests (profile_id, court_id, staff_id, note)
  values (auth.uid(), p_court_id, nullif(trim(p_staff_id), ''), nullif(trim(p_note), ''))
  returning * into v_result;

  return v_result;
end;
$$;

comment on function public.submit_clerk_access_request(uuid, text, text) is
  'Lets an authenticated clerk request access to one additional court. Always creates its own independent request row -- never implies access to any other court in the same or a different district. Rejects a duplicate active pending request for the same (clerk, court) pair via the partial unique index.';

grant execute on function public.submit_clerk_access_request(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. cancel_clerk_access_request(request_id) -- a clerk may cancel only
--    their OWN still-pending request.
-- ----------------------------------------------------------------------------

create or replace function public.cancel_clerk_access_request(p_request_id uuid)
returns public.clerk_access_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.clerk_access_requests;
begin
  update public.clerk_access_requests
  set status = 'cancelled', cancelled_at = now()
  where id = p_request_id
    and profile_id = (select auth.uid())
    and status = 'pending'
  returning * into v_result;

  if v_result.id is null then
    raise exception 'This request cannot be cancelled (not found, not yours, or no longer pending)';
  end if;

  return v_result;
end;
$$;

comment on function public.cancel_clerk_access_request(uuid) is
  'Lets an authenticated clerk cancel exactly one of their OWN still-pending requests. No effect on any other request or on any already-approved court assignment.';

grant execute on function public.cancel_clerk_access_request(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Row Level Security
--
-- SELECT: the clerk sees all of their own requests regardless of
-- verification status (they need to see "please verify your email"
-- reflected somewhere); the authorized magistrate for that court sees it
-- ONLY once the requester's email is confirmed; admin sees everything
-- (fallback/orphan visibility).
--
-- No client-facing INSERT/UPDATE policy at all -- every ordinary write
-- path is one of the SECURITY DEFINER functions above (which, like
-- handle_new_user(), run as the function owner and are therefore not
-- subject to this table's RLS), except a narrow admin correction UPDATE
-- policy for the exceptional/orphaned-request fallback case.
-- ----------------------------------------------------------------------------

alter table public.clerk_access_requests enable row level security;

create policy "Clerks can view their own access requests"
  on public.clerk_access_requests for select
  using (
    profile_id = (select auth.uid())
    or (
      (select public.can_manage_clerk_access(court_id))
      and (select public.clerk_access_request_email_confirmed(id))
    )
    or (select public.is_admin())
  );

create policy "Admins can correct clerk access requests"
  on public.clerk_access_requests for update
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ----------------------------------------------------------------------------
-- 8. Audit trigger -- same reasoning as clerk_courts (0087): an
--    institutional record of who requested/decided what, not private
--    judicial content.
-- ----------------------------------------------------------------------------

create trigger audit_clerk_access_requests
  after insert or update or delete on public.clerk_access_requests
  for each row
  execute function public.audit_trigger_fn();
