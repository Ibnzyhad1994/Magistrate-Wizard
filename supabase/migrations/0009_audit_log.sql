-- BenchBook — audit log
-- Append-only trail of inserts/updates/deletes on the tables that matter
-- most for compliance review (cases, bench notes, the reference library,
-- and document metadata). `audit_trigger_fn()` is generic and can be
-- attached to any additional table with an `id uuid` primary key.

create type public.audit_action as enum ('insert', 'update', 'delete');

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action public.audit_action not null,
  table_name text not null,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

comment on table public.audit_log is 'Append-only audit trail populated by audit_trigger_fn() on sensitive tables.';

create index audit_log_table_record_idx on public.audit_log (table_name, record_id);
create index audit_log_actor_id_idx on public.audit_log (actor_id);
create index audit_log_created_at_idx on public.audit_log (created_at desc);

create or replace function public.audit_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
    values (auth.uid(), 'insert', tg_table_name, new.id, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    values (auth.uid(), 'update', tg_table_name, new.id, to_jsonb(old), to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (actor_id, action, table_name, record_id, old_data)
    values (auth.uid(), 'delete', tg_table_name, old.id, to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$;

create trigger audit_cases
  after insert or update or delete on public.cases
  for each row execute function public.audit_trigger_fn();

create trigger audit_bench_notes
  after insert or update or delete on public.bench_notes
  for each row execute function public.audit_trigger_fn();

create trigger audit_statutes
  after insert or update or delete on public.statutes
  for each row execute function public.audit_trigger_fn();

create trigger audit_case_law
  after insert or update or delete on public.case_law
  for each row execute function public.audit_trigger_fn();

create trigger audit_documents
  after insert or update or delete on public.documents
  for each row execute function public.audit_trigger_fn();

alter table public.audit_log enable row level security;

create policy "Admins can view the audit log"
  on public.audit_log for select
  using (public.is_admin());
