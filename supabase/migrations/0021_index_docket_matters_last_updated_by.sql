-- BenchBook — index docket_matters.last_updated_by
-- Addresses the single new performance-advisor finding attributable to
-- migration 0020: docket_matters_last_updated_by_fkey (the FK from
-- docket_matters.last_updated_by to profiles.id) had no covering index.
-- That was a deliberate omission at 0020 design time — last_updated_by
-- wasn't in the originally approved "appropriate indexes" list — now
-- corrected as its own small forward migration, per the project's
-- never-edit-applied-migrations rule (0020 is not touched).
--
-- No other schema, policy, trigger, function, or data change is made
-- here. Naming follows the existing convention already used for this
-- table's other single-column indexes (docket_matters_court_id_idx,
-- docket_matters_status_idx, docket_matters_created_by_idx).

create index docket_matters_last_updated_by_idx on public.docket_matters (last_updated_by);
