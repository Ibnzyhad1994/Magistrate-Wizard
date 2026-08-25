-- ============================================================================
-- 0077_docket_hearing_progress.sql
--
-- Hearing/Trial Progress tracking -- what actually happened at a specific
-- court sitting (witnesses called/completed/partly heard/remaining), so a
-- magistrate can see, chronologically, how a trial has progressed across
-- several hearing dates.
--
-- ARCHITECTURE DECISION: extends `docket_events` (0024) rather than
-- creating a new parallel history table. `docket_events` already IS a
-- chronological, per-date, per-matter "what happened at this appearance"
-- ledger (scheduled_date, stage_at_event, outcome_at_event, notes),
-- already has correct RLS inherited from the parent Docket Matter
-- (can_access_court()/has_retained_assignment()), already has the
-- generic audit trigger attached (0048), already supports edit-in-place
-- with full history preserved (no hard delete), and its own header
-- comment explicitly scopes "ordinary logistical/substantive fields...
-- remain freely correctable" -- a numeric witness breakdown is squarely
-- within that same "what happened at this specific appearance" purpose,
-- not a stretch of it. Building a second table keyed the same way
-- (docket_matter_id + a date) would be the "duplicate parallel history
-- system" the brief explicitly warns against.
--
-- All four witness columns are nullable and independent of each other --
-- a Maintenance/Family Violence hearing (or any non-trial appearance)
-- simply leaves them null and continues using the existing notes/
-- outcome_at_event fields for adjournments/orders/submissions exactly as
-- before, satisfying the "reusable beyond trials" requirement without a
-- witness-specific table. NULL is preserved as genuinely distinct from 0
-- throughout (no default value, no coercion) -- "0 witnesses remaining"
-- and "not recorded" must never be conflated.
-- ============================================================================

alter table public.docket_events
  add column witnesses_called integer,
  add column witnesses_completed integer,
  add column witnesses_partly_heard integer,
  add column witnesses_remaining integer,
  add constraint docket_events_witness_counts_non_negative check (
    (witnesses_called is null or witnesses_called >= 0)
    and (witnesses_completed is null or witnesses_completed >= 0)
    and (witnesses_partly_heard is null or witnesses_partly_heard >= 0)
    and (witnesses_remaining is null or witnesses_remaining >= 0)
  );

comment on column public.docket_events.witnesses_called is
  'Optional hearing-progress field (0077): number of witnesses called at this specific appearance. NULL means not recorded -- never coerced to 0. Independent of event_type/category; relevant mainly at Trial stage but not restricted to it.';
comment on column public.docket_events.witnesses_completed is
  'Optional hearing-progress field (0077): number of witnesses who completed their evidence at this appearance. NULL means not recorded.';
comment on column public.docket_events.witnesses_partly_heard is
  'Optional hearing-progress field (0077): number of witnesses only partly heard at this appearance (evidence started but not finished). NULL means not recorded.';
comment on column public.docket_events.witnesses_remaining is
  'Optional hearing-progress field (0077): number of witnesses still to be heard, as understood at this appearance -- a running total, not a per-appearance delta. NULL means not recorded, distinct from a deliberate 0.';
