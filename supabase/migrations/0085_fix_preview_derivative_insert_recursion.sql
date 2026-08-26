-- ============================================================================
-- 0085_fix_preview_derivative_insert_recursion.sql
--
-- Fixes a real bug in 0083's new INSERT policy, caught during live testing:
-- its WITH CHECK subquery (`exists (select 1 from public.documents src
-- where ...)`) references the SAME table (`documents`) the policy is
-- defined on. Postgres refuses this outright at plan time -- "infinite
-- recursion detected in policy for relation \"documents\"" (42P17) -- and
-- because Postgres combines every permissive policy for a command with OR,
-- this broke EVERY document insert (not just preview-derivative ones): a
-- perfectly ordinary attachment upload failed with a 500 the instant 0083
-- was applied, even though that row's `purpose <> 'preview_derivative'`
-- would have short-circuited the check at the DATA level -- the error is a
-- plan-time rejection of the self-referencing subquery SHAPE itself, not a
-- runtime data problem.
--
-- 0083 is already applied (to this local dev database, via `supabase
-- migration up`) -- it is not edited here; per the "do not edit an
-- already-applied migration" rule, this is a new forward migration that
-- replaces the broken policy with a working one.
--
-- Standard fix for this exact class of error: move the self-referential
-- lookup into a SECURITY DEFINER helper function. A security-definer
-- function's OWN internal query runs with the function owner's privilege,
-- not the caller's RLS -- so its lookup of the source document doesn't
-- re-trigger `documents`' RLS and the recursion cycle never forms.
--
-- The function does its own explicit, narrow check in place of relying on
-- RLS to do it, so nothing about WHO can see WHAT changes. It also takes
-- the NEW row's entity_type/entity_id as plain scalar arguments (not a
-- correlated subquery reference) and requires them to match the source
-- document's own entity_type/entity_id -- 0083's original design intent,
-- lost when its subquery was replaced. Without this match requirement, a
-- user could insert a purpose='preview_derivative' row pointing
-- source_document_id at ANY document they merely have view access to,
-- while setting entity_type/entity_id to a DIFFERENT record -- since
-- documents' SELECT policy is keyed on the row's OWN entity_type/
-- entity_id, that would let them attach an arbitrary file to a record
-- every OTHER viewer of that record would then also see, bypassing the
-- deliberately stricter "Users can attach documents to accessible
-- parents" policy for real attachments. Matching entity_type/entity_id to
-- the actual source closes that off.
-- ============================================================================

create or replace function public.can_attach_preview_derivative(
  p_source_document_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.documents d
    where d.id = p_source_document_id
      and d.purpose <> 'preview_derivative'
      and d.entity_type is not distinct from p_entity_type
      and d.entity_id is not distinct from p_entity_id
      and (
        d.uploaded_by = (select auth.uid())
        or (d.entity_type = 'docket_matter' and public.can_view_docket_matter(d.entity_id))
        or (d.entity_type = 'judgment' and public.can_view_judgment(d.entity_id))
        or (d.entity_type = 'case_law' and public.can_view_case_law(d.entity_id))
        or (d.entity_type = 'quick_code' and exists (select 1 from public.quick_codes qc where qc.id = d.entity_id))
        or (d.entity_type = 'bench_note' and exists (select 1 from public.bench_notes bn where bn.id = d.entity_id))
        or (d.entity_type = 'case' and exists (select 1 from public.cases c where c.id = d.entity_id))
        or (d.entity_type = 'statute' and public.can_view_statute(d.entity_id))
      )
  );
$$;

comment on function public.can_attach_preview_derivative(uuid, text, uuid) is
  'SECURITY DEFINER (0085) -- backs the preview-derivative INSERT policy on documents. Mirrors "Users can view documents they have access to" (0055) for the SOURCE document, plus requires the new row''s entity_type/entity_id to match the source''s exactly. Runs as a function (not an inline same-table subquery) specifically so Postgres does not reject the owning policy as self-referentially recursive (42P17) -- see this migration''s header.';

grant execute on function public.can_attach_preview_derivative(uuid, text, uuid) to authenticated;

drop policy "Users can attach a preview derivative to a document they can view" on public.documents;

create policy "Users can attach a preview derivative to a document they can view"
  on public.documents for insert
  with check (
    purpose = 'preview_derivative'
    and uploaded_by = (select auth.uid())
    and source_document_id is not null
    and public.can_attach_preview_derivative(source_document_id, entity_type, entity_id)
  );
