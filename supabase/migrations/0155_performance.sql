-- ============================================================================
-- 0155_performance.sql
--
-- Performance follow-ups from the 2026-09-17 system audit (§6.2 / §6.3).
-- Nothing here changes who may see what: every predicate is copied from
-- the function or policy it replaces.
--
-- 1. Array-taking identity resolvers so the share and retained-assignment
--    panels make ONE round trip per matter instead of one RPC per row
--    (use-shares.ts / use-docket-assignments.ts). The singular RPCs stay.
-- 2. The last bare `auth.uid()` calls in a live policy or RLS helper are
--    wrapped in `(select auth.uid())` so Postgres evaluates them once per
--    statement rather than once per row (Supabase "auth_rls_initplan"
--    advisor). The audit counted twenty by grepping every migration, but
--    0012 already re-declared the profiles / cases / bench_notes / tags /
--    documents / comments / bookmarks policies with the wrapped form, and
--    0038 / 0055 / 0114 / 0149 kept it. What is actually still bare on a
--    freshly-migrated database is: the two issue_reports policies from
--    0103 and the `mc.profile_id = auth.uid()` inside
--    can_manage_clerk_access() (0151), which runs from RLS-adjacent RPCs.
-- 3. Missing leading-column indexes on FK columns that are filtered on.
--    Checked against the existing PKs / uniques / indexes first; the ones
--    the audit listed that are already covered are noted and skipped.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Batch identity resolvers
-- ----------------------------------------------------------------------------
-- Same SECURITY DEFINER model, fixed search_path, explicit RETURNS TABLE
-- and grants as resolve_docket_share_identity (0121) — the body is that
-- function's body with `s.id = any (p_share_ids)` in place of the equality,
-- plus the share id in the output so the client can map rows back. The
-- per-row authority predicate is unchanged, so a caller receives exactly
-- the rows the singular RPC would have returned one at a time.

create or replace function public.resolve_docket_share_identities(p_share_ids uuid[])
returns table (
  share_id uuid,
  recipient_id uuid,
  recipient_display_name text,
  granted_by uuid,
  grantor_display_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id as share_id,
    s.recipient_id,
    pr.full_name as recipient_display_name,
    s.granted_by,
    pg2.full_name as grantor_display_name
  from public.shares s
  left join public.profiles pr on pr.id = s.recipient_id
  left join public.profiles pg2 on pg2.id = s.granted_by
  where s.id = any (p_share_ids)
    and (
      s.granted_by = (select auth.uid())
      or s.recipient_id = (select auth.uid())
      or (select public.has_item_share_authority(s.item_type, s.item_id))
    );
$$;

revoke all on function public.resolve_docket_share_identities(uuid[]) from public, anon;
grant execute on function public.resolve_docket_share_identities(uuid[]) to authenticated;

comment on function public.resolve_docket_share_identities(uuid[]) is
  'Batch form of resolve_docket_share_identity (0121): identity lookup for many shares rows (any item_type) in one call, gated per row by grantor, recipient, or has_item_share_authority(). Rows the caller may not see are simply absent. SECURITY DEFINER; EXECUTE for authenticated only.';

-- Batch form of resolve_docket_assignment_identity (0043): same three-path
-- docket_matters SELECT envelope per row, assignment id added to the output.

create or replace function public.resolve_docket_assignment_identities(p_ids uuid[])
returns table (
  assignment_id uuid,
  profile_id uuid,
  display_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    dma.id as assignment_id,
    dma.profile_id,
    p.full_name as display_name
  from public.docket_matter_assignments dma
  join public.docket_matters dm on dm.id = dma.docket_matter_id
  left join public.profiles p on p.id = dma.profile_id
  where dma.id = any (p_ids)
    and (
      (select public.can_access_court(dm.court_id))
      or (select public.has_retained_assignment(dm.id))
      or (select public.has_docket_share(dm.id, 'view'))
    );
$$;

revoke all on function public.resolve_docket_assignment_identities(uuid[]) from public, anon;
grant execute on function public.resolve_docket_assignment_identities(uuid[]) to authenticated;

comment on function public.resolve_docket_assignment_identities(uuid[]) is
  'Batch form of resolve_docket_assignment_identity (0043): (assignment_id, profile_id, display_name) for many docket_matter_assignments rows in one call, including ended/historical rows, each gated by the caller being able to read its parent Docket Matter (can_access_court OR has_retained_assignment OR has_docket_share view). Rows the caller may not see are simply absent. SECURITY DEFINER; EXECUTE for authenticated only.';

-- ----------------------------------------------------------------------------
-- 2. Wrap the remaining bare auth.uid() calls
-- ----------------------------------------------------------------------------

alter policy "Reporters can submit issue reports" on public.issue_reports
  with check (reporter_id = (select auth.uid()));

alter policy "Reporters can view their own issue reports" on public.issue_reports
  using (reporter_id = (select auth.uid()));

-- can_manage_clerk_access(): body identical to 0151 apart from the wrapped
-- auth.uid(). 0154 adjusted only this function's grants; those are not
-- touched here (create or replace keeps ACLs and the comment).
create or replace function public.can_manage_clerk_access(p_court_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select public.is_admin()) or exists (
    select 1 from public.magistrate_courts mc
    where mc.court_id = p_court_id
      and mc.profile_id = (select auth.uid())
      and mc.ended_at is null
      and (
        mc.can_manage_clerks = true
        or (
          select count(*) from public.magistrate_courts mc2
          where mc2.court_id = p_court_id and mc2.ended_at is null
        ) = 1
        or (
          mc.assignment_type = 'regular'
          and (
            select count(*) from public.magistrate_courts mc3
            where mc3.court_id = p_court_id
              and mc3.ended_at is null
              and mc3.assignment_type = 'regular'
          ) = 1
        )
      )
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. Foreign-key indexes
-- ----------------------------------------------------------------------------
-- Skipped because a unique constraint / index already leads with the column:
--   docket_matter_case_law(docket_matter_id)   -- docket_matter_case_law_unique (docket_matter_id, case_law_id), 0030
--   docket_matter_judgments(docket_matter_id)  -- docket_matter_judgments_unique (docket_matter_id, judgment_id), 0029
--   docket_matters(district_id)                -- docket_matters_district_case_number_unique (district_id, case_number), 0020
--   shares(item_type, item_id)                 -- shares_item_idx, 0037
--   quick_code_case_law(quick_code_id)         -- quick_code_case_law_unique (quick_code_id, case_law_id), 0034
--   quick_code_docket_matters(quick_code_id)   -- quick_code_docket_matters_unique (quick_code_id, docket_matter_id), 0032

-- webhook_outbox: only a partial index on (created_at) where pending exists
-- (0128); the endpoint FK (cascade delete, per-endpoint history) has none.
create index if not exists webhook_outbox_endpoint_id_idx
  on public.webhook_outbox (endpoint_id);

-- docket_callover_items: indexed by callover and by matter (0129), not by
-- who created the row (ON DELETE SET NULL on profiles needs the lookup).
create index if not exists docket_callover_items_created_by_idx
  on public.docket_callover_items (created_by);
