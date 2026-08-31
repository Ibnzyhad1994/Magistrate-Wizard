-- ============================================================================
-- 0113_profiles_privilege_audit_and_auth_events.sql
--
-- Two follow-ups that 0048 explicitly deferred, now in scope:
--
-- 1. profiles privilege audit. Role / is_active / email changes are the
--    only profile mutations worth a compliance trail (who was promoted
--    to admin, who was deactivated, whose login email changed). Name and
--    avatar edits are skipped via a WHEN clause on the UPDATE trigger.
--    Capture is a slim JSON object (id, role, is_active, email,
--    full_name) — never avatar_url. audit_trigger_fn() is CREATE OR
--    REPLACE'd so existing table triggers keep the 0048 redaction
--    behaviour unchanged.
--
-- 2. Thin auth event log. Successful login, failed login, explicit
--    logout, and password-reset request. Not token refresh, not
--    clickstream. Written only by record_auth_event() (SECURITY DEFINER);
--    clients cannot INSERT. Actor for login_success/logout is always
--    auth.uid() — the client cannot spoof another user. Failed login and
--    password-reset are anon-callable and store email only, with a
--    per-email rate limit so the table cannot be filled as a DOS.
--
-- Reader model unchanged: SELECT is is_admin() only. No admin UI dump of
-- judicial payloads; the SPA viewer filters to institutional tables plus
-- these auth events.
-- ============================================================================

create or replace function public.audit_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old);
  end if;

  if tg_table_name = 'judgments' then
    v_old := v_old - 'content' - 'content_text' - 'search_vector';
    v_new := v_new - 'content' - 'content_text' - 'search_vector';
  elsif tg_table_name = 'bench_notes' then
    v_old := v_old - 'content' - 'content_text' - 'search_vector';
    v_new := v_new - 'content' - 'content_text' - 'search_vector';
  elsif tg_table_name = 'quick_codes' then
    v_old := v_old - 'content' - 'description' - 'search_vector';
    v_new := v_new - 'content' - 'description' - 'search_vector';
  elsif tg_table_name = 'case_law_annotations' then
    v_old := v_old - 'annotation_text';
    v_new := v_new - 'annotation_text';
  elsif tg_table_name = 'docket_matter_parties' then
    v_old := v_old - 'contact_info';
    v_new := v_new - 'contact_info';
  elsif tg_table_name = 'case_law' then
    if (tg_op = 'DELETE' and old.owner_id is not null)
       or (tg_op in ('INSERT', 'UPDATE') and new.owner_id is not null) then
      v_old := v_old - 'summary' - 'full_text' - 'search_vector';
      v_new := v_new - 'summary' - 'full_text' - 'search_vector';
    end if;
  end if;

  -- Privilege-only capture for profiles. The UPDATE trigger's WHEN
  -- clause already skips name/avatar noise; this slim object is what
  -- actually lands in audit_log so avatar_url never does.
  if tg_table_name = 'profiles' then
    if tg_op = 'DELETE' then
      v_old := jsonb_build_object(
        'id', old.id,
        'role', old.role,
        'is_active', old.is_active,
        'email', old.email,
        'full_name', old.full_name
      );
    else
      if tg_op = 'UPDATE' then
        v_old := jsonb_build_object(
          'id', old.id,
          'role', old.role,
          'is_active', old.is_active,
          'email', old.email,
          'full_name', old.full_name
        );
      end if;
      v_new := jsonb_build_object(
        'id', new.id,
        'role', new.role,
        'is_active', new.is_active,
        'email', new.email,
        'full_name', new.full_name
      );
    end if;
  end if;

  if tg_op = 'INSERT' then
    insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
    values (auth.uid(), 'insert', tg_table_name, new.id, v_new);
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    values (auth.uid(), 'update', tg_table_name, new.id, v_old, v_new);
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (actor_id, action, table_name, record_id, old_data)
    values (auth.uid(), 'delete', tg_table_name, old.id, v_old);
    return old;
  end if;
  return null;
end;
$$;

comment on function public.audit_trigger_fn() is
  'Generic AFTER INSERT/UPDATE/DELETE audit trigger, SECURITY DEFINER, search_path pinned to public. 0048 redaction unchanged. 0113: profiles writes a slim privilege payload (id/role/is_active/email/full_name) only.';

create trigger audit_profiles
  after insert or delete on public.profiles
  for each row execute function public.audit_trigger_fn();

create trigger audit_profiles_privilege
  after update on public.profiles
  for each row
  when (
    old.role is distinct from new.role
    or old.is_active is distinct from new.is_active
    or old.email is distinct from new.email
  )
  execute function public.audit_trigger_fn();

-- ==================== Thin auth event log ====================

create type public.auth_event_type as enum (
  'login_success',
  'login_failed',
  'logout',
  'password_reset_requested'
);

create table public.auth_event_log (
  id bigint generated always as identity primary key,
  event_type public.auth_event_type not null,
  actor_id uuid references public.profiles (id) on delete set null,
  email text,
  user_agent text,
  created_at timestamptz not null default now()
);

comment on table public.auth_event_log is
  'Append-only sign-in trail written only by record_auth_event(). Admin SELECT only.';

create index auth_event_log_created_at_idx on public.auth_event_log (created_at desc);
create index auth_event_log_actor_id_idx on public.auth_event_log (actor_id);
create index auth_event_log_email_recent_idx on public.auth_event_log (event_type, email, created_at desc);

alter table public.auth_event_log enable row level security;

create policy "Admins can view auth events"
  on public.auth_event_log for select
  using (public.is_admin());

revoke insert, update, delete, truncate on public.auth_event_log from anon, authenticated;

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
    insert into public.auth_event_log (event_type, actor_id, email, user_agent)
    values (v_event, null, v_email, v_ua);
  end if;
end;
$$;

comment on function public.record_auth_event(text, text, text) is
  'Write one auth_event_log row. login_success/logout require auth.uid() and force actor_id to that uid. login_failed/password_reset_requested are anon-callable, store email only, actor_id always null, rate-limited per email.';

revoke all on function public.record_auth_event(text, text, text) from public, anon, authenticated;
grant execute on function public.record_auth_event(text, text, text) to anon, authenticated;
