-- ============================================================================
-- 0060_legal_library_tag_apply.sql
--
-- Repairs the §15 finding: `proposeTags()` runs at ingestion time and its
-- output is stored in `import_jobs.proposed_tags`, but nothing turned a
-- proposal into a real `case_law_tags`/`statute_tags` relationship --
-- "Automatic tags: YES" in the prior report was too broad; no reviewable
-- apply step existed. `case_law_tags`/`statute_tags` INSERT is admin-only
-- (0006), and `tags` itself has no case-insensitive uniqueness, so a
-- frontend bypass (`supabase.from("tags").insert(...)` on every publish)
-- risks creating synonym duplicates ("Hearsay" / "hearsay" / "Hearsay ")
-- across repeated imports. These RPCs give the Review Queue one
-- authorized, atomic, find-or-create-then-link path instead:
--   - Reviewer explicitly selects the final tag NAME list for a draft
--     (proposed tags they keep, plus any they add) -- nothing is applied
--     automatically or silently.
--   - The function finds an existing `tags` row by case-insensitive exact
--     name match first; only creates a new canonical `tags` row when no
--     match exists.
--   - The record's existing tag links are fully reconciled to the
--     supplied set in the SAME transaction (remove ones no longer wanted,
--     add new ones) -- one call, not a fragile multi-step sequence of
--     independent inserts/deletes from the browser.
-- ============================================================================
create or replace function public.apply_case_law_tags(p_case_law_id uuid, p_tag_names text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_tag_id uuid;
  v_final_ids uuid[] := '{}';
begin
  if not public.is_admin() then
    raise exception 'Only administrators may apply Case Law tags.';
  end if;

  if not exists (select 1 from public.case_law where id = p_case_law_id) then
    raise exception 'Case Law record % not found.', p_case_law_id;
  end if;

  foreach v_name in array coalesce(p_tag_names, '{}') loop
    v_name := trim(v_name);
    continue when v_name = '';

    select id into v_tag_id from public.tags where lower(name) = lower(v_name) limit 1;
    if v_tag_id is null then
      insert into public.tags (name, created_by) values (v_name, auth.uid())
      returning id into v_tag_id;
    end if;
    v_final_ids := array_append(v_final_ids, v_tag_id);
  end loop;

  delete from public.case_law_tags
  where case_law_id = p_case_law_id
    and not (tag_id = any (v_final_ids));

  insert into public.case_law_tags (case_law_id, tag_id)
  select p_case_law_id, t
  from unnest(v_final_ids) as t
  on conflict do nothing;
end;
$$;

create or replace function public.apply_statute_tags(p_statute_id uuid, p_tag_names text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_tag_id uuid;
  v_final_ids uuid[] := '{}';
begin
  if not public.is_admin() then
    raise exception 'Only administrators may apply Legislation tags.';
  end if;

  if not exists (select 1 from public.statutes where id = p_statute_id) then
    raise exception 'Legislation record % not found.', p_statute_id;
  end if;

  foreach v_name in array coalesce(p_tag_names, '{}') loop
    v_name := trim(v_name);
    continue when v_name = '';

    select id into v_tag_id from public.tags where lower(name) = lower(v_name) limit 1;
    if v_tag_id is null then
      insert into public.tags (name, created_by) values (v_name, auth.uid())
      returning id into v_tag_id;
    end if;
    v_final_ids := array_append(v_final_ids, v_tag_id);
  end loop;

  delete from public.statute_tags
  where statute_id = p_statute_id
    and not (tag_id = any (v_final_ids));

  insert into public.statute_tags (statute_id, tag_id)
  select p_statute_id, t
  from unnest(v_final_ids) as t
  on conflict do nothing;
end;
$$;

revoke execute on function public.apply_case_law_tags from public;
revoke execute on function public.apply_statute_tags from public;
grant execute on function public.apply_case_law_tags to authenticated;
grant execute on function public.apply_statute_tags to authenticated;
