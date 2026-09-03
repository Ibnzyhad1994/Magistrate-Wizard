-- 0122_judgment_versions.sql
--
-- Append-only revision log for Judgments. A BEFORE UPDATE trigger copies
-- the previous substantive fields (title, case_number, court_name,
-- judgment_date, citation, content, content_text) whenever any of those
-- change. Discoverability, category, and status transitions do not
-- create versions.
--
-- Restore is a client UPDATE of those fields on the live row. 0045
-- still blocks substantive edits while status = 'final'; the UI only
-- offers restore when status = 'draft' (Unlock first).
--
-- RLS: the owner may SELECT versions. No client INSERT/UPDATE/DELETE
-- policies — the trigger inserts as table owner. Recipients of a Share
-- do not read version history.

create table public.judgment_versions (
  id uuid primary key default gen_random_uuid(),
  judgment_id uuid not null references public.judgments (id) on delete cascade,
  version_number integer not null,
  title text not null,
  case_number text,
  citation text,
  court_name text,
  judgment_date date,
  content jsonb,
  content_text text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  unique (judgment_id, version_number)
);

comment on table public.judgment_versions is
  'Append-only snapshots of a Judgment''s substantive fields, taken immediately before those fields change.';

create index judgment_versions_judgment_id_idx
  on public.judgment_versions (judgment_id, version_number desc);

create or replace function public.capture_judgment_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_n integer;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if old.title is not distinct from new.title
     and old.case_number is not distinct from new.case_number
     and old.citation is not distinct from new.citation
     and old.court_name is not distinct from new.court_name
     and old.judgment_date is not distinct from new.judgment_date
     and old.content is not distinct from new.content
     and old.content_text is not distinct from new.content_text then
    return new;
  end if;

  select coalesce(max(v.version_number), 0) + 1
    into next_n
  from public.judgment_versions v
  where v.judgment_id = old.id;

  insert into public.judgment_versions (
    judgment_id,
    version_number,
    title,
    case_number,
    citation,
    court_name,
    judgment_date,
    content,
    content_text,
    created_by
  ) values (
    old.id,
    next_n,
    old.title,
    old.case_number,
    old.citation,
    old.court_name,
    old.judgment_date,
    old.content,
    old.content_text,
    (select auth.uid())
  );

  return new;
end;
$$;

create trigger capture_judgment_version_trigger
  before update on public.judgments
  for each row execute function public.capture_judgment_version();

alter table public.judgment_versions enable row level security;

create policy "Owners can view Judgment versions"
  on public.judgment_versions for select
  using (
    exists (
      select 1 from public.judgments j
      where j.id = judgment_id
        and j.owner_id = (select auth.uid())
    )
  );
