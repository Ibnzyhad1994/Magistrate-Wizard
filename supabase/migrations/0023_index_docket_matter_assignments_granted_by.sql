-- Magistrate Wizard — index docket_matter_assignments.granted_by
-- Addresses the single new performance-advisor finding attributable to
-- migration 0022: docket_matter_assignments_granted_by_fkey (the FK from
-- docket_matter_assignments.granted_by to profiles.id) had no covering
-- index. That was a deliberate omission at 0022 design time (granted_by
-- was not in the originally approved "appropriate indexes" list — only
-- docket_matter_id and profile_id were) — now corrected as its own small
-- forward migration, per the project's never-edit-applied-migrations
-- rule (0022 is not touched).
--
-- No other schema, policy, trigger, function, or data change is made
-- here. Naming follows the existing convention already used for this
-- table's other single-column indexes
-- (docket_matter_assignments_docket_matter_id_idx,
-- docket_matter_assignments_profile_id_idx), and the precedent set by
-- 0021 (docket_matters_last_updated_by_idx) for the same category of
-- finding on a sibling table.

create index docket_matter_assignments_granted_by_idx on public.docket_matter_assignments (granted_by);
