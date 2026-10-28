-- Magistrate Wizard -- 0170: anonymous auth events share one global budget
--
-- Problem (backend sweep BE-11; system audit 3.4 "record_auth_event
-- accepts unlimited distinct emails")
--   record_auth_event (0113) lets anon report login_failed and
--   password_reset_requested, because the sign-in screen reports them
--   before there is a session. The only limit was 10 a minute per email,
--   so a script cycling through distinct emails wrote as many rows as it
--   liked: it could flood the security log the admins read and grow
--   auth_event_log without bound.
--
-- Change
--   record_auth_event is re-declared from 0113, identical except that the
--   two anonymous event types also draw on one budget of 120 accepted rows
--   a minute across every email, counted in rpc_rate_limit_buckets (0137)
--   under the nil user id. The insert ... on conflict ... returning takes
--   the bucket row's lock, so concurrent callers cannot overshoot it. A
--   call over either limit is dropped silently, as the per-email limit
--   already was: the sign-in screen never waits on or reports this write.
--   login_success and logout (signed in, 20 a minute per user) are
--   unchanged.
--
-- Not changed here
--   * Client-reported failed sign-ins remain client reports: a caller can
--     still put up to 10 a minute against one real email. Capturing them
--     server-side needs an Auth hook on the hosted project (BE-27 / BE-25
--     owner decisions).
--   * auth_event_log keeps its 0127 retention policy ("flag", "No
--     automatic delete"); purging it is a data-protection decision for the
--     owner, not a fix.
--
-- Threat model
--   Unchanged from 0113: SECURITY DEFINER because anon and authenticated
--   have no INSERT on auth_event_log; search_path pinned; anon and
--   authenticated keep EXECUTE. The new bucket row is written only by this
--   function and read by nobody but it; rpc_rate_limit_buckets stays
--   closed to every client role.
-- ============================================================================

create or replace function public.record_auth_event(
  p_event text,
  p_email text,
  p_user_agent text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.auth_event_type;
  v_email text;
  v_ua text;
  v_recent int;
  v_window timestamptz;
  v_accepted int;
begin
  begin
    v_event := p_event::public.auth_event_type;
  exception when invalid_text_representation then
    raise exception 'invalid auth event';
  end;

  v_email := nullif(lower(btrim(coalesce(p_email, ''))), '');
  if v_email is not null then
    v_email := left(v_email, 320);
  end if;
  v_ua := nullif(left(btrim(coalesce(p_user_agent, '')), 512), '');

  if v_event in ('login_success', 'logout') then
    if auth.uid() is null then
      raise exception 'not authenticated';
    end if;
    select count(*) into v_recent
    from public.auth_event_log
    where actor_id = auth.uid()
      and event_type = v_event
      and created_at > now() - interval '1 minute';
    if v_recent >= 20 then
      return;
    end if;
    insert into public.auth_event_log (event_type, actor_id, email, user_agent)
    values (
      v_event,
      auth.uid(),
      coalesce((select p.email from public.profiles p where p.id = auth.uid()), v_email),
      v_ua
    );
    return;
  end if;

  if v_event in ('login_failed', 'password_reset_requested') then
    if v_email is null then
      return;
    end if;
    select count(*) into v_recent
    from public.auth_event_log
    where event_type = v_event
      and email = v_email
      and created_at > now() - interval '1 minute';
    if v_recent >= 10 then
      return;
    end if;

    -- One budget for every anonymous report, whatever the email (0170).
    v_window := date_trunc('minute', now());
    insert into public.rpc_rate_limit_buckets as b (user_id, rpc_name, window_start, hit_count)
    values ('00000000-0000-0000-0000-000000000000', 'record_auth_event:anonymous', v_window, 1)
    on conflict (user_id, rpc_name, window_start)
    do update set hit_count = b.hit_count + 1
    returning hit_count into v_accepted;
    delete from public.rpc_rate_limit_buckets
    where user_id = '00000000-0000-0000-0000-000000000000'
      and rpc_name = 'record_auth_event:anonymous'
      and window_start < v_window;
    if v_accepted > 120 then
      return;
    end if;

    insert into public.auth_event_log (event_type, actor_id, email, user_agent)
    values (v_event, null, v_email, v_ua);
  end if;
end;
$$;

comment on function public.record_auth_event(text, text, text) is
  'Write one auth_event_log row. login_success/logout require auth.uid() and force actor_id to that uid (20 a minute per user). login_failed/password_reset_requested are anon-callable, store email only, actor_id always null, and are limited to 10 a minute per email and 120 a minute across all emails (0170).';

revoke all on function public.record_auth_event(text, text, text) from public, anon, authenticated;
grant execute on function public.record_auth_event(text, text, text) to anon, authenticated;
