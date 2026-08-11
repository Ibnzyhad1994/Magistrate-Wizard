-- Postgres enum values cannot be added and used within the same
-- transaction, so this is split into its own tiny migration, applied
-- directly (a pure additive enum label -- cannot break any existing row
-- or query; there is no meaningful "rollback test" for an ADD VALUE
-- beyond what's already been reasoned through here). The trigger-function
-- changes that actually USE this new value are pretested normally and
-- applied separately as 0056b.
alter type public.bookmark_entity_type add value 'statute_provision';
