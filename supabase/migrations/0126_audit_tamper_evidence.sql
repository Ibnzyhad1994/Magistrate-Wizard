-- 0126_audit_tamper_evidence.sql
--
-- Append-only hash chain on audit_log. Each row stores the previous
-- row's hash and its own SHA-256 over a stable payload. Ordinary
-- UPDATE/DELETE is rejected after backfill.

create extension if not exists pgcrypto with schema extensions;

alter table public.audit_log
  add column if not exists prev_hash text,
  add column if not exists row_hash text;

create or replace function public.audit_log_payload(
  p_prev_hash text,
  p_id bigint,
  p_action public.audit_action,
  p_table_name text,
  p_record_id uuid,
  p_actor_id uuid,
  p_created_at timestamptz,
  p_old_data jsonb,
  p_new_data jsonb
)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select concat_ws(
    '|',
    coalesce(p_prev_hash, 'genesis'),
    p_id::text,
    p_action::text,
    coalesce(p_table_name, ''),
    coalesce(p_record_id::text, ''),
    coalesce(p_actor_id::text, ''),
    coalesce(p_created_at::text, ''),
    coalesce(p_old_data::text, ''),
    coalesce(p_new_data::text, '')
  );
$$;

create or replace function public.audit_log_digest(p_payload text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(convert_to(p_payload, 'utf8'), 'sha256'), 'hex');
$$;

do $$
declare
  r record;
  prev text := 'genesis';
  payload text;
  digest text;
begin
  for r in
    select id, action, table_name, record_id, actor_id, created_at, old_data, new_data
    from public.audit_log
    order by id
  loop
    payload := public.audit_log_payload(
      prev, r.id, r.action, r.table_name, r.record_id, r.actor_id, r.created_at, r.old_data, r.new_data
    );
    digest := public.audit_log_digest(payload);
    update public.audit_log
       set prev_hash = prev,
           row_hash = digest
     where id = r.id;
    prev := digest;
  end loop;
end $$;

create or replace function public.audit_log_assign_hash()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  prev text;
  digest text;
begin
  select a.row_hash
    into prev
  from public.audit_log a
  where a.id <> new.id
    and a.row_hash is not null
  order by a.id desc
  limit 1
  for update;

  prev := coalesce(prev, 'genesis');
  digest := public.audit_log_digest(
    public.audit_log_payload(
      prev,
      new.id,
      new.action,
      new.table_name,
      new.record_id,
      new.actor_id,
      new.created_at,
      new.old_data,
      new.new_data
    )
  );

  update public.audit_log
     set prev_hash = prev,
         row_hash = digest
   where id = new.id;

  return null;
end;
$$;

drop trigger if exists audit_log_assign_hash_trigger on public.audit_log;
create trigger audit_log_assign_hash_trigger
  after insert on public.audit_log
  for each row execute function public.audit_log_assign_hash();

create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'audit_log rows cannot be deleted';
  end if;
  if old.row_hash is not null then
    raise exception 'audit_log rows cannot be updated';
  end if;
  if new.id is distinct from old.id
    or new.actor_id is distinct from old.actor_id
    or new.action is distinct from old.action
    or new.table_name is distinct from old.table_name
    or new.record_id is distinct from old.record_id
    or new.old_data is distinct from old.old_data
    or new.new_data is distinct from old.new_data
    or new.created_at is distinct from old.created_at
  then
    raise exception 'audit_log rows cannot be updated';
  end if;
  return new;
end;
$$;

drop trigger if exists audit_log_immutable_trigger on public.audit_log;
create trigger audit_log_immutable_trigger
  before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

create or replace function public.verify_audit_hash_chain()
returns table(ok boolean, broken_id bigint)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  r record;
  prev text := 'genesis';
  expected text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  for r in
    select id, action, table_name, record_id, actor_id, created_at, old_data, new_data, prev_hash, row_hash
    from public.audit_log
    order by id
  loop
    if r.prev_hash is distinct from prev then
      ok := false;
      broken_id := r.id;
      return next;
      return;
    end if;
    expected := public.audit_log_digest(
      public.audit_log_payload(
        r.prev_hash, r.id, r.action, r.table_name, r.record_id, r.actor_id, r.created_at, r.old_data, r.new_data
      )
    );
    if r.row_hash is distinct from expected then
      ok := false;
      broken_id := r.id;
      return next;
      return;
    end if;
    prev := r.row_hash;
  end loop;

  ok := true;
  broken_id := null;
  return next;
end;
$$;

revoke all on function public.verify_audit_hash_chain() from public, anon;
grant execute on function public.verify_audit_hash_chain() to authenticated;

comment on function public.verify_audit_hash_chain() is
  'Walks audit_log in id order and reports the first broken hash link. Callable by admins via RLS on the page that displays it; the function itself does not leak row bodies.';
