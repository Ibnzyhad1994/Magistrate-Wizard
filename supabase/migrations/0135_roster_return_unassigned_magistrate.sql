-- 0135_roster_return_unassigned_magistrate.sql
--
-- Roster listed unassigned magistrates with only Assign. Reject lived
-- solely on Pending Requests, so a person who cancelled (or never had
-- an open request) could not be sent back. This:
--   1. Notifies the requester when a magistrate court request is
--      approved or rejected (clerk access already did this).
--   2. Adds return_unassigned_magistrate_to_requester() so an admin
--      on Roster can reject any still-open requests and notify the
--      person to request the correct court, or register as a clerk if
--      they chose the wrong account type.

-- 1. Allow requester-facing court-request decisions on notifications --

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
    'hearing_tomorrow',
    'stale_draft'
  ));

-- 2. Notify the magistrate when their request is decided ---------------

drop trigger if exists magistrate_court_requests_notify_trigger on public.magistrate_court_requests;

create or replace function public.magistrate_court_requests_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_court text;
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
    perform public.notify_user(
      new.profile_id,
      'court_request_decided',
      case
        when new.status::text = 'approved' then 'Your court request was approved'
        else 'Your court request was not approved'
      end,
      coalesce(
        nullif(trim(coalesce(new.rejection_reason, '')), ''),
        coalesce(v_court, 'See Court Assignments for details.')
      ),
      '/court-assignments'
    );
  end if;

  return new;
end;
$$;

create trigger magistrate_court_requests_notify_trigger
  after insert or update on public.magistrate_court_requests
  for each row execute function public.magistrate_court_requests_notify();

-- 3. Roster: send an unassigned magistrate back to request again ------

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
  -- sees the send-back wording rather than a generic rejection.
  perform public.notify_user(
    p_profile_id,
    'court_request_decided',
    'Your court assignment was sent back',
    coalesce(
      v_reason,
      'Sign in and request the correct court. If you registered as a magistrate by mistake, contact an administrator — this screen cannot change your account type to clerk.'
    ),
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
  'Admin-only Roster action for a magistrate with no active court. Rejects any still-pending magistrate_court_requests for that profile and notifies them to request the correct court. Does not change profiles.role (magistrate cannot become clerk here). Blocked for the caller''s own profile and for anyone who already holds an active magistrate_courts row.';

grant execute on function public.return_unassigned_magistrate_to_requester(uuid, text) to authenticated;
