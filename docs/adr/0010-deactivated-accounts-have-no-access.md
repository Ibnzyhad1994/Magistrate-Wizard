# 0010 - A deactivated account has no access

**Status:** Accepted (`0200_deactivated_accounts_have_no_access`, `0201_set_profile_active`; backend sweep BE-09, owner decision 2026-10-28)

## Context

`profiles.is_active` existed from `0001_init` and Admin People showed Active and Inactive, but nothing enforced it.
A magistrate who had left the bench, or an administrator marked Inactive, kept full access, and offboarding needed the Supabase dashboard.
Deleting the account is not an option: judicial content references its author with `ON DELETE RESTRICT`, and the audit log is append-only.

## Decision

`is_active = false` locks the account out immediately, at every layer:

- every role, court and docket helper (`is_admin`, `is_magistrate`, `is_clerk`, `my_court_id`, `can_access_court`, `has_active_clerk_assignment`, `has_active_magistrate_court`, `can_manage_clerk_access`, `has_retained_assignment`, `has_docket_share`) answers false for it, so every RPC gated on them refuses;
- a restrictive "Deactivated accounts have no access" policy for `authenticated` on every public table with RLS, and on `storage.objects`, ANDs `is_active_account()` into every permissive policy, ownership-only ones and Realtime included;
- `set_profile_active`, the only client path that changes the flag, bans the user and deletes their sessions, so no new token is issued and the one already issued expires within `jwt_expiry`.

The one thing a deactivated account can still do is read its own profile row, so the app can say the account is deactivated.

Court assignments are not ended by deactivation.
`set_profile_active` returns the open ones so an administrator reassigns each, because who sits where is a decision, not a side effect.

## Consequences

- A new public table with RLS needs the restrictive policy in the migration that creates it; `test-account-deactivation.mjs` fails until it has one.
- A new helper that grants access through `auth.uid()` should AND in `is_active_account()`.
- A deactivated account keeps holding its court assignments, including a primary slot, until an administrator ends or reassigns them.
- Reactivation restores everything the account held, because nothing was ended.
- The last active administrator cannot deactivate themselves.
