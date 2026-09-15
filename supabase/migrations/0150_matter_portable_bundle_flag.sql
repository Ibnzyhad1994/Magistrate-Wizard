-- 0150_matter_portable_bundle_flag.sql
--
-- Dashboard matter pack (court-authority export/import). Distinct from
-- download_my_data, which never includes docket matters.

insert into public.feature_flags (key, description, enabled)
values (
  'matter_portable_bundle',
  'Dashboard export/import of a court-authority matter pack',
  true
)
on conflict (key) do nothing;
