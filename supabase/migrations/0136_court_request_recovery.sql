-- 0136_court_request_recovery.sql
--
-- Make court-request review recoverable from human error:
--   1. Requester-facing decision copy says the request was returned and
--      how to continue (request again, or ask admin to correct account type).
--   2. return_unassigned_magistrate_to_requester() requires a reason.
--   3. correct_unassigned_account_type() lets an admin flip magistrate
--      <-> clerk only when the person has no active court on either table.
--      Pending requests of the old type are cancelled (not rejected) so
--      the generic "request again as your current role" notify does not
--      fire; one account_type_corrected notice points at the right page.

-- 1. Notification type for account-type correction --------------------

do $$
declare
  cname text;
begin
  select con.conname
    into cname
  from pg_constraint con
  where con.conrelid = 'public.notifications'::regclass
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%court_request%';
  if cname is not null then
    execute format('alter table public.notifications drop constraint %I', cname);
  end if;
end $$;

alter table public.notifications
  add constraint notifications_type_check check (type in (
    'share_granted',
    'share_revoked',
    'judgment_final',
    'court_assigned',
    'clerk_request',
    'clerk_request_decided',
    'court_request',
    'court_request_decided',
    'account_type_corrected',
    'hearing_tomorrow',
    'stale_draft'
  ));

-- 2. Returned (rejected) request copy ---------------------------------

create or replace function public.magistrate_court_requests_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_court text;
  v_reason text;
begin
  select name into v_court from public.courts where id = new.court_id;

  if tg_op = 'INSERT' and new.status::text = 'pending' then
    perform public.notify_admins(
      'court_request',
      'Magistrate court request',
      coalesce(v_court, 'A magistrate requested a court assignment.'),
      '/admin/court-assignments'
    );
  elsif tg_op = 'UPDATE'
    and old.status::text = 'pending'
    and new.status::text in ('approved', 'rejected')
  then
    v_reason := nullif(trim(coalesce(new.rejection_reason, '')), '');
    perform public.notify_user(
      new.profile_id,
      'court_request_decided',
      case
        when new.status::text = 'approved' then 'Your court request was approved'
        else 'Your court request was returned'
      end,
      case
        when new.status::text = 'approved' then
          coalesce(v_court, 'See Court Assignments for details.')
        else
          trim(both from concat_ws(
            ' ',
            v_reason,
            'You can request again from Court Assignments. If you signed up as the wrong account type, contact a Court Assignment Administrator.'
          ))
      end,
      '/court-assignments'
    );
  end if;

  return new;
end;
$$;

-- 3. Roster return: reason required, same next-step copy --------------

create or replace function public.return_unassigned_magistrate_to_requester(
  p_profile_id uuid,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_rejected integer := 0;
  v_now timestamptz := now();
begin
  if not (select public.is_admin()) then
    raise exception 'You are not currently authorized to review court assignment requests';
  end if;

  if p_profile_id is null then
    raise exception 'Profile is required';
  end if;

  if p_profile_id = (select auth.uid()) then
    raise exception 'You cannot send your own court assignment back from this screen';
  end if;

  if v_reason is null then
    raise exception 'A reason is required so the requester knows what to do next';
  end if;

  select role into v_role
  from public.profiles
  where id = p_profile_id;

  if v_role is null then
    raise exception 'Profile not found';
  end if;

  if v_role <> 'magistrate' then
    raise exception 'Only an unassigned magistrate can be sent back to request a court';
  end if;

  if exists (
    select 1
    from public.magistrate_courts
    where profile_id = p_profile_id
      and ended_at is null
  ) then
    raise exception 'This magistrate already has an active court. End that assignment first.';
  end if;

  -- Notify first so a following per-row reject trigger is deduped
  -- (notify_user matches type+link within 20 hours) and the person
  -- sees the return wording rather than a generic rejection.
  perform public.notify_user(
    p_profile_id,
    'court_request_decided',
    'Your court request was returned',
    trim(both from concat_ws(
      ' ',
      v_reason,
      'You can request again from Court Assignments. If you signed up as the wrong account type, contact a Court Assignment Administrator.'
    )),
    '/court-assignments'
  );

  update public.magistrate_court_requests
  set status = 'rejected',
      reviewed_at = v_now,
      reviewed_by = (select auth.uid()),
      rejection_reason = v_reason
  where profile_id = p_profile_id
    and status = 'pending';

  get diagnostics v_rejected = row_count;

  return v_rejected;
end;
$$;

comment on function public.return_unassigned_magistrate_to_requester(uuid, text) is
  'Admin-only Roster action for a magistrate with no active court. Requires a reason. Rejects any still-pending magistrate_court_requests for that profile and notifies them to request again. Does not change profiles.role. Blocked for the caller''s own profile and for anyone who already holds an active magistrate_courts row.';

-- 4. Gated magistrate <-> clerk correction ----------------------------

create or replace function public.correct_unassigned_account_type(
  p_profile_id uuid,
  p_new_role public.user_role,
  p_reason text
)
returns public.user_role
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_now timestamptz := now();
  v_link text;
  v_title text;
begin
  if not (select public.is_admin()) then
    raise exception 'You are not currently authorized to correct account types';
  end if;

  if p_profile_id is null then
    raise exception 'Profile is required';
  end if;

  if p_profile_id = (select auth.uid()) then
    raise exception 'You cannot correct your own account type from this screen';
  end if;

  if v_reason is null then
    raise exception 'A reason is required so the person knows why their account type changed';
  end if;

  if p_new_role is null or p_new_role not in ('magistrate', 'clerk') then
    raise exception 'Account type can only be corrected between magistrate and clerk';
  end if;

  select role into v_role
  from public.profiles
  where id = p_profile_id;

  if v_role is null then
    raise exception 'Profile not found';
  end if;

  if v_role not in ('magistrate', 'clerk') then
    raise exception 'Only a magistrate or clerk account can be corrected this way';
  end if;

  if v_role = p_new_role then
    raise exception 'This account is already that type';
  end if;

  if exists (
    select 1
    from public.magistrate_courts
    where profile_id = p_profile_id
      and ended_at is null
  ) then
    raise exception 'End their magistrate court assignment before correcting the account type';
  end if;

  if exists (
    select 1
    from public.clerk_courts
    where profile_id = p_profile_id
      and ended_at is null
  ) then
    raise exception 'End their clerk court access before correcting the account type';
  end if;

  update public.profiles
  set role = p_new_role
  where id = p_profile_id;

  -- Cancel, do not reject: rejected would notify them to request again
  -- as the old role (magistrate_court_requests_notify / clerk_access_requests_notify).
  update public.magistrate_court_requests
  set status = 'cancelled',
      cancelled_at = v_now
  where profile_id = p_profile_id
    and status = 'pending';

  update public.clerk_access_requests
  set status = 'cancelled',
      cancelled_at = v_now
  where profile_id = p_profile_id
    and status = 'pending';

  if p_new_role = 'clerk' then
    v_link := '/clerk-access';
    v_title := 'Your account type was corrected to Court Clerk';
  else
    v_link := '/court-assignments';
    v_title := 'Your account type was corrected to Magistrate';
  end if;

  perform public.notify_user(
    p_profile_id,
    'account_type_corrected',
    v_title,
    trim(both from concat_ws(
      ' ',
      v_reason,
      'Refresh or sign in again, then request access on the correct page.'
    )),
    v_link
  );

  return p_new_role;
end;
$$;

comment on function public.correct_unassigned_account_type(uuid, public.user_role, text) is
  'Admin-only recovery for a magistrate/clerk signup mistake. Flips profiles.role between magistrate and clerk when the person has no active magistrate_courts or clerk_courts row. Cancels pending requests of either type so they leave the old queue, and notifies them to continue on the matching page. Never converts to/from admin, never acts on the caller''s own profile. Role change is captured by the existing profiles privilege audit trigger (0113).';

grant execute on function public.correct_unassigned_account_type(uuid, public.user_role, text) to authenticated;
