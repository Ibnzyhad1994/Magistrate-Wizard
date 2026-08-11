-- BenchBook — performance & security hardening
-- Addresses Supabase advisor findings after the initial 11 migrations:
--   1. set_updated_at() had a mutable search_path.
--   2. Trigger-only functions were callable directly via PostgREST RPC.
--   3. auth.uid()/auth.<fn>() (and our STABLE wrapper functions) were
--      called unwrapped in RLS policies, forcing per-row re-evaluation
--      instead of a single per-statement initplan.
--   4. A few tables had overlapping permissive policies for the same
--      role/action (e.g. a public "viewable by all" SELECT policy plus
--      an admin "for all" policy that also covers SELECT).
--   5. Three created_by foreign keys had no covering index.
-- See: https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
-- Note: is_admin(), my_court_id(), user_can_access_case(), and
-- user_can_access_bench_note() remain executable by anon/authenticated —
-- that's required, since RLS policies evaluated for those roles call them
-- directly. This is safe: each returns a boolean/uuid derived from
-- auth.uid(), which is null for anon, so an anonymous caller only ever
-- gets back false/null — no data is exposed by calling them directly.

-- 1. Fix set_updated_at()'s search_path -------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2. Lock trigger-only functions down from the public API -------------------
-- These are only ever invoked by Postgres trigger machinery (they read
-- NEW/OLD/TG_OP, which are unbound outside a trigger context and would
-- error if called directly) — revoke the API-facing EXECUTE grant.

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.audit_trigger_fn() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.validate_bookmark_entity() from public, anon, authenticated;

-- 3. profiles: consolidate + wrap ---------------------------------------

drop policy if exists "Profiles are viewable by their owner" on public.profiles;
drop policy if exists "Admins can view all profiles" on public.profiles;
drop policy if exists "Profiles are editable by their owner" on public.profiles;
drop policy if exists "Admins can update any profile" on public.profiles;

create policy "Profiles are viewable by owner or admin"
  on public.profiles for select
  using ((select auth.uid()) = id or (select public.is_admin()));

create policy "Profiles are editable by owner or admin"
  on public.profiles for update
  using ((select auth.uid()) = id or (select public.is_admin()))
  with check (
    (
      (select auth.uid()) = id
      and role = (select p.role from public.profiles p where p.id = (select auth.uid()))
    )
    or (select public.is_admin())
  );

-- 4. courts: split admin "for all" so it stops overlapping the public
--    read policy on SELECT ---------------------------------------------

drop policy if exists "Admins can manage courts" on public.courts;

create policy "Admins can insert courts"
  on public.courts for insert
  with check ((select public.is_admin()));

create policy "Admins can update courts"
  on public.courts for update
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins can delete courts"
  on public.courts for delete
  using ((select public.is_admin()));

-- 5. cases + case_parties: wrap -------------------------------------------

drop policy if exists "Users can view cases in their court" on public.cases;
drop policy if exists "Users can create cases in their own court" on public.cases;
drop policy if exists "Users can update cases in their court" on public.cases;
drop policy if exists "Admins can delete cases" on public.cases;

create policy "Users can view cases in their court"
  on public.cases for select
  using ((select public.is_admin()) or court_id = (select public.my_court_id()));

create policy "Users can create cases in their own court"
  on public.cases for insert
  with check (
    (select public.is_admin())
    or (court_id = (select public.my_court_id()) and created_by = (select auth.uid()))
  );

create policy "Users can update cases in their court"
  on public.cases for update
  using ((select public.is_admin()) or court_id = (select public.my_court_id()))
  with check ((select public.is_admin()) or court_id = (select public.my_court_id()));

create policy "Admins can delete cases"
  on public.cases for delete
  using ((select public.is_admin()));

drop policy if exists "Users can view case parties for accessible cases" on public.case_parties;
drop policy if exists "Users can add case parties to accessible cases" on public.case_parties;
drop policy if exists "Users can update case parties on accessible cases" on public.case_parties;
drop policy if exists "Users can remove case parties from accessible cases" on public.case_parties;

create policy "Users can view case parties for accessible cases"
  on public.case_parties for select
  using ((select public.user_can_access_case(case_id)));

create policy "Users can add case parties to accessible cases"
  on public.case_parties for insert
  with check ((select public.user_can_access_case(case_id)));

create policy "Users can update case parties on accessible cases"
  on public.case_parties for update
  using ((select public.user_can_access_case(case_id)))
  with check ((select public.user_can_access_case(case_id)));

create policy "Users can remove case parties from accessible cases"
  on public.case_parties for delete
  using ((select public.user_can_access_case(case_id)));

-- 6. bench_notes: wrap -----------------------------------------------------

drop policy if exists "Users can view accessible bench notes" on public.bench_notes;
drop policy if exists "Users can create their own bench notes" on public.bench_notes;
drop policy if exists "Authors and admins can update bench notes" on public.bench_notes;
drop policy if exists "Authors and admins can delete bench notes" on public.bench_notes;

create policy "Users can view accessible bench notes"
  on public.bench_notes for select
  using ((select public.user_can_access_bench_note(id)));

create policy "Users can create their own bench notes"
  on public.bench_notes for insert
  with check (author_id = (select auth.uid()));

create policy "Authors and admins can update bench notes"
  on public.bench_notes for update
  using ((select public.is_admin()) or author_id = (select auth.uid()))
  with check ((select public.is_admin()) or author_id = (select auth.uid()));

create policy "Authors and admins can delete bench notes"
  on public.bench_notes for delete
  using ((select public.is_admin()) or author_id = (select auth.uid()));

-- 7. statutes / case_law: split admin "for all" + wrap ----------------------

drop policy if exists "Admins can manage statutes" on public.statutes;

create policy "Admins can insert statutes"
  on public.statutes for insert
  with check ((select public.is_admin()));

create policy "Admins can update statutes"
  on public.statutes for update
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins can delete statutes"
  on public.statutes for delete
  using ((select public.is_admin()));

drop policy if exists "Admins can manage case law" on public.case_law;

create policy "Admins can insert case law"
  on public.case_law for insert
  with check ((select public.is_admin()));

create policy "Admins can update case law"
  on public.case_law for update
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins can delete case law"
  on public.case_law for delete
  using ((select public.is_admin()));

-- 8. tags + join tables: wrap -----------------------------------------------

drop policy if exists "Authenticated users can create tags" on public.tags;
drop policy if exists "Creators and admins can update tags" on public.tags;
drop policy if exists "Creators and admins can delete tags" on public.tags;

create policy "Authenticated users can create tags"
  on public.tags for insert
  with check (created_by = (select auth.uid()));

create policy "Creators and admins can update tags"
  on public.tags for update
  using ((select public.is_admin()) or created_by = (select auth.uid()))
  with check ((select public.is_admin()) or created_by = (select auth.uid()));

create policy "Creators and admins can delete tags"
  on public.tags for delete
  using ((select public.is_admin()) or created_by = (select auth.uid()));

drop policy if exists "Users can view case tags for accessible cases" on public.case_tags;
drop policy if exists "Users can tag accessible cases" on public.case_tags;
drop policy if exists "Users can untag accessible cases" on public.case_tags;

create policy "Users can view case tags for accessible cases"
  on public.case_tags for select
  using ((select public.user_can_access_case(case_id)));

create policy "Users can tag accessible cases"
  on public.case_tags for insert
  with check ((select public.user_can_access_case(case_id)));

create policy "Users can untag accessible cases"
  on public.case_tags for delete
  using ((select public.user_can_access_case(case_id)));

drop policy if exists "Users can view bench note tags for accessible notes" on public.bench_note_tags;
drop policy if exists "Users can tag accessible bench notes" on public.bench_note_tags;
drop policy if exists "Users can untag accessible bench notes" on public.bench_note_tags;

create policy "Users can view bench note tags for accessible notes"
  on public.bench_note_tags for select
  using ((select public.user_can_access_bench_note(bench_note_id)));

create policy "Users can tag accessible bench notes"
  on public.bench_note_tags for insert
  with check ((select public.user_can_access_bench_note(bench_note_id)));

create policy "Users can untag accessible bench notes"
  on public.bench_note_tags for delete
  using ((select public.user_can_access_bench_note(bench_note_id)));

drop policy if exists "Admins can tag statutes" on public.statute_tags;
drop policy if exists "Admins can untag statutes" on public.statute_tags;

create policy "Admins can tag statutes"
  on public.statute_tags for insert
  with check ((select public.is_admin()));

create policy "Admins can untag statutes"
  on public.statute_tags for delete
  using ((select public.is_admin()));

drop policy if exists "Admins can tag case law" on public.case_law_tags;
drop policy if exists "Admins can untag case law" on public.case_law_tags;

create policy "Admins can tag case law"
  on public.case_law_tags for insert
  with check ((select public.is_admin()));

create policy "Admins can untag case law"
  on public.case_law_tags for delete
  using ((select public.is_admin()));

-- 9. documents: wrap ---------------------------------------------------------

drop policy if exists "Users can view documents they have access to" on public.documents;
drop policy if exists "Users can attach documents to accessible parents" on public.documents;
drop policy if exists "Uploaders and admins can delete documents" on public.documents;

create policy "Users can view documents they have access to"
  on public.documents for select
  using (
    uploaded_by = (select auth.uid())
    or (case_id is not null and (select public.user_can_access_case(case_id)))
    or (bench_note_id is not null and (select public.user_can_access_bench_note(bench_note_id)))
  );

create policy "Users can attach documents to accessible parents"
  on public.documents for insert
  with check (
    uploaded_by = (select auth.uid())
    and (
      (case_id is not null and (select public.user_can_access_case(case_id)))
      or (bench_note_id is not null and (select public.user_can_access_bench_note(bench_note_id)))
      or (case_id is null and bench_note_id is null)
    )
  );

create policy "Uploaders and admins can delete documents"
  on public.documents for delete
  using ((select public.is_admin()) or uploaded_by = (select auth.uid()));

-- 10. comments + bookmarks: wrap ---------------------------------------------

drop policy if exists "Users can view comments on accessible parents" on public.comments;
drop policy if exists "Users can comment on accessible parents" on public.comments;
drop policy if exists "Authors and admins can update comments" on public.comments;
drop policy if exists "Authors and admins can delete comments" on public.comments;

create policy "Users can view comments on accessible parents"
  on public.comments for select
  using (
    (case_id is not null and (select public.user_can_access_case(case_id)))
    or (bench_note_id is not null and (select public.user_can_access_bench_note(bench_note_id)))
  );

create policy "Users can comment on accessible parents"
  on public.comments for insert
  with check (
    author_id = (select auth.uid())
    and (
      (case_id is not null and (select public.user_can_access_case(case_id)))
      or (bench_note_id is not null and (select public.user_can_access_bench_note(bench_note_id)))
    )
  );

create policy "Authors and admins can update comments"
  on public.comments for update
  using ((select public.is_admin()) or author_id = (select auth.uid()))
  with check ((select public.is_admin()) or author_id = (select auth.uid()));

create policy "Authors and admins can delete comments"
  on public.comments for delete
  using ((select public.is_admin()) or author_id = (select auth.uid()));

drop policy if exists "Users can view their own bookmarks" on public.bookmarks;
drop policy if exists "Users can create their own bookmarks" on public.bookmarks;
drop policy if exists "Users can delete their own bookmarks" on public.bookmarks;

create policy "Users can view their own bookmarks"
  on public.bookmarks for select
  using (user_id = (select auth.uid()));

create policy "Users can create their own bookmarks"
  on public.bookmarks for insert
  with check (user_id = (select auth.uid()));

create policy "Users can delete their own bookmarks"
  on public.bookmarks for delete
  using (user_id = (select auth.uid()));

-- 11. audit_log: wrap ---------------------------------------------------------

drop policy if exists "Admins can view the audit log" on public.audit_log;

create policy "Admins can view the audit log"
  on public.audit_log for select
  using ((select public.is_admin()));

-- 12. storage.objects: wrap ---------------------------------------------------

drop policy if exists "Uploaders can write into their own documents folder" on storage.objects;
drop policy if exists "Users can read documents they have access to" on storage.objects;
drop policy if exists "Uploaders and admins can delete documents from storage" on storage.objects;
drop policy if exists "Users can upload their own avatar" on storage.objects;
drop policy if exists "Users can update their own avatar" on storage.objects;
drop policy if exists "Users can delete their own avatar" on storage.objects;

create policy "Uploaders can write into their own documents folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users can read documents they have access to"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1
      from public.documents d
      where d.file_path = storage.objects.name
        and (
          d.uploaded_by = (select auth.uid())
          or (d.case_id is not null and (select public.user_can_access_case(d.case_id)))
          or (d.bench_note_id is not null and (select public.user_can_access_bench_note(d.bench_note_id)))
        )
    )
  );

create policy "Uploaders and admins can delete documents from storage"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'documents'
    and (
      (select public.is_admin())
      or (storage.foldername(name))[1] = (select auth.uid())::text
    )
  );

create policy "Users can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users can update their own avatar"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users can delete their own avatar"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 13. Missing indexes on created_by foreign keys -----------------------------

create index case_law_created_by_idx on public.case_law (created_by);
create index statutes_created_by_idx on public.statutes (created_by);
create index tags_created_by_idx on public.tags (created_by);
