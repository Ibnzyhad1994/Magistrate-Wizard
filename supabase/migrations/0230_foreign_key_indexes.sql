-- Magistrate Wizard -- 0230: every foreign key a parent delete follows has
-- an index on its column
--
-- Problem (backend sweep, low priority)
--   Postgres does not index a referencing column on its own. When a parent
--   row is deleted, the foreign key's ON DELETE action looks up the
--   referencing rows by that column, so with no index each delete scans the
--   whole child table while holding its locks. Seven such columns had no
--   index leading on them:
--     docket_capacity_overrides.docket_event_id -> docket_events (SET NULL)
--     docket_capacity_overrides.category_id     -> docket_matter_categories (SET NULL)
--     docket_capacity_settings.category_id      -> docket_matter_categories (CASCADE)
--     statutes.primary_document_id              -> documents (SET NULL)
--     court_non_sitting_days.court_id           -> courts (CASCADE)
--     court_non_sitting_days.district_id        -> magisterial_districts (CASCADE)
--     webhook_endpoints.court_id                -> courts (SET NULL)
--   docket_capacity_settings_owner_category_unique_idx and the
--   court_non_sitting_days unique indexes contain the column, but not first,
--   so the delete's lookup cannot use them.
--
-- Change
--   One btree index per column above. Deleting a docket event, a matter
--   category, a document, a court or a district now finds its referencing
--   rows by index.
--
-- Left as they are: the `*_by -> profiles` audit columns (created_by,
--   reviewed_by, ended_by and the like). They are only looked up when a
--   profile is deleted, which never happens: the immutable audit ledger
--   keeps profiles (accounts are deactivated, ADR 0010), and the RESTRICT
--   provenance keys refuse it. An index on each would cost every write to
--   those tables for a lookup that does not run.
--   scripts/tests/test-foreign-key-indexes.mjs keeps it that way: a new
--   unindexed foreign key fails it unless it is one of these audit columns.
--
-- Threat model: indexes only; no policy, grant or function changes.
-- ============================================================================

create index docket_capacity_overrides_docket_event_id_idx
  on public.docket_capacity_overrides (docket_event_id);

create index docket_capacity_overrides_category_id_idx
  on public.docket_capacity_overrides (category_id);

create index docket_capacity_settings_category_id_idx
  on public.docket_capacity_settings (category_id);

create index statutes_primary_document_id_idx
  on public.statutes (primary_document_id);

create index court_non_sitting_days_court_id_idx
  on public.court_non_sitting_days (court_id);

create index court_non_sitting_days_district_id_idx
  on public.court_non_sitting_days (district_id);

create index webhook_endpoints_court_id_idx
  on public.webhook_endpoints (court_id);
