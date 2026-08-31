-- ============================================================================
-- 0106_magistrate_court_requests.sql
--
-- The magistrate court-access REQUEST structure -- one row per (magistrate,
-- court) request, mirroring clerk_access_requests (0088) closely. Ordinary
-- magistrates can only ever reach this table through submit/cancel RPCs
-- (0107) and handle_new_user() at signup (extended at the end of this
-- migration) -- no direct client INSERT/UPDATE policy, so a raw Supabase
-- call cannot mutate status, reviewer, or decision fields.
--
-- requested_assignment_type is fixed to 'regular' by both the column
-- default and a CHECK constraint restricting it to exactly that one
-- value -- acting/relief assignments are never requested through this
-- table; they are admin-direct via admin_assign_magistrate_court() (0108).
-- This mirrors the real-world shape of an acting/relief appointment (the
-- administrator designates someone; there is no "applicant" to review),
-- and keeps "acting/relief cannot be self-created" structurally true
-- rather than merely policy-enforced.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Status enum + table
-- ----------------------------------------------------------------------------

create type public.magistrate_court_request_status as enum (
  'pending', 'approved', 'rejected', 'cancelled', 'expired'
);

create table public.magistrate_court_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  court_id uuid not null references public.courts (id) on delete restrict,
  requested_assignment_type text not null default 'regular'
    check (requested_assignment_type = 'regular'),
  status public.magistrate_court_request_status not null default 'pending',
  staff_id text,
  note text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  rejection_reason text,
  cancelled_at timestamptz,
  expires_at timestamptz,
  approval_kind text check (approval_kind in ('ordinary', 'bootstrap_self_approval')),
  notified_requester_at timestamptz,
  notified_admin_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint magistrate_court_requests_reviewed_iff_decided check (
    (status in ('approved', 'rejected') and reviewed_at is not null and reviewed_by is not null)
    or (status not in ('approved', 'rejected') and reviewed_at is null and reviewed_by is null)
  ),
  constraint magistrate_court_requests_rejection_reason_iff_rejected check (
    (rejection_reason is null) or (status = 'rejected')
  ),
  constraint magistrate_court_requests_cancelled_iff_cancelled check (
    (cancelled_at is not null) = (status = 'cancelled')
  ),
  constraint magistrate_court_requests_expiry_only_while_relevant check (
    expires_at is null or status in ('pending', 'expired')
  ),
  constraint magistrate_court_requests_approval_kind_iff_approved check (
    (approval_kind is null) or (status = 'approved')
  )
);

comment on table public.magistrate_court_requests is
  'One row per (magistrate, court) court-assignment request -- every requested court is reviewed and decided independently (see the partial unique index below). Ordinary magistrates reach this table only through submit_magistrate_court_request()/cancel_magistrate_court_request() (SECURITY DEFINER, 0107) and signup-time creation in handle_new_user() -- there is no direct client INSERT/UPDATE policy, so status/reviewer/decision fields cannot be altered by a raw Supabase call.';
comment on column public.magistrate_court_requests.staff_id is 'Optional employee/staff identification number, as supplied at request time.';
comment on column public.magistrate_court_requests.note is 'Optional short free-text note supplied at request time.';
comment on column public.magistrate_court_requests.approval_kind is 'NULL until decided. ''ordinary'' for a normal Court Assignment Administrator approval via decide_magistrate_court_request(). ''bootstrap_self_approval'' ONLY when approved via admin_bootstrap_self_approve_magistrate_court_request() (0107) -- the sole-administrator self-approval exception, permanently visible here and in audit_log so a bootstrap approval is never indistinguishable from an ordinary one.';
comment on column public.magistrate_court_requests.notified_requester_at is 'Set once the requester has been notified of the decision. In-app only for this pass (no email provider configured project-wide) -- reserved for a future notification mechanism, mirroring clerk_access_requests.notified_clerk_at.';
comment on column public.magistrate_court_requests.notified_admin_at is 'Set once an administrator has been notified a new request needs review. In-app only for this pass, mirroring clerk_access_requests.notified_magistrate_at.';

create trigger set_magistrate_court_requests_updated_at
  before update on public.magistrate_court_requests
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Indexes -- prevents duplicate ACTIVE pending requests for the exact
--    same (magistrate, court) pair.
-- ----------------------------------------------------------------------------

create unique index magistrate_court_requests_pending_pair_idx
  on public.magistrate_court_requests (profile_id, court_id)
  where status = 'pending';

create index magistrate_court_requests_profile_id_idx on public.magistrate_court_requests (profile_id);
create index magistrate_court_requests_court_id_idx on public.magistrate_court_requests (court_id);
create index magistrate_court_requests_status_idx on public.magistrate_court_requests (status);
create index magistrate_court_requests_pending_idx on public.magistrate_court_requests (court_id) where status = 'pending';

-- ----------------------------------------------------------------------------
-- 3. magistrate_court_request_email_confirmed(request_id) -- mirrors
--    clerk_access_request_email_confirmed() (0088) exactly. An unverified
--    magistrate's request must not be reviewable before email verification.
-- ----------------------------------------------------------------------------

create or replace function public.magistrate_court_request_email_confirmed(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.magistrate_court_requests r
    join auth.users u on u.id = r.profile_id
    where r.id = p_request_id and u.email_confirmed_at is not null
  );
$$;

comment on function public.magistrate_court_request_email_confirmed(uuid) is
  'True only if the magistrate who owns magistrate_court_requests row p_request_id has a confirmed email. Scoped to one specific existing request id, not a general profile-email-status lookup. Used to keep an unverified magistrate''s request invisible to admin review until confirmed, mirroring clerk_access_request_email_confirmed().';

grant execute on function public.magistrate_court_request_email_confirmed(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. handle_new_user() -- extended (forward modification, same precedent
--    as 0002/0086/0088) to also create one pending magistrate_court_requests
--    row per valid, currently-active requested court id when the resolved
--    role is 'magistrate' -- symmetric to the existing clerk branch.
--    Invalid/inactive court ids are silently skipped; a malformed payload
--    degrades to "no requests created", never a broken signup.
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
    if v_role = 'clerk' then
      insert into public.clerk_access_requests (profile_id, court_id, staff_id, note)
      select
        new.id,
        c.id,
        nullif(trim(new.raw_user_meta_data ->> 'staff_id'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'note'), '')
      from public.courts c
      where c.id = any (v_requested_court_ids) and c.is_active = true
      on conflict (profile_id, court_id) where status = 'pending' do nothing;
    elsif v_role = 'magistrate' then
      insert into public.magistrate_court_requests (profile_id, court_id, staff_id, note)
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
  'Auto-provisions a profiles row on signup, and -- based on the resolved role -- creates one PENDING request row per valid, currently-active requested court id: clerk_access_requests for role=''clerk'', magistrate_court_requests for role=''magistrate'' (the safe default). Both branches are invisible/un-notified until the owner''s email is confirmed (clerk_access_request_email_confirmed()/magistrate_court_request_email_confirmed()). Invalid court ids or a malformed payload are silently skipped, never a failed signup. Pending requests grant zero Docket access on their own -- approval (0107) is the only path to an active magistrate_courts row.';

-- ----------------------------------------------------------------------------
-- 5. Row Level Security
--
-- SELECT: the magistrate sees all of their own requests regardless of
-- verification status; the Court Assignment Administrator (is_admin())
-- sees a request only once the requester's email is confirmed.
--
-- No client-facing INSERT/UPDATE policy -- every ordinary write path is a
-- SECURITY DEFINER function (0107), except a narrow admin-correction
-- UPDATE policy for the exceptional/orphaned-request fallback case,
-- mirroring clerk_access_requests exactly.
-- ----------------------------------------------------------------------------

alter table public.magistrate_court_requests enable row level security;

create policy "Magistrates can view their own court requests"
  on public.magistrate_court_requests for select
  using (
    profile_id = (select auth.uid())
    or (
      (select public.is_admin())
      and (select public.magistrate_court_request_email_confirmed(id))
    )
  );

create policy "Admins can correct magistrate court requests"
  on public.magistrate_court_requests for update
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ----------------------------------------------------------------------------
-- 6. Audit trigger -- institutional roster record, same classification as
--    magistrate_courts/clerk_access_requests (0048/0087).
-- ----------------------------------------------------------------------------

create trigger audit_magistrate_court_requests
  after insert or update or delete on public.magistrate_court_requests
  for each row
  execute function public.audit_trigger_fn();
