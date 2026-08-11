-- BenchBook — comments & bookmarks

-- 1. Comments ----------------------------------------------------------
-- Threaded discussion on either a case or a bench note (never both / never
-- neither — see documents_parent_check-style constraint below).

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.cases (id) on delete cascade,
  bench_note_id uuid references public.bench_notes (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (char_length(btrim(content)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comments_parent_check check (
    (case_id is not null and bench_note_id is null) or
    (case_id is null and bench_note_id is not null)
  )
);

comment on table public.comments is 'Threaded discussion attached to exactly one case or one bench note.';

create index comments_case_id_idx on public.comments (case_id);
create index comments_bench_note_id_idx on public.comments (bench_note_id);
create index comments_author_id_idx on public.comments (author_id);

create trigger set_comments_updated_at
  before update on public.comments
  for each row
  execute function public.set_updated_at();

alter table public.comments enable row level security;

create policy "Users can view comments on accessible parents"
  on public.comments for select
  using (
    (case_id is not null and public.user_can_access_case(case_id))
    or (bench_note_id is not null and public.user_can_access_bench_note(bench_note_id))
  );

create policy "Users can comment on accessible parents"
  on public.comments for insert
  with check (
    author_id = auth.uid()
    and (
      (case_id is not null and public.user_can_access_case(case_id))
      or (bench_note_id is not null and public.user_can_access_bench_note(bench_note_id))
    )
  );

create policy "Authors and admins can update comments"
  on public.comments for update
  using (public.is_admin() or author_id = auth.uid())
  with check (public.is_admin() or author_id = auth.uid());

create policy "Authors and admins can delete comments"
  on public.comments for delete
  using (public.is_admin() or author_id = auth.uid());

-- 2. Bookmarks -----------------------------------------------------------
-- Personal, per-user saved references. `entity_id` intentionally has no
-- foreign key (it points at one of four different tables depending on
-- `entity_type`), so a trigger enforces referential integrity instead.

create type public.bookmark_entity_type as enum ('case', 'bench_note', 'statute', 'case_law');

create table public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  entity_type public.bookmark_entity_type not null,
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, entity_type, entity_id)
);

comment on table public.bookmarks is 'Per-user saved references to a case, bench note, statute, or case law entry.';

create index bookmarks_user_id_idx on public.bookmarks (user_id);
create index bookmarks_entity_idx on public.bookmarks (entity_type, entity_id);

create or replace function public.validate_bookmark_entity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  case new.entity_type
    when 'case' then
      if not exists (select 1 from public.cases where id = new.entity_id) then
        raise exception 'bookmark references a case that does not exist: %', new.entity_id;
      end if;
    when 'bench_note' then
      if not exists (select 1 from public.bench_notes where id = new.entity_id) then
        raise exception 'bookmark references a bench note that does not exist: %', new.entity_id;
      end if;
    when 'statute' then
      if not exists (select 1 from public.statutes where id = new.entity_id) then
        raise exception 'bookmark references a statute that does not exist: %', new.entity_id;
      end if;
    when 'case_law' then
      if not exists (select 1 from public.case_law where id = new.entity_id) then
        raise exception 'bookmark references a case law entry that does not exist: %', new.entity_id;
      end if;
  end case;
  return new;
end;
$$;

create trigger validate_bookmark_entity_trigger
  before insert or update on public.bookmarks
  for each row
  execute function public.validate_bookmark_entity();

alter table public.bookmarks enable row level security;

create policy "Users can view their own bookmarks"
  on public.bookmarks for select
  using (user_id = auth.uid());

create policy "Users can create their own bookmarks"
  on public.bookmarks for insert
  with check (user_id = auth.uid());

create policy "Users can delete their own bookmarks"
  on public.bookmarks for delete
  using (user_id = auth.uid());
