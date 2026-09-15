-- ============================================================================
-- 0152_people_court_occupancy_and_exceptions.sql
--
-- Court occupancy, special seating exceptions, and admin transfer.
--
-- Occupancy is no longer "any active regular magistrate_courts row". A
-- pending request never occupies a court. An approved regular sitting
-- occupies the court only after that person has a successful sign-in
-- (auth_event_log.login_success) — the same signal /admin/people uses
-- for last login. Until then the court stays available for another
-- signup or assignment.
--
-- A magistrate may request an already-occupied court as
-- request_kind='occupied_exception'. That request still does not occupy
-- the slot. Only a Court Assignment Administrator can resolve it:
--   replace  — end every other regular at that court, seat the requester
--              as regular
--   co_sit   — seat the requester as acting alongside the current primary
--              (two magistrates sit; the unique primary slot stays with
--              the incumbent)
--
-- Admins can also seat or transfer from People / Roster via the RPCs
-- below, with the same replace / co-sit choice when the destination is
-- occupied by a signed-in primary.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Occupancy helpers
-- ----------------------------------------------------------------------------

create or replace function public.profile_has_completed_first_sign_in(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.auth_event_log e
    where e.event_type = 'login_success'
      and (
        e.actor_id = p_profile_id
        or (
          e.email is not null
          and e.email = (select p.email from public.profiles p where p.id = p_profile_id)
        )
      )
  );
$$;

comment on function public.profile_has_completed_first_sign_in(uuid) is
  'True when this profile has at least one login_success in auth_event_log, matching /admin/people last-login. Used to decide whether an active regular sitting occupies the court''s primary slot.';

revoke all on function public.profile_has_completed_first_sign_in(uuid) from public, anon, authenticated;

alter table public.magistrate_courts
  add column if not exists occupies_primary_slot boolean not null default false;

comment on column public.magistrate_courts.occupies_primary_slot is
  'True only for an active assignment_type=regular sitting whose magistrate has signed in at least once. Pending requests and never-logged-in regulars do not occupy the court.';

create or replace function public.sync_magistrate_court_occupies_primary_slot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assignment_type = 'regular' and new.ended_at is null then
    new.occupies_primary_slot := public.profile_has_completed_first_sign_in(new.profile_id);
  else
    new.occupies_primary_slot := false;
  end if;
  return new;
end;
$$;

drop trigger if exists a_sync_magistrate_court_occupies_primary_slot_trigger on public.magistrate_courts;
create trigger a_sync_magistrate_court_occupies_primary_slot_trigger
  before insert or update on public.magistrate_courts
  for each row
  execute function public.sync_magistrate_court_occupies_primary_slot();

update public.magistrate_courts mc
set occupies_primary_slot = (mc.assignment_type = 'regular' and mc.ended_at is null
  and public.profile_has_completed_first_sign_in(mc.profile_id));

create or replace function public.court_has_active_primary_magistrate(p_court_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.magistrate_courts mc
    where mc.court_id = p_court_id
      and mc.assignment_type = 'regular'
      and mc.ended_at is null
      and mc.occupies_primary_slot
  );
$$;

comment on function public.court_has_active_primary_magistrate(uuid) is
  'True when a signed-in primary (regular) magistrate currently sits this court. Pending requests and never-logged-in regulars do not count.';

create or replace function public.check_primary_magistrate_exclusivity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assignment_type is distinct from 'regular' then
    return new;
  end if;
  if new.ended_at is not null then
    return new;
  end if;
  if not coalesce(new.occupies_primary_slot, false) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.court_id::text, 0));

  if exists (
    select 1
    from public.magistrate_courts mc
    where mc.court_id = new.court_id
      and mc.assignment_type = 'regular'
      and mc.ended_at is null
      and mc.occupies_primary_slot
      and mc.id is distinct from new.id
  ) then
    raise exception 'This court already has an active primary magistrate assignment -- cannot approve.'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

comment on function public.check_primary_magistrate_exclusivity() is
  'Blocks a second occupying (signed-in) regular magistrate at the same court. Never-logged-in regulars and acting/relief/other sittings are exempt. Takes a per-court advisory lock. Raises 23505.';

drop index if exists public.magistrate_courts_primary_per_court_idx;

do $$
declare
  v_conflicting_court_ids uuid[];
begin
  select array_agg(court_id) into v_conflicting_court_ids
  from (
    select court_id
    from public.magistrate_courts
    where assignment_type = 'regular' and ended_at is null and occupies_primary_slot
    group by court_id
    having count(*) > 1
  ) conflicts;

  if v_conflicting_court_ids is null then
    execute
      'create unique index magistrate_courts_occupying_primary_per_court_idx '
      || 'on public.magistrate_courts (court_id) '
      || 'where assignment_type = ''regular'' and ended_at is null and occupies_primary_slot';
  else
    execute format(
      'create unique index magistrate_courts_occupying_primary_per_court_idx '
      || 'on public.magistrate_courts (court_id) '
      || 'where assignment_type = ''regular'' and ended_at is null and occupies_primary_slot and court_id <> all (%L)',
      v_conflicting_court_ids
    );
    raise notice 'magistrate_courts_occupying_primary_per_court_idx created, excluding % still-conflicted court(s): %',
      array_length(v_conflicting_court_ids, 1), v_conflicting_court_ids;
  end if;
end $$;

comment on index public.magistrate_courts_occupying_primary_per_court_idx is
  'At most one occupying (signed-in) primary magistrate per court. Never-logged-in regulars do not take this slot.';

-- First successful sign-in claims the slot, or yields if another signed-in
-- primary already sits that court (the never-logged-in "ghost" regular ends).
create or replace function public.claim_primary_slot_on_first_sign_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  if new.event_type is distinct from 'login_success' then
    return new;
  end if;

  v_profile_id := new.actor_id;
  if v_profile_id is null and new.email is not null then
    select p.id into v_profile_id
    from public.profiles p
    where lower(p.email) = lower(new.email)
    limit 1;
  end if;
  if v_profile_id is null then
    return new;
  end if;

  update public.magistrate_courts mc
  set ended_at = now(),
      ended_by = v_profile_id,
      end_reason = 'Ended automatically: this court already has a signed-in primary magistrate'
  where mc.profile_id = v_profile_id
    and mc.assignment_type = 'regular'
    and mc.ended_at is null
    and exists (
      select 1
      from public.magistrate_courts o
      where o.court_id = mc.court_id
        and o.assignment_type = 'regular'
        and o.ended_at is null
        and o.occupies_primary_slot
        and o.profile_id is distinct from v_profile_id
    );

  update public.magistrate_courts mc
  set updated_at = now()
  where mc.profile_id = v_profile_id
    and mc.assignment_type = 'regular'
    and mc.ended_at is null;

  return new;
end;
$$;

drop trigger if exists claim_primary_slot_on_first_sign_in_trigger on public.auth_event_log;
create trigger claim_primary_slot_on_first_sign_in_trigger
  after insert on public.auth_event_log
  for each row
  execute function public.claim_primary_slot_on_first_sign_in();

-- ----------------------------------------------------------------------------
-- 2. Request kind + occupied resolution
-- ----------------------------------------------------------------------------

alter table public.magistrate_court_requests
  add column if not exists request_kind text not null default 'ordinary';

alter table public.magistrate_court_requests
  add column if not exists occupied_resolution text;

update public.magistrate_court_requests
set request_kind = 'ordinary'
where request_kind is null or request_kind not in ('ordinary', 'occupied_exception');

alter table public.magistrate_court_requests
  drop constraint if exists magistrate_court_requests_request_kind_check;
alter table public.magistrate_court_requests
  add constraint magistrate_court_requests_request_kind_check
  check (request_kind in ('ordinary', 'occupied_exception'));

alter table public.magistrate_court_requests
  drop constraint if exists magistrate_court_requests_occupied_resolution_check;
alter table public.magistrate_court_requests
  add constraint magistrate_court_requests_occupied_resolution_check
  check (occupied_resolution is null or occupied_resolution in ('replace', 'co_sit'));

comment on column public.magistrate_court_requests.request_kind is
  'ordinary = court was free at request time. occupied_exception = requester asked for a court that already has a signed-in primary; admin must replace or co-sit. The request itself never occupies the court.';
comment on column public.magistrate_court_requests.occupied_resolution is
  'Admin decision on an occupied-exception approval: replace the incumbent primary, or seat this magistrate as acting alongside them.';

create or replace function public.end_other_regular_assignments_at_court(
  p_court_id uuid,
  p_keep_profile_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.magistrate_courts
  set ended_at = now(),
      ended_by = (select auth.uid()),
      end_reason = coalesce(nullif(trim(p_reason), ''), 'Replaced by administrator')
  where court_id = p_court_id
    and assignment_type = 'regular'
    and ended_at is null
    and profile_id is distinct from p_keep_profile_id;
end;
$$;

revoke all on function public.end_other_regular_assignments_at_court(uuid, uuid, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Signup / self-service: occupied courts become occupied_exception requests
-- ----------------------------------------------------------------------------

create or replace function public.submit_magistrate_court_request(
  p_court_id uuid,
  p_staff_id text default null,
  p_note text default null
)
returns public.magistrate_court_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_request public.magistrate_court_requests;
  v_kind text;
begin
  select role into v_role from public.profiles where id = (select auth.uid());
  if v_role is null or v_role not in ('magistrate', 'admin') then
    raise exception 'Only a magistrate (or an administrator who also sits as a magistrate) may request a court assignment';
  end if;

  if not exists (select 1 from public.courts where id = p_court_id and is_active = true) then
    raise exception 'Court not found or inactive';
  end if;

  if exists (
    select 1 from public.magistrate_courts
    where profile_id = (select auth.uid()) and court_id = p_court_id and ended_at is null
  ) then
    raise exception 'You already have an active assignment at this court';
  end if;

  if exists (
    select 1 from public.magistrate_court_requests
    where profile_id = (select auth.uid()) and court_id = p_court_id and status = 'pending'
  ) then
    raise exception 'You already have a pending request for this court';
  end if;

  v_kind := case
    when public.court_has_active_primary_magistrate(p_court_id) then 'occupied_exception'
    else 'ordinary'
  end;

  insert into public.magistrate_court_requests (
    profile_id, court_id, staff_id, note, request_kind
  ) values (
    (select auth.uid()),
    p_court_id,
    nullif(trim(coalesce(p_staff_id, '')), ''),
    nullif(trim(coalesce(p_note, '')), ''),
    v_kind
  )
  returning * into v_request;

  return v_request;
end;
$$;

comment on function public.submit_magistrate_court_request(uuid, text, text) is
  'Magistrate (or sitting-admin) self-service: create one independent pending request. Occupied courts are accepted as request_kind=occupied_exception and still do not occupy the slot. Admin replace/co-sit is required before seating.';

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
      insert into public.magistrate_court_requests (profile_id, court_id, staff_id, note, request_kind)
      select
        new.id,
        c.id,
        nullif(trim(new.raw_user_meta_data ->> 'staff_id'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'note'), ''),
        case
          when public.court_has_active_primary_magistrate(c.id) then 'occupied_exception'
          else 'ordinary'
        end
      from public.courts c
      where c.id = any (v_requested_court_ids) and c.is_active = true
      on conflict (profile_id, court_id) where status = 'pending' do nothing;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Auto-provisions a profiles row on signup, and creates pending court requests for valid active court ids. Magistrate requests for a court that already has a signed-in primary are stored as occupied_exception and do not occupy the slot. Invalid ids never fail signup.';

-- ----------------------------------------------------------------------------
-- 4. Admin decide: replace vs co-sit
-- ----------------------------------------------------------------------------

drop function if exists public.decide_magistrate_court_request(uuid, public.magistrate_court_decision, text);

create or replace function public.decide_magistrate_court_request(
  p_request_id uuid,
  p_decision public.magistrate_court_decision,
  p_rejection_reason text default null,
  p_occupied_resolution text default null
)
returns public.magistrate_court_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.magistrate_court_requests;
  v_now timestamptz := now();
  v_reason text;
  v_resolution text;
  v_occupied boolean;
  v_assignment_type text;
begin
  if not (select public.is_admin()) then
    raise exception 'Only a Court Assignment Administrator may review court assignment requests';
  end if;

  select * into v_request
  from public.magistrate_court_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'Court assignment request not found';
  end if;

  if v_request.profile_id = (select auth.uid()) then
    raise exception 'You cannot approve or reject your own court assignment request';
  end if;

  if v_request.status in ('approved', 'rejected') then
    return v_request;
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request is no longer pending (status: %)', v_request.status;
  end if;

  if p_decision = 'rejected' then
    v_reason := nullif(trim(coalesce(p_rejection_reason, '')), '');
    if v_reason is null then
      raise exception 'A reason is required when returning a request to the requester';
    end if;

    update public.magistrate_court_requests
    set status = 'rejected',
        reviewed_at = v_now,
        reviewed_by = (select auth.uid()),
        rejection_reason = v_reason,
        occupied_resolution = null
    where id = p_request_id
    returning * into v_request;

    return v_request;
  end if;

  v_occupied := public.court_has_active_primary_magistrate(v_request.court_id);
  v_resolution := nullif(trim(coalesce(p_occupied_resolution, '')), '');

  if v_occupied or v_request.request_kind = 'occupied_exception' then
    if not v_occupied then
      v_assignment_type := 'regular';
      v_resolution := null;
    else
      if v_resolution is null or v_resolution not in ('replace', 'co_sit') then
        raise exception 'This court already has a signed-in primary magistrate. Choose replace (end the current primary) or co_sit (seat this magistrate as acting alongside them).';
      end if;
      if v_resolution = 'replace' then
        perform public.end_other_regular_assignments_at_court(
          v_request.court_id,
          v_request.profile_id,
          'Replaced by administrator for a special seating exception'
        );
        v_assignment_type := 'regular';
      else
        v_assignment_type := 'acting';
      end if;
    end if;
  else
    v_assignment_type := 'regular';
    v_resolution := null;
  end if;

  begin
    insert into public.magistrate_courts (profile_id, court_id, assignment_type, started_at)
    values (v_request.profile_id, v_request.court_id, v_assignment_type, v_now)
    on conflict (profile_id, court_id) where ended_at is null do nothing;
  exception when unique_violation then
    raise exception 'This court already has an active primary magistrate assignment -- cannot approve.';
  end;

  update public.magistrate_court_requests
  set status = 'approved',
      reviewed_at = v_now,
      reviewed_by = (select auth.uid()),
      rejection_reason = null,
      approval_kind = coalesce(v_request.approval_kind, 'ordinary'),
      occupied_resolution = v_resolution
  where id = p_request_id
  returning * into v_request;

  return v_request;
end;
$$;

comment on function public.decide_magistrate_court_request(uuid, public.magistrate_court_decision, text, text) is
  'Admin approve/return of a magistrate court request. Occupied courts require p_occupied_resolution=replace|co_sit. Requests never occupy a slot; replace/co-sit only take effect on approval. Self-approval is still blocked.';

revoke all on function public.decide_magistrate_court_request(uuid, public.magistrate_court_decision, text, text) from public, anon;
grant execute on function public.decide_magistrate_court_request(uuid, public.magistrate_court_decision, text, text) to authenticated;

create or replace function public.admin_bootstrap_self_approve_magistrate_court_request(
  p_request_id uuid,
  p_reason text
)
returns public.magistrate_court_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.magistrate_court_requests;
  v_now timestamptz := now();
  v_active_admin_count int;
  v_reason text;
  v_token_age_seconds numeric;
begin
  if not (select public.is_admin()) then
    raise exception 'Only a Court Assignment Administrator may use this exception';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'A reason is required to use the sole-administrator self-approval exception';
  end if;

  v_token_age_seconds := extract(epoch from now()) - (select (auth.jwt() ->> 'iat')::numeric);
  if v_token_age_seconds is null or v_token_age_seconds > 300 then
    raise exception 'This action requires a recent sign-in. Please re-enter your password and try again.';
  end if;

  select * into v_request
  from public.magistrate_court_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'Court assignment request not found';
  end if;

  if v_request.status in ('approved', 'rejected') then
    return v_request;
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request is no longer pending (status: %)', v_request.status;
  end if;

  if v_request.profile_id <> (select auth.uid()) then
    raise exception 'This exception is only for approving your own request -- use decide_magistrate_court_request() for other requests';
  end if;

  select count(*) into v_active_admin_count
  from public.profiles
  where role = 'admin' and is_active = true;

  if v_active_admin_count <> 1 then
    raise exception 'The sole-administrator exception is unavailable: % active administrators currently exist. Ask another administrator to review this request.', v_active_admin_count;
  end if;

  if public.court_has_active_primary_magistrate(v_request.court_id)
     or v_request.request_kind = 'occupied_exception' then
    raise exception 'This court already has a signed-in primary magistrate. The sole-administrator exception cannot replace or co-sit; ask another administrator once one exists, or transfer from People.';
  end if;

  begin
    insert into public.magistrate_courts (profile_id, court_id, assignment_type, started_at)
    values (v_request.profile_id, v_request.court_id, 'regular', v_now)
    on conflict (profile_id, court_id) where ended_at is null do nothing;
  exception when unique_violation then
    raise exception 'This court already has an active primary magistrate assignment -- cannot approve.';
  end;

  update public.magistrate_court_requests
  set status = 'approved',
      reviewed_at = v_now,
      reviewed_by = (select auth.uid()),
      rejection_reason = null,
      approval_kind = 'bootstrap_self_approval'
  where id = p_request_id
  returning * into v_request;

  return v_request;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Admin seat + transfer (People / Roster)
-- ----------------------------------------------------------------------------

create or replace function public.admin_seat_magistrate_at_court(
  p_profile_id uuid,
  p_court_id uuid,
  p_assignment_type text default 'regular',
  p_if_occupied text default null,
  p_reason text default null
)
returns public.magistrate_courts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_type text;
  v_resolution text;
  v_row public.magistrate_courts;
begin
  if not (select public.is_admin()) then
    raise exception 'Only a Court Assignment Administrator may assign a court';
  end if;

  select role into v_role from public.profiles where id = p_profile_id;
  if v_role is null then
    raise exception 'Profile not found';
  end if;
  if v_role not in ('magistrate', 'admin') then
    raise exception 'Only a magistrate (or administrator) can be seated at a court';
  end if;

  if not exists (select 1 from public.courts where id = p_court_id and is_active = true) then
    raise exception 'Court not found or inactive';
  end if;

  v_type := coalesce(nullif(trim(p_assignment_type), ''), 'regular');
  if v_type not in ('regular', 'acting', 'relief', 'other') then
    raise exception 'Invalid assignment type';
  end if;

  v_resolution := nullif(trim(coalesce(p_if_occupied, '')), '');

  if v_type = 'regular' and public.court_has_active_primary_magistrate(p_court_id) then
    if v_resolution is null or v_resolution not in ('replace', 'co_sit') then
      raise exception 'This court already has a signed-in primary magistrate. Choose replace or co_sit.';
    end if;
    if v_resolution = 'replace' then
      perform public.end_other_regular_assignments_at_court(
        p_court_id,
        p_profile_id,
        coalesce(nullif(trim(p_reason), ''), 'Replaced by administrator')
      );
    else
      v_type := 'acting';
    end if;
  end if;

  begin
    insert into public.magistrate_courts (profile_id, court_id, assignment_type, started_at)
    values (p_profile_id, p_court_id, v_type, now())
    on conflict (profile_id, court_id) where ended_at is null do nothing
    returning * into v_row;
  exception when unique_violation then
    raise exception 'This court already has an active primary magistrate assignment -- cannot assign.';
  end;

  if v_row.id is null then
    raise exception 'This person already has an active assignment at this court';
  end if;

  return v_row;
end;
$$;

comment on function public.admin_seat_magistrate_at_court(uuid, uuid, text, text, text) is
  'Admin seating from People/Roster. Occupied courts require p_if_occupied=replace|co_sit (co-sit seats acting). Never-logged-in regulars do not occupy; a pending request never occupies.';

revoke all on function public.admin_seat_magistrate_at_court(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.admin_seat_magistrate_at_court(uuid, uuid, text, text, text) to authenticated;

create or replace function public.admin_transfer_magistrate_court(
  p_assignment_id uuid,
  p_new_court_id uuid,
  p_if_occupied text default null,
  p_reason text default null
)
returns public.magistrate_courts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.magistrate_courts;
  v_reason text;
begin
  if not (select public.is_admin()) then
    raise exception 'Only a Court Assignment Administrator may transfer a court assignment';
  end if;

  select * into v_src
  from public.magistrate_courts
  where id = p_assignment_id
  for update;

  if v_src.id is null then
    raise exception 'Court assignment not found';
  end if;
  if v_src.ended_at is not null then
    raise exception 'This assignment has already ended';
  end if;
  if v_src.court_id = p_new_court_id then
    raise exception 'Choose a different court to transfer to';
  end if;

  v_reason := coalesce(nullif(trim(p_reason), ''), 'Transferred by administrator');

  update public.magistrate_courts
  set ended_at = now(),
      ended_by = (select auth.uid()),
      end_reason = v_reason
  where id = p_assignment_id;

  return public.admin_seat_magistrate_at_court(
    v_src.profile_id,
    p_new_court_id,
    v_src.assignment_type,
    p_if_occupied,
    v_reason
  );
end;
$$;

comment on function public.admin_transfer_magistrate_court(uuid, uuid, text, text) is
  'Ends the current sitting and seats the same magistrate at another court. If the destination has a signed-in primary, p_if_occupied=replace|co_sit is required.';

revoke all on function public.admin_transfer_magistrate_court(uuid, uuid, text, text) from public, anon;
grant execute on function public.admin_transfer_magistrate_court(uuid, uuid, text, text) to authenticated;
