## What changed and why

<!-- One paragraph. Describe the verified state that results, not just which files moved. -->

## Checks

- [ ] `npm run lint` and `npm run typecheck` pass locally
- [ ] `npm test` passes (script suite); `npm run test:live` if the change touches RLS, RPCs or hooks that hit the database
- [ ] `npm run test:e2e` passes if the change touches a route, layout or the auth flow
- [ ] User-facing copy uses British spelling (colour, organisation, licence, judgement is *judgment* in the legal sense)
- [ ] No formatting-only churn mixed into logic changes
- [ ] `CHANGELOG.md` → Unreleased updated if a user or operator would notice the change

## Database change checklist

<!-- Only when supabase/migrations/** or supabase/functions/** changes. Delete this section otherwise.
     Mirrors DEVELOPMENT_WORKFLOW.md → "Database change workflow". Stages are not skipped to save time. -->

- [ ] 1. Live inspection done (schema, RLS, functions, triggers confirmed, not assumed)
- [ ] 2. Dependency inventory (what reads/writes the affected objects)
- [ ] 3. Design written up
- [ ] 4. Threat model (who can now read/write what; any new `SECURITY DEFINER` has its why/`search_path`/grants note)
- [ ] 5. Rollback-only DDL pretest
- [ ] 6. Behavioural pretest with disposable fixtures only (never the real admin profile)
- [ ] 7. Reviewed / explicitly approved
- [ ] 8. Applied (which environment: local / preview / production)
- [ ] 9. Structural verification
- [ ] 10. Live behavioural regression (RLS/privacy-affecting changes: rollback-only pass done)
- [ ] 11. Supabase advisors (security + performance) reviewed; any *new* finding called out below
- [ ] 12. Rollback / baseline check
- [ ] 13. Architecture spec updated
- [ ] Migration is new and forward-only (no applied migration edited; numbering reconciled against `list_migrations`)
- [ ] None of the security/privacy invariants in `docs/adr/` is weakened

## Notes for the reviewer

<!-- Anything unverified, deferred, or worth a second pair of eyes. -->
