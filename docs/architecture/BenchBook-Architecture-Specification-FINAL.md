# BenchBook Authoritative Architecture Specification (Final, Pre-Implementation)

**Revision 3** — incorporates Addendum 3 (Court-Anchored Docket) and the retained/part-heard matter model in full, superseding all owner-based Docket RLS language from Revision 2. Docket Matters are no longer individually owned; operational access derives from active Court assignment, with a separate mechanism for retained/part-heard responsibility after a Court assignment ends. Assignment state now uses `ended_at IS NULL` as the single source of truth (no `is_active` boolean on assignment tables). Sections 1, 3, 4, 14, 15, 16, and 17 are rewritten; Sections 2, 5–13 are unchanged from Revision 2.

**Status:** Approved for implementation. Applied to Supabase so far: `0013_magisterial_districts`, `0014_seed_magisterial_districts` (ten original districts), `0015_seed_east_bank_demerara_district` (eleventh district), `0016_reference_data_admin_fields`, `0017_magistrate_courts`, `0018_seed_guyana_magistrates_courts` (46-row researched/inferred Court seed — since superseded), `0019_reconcile_guyana_magistrates_courts` (forward reconciliation to a personally verified 55-row operational Court structure; 0018 itself was not edited, per the project's applied-migrations-are-immutable rule), `0020_docket_matters` (court-anchored foundation: court_id, database-derived district_id, case_number, matter_title, charge_or_issue, orders_summary, outcome, status, created_by, last_updated_by; can_access_court()-only RLS at this stage), `0021_index_docket_matters_last_updated_by`, `0022_docket_matter_assignments` (retained/part-heard access: self-only creation gated by a live `can_access_court()` check, no admin bypass anywhere, `ON DELETE SET NULL` on `profile_id`/`granted_by` with a history-protection trigger that safely absorbs that FK action, automatic release on `completed`/`archived`; extends Docket SELECT/UPDATE RLS to add the `has_retained_assignment()` path — applied and verified against a full transactional test battery). `0023_index_docket_matter_assignments_granted_by` (adds the covering index for `docket_matter_assignments_granted_by_fkey` — applied and verified). `0024_docket_events` (one appearance/hearing occurrence per Docket Matter, court/district derived from the parent, immutable `docket_matter_id`, forced/locked `presiding_magistrate_id` provenance, constrained-text `event_status`, external-calendar pair CHECK, access inherited via `can_access_court()`/`has_retained_assignment()` — applied and verified against a full transactional test battery). `0025_docket_matter_parties` (structured party/participant identity per Docket Matter, immutable `docket_matter_id`, independent `party_type`/`role` constrained-text vocabularies (not the legacy `party_role` enum), no uniqueness on name/role (names are not identifiers), constrained-text `party_status` with no hard DELETE, access inherited via the same two-path predicate — applied and verified against a full transactional test battery). `0026_docket_matter_tags` (APPLIED) — institutional Docket tags as a dedicated direct child table of `docket_matters` (NOT a join to the existing global `tags` table, which remains untouched), free-form `tag_name` with case-insensitive/whitespace-trimmed uniqueness per matter (not global), `created_by` provenance only (never access control), ordinary hard DELETE approved for untagging (a deliberate, explicit exception to the no-hard-delete rule used elsewhere in the Court-Anchored Docket), access inherited via the same two-path predicate, no UPDATE policy, no admin bypass. A separate, private, user-owned personal-label feature is explicitly deferred and not part of 0026. `0027_judgments` (APPLIED) — individually owned Judgment records (`owner_id`, immutable after creation, forced/locked by a guard trigger, never Court-owned, never transferred on Court departure), private by default with an owner-controlled `is_discoverable` read-only flag, no `is_admin()` bypass anywhere, no reference to any Docket/Court access helper, owner-only DELETE recorded as explicitly provisional pending the later `judgment_lifecycle_locking` migration, `content`/`content_text` fields with no editor/search infrastructure built yet, and no `judgment_tags`/`docket_matter_judgments`/attachments/finalization created in this migration. `0028_judgment_tags` (APPLIED) — Judgment-specific tags as a dedicated direct child table of `judgments` (NOT the global `tags` table), `judgment_id ON DELETE CASCADE` (deliberately the opposite of the Docket child-table RESTRICT convention, since tag rows are purely organizational and a Judgment remains owner-deletable at this pre-lifecycle-locking stage), SELECT inherits the parent Judgment's own access model (owner OR `is_discoverable`), INSERT/DELETE owner-only even for a discoverable reader, no UPDATE policy, no admin bypass, no Court/Docket access rule referenced anywhere. `0029_docket_matter_judgments` (APPLIED) — the Docket↔Judgment association table: association only, never confers access in either direction; SELECT requires independent lawful access to BOTH the Docket Matter and the Judgment (`DocketAccess AND JudgmentAccess`, never OR — closing a join-row-as-side-channel gap); INSERT/DELETE require Docket access AND Judgment *ownership* specifically (`is_discoverable` alone is never sufficient); `created_by` is provenance only and never determines DELETE authority; `docket_matter_id ON DELETE RESTRICT`, `judgment_id ON DELETE CASCADE`; no UPDATE policy; no admin bypass; the join row carries no descriptive metadata. Applied and fully verified against a 34-scenario rollback-only transactional test battery (SELECT AND/OR matrix, INSERT/DELETE authority, discoverability- and Docket-access-transition sequences, side-channel protection in both directions, CASCADE/RESTRICT lifecycle, no new advisor findings). `0030_docket_matter_case_law` (APPLIED) — the Docket↔Case-Law association table, following the same association-only/BOTH-sides principle established in 0029, but deliberately built against the *current live, legacy, admin-curated* `case_law` model (globally readable to authenticated users, no `owner_id`/`is_discoverable` yet) rather than the future personal/canonical split anticipated by §3 and scheduled later as `0035_case_law_personal_research` — see §5/§14/§17. Applied and fully verified against a 27-scenario rollback-only transactional test battery (BOTH-sides SELECT, owner-independent Case-Law-read-only INSERT/DELETE authority, nested-RLS structural proof, side-channel protection, both RESTRICT FK lifecycles, no new advisor findings). `0031_quick_codes` (APPLIED) — individually owned, fully private text-expansion/snippet records (`code_word`/`title`/`content`/`description`), owner-only RLS on all four commands with no Court/Docket/discoverability/admin-bypass path of any kind, per-owner case-insensitive `code_word` uniqueness, owner hard DELETE approved, no search infrastructure yet — see §7. Applied and fully verified against a 25-scenario rollback-only transactional test battery (validation, normalization, per-owner uniqueness, ownership-guard/spoof-neutralization, owner-vs-other-vs-Admin RLS on all four commands, no Court/Docket leakage even when sharing a Court, profiles RESTRICT, no new advisor findings). `0032_quick_code_docket_matters` (APPLIED) — the Quick Code↔Docket Matter association table, following the same association-only/BOTH-sides principle as `docket_matter_judgments`/`docket_matter_case_law`, with Quick Code access collapsing to `owner_id = auth.uid()` (no discoverability tier exists); `quick_code_id ON DELETE CASCADE`, `docket_matter_id ON DELETE RESTRICT` — see §7/§14. Applied and fully verified against a 25-scenario rollback-only transactional test battery (duplicate/cardinality, provenance, no-UPDATE, current/retained/no-Docket-access paths, Admin rejection, side-channel protection both directions, dynamic Docket-access transition, Quick Code CASCADE proven independent of current Docket access, Docket RESTRICT, association-only boundary, no new advisor findings). `0033_quick_code_judgments` (APPLIED) — the Quick Code↔Judgment association table, `QuickCodeOwnership AND JudgmentReadAccess` (deliberately read-only, not ownership, on the Judgment side), both FKs `ON DELETE CASCADE`, visibility tracks Judgment discoverability dynamically — see §7/§14. Applied and fully verified against a rollback-only transactional test battery (provenance/spoof-neutralization, no-UPDATE, all six ownership/Judgment-access scenario combinations, Admin rejection, side-channel protection both directions, a 10-step discoverability-transition sequence proving zero association-row mutation, Quick-Code-CASCADE-independent-of-Judgment-access, Judgment-CASCADE-independent-of-another-user's-private-association, association-only boundary, no new advisor findings; one test-authoring artifact was self-caught and documented — a non-owner's blocked DELETE was verified as having no effect by re-querying under the same non-owner's restricted session, which trivially shows 0 visible rows regardless of deletion; the row's continued physical existence was independently confirmed via a later unprivileged-role count in the same battery). `0034_quick_code_case_law` (APPLIED) — the Quick Code↔Case-Law association table, reusing 0030's nested-RLS design unmodified for the Case-Law side (`QuickCodeOwnership AND CaseLawReadAccess`), `quick_code_id ON DELETE CASCADE`, `case_law_id ON DELETE RESTRICT` matching 0030 — see §5/§7/§14. Applied and fully verified against a 22-scenario rollback-only transactional test battery (duplicate/cardinality both directions, provenance/spoof-neutralization, no-UPDATE, own+readable full SELECT/INSERT/DELETE cycle, other-user's-Quick-Code rejection, Admin rejection, side-channel protection both directions, Quick-Code-CASCADE-independent-of-Case-Law-access, Case-Law-RESTRICT-while-referenced then successful once unlinked, association-only boundary, no new advisor findings; zero test-authoring artifacts). `0035_case_law_personal_research` (APPLIED) — refactors the live single-tier `case_law` table into a canonical/personal dual model via nullable `owner_id` in the same table, with an owner-controlled `is_discoverable` flag on personal rows only, ownership immutable after creation, no admin bypass into personal records, canonical-only citation uniqueness, and `docket_matter_case_law`/`quick_code_case_law` left entirely unmodified — see §5/§14/§17. Applied and fully verified against a 54-scenario rollback-only battery across three self-contained transactions (canonical/personal creation including owner_id-omission and spoof-neutralization, the full SELECT/UPDATE/DELETE privacy matrix including a critical real-Admin-cannot-read-another-user's-private-row proof, ownership/category immutability in all three directions, `created_by`/`owner_id` independence, `search_case_law()` privacy proven zero-leakage across three identities, `case_law_tags` self-tagging correctly rejected, full `docket_matter_case_law` (0030) and `quick_code_case_law` (0034) nested-RLS regression with zero code changes to either table required, both tables' dynamic discoverability-transition sequences proving zero association-row mutation, and both RESTRICT-then-succeeds FK lifecycle proofs — no new advisor findings beyond the two expected new-index INFO notices; a cosmetic-only policy-name truncation to Postgres's 63-byte `name` limit was found and is disclosed in Part A below, with zero effect on any predicate/security behavior). `0036_case_law_annotations` (APPLIED) — private personal research notes attached to one Case Law record, reusing the 0030/0034 nested-RLS pattern (`AnnotationOwnership AND CaseLawReadAccess`), `case_law_id ON DELETE CASCADE` (deliberately unlike the 0030/0034 RESTRICT association model, since annotations are subordinate notes, not citations), `owner_id ON DELETE RESTRICT`, no admin bypass, no discoverability/sharing — see §5/§14/§17. Applied and fully verified against a 24-scenario rollback-only transactional test battery across two transactions (validation/non-blank CHECK, ownership-guard/spoof-neutralization, multiple-annotations-per-owner with no unintended uniqueness, owner+canonical/own-private/another's-discoverable full SELECT/INSERT/UPDATE/DELETE cycles, the critical parent-Case-Law-owner-cannot-see-another-magistrate's-annotation proof, another-user's-private-Case-Law rejection, other-user's-annotation isolation, Admin no-bypass confirmed structurally and behaviorally, a 7-step dynamic parent-privacy-transition sequence proving zero annotation-row mutation, parent `ON DELETE CASCADE` proven, profile `ON DELETE RESTRICT` proven, `updated_at` trigger confirmed — no new advisor findings beyond expected new-index INFO notices; one test-labeling artifact was self-caught and disclosed, not a system defect — see Part A of the 0036 verification report). `0037_shares.sql` (APPLIED) — explicit view/edit sharing for the Court-Anchored Docket only in this migration (`item_type` CHECK-constrained to `'docket_matter'`, a deliberate, disclosed scope boundary — Judgment/personal-Case-Law sharing is designed in principle but requires a separate future migration), completing the three-path Docket SELECT/UPDATE predicate first described in `0020` and extended once in `0022`; creation/revocation authority = any current lawful Docket-access holder (`can_access_court()`/`has_retained_assignment()`) plus recipient self-relinquishment; no resharing; soft-revocation only (`revoked_at`, mirroring `docket_matter_assignments.ended_at`); at most one active share per recipient per matter; no admin bypass; child tables (`docket_events`, `docket_matter_parties`, `docket_matter_tags`) extended to inherit each table's *existing* lifecycle under a share (view→SELECT-only, edit→existing mutation rights, never a newly-invented capability); association tables (`docket_matter_judgments`, `docket_matter_case_law`) widened on the Docket side for SELECT only, INSERT/DELETE left untouched; `quick_code_docket_matters` widened on the Docket side for INSERT/DELETE by an EDIT share specifically (Quick Code ownership untouched, Quick Codes remain fully unshareable); `has_docket_matter_authority()` (new, `SECURITY DEFINER`, boolean-only) resolves a genuine RLS-recursion risk in `shares`' own SELECT policy while `has_docket_share()` (`SECURITY INVOKER`) is the read-side helper consumed everywhere else — see §3/§14/§17. Applied and fully verified against a 75-scenario rollback-only transactional test battery (creation authority incl. self-share/grantor-spoof/duplicate-share/nonexistent-recipient rejection, SELECT visibility incl. the corrected current-authority-holder branch, the previously-fixed non-granter-revocation defect proven live via a real Court-authority-holder revoking another magistrate's granted share, share-only-recipients blocked from managing others' shares, no reactivation/no permission-mutation of a revoked share, no hard DELETE, the full Docket-parent/Events/Parties/Tags access matrix across Court/retained/view-share/edit-share/revoked/Admin-no-bypass paths, Judgment/Case-Law association BOTH-sides privacy preserved under an active Docket share, the asymmetric Quick-Code-Docket-Matter view/edit rule proven exactly as designed, offboarding proven to behave differently for recipient-deletion [auto-revoke] vs. grantor-deletion [access persists, provenance nulled], and the revoke-then-create permission-change workflow) — no new advisor findings beyond one expected `SECURITY DEFINER`/anon-EXECUTE WARN on `has_docket_matter_authority()` (same shape as the pre-existing `is_admin()` finding; boolean-only, no data exposure, not auto-fixed per this project's review discipline) and one expected unindexed-FK INFO note on `shares_item_id_fkey` (covered in practice by the composite `shares_item_idx`, since `item_type` is currently constrained to a single value). Migrations 0001–0012 remain exactly as applied. The legacy `cases`/`case_parties` tables remain untouched and are not built upon.

This document supersedes the original Reconciliation Report, Addendum 2, and Addendum 3 in full for all purposes. Those remain on disk for historical context only.

---

## 1. Final Entity/Table List

**Retained from 0001–0012, unchanged:**
`profiles`, `statutes`, `tags`, `statute_tags`, `audit_log`. Storage buckets `documents`, `avatars`.

**Retained from 0001–0012, unchanged but legacy (not used by new development):**
`cases`, `case_parties`, `case_tags`, `comments` (currently points at `cases`/`bench_notes`; fate addressed in §17).

**Retained from 0001–0012, structurally modified going forward:**
`courts` (gains `district_id`, `is_active`), `bench_notes` (polymorphic parent), `case_law` (nullable `owner_id`), `documents` (polymorphic parent), `bookmarks` (extended entity types), `bench_note_tags`, `case_law_tags`.

**Retained from 0001–0012, additionally deprecated (Guyana court-structure revision):**
`profiles.court_id`, `profiles.jurisdiction`, `profiles.court_name`, `courts.jurisdiction` — all four superseded by the `magisterial_districts` → `courts.district_id` → `magistrate_courts` model. None are used by any new functionality; none are rewritten or dropped in 0001–0012.

**New reference-data tables (applied or in progress):**
`magisterial_districts` (applied, `0013`/`0014`), gaining `is_active` in a forward migration (§16).

**New tables (Court-Anchored Docket, not yet applied):**
`magistrate_courts`, `docket_matters`, `docket_matter_assignments`, `docket_events`, `docket_matter_parties`, `docket_matter_tags`, `docket_matter_judgments`, `docket_matter_case_law`.

**New tables (other domains, not yet applied):**
`judgments`, `judgment_tags`, `quick_codes`, `quick_code_docket_matters`, `quick_code_judgments`, `quick_code_case_law`, `case_law_annotations`, `shares`.

---

## 2. Final Relationships and Cardinalities

- `magisterial_districts` 1—many `courts`
- `courts` many—many `profiles` (via `magistrate_courts`, time-bounded — see §4)
- `courts` 1—many `docket_matters`
- `docket_matters` 1—many `docket_matter_assignments` (retained/part-heard responsibility, time-bounded)
- `docket_matters` 1—many `docket_events`
- `docket_matters` 1—many `docket_matter_parties`
- `docket_matters` 1—many `docket_matter_tags` (institutional Docket tags — a dedicated child table, NOT the global `tags` table; see §4)
- `docket_matters` many—many `judgments` (via `docket_matter_judgments` — association only; never confers access to the Judgment in either direction; SELECT/INSERT/DELETE all require independent lawful access to BOTH linked records; see §6)
- `docket_matters` many—many `case_law` (via `docket_matter_case_law` — association only; never confers access to the Case Law record in either direction; SELECT/INSERT/DELETE all require independent lawful access to BOTH linked records — `DocketAccess AND CaseLawAccess`, never OR; Case-Law-side access is expressed as a live existence check against `case_law`'s own current RLS rather than a duplicated predicate, so it tracks the future personal/canonical `case_law` refactor (`0035`) automatically without requiring 0030 to change; see §5/§14)
- `judgments` 1—many `judgment_tags` (Judgment-specific tags — a dedicated child table, NOT the global `tags` table; see §6)
- `case_law` is itself a dual canonical/personal table (nullable `owner_id`, owner-controlled `is_discoverable` on personal rows only) as of `0035_case_law_personal_research` (prepared for review, not yet applied) — see §5.
- `case_law` many—many `tags` (via `case_law_tags` — unchanged by `0035`; `SELECT using (true)`, INSERT/DELETE `is_admin()`-only; no ordinary-user INSERT path exists, so a personal Case Law row can never acquire a tag association today — see §5)
- `case_law` 1—many `case_law_annotations` (private personal research notes, strictly owner-scoped; prepared for review as `0036_case_law_annotations`, not yet applied — SELECT/INSERT/UPDATE/DELETE require `AnnotationOwnership AND CaseLawReadAccess` via the same nested-RLS pattern as `docket_matter_case_law`/`quick_code_case_law`; `case_law_id ON DELETE CASCADE`, deliberately unlike the association tables' RESTRICT; the parent Case Law's own `owner_id` is never referenced, so owning the annotated record confers no annotation visibility; see §5/§14)
- `quick_codes` many—many `docket_matters` (via `quick_code_docket_matters` — association only; never confers access in either direction; SELECT/INSERT/DELETE all require independent lawful access to BOTH linked records — `DocketAccess AND QuickCodeAccess`, never OR, where Quick Code access is simply `owner_id = auth.uid()`; see §7/§14)
- `quick_codes` many—many `judgments` (via `quick_code_judgments` — association only; never confers access in either direction; SELECT/INSERT/DELETE all require `QuickCodeOwnership AND JudgmentReadAccess` (`owner_id = auth.uid()` on the Quick Code side, `owner_id = auth.uid() OR is_discoverable = true` on the Judgment side), never OR between the two sides; a Quick Code owner may link to another magistrate's discoverable Judgment without gaining any further access to it; visibility follows Judgment discoverability dynamically; both parents use `ON DELETE CASCADE`; see §7/§14)
- `quick_codes` many—many `case_law` (via `quick_code_case_law` — association only; never confers access in either direction; SELECT/INSERT/DELETE all require `QuickCodeOwnership AND CaseLawReadAccess` (`owner_id = auth.uid()` on the Quick Code side, a live existence check against `case_law` on the Case Law side — reusing 0030's nested-RLS design unmodified); a Quick Code owner may link to any readable Case Law record without gaining any further access to it; `quick_code_id ON DELETE CASCADE`, `case_law_id ON DELETE RESTRICT` matching `docket_matter_case_law` (0030); see §5/§7/§14)
- `bench_notes` many—1 polymorphic parent (`docket_matters`, `case_law`, or `judgments`) via `entity_type`/`entity_id`
- `documents` many—1 polymorphic parent (`docket_matters`, `judgments`, `case_law`, `quick_codes`, `bench_notes`, or legacy `cases`) via `entity_type`/`entity_id`
- `bookmarks` many—1 polymorphic target via `entity_type`/`entity_id` (`bookmark_entity_type` enum) -- seven approved values as of `0041`/`0042`: `case`, `bench_note`, `statute`, `case_law` (original, `0008`), plus `docket_matter`, `judgment`, `quick_code` (added `0041`/`0042`). Deliberately NOT the same set as `documents`: `document` itself is explicitly excluded (bookmarking an attachment vs. its parent record is an unresolved product question, not decided in `0041`/`0042`), and `bench_note` -- excluded from `documents`' six types by nothing in particular, simply never added there -- IS bookmarkable. `validate_bookmark_entity()` is `SECURITY INVOKER` (unlike `bench_notes_entity_guard()`): a Bookmark may only be created against an entity the caller can currently, lawfully read; the check must not bypass the parent's own RLS. See §14/§16/§17.
- `shares` many—1 polymorphic target (`docket_matters`, `judgments`, `case_law`), many—1 owner/granter, many—1 registered recipient
- `statutes` many—many `tags` (via `statute_tags`) — unchanged
- `profiles` 1—many `judgments`, `quick_codes`, `bench_notes` (as author), `case_law` (personal rows), `magistrate_courts`, `docket_matter_assignments`, `shares` (as granter and separately as recipient)

---

## 3. Final Ownership / Privacy / Sharing / Discoverability Rules

| Entity | Default visibility | Explicit sharing? | Discoverable pool? | Admin bypass? |
|---|---|---|---|---|
| `docket_matters` | Court-anchored — visible/editable to any magistrate with a **current** `magistrate_courts` assignment to that matter's court | **Yes** — per-matter view/edit share with a registered user, for exceptional consultation only (not ordinary succession). *Design fully resolved and prepared for review as `0037_shares.sql` (not yet applied) — see §14: grant/revoke authority = any current lawful Docket-access holder (court OR retained), plus the recipient may always relinquish their own share; no resharing; soft-revocation only (`revoked_at`); at most one active share per recipient per matter; share grants access to the Docket Matter row only, not its events/parties/tags/associations in this migration.* | **No — never** | **No.** Admin has zero special access to another court's or magistrate's Docket content, including no visibility into `shares` rows they neither granted nor received. |
| `docket_matter_assignments` (retained/part-heard) | The named magistrate only, for that specific matter, while `ended_at IS NULL` | N/A — this *is* the access grant | No | **No.** |
| `docket_events`, `docket_matter_parties` | Inherit from parent matter | Inherit | Inherit | **No.** |
| `docket_matter_tags` (institutional) | Inherit from parent matter — visible to any magistrate with current Court access or a retained assignment to that matter | Inherit (will extend to the `shares` path once built — not yet implemented) | Inherit | **No.** |
| `case_law` (canonical, `owner_id IS NULL`) | Visible to all authenticated users | N/A (already universal) | N/A (already universal) | **Yes, for write only** — expressly administrative resource. *(Resolved/implemented when `0035_case_law_personal_research` was prepared — not yet applied; see §5.)* |
| `case_law` (personal, `owner_id` set) | Private to owner | **Yes** — view or edit, registered users only | **Yes** — owner-controlled `is_discoverable` flag | **No — never, even for canonical-curation admins.** *(Resolved/implemented when `0035_case_law_personal_research` was prepared — not yet applied; see §5.)* |
| `case_law_annotations` | Strictly private to the annotation's own `owner_id` — the parent Case Law's own owner has no visibility into it either | **No, ever** | No | **No, ever.** *(Resolved/prepared for review when `0036_case_law_annotations` was written — not yet applied; see §5.)* |
| `judgments` | Private to owner by default (individually owned — never Court-owned; ownership never transfers when a magistrate leaves a Court) | **Future** — explicit view/edit sharing via the later `shares` migration (not implemented in `0027`) | **Yes** — owner-controlled `is_discoverable` flag; read-only to other magistrates, never edit | **No.** |
| `judgment_tags` | Inherits READ visibility from the parent Judgment (`owner_id = auth.uid()` OR `is_discoverable = true`); INSERT/DELETE are owner-only — a discoverable reader may read tags but never add or remove them | Future — will follow the parent Judgment's share-based view access once `shares` exists (not implemented in `0028`) | Inherit only — no separate discoverable flag of its own | **No.** |
| `docket_matter_judgments` | Association only — SELECT/INSERT/DELETE all require independent lawful access to **both** the Docket Matter (`can_access_court()` OR `has_retained_assignment()`) **and** the Judgment; INSERT/DELETE additionally require Judgment **ownership** specifically (`is_discoverable` alone is never sufficient to create or remove a link) | Future — both sides will extend to their own `shares` mechanism once built, preserving the BOTH-sides requirement; mutation via share-based edit access is undecided | N/A — the join row itself carries no descriptive metadata | **No.** |
| `docket_matter_case_law` | Association only — SELECT/INSERT/DELETE all require independent lawful access to **both** the Docket Matter (`can_access_court()` OR `has_retained_assignment()`) **and** the Case Law record; unlike `docket_matter_judgments`, INSERT/DELETE require Case-Law **read** access only, not ownership — Case Law is reusable research/reference authority, not individually authored work product. Case-Law-side access is currently trivially satisfied for any authenticated user (the live `case_law` table is globally readable, admin-curated only); the predicate is expressed as a live existence check against `case_law` itself so it automatically tightens once the future personal/canonical `case_law` split (`0035`) exists | Future — both sides will extend to their own `shares`/access mechanism once built, preserving the BOTH-sides requirement | N/A — the join row itself carries no descriptive metadata | **No.** |
| `quick_codes` | Private to owner, full stop — SELECT/INSERT/UPDATE/DELETE all `owner_id = auth.uid()`, no exceptions. `code_word` uniqueness is case-insensitive/trimmed and scoped PER OWNER (never global) | Not yet (deferred) — an explicit future design decision if ever introduced | **No — never.** No `is_discoverable` concept at all | **No.** Real Admin behaves like any other non-owner. |
| `quick_code_docket_matters` | Association only — SELECT/INSERT/DELETE all require independent lawful access to **both** the Docket Matter (`can_access_court()` OR `has_retained_assignment()`) **and** the Quick Code (`owner_id = auth.uid()`, the only access path Quick Codes have) | Future — both sides will extend to their own `shares`/access mechanism once built, preserving the BOTH-sides requirement | N/A — the join row itself carries no descriptive metadata | **No.** |
| `quick_code_judgments` | Association only — SELECT/INSERT/DELETE all require `QuickCodeOwnership` (`owner_id = auth.uid()`) **AND** current `JudgmentReadAccess` (`owner_id = auth.uid()` OR `is_discoverable = true`) — a deliberate difference from `quick_code_docket_matters`/`docket_matter_judgments`: linking requires Judgment **read** access only, not ownership, since Quick Codes are the linking user's own private metadata and grant nobody else anything | Future — preserves the independent-access requirement on both sides | Follows the linked Judgment's own discoverability, dynamically — visibility can appear/disappear as the Judgment owner toggles `is_discoverable`, without touching the association row | **No.** |
| `quick_code_case_law` | Association only — SELECT/INSERT/DELETE all require `QuickCodeOwnership` (`owner_id = auth.uid()`) **AND** `CaseLawReadAccess`, expressed as a live existence check against `case_law` itself (reusing 0030's nested-RLS design unmodified) rather than ownership — Case Law is reusable reference authority, mirroring `docket_matter_case_law`'s INSERT/DELETE rule | Future — both sides will extend to their own `shares`/access mechanism once built, preserving the independent-access requirement | Currently trivially satisfied for any authenticated user (the live `case_law` table is globally readable); will automatically tighten once the future personal/canonical `case_law` split (`0035`) exists, with no change required to this table — `0035` must regression-test this table alongside `docket_matter_case_law` | **No.** |
| `bench_notes` | Private to author, full stop, regardless of who can access the parent entity | **No** | No | **No.** |
| `documents` | Follows the parent entity's access rules | Follows parent | Follows parent | Follows parent. |
| `magisterial_districts`, `courts`, `statutes`, `tags` | Visible to all authenticated users | N/A | N/A | **Yes, for write** — reference/administrative resources. |
| `magistrate_courts` | Self (own assignments) | N/A | N/A | **Yes** — administrative roster data, not private judicial content. |
| `profiles` | Self only, row-level — unchanged. Professional-identity attribution ("retained by [Name]", Share recipient/grantor) is exposed only through two narrow, context-gated SECURITY DEFINER functions (`0043_narrow_professional_identity.sql`, **APPLIED and verified** — see §14/§16/§17), never through broadened `profiles` SELECT | N/A | N/A | **Yes** — user/system administration. |

**Governing principle (unchanged from Revision 2):** `is_admin()` is valid for administrative/system/reference functions. It is **never** used, by itself, to grant read or write access to another magistrate's private judicial content — and as of this revision, that explicitly includes Docket Matters, whose *ordinary* access path changed (court assignment instead of ownership) but whose *admin-exclusion* rule did not.

---

## 4. Final Docket Architecture (Court-Anchored — supersedes the owner-based design in full)

**Reference data (structural, not judicial content):**

```
magisterial_districts (
  id, name (case-insensitively unique),
  is_active boolean default true,   -- added in a forward migration; governs
                                      -- availability for NEW assignments only,
                                      -- never a historical-access gate
  created_at, updated_at
)

courts (
  id, name, jurisdiction (legacy free text, unused going forward),
  address,
  district_id → magisterial_districts,  -- nullable; a court may exist
                                          -- before its district is assigned
  is_active boolean default true,        -- same semantics as above
  created_at, updated_at
)
```

**Assignment (who currently operates where):**

```
magistrate_courts (
  id, profile_id → profiles, court_id → courts,
  assignment_type text not null default 'regular'
    check (assignment_type in ('regular','acting','relief','other')),
    -- constrained text, not a Postgres enum, for easy future expansion;
    -- does NOT alter Docket permissions — any current assignment,
    -- regardless of type, grants identical operational access
  started_at timestamptz not null default now(),
  ended_at timestamptz,   -- NULL = current/active; the single source of
                           -- truth for assignment state (no separate
                           -- is_active boolean — eliminates the
                           -- possibility of the two disagreeing)
  created_at, updated_at
)
-- unique(profile_id, court_id) where ended_at is null
--   → at most one current assignment per magistrate/court pair;
--     full history preserved across multiple past assignments to the
--     same court (e.g. left and later rejoined)
```

**The operational Docket itself:**

```
docket_matters (
  id, court_id → courts (not null),
  district_id uuid not null,   -- entirely database-derived from
                                 -- court_id → courts.district_id via
                                 -- trigger; never client-writable in
                                 -- practice, always overwritten;
                                 -- insert/update REJECTED outright if
                                 -- the selected court has no district
  case_number text not null,   -- Guyana case number; NOT globally unique —
                                 -- see the table-level constraint below.
                                 -- The official registry/case identifier.
  matter_title text not null,  -- Concise human-readable case style/title
                                 -- (e.g. party names) displayed in the
                                 -- Docket UI — distinct from case_number
                                 -- (official registry identifier) and from
                                 -- the future structured
                                 -- docket_matter_parties table. Entered
                                 -- directly; NOT derived or synchronized
                                 -- from docket_matter_parties or anywhere
                                 -- else. Approved as an explicit
                                 -- architecture refinement alongside
                                 -- migration 0020 (not part of the
                                 -- original Addendum 3 sketch).
  charge_or_issue text,        -- nullable — may not exist at initial
                                 -- Docket creation; free text, no
                                 -- enum/vocabulary imposed
  orders_summary text,         -- nullable, same rationale
  outcome text,                -- nullable, same rationale
  status enum('active','stayed','completed','archived'),
  matter_type enum(...),       -- DEFERRED — categories not yet defined,
                                 -- not part of migration 0020
  created_by uuid not null references profiles(id) on delete restrict,
  last_updated_by uuid references profiles(id) on delete set null,
    -- trigger-populated on every UPDATE; never client-writable
  created_at, updated_at,
  search_vector                -- DEFERRED — search architecture (§11)
                                 -- not yet designed, not part of
                                 -- migration 0020
)
-- NO owner_id column — ownership is not the access model for this table
-- NO is_discoverable column — the Docket can never be discoverable, by construction
-- NO DELETE RLS policy — archive via status, never hard-delete
-- table-level constraint: UNIQUE(district_id, case_number) — scoped to
--   the Magisterial District's registry sequence, not global. There is
--   deliberately NO standalone/global UNIQUE on case_number by itself.
-- Structured party/procedural-role identification (defendant, applicant,
--   respondent, etc.) is intentionally NOT on this table — it lives in
--   the future docket_matter_parties table (schema not yet designed),
--   which matter_title does not derive from or synchronize with.
```

**Retained/part-heard responsibility (a magistrate's continuing duty on a specific matter after their broader Court assignment ends):**

```
docket_matter_assignments (
  id, docket_matter_id → docket_matters, profile_id → profiles,
  reason text not null default 'retained_part_heard',
    -- constrained text, forward-compatible with additional legitimate
    -- reasons later; only one value needed today
  granted_by uuid references profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,   -- NULL = current/active, same ended_at-only
                           -- model as magistrate_courts
  notes text,   -- optional free-text context
  created_at, updated_at
)
-- unique(docket_matter_id, profile_id) where ended_at is null
-- grants full view+edit access to that one matter only — no separate
-- permission column; the retained magistrate needs to be able to
-- complete the matter, not merely observe it
-- automatic release: a trigger sets ended_at = now() (if still NULL)
-- whenever the parent docket_matters.status transitions to 'completed'
-- or 'archived' — NOT on 'stayed', since a stayed part-heard matter may
-- resume and remain that magistrate's responsibility
```

**Retained-assignment authorization and lifecycle rules (resolved when migration 0022 was prepared — this closes the gap the FINAL spec originally left open):**

- **Creation authority.** A `docket_matter_assignments` row may be created by a magistrate ONLY for themselves, and ONLY while they currently hold ordinary Court access to that matter via `can_access_court()`. Enforced by RLS `WITH CHECK`: `profile_id = auth.uid()`, `granted_by = auth.uid()`, the row is created with `ended_at IS NULL`, and `can_access_court()` is true for the parent matter's `court_id` at the moment of creation. A magistrate can never grant retained access to another person, record another user as `granted_by`, or create retained access to a matter at a Court they cannot currently access. **There is no admin bypass for creating retained Docket access** — this is a magistrate preserving their own already-legitimate access, not a mechanism for transferring or granting judicial access.
- **Ending authority.** Only the magistrate named by `profile_id` may end their own current retained assignment (setting `ended_at = now()`). They may not change `profile_id`, `docket_matter_id`, `granted_by`, or `started_at`, and may not clear/reopen an `ended_at` once set (no reactivation — a new retained assignment after a legitimate future need is a new row, subject to the ordinary creation authorization at that future time). No admin exception on ending, matching the no-admin-bypass rule throughout this table.
- **No hard DELETE**, ever, for anyone — historical rows are permanently preserved, same principle as `magistrate_courts`.
- **`reason`** remains constrained to the single approved value `retained_part_heard` (CHECK, not an enum, so future legitimate reasons can be added without a type change) — no additional values are defined or invented at this stage.
- **Automatic release** behavior is unchanged from the original sketch above: fires only on transition to `completed`/`archived`, never on `stayed`.
- **Dual-access is intentional, not a bug.** If Magistrate A holds a retained assignment on Matter X and then leaves the Court, A keeps SELECT/UPDATE on Matter X only, via the retained-assignment path — A loses all other access to that Court's Docket. If Magistrate B then becomes newly assigned to that Court, B gets ordinary Court-wide access via `can_access_court()`, which includes Matter X. A and B can therefore both legitimately access Matter X simultaneously, through two different access paths. A's retained assignment is not exclusive ownership and does not remove Matter X from the Court's ordinary Docket.

**Magistrate offboarding (retirement, resignation, promotion, or otherwise ceasing to use BenchBook) — resolved when migration 0022 was prepared:**

- The Court's Docket is never owned by any magistrate, including one holding a retained assignment. A departing magistrate's live retained access must be ended as part of offboarding, before their `profiles` row is ever deleted — by ordinary self-service ending (or a future dedicated offboarding workflow, not built as part of 0022).
- A successor magistrate assigned to the Court inherits ordinary Docket access purely through `magistrate_courts`/`can_access_court()` — no transfer, reassignment, or special handling of any Docket Matter is required merely because a predecessor departed. No Docket Matter is ever deleted or reassigned as a consequence of a magistrate leaving.
- The historical record of a retained assignment must survive even if the magistrate's `profiles` row is later deleted entirely. `docket_matter_assignments.profile_id` and `.granted_by` are therefore `ON DELETE SET NULL`, not `CASCADE` (which would destroy the historical row) and not `RESTRICT` (which would permanently block deleting a departed magistrate's profile).
- A `NULL` `profile_id` can only ever mean "the profile that once held this row has since been deleted" — it can never represent a live, currently-usable grant. `has_retained_assignment()` requires `profile_id = auth.uid()`, which `NULL` can never satisfy, and the table's history-protection trigger separately guarantees a row can never be left in the state `profile_id IS NULL AND ended_at IS NULL` — if a still-current row's `profile_id` is nulled by the FK action, the same trigger invocation also stamps `ended_at := now()`, so a current-but-orphaned row can never exist, even momentarily.
- Profile deletion must never cascade-delete judicial assignment history — this is the specific reason `CASCADE` was rejected in favor of `SET NULL` for both FK columns on this table.

**Normal offboarding vs. profile deletion — these are two different things, not one (recorded when 0022 was reviewed, for the future identity/profile migration to implement consistently; not designed or built now):**

- **Normal judicial departure** (retirement, resignation, promotion/appointment to another judicial office, transfer out of the Magistracy, or other ordinary cessation of BenchBook use) should NEVER delete the person's `profiles` row. The preferred future model is: (1) disable/deactivate their ability to authenticate/use BenchBook; (2) end their current `magistrate_courts` assignments; (3) end their current `docket_matter_assignments`; (4) preserve their `profiles` row as historical judicial identity; (5) preserve all historical Court and Docket assignment rows. Ceasing to use BenchBook must never, by itself, require deleting a magistrate's historical identity — historical records should remain able to identify which magistrate previously held a given Court or retained/part-heard assignment, by name, not just by an orphaned reference.
- **Profile deletion is exceptional fallback behavior, not the normal offboarding workflow.** The `docket_matter_assignments.profile_id`/`.granted_by` `ON DELETE SET NULL` behavior exists to make genuine, exceptional profile deletion safe if it ever occurs — historical rows survive, any still-current retained assignment affected is automatically ended by the history-protection trigger, and a `NULL` profile can never grant access — but this is a resilience mechanism for an edge case, not the intended day-to-day path for a magistrate leaving office.
- The actual deactivation/offboarding mechanism (an `is_active`-style flag or similar on `profiles`, and the workflow that drives it) is deferred to the future identity/profile migration — not designed or implemented as part of 0022.

**Provenance and physical profile deletion — clarified from the 0022 verification testing (discovered, not designed, this turn; no schema changed as a result):**

- During 0022's profile-deletion-fallback transactional testing, deleting a disposable test profile that was also the `created_by` of a `docket_matters` row was correctly blocked — not by anything in 0022, but by the pre-existing `docket_matters.created_by → profiles(id) ON DELETE RESTRICT` constraint from migration 0020. This is intentional, existing behavior, confirmed rather than changed.
- **Normal magistrate retirement or departure uses account/profile deactivation, not profile deletion.** This is consistent with, and reinforces, the "normal offboarding vs. profile deletion" distinction above — physical deletion was never the intended day-to-day path.
- **Historical `profiles` rows should ordinarily remain**, so that judicial provenance — which magistrate created or last touched a given Docket Matter — remains identifiable by name, not just by an orphaned reference.
- **`docket_matters.created_by ON DELETE RESTRICT` intentionally means a profile with Docket provenance cannot simply be physically deleted.** This is a deliberate consequence of that FK's design (§1/§4 of Revision 2, unchanged by 0022), not a gap to be closed. It was not altered as part of 0022, and is not altered by this clarification.
- The `ON DELETE SET NULL` behavior on `docket_matter_assignments.profile_id` and `.granted_by` (0022) remains useful resilience for the narrower case where profile deletion is otherwise permissible — e.g. a profile that never created or last-updated any Docket Matter, but did hold a retained assignment. It does not, and was never intended to, make deletion of a profile with Docket provenance possible.
- **A future identity/privacy/offboarding design may need an explicit archival or anonymization strategy**, if true physical deletion of a profile with judicial provenance is ever legally or operationally required (e.g. a data-protection request). That design is not needed now, is not designed here, and must preserve judicial record integrity (the fact that a given Court/Docket action was taken by an identifiable judicial officer) rather than simply removing the `RESTRICT` or converting `created_by` to `SET NULL` for convenience.

**`docket_events` — one Court appearance/hearing occurrence per Docket Matter (resolved when migration 0024 was prepared):**

```
docket_events (
  id, docket_matter_id → docket_matters (not null, immutable after creation),
    -- NO court_id, NO district_id on this table — both are obtained
    -- through the parent Docket Matter; never duplicated here
  scheduled_date date not null,   -- mandatory; a Court appearance is
                                    -- always known by date even before a
                                    -- precise sitting time is known
  scheduled_time time,            -- nullable — never fabricated merely
                                    -- to populate a timestamp
  event_type text,                -- nullable, UNCONSTRAINED in 0024 —
                                    -- the Addendum 2 criminal-specific
                                    -- enum (first_appearance, arraignment,
                                    -- pretrial, trial, sentencing, review,
                                    -- other) is explicitly NOT built; a
                                    -- broader cross-jurisdiction taxonomy
                                    -- is future work, designed and
                                    -- migrated deliberately when needed
  stage_at_event text,            -- nullable — what stage the matter was
                                    -- at, at this specific appearance
  outcome_at_event text,          -- nullable — this appearance's outcome,
                                    -- distinct from docket_matters.outcome
  orders_made_at_event text,      -- nullable
  notes text,                     -- nullable, free-text
  presiding_magistrate_id uuid references profiles(id) on delete set null,
    -- judicial provenance ONLY — who actually presided/heard this
    -- appearance; NEVER an access-control field. Forced to auth.uid()
    -- at creation (a client cannot forge another magistrate as
    -- presiding); not freely client-rewritable after creation. A future
    -- controlled correction/admin workflow may need to legitimately
    -- record a different presiding magistrate than the creator in some
    -- circumstance — that workflow is NOT built in 0024, and creation-
    -- time provenance is not weakened in anticipation of it.
  event_status text not null default 'scheduled'
    check (event_status in ('scheduled','completed','cancelled','entered_in_error')),
    -- constrained text, not a Postgres enum (same pattern as
    -- docket_matter_assignments.reason). scheduled = future/planned;
    -- completed = appearance occurred; cancelled = scheduled appearance
    -- did not proceed, remains historically visible; entered_in_error =
    -- row was created incorrectly, retained for audit/history rather
    -- than hard-deleted. No additional values invented.
  external_calendar_provider text,        -- nullable, Outlook placeholder
  external_calendar_event_id text,        -- nullable, Outlook placeholder
  external_calendar_synced_at timestamptz,-- nullable, Outlook placeholder
    -- no sync logic built in 0024 — placeholders only, per the boundary
    -- below
  location text,                  -- nullable, courtroom/location free
                                    -- text; NO separate courtroom table
                                    -- in 0024
  created_by uuid not null default auth.uid() references profiles(id) on delete restrict,
  last_updated_by uuid references profiles(id) on delete set null,
  created_at, updated_at
)
-- unique index on (external_calendar_provider, external_calendar_event_id),
--   scoped (partial) to rows where BOTH are non-null, so ordinary
--   non-synced rows are entirely unaffected — prevents importing the
--   same external calendar event twice
-- NO DELETE policy, ever — historical appearances, including cancelled
--   or entered-in-error ones, are never hard-deleted; a mistaken event
--   is corrected to entered_in_error, not removed
```

- **Court/District are never duplicated.** Both are obtained exclusively through the parent `docket_matters` row (`dm.court_id`, `dm.district_id`) — `docket_events` carries neither column.
- **`docket_matter_id` is immutable.** An event can never be moved to another Docket Matter via UPDATE — enforced by a trigger that raises an exception on any attempted change, mirroring how `docket_matter_assignments`' identity fields are protected in 0022.
- **Adjournments create a new row, never overwrite the old one.** Example: an appearance on 10 August occurs and the matter is adjourned to 3 September — the 10 August event remains permanently as the historical appearance; a new 3 September event is created. This is what keeps derived previous/next-appearance chronology historically accurate.
- **`presiding_magistrate_id` provenance protection** mirrors the `docket_matter_assignments.profile_id`/`granted_by` FK-nulling pattern from 0022: forced to `auth.uid()` at creation (ignoring any client-supplied value), force-preserved on ordinary UPDATE, with a single narrow exception permitting the transition from a real value to `NULL` — the profile's own `ON DELETE SET NULL` action when a presiding magistrate's profile is later deleted. The UPDATE policy's `WITH CHECK` independently requires `presiding_magistrate_id IS NOT NULL`, which makes that transition structurally impossible for any RLS-governed client path — the same provable-safety technique used in 0022, adapted here since (unlike `docket_matter_assignments.profile_id`) `presiding_magistrate_id` is not required to equal the *current* updater's `auth.uid()` after creation (it records who originally presided, an immutable historical fact, not whoever is currently correcting logistics).
- **`created_by`/`last_updated_by` FK choice** follows `docket_matters`' own precedent exactly, column-for-column: `created_by` is `ON DELETE RESTRICT` (same semantic role — who authored/created this specific row — as `docket_matters.created_by`, which is also `RESTRICT`), `last_updated_by` is `ON DELETE SET NULL` (same as `docket_matters.last_updated_by` — an incidental, resilience-appropriate "most recent toucher" marker, not a provenance-locking one). Neither is an access-control field.
- **Access is fully inherited from the parent Docket Matter.** SELECT, INSERT, and UPDATE all require `can_access_court(parent.court_id) OR has_retained_assignment(parent.id)` via an `EXISTS` lookup against `docket_matters` — the same two-path predicate `docket_matters` itself uses (not yet the `shares` path, per the incremental RLS staging decision in §14). This deliberately means a retained/part-heard magistrate may create and update appearances on the one matter they remain responsible for, even after losing ordinary Court-wide access — intentional, and does not extend to any other matter at that Court. No DELETE policy. No admin bypass, anywhere.
- **No full immutable event ledger is built in 0024.** Only the narrowest protection needed is applied: `docket_matter_id` is locked, `presiding_magistrate_id` provenance is locked (subject to the FK-nulling exception above), and there is no hard DELETE. Ordinary logistical/substantive fields (`scheduled_date`, `scheduled_time`, `event_type`, `stage_at_event`, `outcome_at_event`, `orders_made_at_event`, `notes`, `location`, `event_status`) remain freely correctable by anyone with lawful access to the parent matter.

**Outlook boundary for `docket_events` (unchanged from the original addenda, reaffirmed at 0024):** Outlook/calendar integration may deal only with appearance logistics — date, time, location. It must never become authoritative for legal substance (orders, outcome, parties, charges/issues) or for judicial access. The three placeholder columns above reserve the shape for a future sync; no sync logic is built now.

"Next appearance"/"previous appearance" remain derived from `docket_events.scheduled_date`, never stored — computed via query/view, not cached on `docket_matters`. **Resolved:** `event_status = 'cancelled'` and `event_status = 'entered_in_error'` rows are BOTH excluded from previous- and next-appearance derivation, in all four cases (excluded from "previous," excluded from "next"). `entered_in_error` never represents a real Court appearance and must never influence Docket chronology. A cancelled event remains permanently preserved and visible in the matter's full event history, but "Previous Appearance"/"Next Appearance" specifically mean an appearance that actually occurred or is presently expected to occur — a cancelled sitting must not become the Docket's current "previous appearance" merely because it once appeared on the calendar. Chronology queries/views implementing this filter are not built as part of 0024 — this is the semantic rule they must follow when they are.

**`docket_matter_parties` — structured party/participant identity (resolved when migration 0025 was prepared):**

```
docket_matter_parties (
  id, docket_matter_id → docket_matters (not null, immutable after creation),
    -- NO court_id, NO district_id — obtained exclusively through the
    -- parent Docket Matter, same principle as docket_events
  full_name text not null,   -- display/legal name as recorded for this
                               -- proceeding; NO separate persons/contact
                               -- registry, NO cross-matter identity
                               -- matching
  party_type text not null default 'individual'
    check (party_type in ('individual','organization','government_body','estate','other')),
    -- WHAT the party/entity is — independent of role
  role text not null
    check (role in ('accused','complainant','applicant','respondent',
      'plaintiff','defendant','petitioner','appellant','appellee',
      'landlord','tenant','child','other')),
    -- their PROCEDURAL position; no default, must be explicitly
    -- supplied. Deliberately excludes witness (not ordinarily a party —
    -- to be modeled separately if/when structured witness functionality
    -- is built) and any prosecution/police/counsel role (deferred, not
    -- invented merely to fill a perceived gap)
  attorney_name text,        -- nullable, simple free text
  contact_info text,         -- nullable, simple free text — no
                               -- structured contact/address model
  party_status text not null default 'active'
    check (party_status in ('active','entered_in_error')),
    -- entered_in_error preserves a bad/duplicate entry for history
    -- rather than hard-deleting it; NOT tied to the parent matter's own
    -- status/lifecycle — a party row does not become inactive merely
    -- because the matter completes/archives
  created_by uuid not null references profiles(id) on delete restrict,
  last_updated_by uuid references profiles(id) on delete set null,
  created_at, updated_at
)
-- NO uniqueness on (docket_matter_id, full_name) or
--   (docket_matter_id, full_name, role) — names are not reliable unique
--   identifiers, and one real person/entity may legitimately need more
--   than one party record where they hold more than one procedural role
-- NO DELETE policy, ever — a mistaken or duplicate entry is corrected
--   to entered_in_error, never hard-deleted
```

- **Legacy separation.** This is a wholly independent role/type vocabulary from the legacy `party_role` enum (`case_parties.role`) — that enum is not reused and not modified. `cases`/`case_parties` remain untouched, per the project's standing rule that the legacy Docket model is not built upon.
- **`docket_matters.matter_title` is unaffected.** Structured parties do not generate, derive, or synchronize `matter_title` in either direction — reaffirming the same non-synchronization rule recorded when `matter_title` was added in 0020.
- **`docket_matter_id` is immutable**, protected by the same exception-raising trigger pattern as `docket_events.docket_matter_id` (0024).
- **Corrections remain ordinary UPDATEs**, not a full immutable ledger: `full_name`, `party_type`, `role`, `attorney_name`, `contact_info`, and `party_status` may all be corrected by anyone with lawful access to the parent matter. If a party's legal name genuinely changes over time (as distinct from correcting a data-entry error), no separate historical-name timeline is preserved — that richer identity/history model is explicitly deferred, not built here.
- **Provenance (`created_by`/`last_updated_by`) follows the `docket_matters`/`docket_events` pattern exactly**, column-for-column, including the same FK choices (`created_by` `RESTRICT`, `last_updated_by` `SET NULL`) and the same non-access-control status.
- **Access is fully inherited from the parent Docket Matter**, via the identical two-path predicate (`can_access_court()` OR `has_retained_assignment()`) already used by `docket_matters`/`docket_events`, for SELECT/INSERT/UPDATE. No DELETE policy. No admin bypass. Not yet the `shares` path.
- **Deferred, not designed now:** a separate persons/contact/entity registry, cross-matter identity matching/deduplication, structured witness modeling, prosecution/police/counsel roles, a lawyer directory, structured address/telephone/email fields, and alias/AKA/historical-name tracking. None of these are invented here merely to appear complete.

**`docket_matter_tags` — institutional Docket tags (resolved when migration 0026 was prepared, superseding the original bare `docket_matters many—many tags` sketch in §1/§2/§15):**

**Why the existing global `tags` table is NOT reused.** `tags` (0006) is globally readable to every authenticated user and freely extensible by any authenticated user, with no scoping boundary of any kind — appropriate for the individually-owned content it currently serves (`cases`, `bench_notes`, `case_law`, `statutes`), but not appropriate for Docket metadata: a Docket tag's text may itself reveal sensitive information about a judicial matter (e.g. "warrant outstanding"), and such information must never be exposed outside that matter's own access boundary. `docket_matters` is therefore explicitly **not** connected to `tags` for the Court-Anchored Docket model. The existing `tags`, `case_tags`, `bench_note_tags`, `case_law_tags`, and `statute_tags` tables/relationships are unmodified and continue to serve their existing content types exactly as before.

**Two conceptually distinct tagging mechanisms, only one of which is built now:**
- **Institutional Docket tags** (`docket_matter_tags`, built in 0026): belong to the Docket Matter itself — operational/workflow labels (illustrative only, not seeded or hard-coded: e.g. *part-heard*, *urgent*, *awaiting report*, *warrant outstanding*). Follow the Court Docket; visible to every magistrate with lawful access to that matter (current Court assignment or retained assignment); not personal to whoever created them; will eventually also follow explicit parent-matter `shares` once that path exists.
- **Personal magistrate labels** (e.g. *review Friday*, *read before hearing*, *discuss with clerk*): private to the individual magistrate, NOT part of 0026, not designed here. A future, separate, user-owned/private mechanism. Explicitly must **not** automatically transfer to a successor magistrate merely because the successor inherits ordinary Court-wide Docket access — a private label is not Docket metadata.

```
docket_matter_tags (
  id, docket_matter_id → docket_matters (not null, effectively immutable —
    -- no UPDATE policy exists on this table at all, so a tag can never be
    -- moved between matters after creation),
    -- NO court_id, NO district_id — obtained exclusively through the
    -- parent Docket Matter, same principle as docket_events/docket_matter_parties
  tag_name text not null,   -- free-form, NO enum/controlled vocabulary in
                              -- 0026; must not be blank after trimming
                              -- whitespace (CHECK); entered/display casing
                              -- is preserved (not forced to a canonical
                              -- case) — stored value is whitespace-trimmed
                              -- for storage hygiene (an implementation
                              -- choice flagged for confirmation when 0026
                              -- was proposed, not a semantic decision)
  created_by uuid not null default auth.uid() references profiles(id) on delete restrict,
    -- provenance ONLY, never access control; forced to auth.uid() at
    -- creation by a guard trigger (cannot be forged), matching the
    -- created_by convention used throughout the Court-Anchored Docket
  created_at timestamptz not null default now()
    -- NO last_updated_by, NO updated_at — tag assignments are never
    -- edited in place (see lifecycle below)
)
-- unique index on (docket_matter_id, lower(btrim(tag_name))) — case-
--   insensitive, whitespace-trimmed duplicate prevention SCOPED TO THE
--   INDIVIDUAL MATTER ONLY; the same tag text on a different Docket
--   Matter is explicitly NOT a duplicate
-- NO separate tag-catalogue table — tag_name belongs directly to the row,
--   unlike the global tags/docket_matter_tags-as-join-table model this
--   supersedes
```

- **Lifecycle is a deliberate, explicit exception to the no-hard-delete rule** used everywhere else in the Court-Anchored Docket (`docket_matters`, `docket_matter_assignments`, `docket_events`, `docket_matter_parties` all forbid hard DELETE). Institutional tags are operational metadata, not substantive judicial history: INSERT = add tag, DELETE = remove tag. Renaming a tag is remove-old + add-new, not an in-place edit. **No `tag_status`, no `entered_in_error`, no ended-at state, and no UPDATE policy** — none of these are built. A future audit-log mechanism may separately record tag additions/removals if required; not designed here.
- **Access is fully inherited from the parent Docket Matter**, via the identical two-path predicate (`can_access_court()` OR `has_retained_assignment()`) already used by `docket_matters`/`docket_events`/`docket_matter_parties`, for SELECT/INSERT/DELETE. A retained/part-heard magistrate may add/remove institutional tags on the one matter they remain responsible for, and gains no access to tags on any other matter at that Court. **No admin bypass, anywhere.** Not yet the `shares` path — recorded for when `shares` (0037) is built, institutional Docket tags should inherit whatever visibility the parent matter grants a `shares` recipient; not implemented in 0026 since `shares` does not yet exist.
- **No speculative search infrastructure.** Institutional Docket tags are intended to eventually participate in Docket filtering/search, but that mechanism is not built in 0026 — only the indexes needed for parent-matter lookup and duplicate prevention are added.

---

## 5. Final Case Law Architecture

**`case_law` — canonical/personal dual model (APPLIED and fully verified as `0035_case_law_personal_research`):**

One unified table, distinguished purely by nullable `owner_id`. **NOT** split into two tables.

- `owner_id IS NULL` → **canonical/institutional Case Law.** Admin-curated, readable by every authenticated user regardless of `is_discoverable`, creatable/editable/deletable by admins only (`is_admin()`) — exactly `case_law`'s original live behavior, preserved unchanged for this branch.
- `owner_id IS NOT NULL` → **personal Case Law research**, owned by exactly one magistrate. Private by default; an owner-controlled `is_discoverable` flag extends read-only visibility to other authenticated users, mirroring `judgments.is_discoverable` (0027) exactly — discoverability never grants edit/delete. Creatable by any authenticated magistrate; editable/deletable by the owner only.
- **Ownership is immutable after creation** (guard trigger `case_law_ownership_guard()`) — a canonical record can never become personal, a personal record can never become canonical or change owners, via ordinary UPDATE. Converting personal research into canonical authority, if ever wanted, requires a deliberate future curation workflow, not built in `0035`.
- **No admin bypass into personal records.** Admin's canonical-curation authority (`owner_id IS NULL` rows) and a magistrate's personal-record privacy are deliberately separate concerns — the UPDATE/DELETE policies never let Admin satisfy a personal row's access predicate merely by being Admin.
- `created_by` is left **exactly as it already was** (nullable, `ON DELETE SET NULL`, provenance-only) — not touched by `0035`, and conceptually distinct from `owner_id`.
- **Citation uniqueness is scoped to canonical rows only** (`case_law_citation_canonical_unique_idx`, partial unique index `where owner_id is null`), replacing the old global unique index on `citation`. Personal rows have no citation uniqueness constraint of any kind — a deliberate, explicitly-flagged design choice (not specified by prior instruction) made because citation is an external real-world identifier, not a user-invented shorthand the way `quick_codes.code_word` is; two magistrates' (or one magistrate's) independent personal notes may legitimately cite the same case without conflicting.
- **`search_case_law()` requires no change** — confirmed `SECURITY INVOKER` (not `SECURITY DEFINER`), plain SQL selecting directly from `case_law` with no other bypass; it automatically narrows along with `case_law`'s own RLS. **`search_vector` requires no change** — a `GENERATED ALWAYS ... STORED` column (not trigger-maintained), computed only from descriptive text fields, deliberately excluding `owner_id`/`is_discoverable`.
- **`case_law_tags` requires no change.** It remains `SELECT using (true)` / INSERT-DELETE `is_admin()`-only; since ordinary magistrates still have no INSERT path into it, a personal Case Law row can never acquire a `case_law_tags` association through any currently available path, so the Docket/Judgment-tag-style privacy problem cannot occur here today. If a future migration ever lets owners tag their own personal Case Law, that feature requires the same dedicated-owner-scoped-table treatment already given to `docket_matter_tags`/`judgment_tags` at that time.
- **Indexes added:** `case_law_owner_id_idx` (plain, matching `judgments_owner_id_idx`); `case_law_discoverable_decided_date_idx` (partial, `on (decided_date desc) where owner_id is not null and is_discoverable = true` — refines the `judgments_discoverable_date_idx` precedent by also scoping to personal rows, since a canonical row's `is_discoverable` flag is inert to its own visibility). `case_law_created_by_idx`/`case_law_jurisdiction_idx`/`case_law_search_vector_idx` are unaffected.
- Production `case_law` had **zero rows** at the time `0035` was prepared — confirmed directly, not assumed. No backfill/data migration is required.
- No `case_law_annotations`, no Case Law `shares`, no personal↔canonical promotion workflow, and no frontend surface are built in `0035`.

**Live-schema note, now historical (recorded when `0030_docket_matter_case_law` was prepared, superseded by `0035` above once applied):** prior to `0035`, the live `case_law` table was the original single unified table with no `owner_id`/`is_discoverable` column, a flat `using (true)` SELECT policy, and `is_admin()`-only INSERT/UPDATE/DELETE. `0030_docket_matter_case_law` and `0034_quick_code_case_law` were both deliberately built against that legacy model via a live nested `EXISTS` against `case_law` rather than a duplicated predicate — see the design blocks below and §14 — specifically so that neither table would require any code change once `0035` landed.

**`docket_matter_case_law` — the Docket↔Case-Law association table (resolved when migration 0030 was prepared):**

**Governing principle, following the same association-only pattern established for `docket_matter_judgments` in 0029, adapted to Case Law's different access model:** a `docket_matter_case_law` row is an association only. It never grants access in either direction — Docket access never grants Case-Law access, and Case-Law access never grants Docket access. SELECT requires independent lawful access to **both** parents (`DocketAccess AND CaseLawAccess`, never OR), for the same side-channel reason established in 0029: the mere existence/visibility of a link row to only one side would itself leak information.

Unlike `docket_matter_judgments`, **INSERT/DELETE do not require Case-Law ownership** — only lawful Case-Law *read* access. Case Law is reusable research/reference authority intended to be cited across many matters, not individually authored work product; requiring ownership to cite a canonical authority would make ordinary legal research impossible (a magistrate must be able to attach an admin-curated authority they can read but did not create). This is a deliberate, explicit difference from the Judgment rule, not an oversight.

```
docket_matter_case_law (
  id, docket_matter_id → docket_matters (not null, on delete restrict),
    -- RESTRICT, matching docket_matter_judgments and the Court-Anchored
    -- Docket's judicial-history convention -- Docket Matters are not
    -- intended to be hard-deleted, and this association defensively
    -- prevents privileged/database-level deletion of a referenced
    -- Docket Matter while a link exists
  case_law_id → case_law (not null, on delete restrict),
    -- RESTRICT, deliberately NOT the CASCADE used for judgment_id in
    -- 0029. Case Law is administratively curated canonical/reference
    -- material intended to be cited across many Docket Matters, and
    -- its DELETE is currently admin-only and rare/deliberate -- unlike
    -- an individually-owned, still-provisional Judgment DELETE. An
    -- admin who wants to delete a Case Law record that is actively
    -- cited by one or more Docket Matters must explicitly unlink it
    -- first (or take a deliberate privileged action), rather than
    -- having citations silently vanish out from under magistrates who
    -- rely on them.
  created_by uuid not null default auth.uid() references profiles(id) on delete restrict,
    -- provenance ONLY -- never "ownership" of the link, never access
    -- control. Forced to auth.uid() at creation by a guard trigger
    -- (cannot be forged).
  created_at timestamptz not null default now()
    -- NO last_updated_by, NO updated_at -- present or absent only
)
-- unique(docket_matter_id, case_law_id) -- prevents duplicate
--   associations between the same pair; the relationship remains
--   genuinely many-to-many
-- NO status, NO notes, NO court_id/district_id, NO denormalized Case
--   Law case_name/citation or Docket case_number/matter_title -- the
--   association row contains nothing beyond its two foreign keys and
--   creation provenance
```

- **SELECT requires independent lawful access to BOTH linked records** — `DocketAccess AND CaseLawAccess`, never OR. Docket access means `can_access_court(dm.court_id) OR has_retained_assignment(dm.id)`, identical to `docket_matter_judgments`. Case-Law access is expressed as a live existence check against `case_law` itself (`exists (select 1 from case_law cl where cl.id = case_law_id)`) rather than a duplicated predicate copying `case_law`'s own access rules — this is deliberate: `case_law`'s live SELECT policy is unconditionally `true` for any authenticated user today, so the check is currently trivially satisfied whenever the referenced `case_law_id` exists at all, but the same EXISTS clause will automatically and correctly narrow once `case_law` gains real row-level privacy in the future `0035` refactor, with no change required to `0030`.
- **INSERT (creating a link) requires Docket access AND Case-Law *read* access** — not Case-Law ownership. Any magistrate with lawful Docket access may cite any Case Law record they can currently read (today: any Case Law record at all, since the table is globally readable). `created_by = auth.uid()` is also required and force-set by a guard trigger, so it cannot be forged.
- **DELETE (unlinking) requires the identical substantive authority as creation** — lawful current Docket access AND Case-Law read access, not merely "whoever created the link." `created_by` never determines DELETE authority.
- **No UPDATE policy.** The association has no editable business fields.
- **No admin bypass, anywhere on this table.** The real Admin profile must satisfy the same underlying Docket-access-AND-Case-Law-read predicates as anyone else to see or mutate an association — this is unaffected by the fact that `case_law` itself grants admins a separate, unrelated write-bypass on the parent `case_law` table.
- **Not yet the `shares` path.** The principle is established now for when Docket `shares` and any future Case-Law-side access mechanism exist: association visibility should continue to require independent lawful access to both sides — conceptually `FutureDocketReadAccess AND FutureCaseLawReadAccess`.
- **Explicitly deferred, not built in 0030:** the `case_law` personal/canonical refactor itself (`0035`), any Case-Law-side ownership/discoverability concept, `quick_code_case_law`, `case_law_annotations`, full-text/global search over associated authorities, and any frontend surface.
- **Mandatory future regression obligation (recorded when 0030 was approved):** `docket_matter_case_law`'s Case-Law-side predicate is a nested `EXISTS` against `public.case_law` itself, not a duplicated/inlined predicate — by design, it automatically inherits whatever RLS `case_law` carries at query time, today's unconditional `using (true)` included. This means `0035_case_law_personal_research`, when implemented, will silently and automatically change `docket_matter_case_law` SELECT/INSERT/DELETE behavior with zero code changes to this table. **`0035`'s own verification must therefore explicitly include a `docket_matter_case_law` regression pass** — confirming that after the refactor, a magistrate with Docket access but no Case-Law read access (personal/private, not owned, not discoverable) genuinely loses SELECT/INSERT/DELETE on existing associations, and that the BOTH-sides rule continues to hold under the new model. This is not automatically guaranteed by `0035` passing its own standalone tests; it must be checked as a direct consequence of `0030`'s dependency on nested RLS. **Fulfilled:** `0035`'s own verification battery included a full `docket_matter_case_law` regression pass (canonical/own-private/another's-private/another's-discoverable/no-Docket-access, plus a full discoverability-transition sequence) — zero code changes to `0030` were required, exactly as designed; see status line and Part A of the `0035` verification report.

**`case_law_annotations` — private personal research notes on a Case Law record (prepared for review as migration 0036; not yet applied):**

A `case_law_annotations` row is a private personal research note authored by one magistrate about one Case Law record (canonical or personal, own or another user's discoverable). It never modifies the parent Case Law record and is never canonical content.

**Governing principle: reuses, unmodified, the same nested-RLS pattern approved for `docket_matter_case_law` (0030) and `quick_code_case_law` (0034), applied here to a single-parent table rather than an association table.** SELECT/INSERT/UPDATE/DELETE all require `AnnotationOwnership AND CaseLawReadAccess` — `owner_id = auth.uid()` AND a plain, undecorated `EXISTS (select 1 from case_law cl where cl.id = case_law_id)`. Because RLS applies to every query against `case_law` regardless of where it originates, this EXISTS clause is automatically filtered by `case_law`'s own current RLS — if the parent later becomes unreadable to the annotation's owner, the owner automatically loses SELECT/UPDATE/DELETE on their own annotation through ordinary RLS, with the row persisting untouched until access returns, exactly mirroring the `0030`/`0034` discoverability-transition behavior. **Strictly private, permanently, in `0036`** — no discoverability, no sharing, no admin bypass. Critically, **the parent Case Law record's own `owner_id` is never referenced anywhere in this table's RLS** — owning the annotated Case Law confers zero visibility into another magistrate's annotations on it, even for an admin who curates it as canonical.

```
case_law_annotations (
  id, case_law_id → case_law (not null, on delete cascade),
    -- CASCADE -- deliberately unlike the 0030/0034 RESTRICT association
    -- model. Annotations are personal subordinate notes, not citations/
    -- references; a lawful Case Law deletion must never be blocked by
    -- anyone's annotations on it. All annotations disappear
    -- automatically with the parent, regardless of author.
  owner_id uuid not null default auth.uid() references profiles(id) on delete restrict,
    -- forced/locked by a guard trigger (cannot be forged, cannot be
    -- transferred), mirroring quick_codes.owner_id/case_law.owner_id
  annotation_text text not null,
    -- must not be blank after trimming (CHECK); never auto-rewritten
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
-- NO uniqueness on (owner_id, case_law_id) -- multiple annotations per
--   owner per Case Law record are explicitly allowed
-- NO title, NO is_discoverable, NO shares field, NO Court/Docket ids,
--   NO canonical flag, NO tags, NO search_vector
```

- **No admin bypass, anywhere on this table.** Admin may create and manage their own annotations like anyone else (subject to independently satisfying `CaseLawReadAccess`), but has zero visibility into another magistrate's annotations, including on Case Law Admin itself curates as canonical.
- **Parent CASCADE consequence, explicitly accepted:** an annotation creates no property/standing interest in the parent Case Law record whatsoever — its owner cannot block, delay, or even be consulted about a lawful deletion of the Case Law it annotates.
- **Not yet the `shares` path.** No annotation sharing exists in `0036`; if ever introduced, it requires an explicit future design decision.
- **Explicitly deferred, not built in 0036:** any title/discoverability/sharing field, Court/Docket association, a canonical/personal distinction on the annotation itself (always privately owned regardless of the parent's own canonical/personal status), tagging, search infrastructure, and any frontend surface.

---

## 6. Final Judgment Architecture and Lifecycle

Judgments are individually owned judicial work product — never Court-owned, and never affected by the Court-Anchored Docket's access model. This is a deliberate, permanent design boundary: `can_access_court()`, `has_retained_assignment()`, `my_court_id()`, and `is_admin()` are never used to authorize Judgment access. A Judgment's own access rules (`owner_id` / `is_discoverable`) are the sole gate, entirely independent of any Docket relationship.

```
judgments (
  id, owner_id uuid not null references profiles(id) on delete restrict,
    -- ownership AND authorship identity combined for 0027; forced to
    -- auth.uid() at creation by a guard trigger (cannot be forged), and
    -- immutable thereafter -- an owner cannot transfer a Judgment to
    -- another profile by UPDATE. Future collaboration uses explicit
    -- sharing (the future shares migration), never ownership transfer.
  title text not null,          -- human-readable Judgment/case title
  case_number text,             -- optional, no global uniqueness imposed
  court_name text,               -- optional free text; deliberately NOT
                                   -- an FK to courts -- a Judgment is
                                   -- independent authored work product
                                   -- and may concern a historical/
                                   -- external Court not represented in
                                   -- the active BenchBook Court
                                   -- reference structure
  judgment_date date,           -- optional
  citation text,                 -- optional, no uniqueness imposed
  content jsonb,                 -- structured rich-text/editor
                                   -- representation; editor
                                   -- implementation not designed here
  content_text text,             -- plain-text mirror for later search/
                                   -- indexing; NOT auto-derived from
                                   -- content in 0027 (no approved
                                   -- conversion mechanism exists yet) --
                                   -- synchronization is left to a future
                                   -- application/editor implementation
  is_discoverable boolean not null default false,
    -- owner-controlled. false = only the owner may access at all.
    -- true = other authenticated magistrates may SELECT/read only --
    -- never edit, never delete, never admin-managed, never implies
    -- public access, and never automatically attaches to a Docket
    -- Matter or becomes canonical authority. A discoverable Judgment
    -- remains individually owned throughout.
  created_at, updated_at,  -- updated_at maintained by the existing
                             -- public.set_updated_at() trigger
                             -- mechanism, same as every other table
  status text not null default 'draft'
    constraint judgments_status_check check (status in ('draft', 'final')),
    -- APPLIED via 0045_judgment_lifecycle_locking. Exactly two states,
    -- constrained TEXT (not an enum -- this codebase has already been
    -- burned by an enum-migration risk, the bookmark_entity_type
    -- ALTER TYPE split into 0041/0042). NO archived/superseded/
    -- corrigendum/version-number/amendment/publication state -- all
    -- remain explicit future work, not built here.
  finalized_at timestamptz,       -- most-recent finalization only, NOT
                                    -- a full history; NULL until first
                                    -- finalized; force-set by trigger
  finalized_by uuid references profiles(id) on delete set null
    -- most-recent finalizer only, NOT a full history; force-set by
    -- trigger to auth.uid() -- always equals owner_id today, since
    -- finalization is owner-only with no transfer mechanism; ON DELETE
    -- SET NULL is the specified design but is presently unreachable in
    -- practice, since owner_id's own ON DELETE RESTRICT on this same
    -- table already blocks deleting a profile that owns a finalized
    -- Judgment before this clause could ever fire -- flagged, not a
    -- defect, reserved for a future design (e.g. ownership transfer)
    -- that could let the two diverge
)
-- NO created_by/last_updated_by -- owner_id serves both roles for 0027,
--   unless a future Judgment-specific design requires separating them
-- NO version history, NO amendment/corrigendum workflow, NO archive
--   status -- deliberately still deferred past 0045; see below
```

- **Ownership never transfers.** Leaving a Court does not transfer a magistrate's Judgments to a successor. A successor magistrate who inherits ordinary Court-wide Docket access via `magistrate_courts`/`can_access_court()` does NOT automatically inherit the predecessor's privately owned Judgments — Judgment access and Docket access are two entirely independent systems. Normal magistrate offboarding preserves the historical `profiles` row rather than deleting it, consistent with the provenance-preservation principle already established for the Docket (§4) — `owner_id references profiles(id) on delete restrict` reinforces this by making a Judgment-owning profile impossible to hard-delete, the same pattern already used for `docket_matters.created_by`.
- **The Docket relationship (`docket_matter_judgments`, not built in 0027) is association only.** Linking a Judgment to a Docket Matter never itself grants access to the Judgment, in either direction: Docket access (`can_access_court()`, `has_retained_assignment()`, and the future parent-matter `shares` path) never confers Judgment access, and a Judgment's own access rules never confer Docket access. A successor magistrate who inherits a Court's Docket therefore does NOT gain access to a predecessor's private Judgment merely because a `docket_matter_judgments` association row still links it to a matter the successor can now see. A Judgment may exist with zero, one, or multiple Docket Matter associations; a single Docket Matter may accumulate more than one Judgment (e.g. interim and final rulings) — the relationship is genuinely many-to-many and entirely optional on both sides.
- **RLS.** SELECT: `owner_id = auth.uid() OR is_discoverable = true`. INSERT: `owner_id = auth.uid()`, with `owner_id` force-set to `auth.uid()` by a guard trigger so it cannot be forged regardless of client payload. UPDATE: owner-only (`owner_id = auth.uid()`) — **unchanged by 0045**, still the sole authorization gate for who may attempt an UPDATE. **No `is_admin()` bypass anywhere on this table**, matching the "unlock is owner-only, never admin" principle, now also carried through unchanged into the 0045 lifecycle trigger.
- **Ownership is immutable after creation.** A guard trigger rejects any UPDATE that attempts to change `owner_id`. If a genuine ownership-transfer need ever arises, it requires a deliberate future design — it is not available via ordinary UPDATE.
- **Lifecycle locking — APPLIED via `0045_judgment_lifecycle_locking.sql`.** DELETE is no longer unconditionally owner-only: the DELETE policy now reads `can_edit_judgment(id) AND status = 'draft'` — a final Judgment cannot be hard-deleted by anyone, owner included, until unlocked back to draft. Ordinary UPDATE authorization (`can_edit_judgment(id)` in both USING and WITH CHECK) is **unchanged** — the field-level content lock is enforced entirely by a new `protect_judgment_lifecycle()` `BEFORE INSERT OR UPDATE` trigger, deliberately layered underneath the existing owner-only policy rather than replacing it (a narrowed `status = 'draft'` UPDATE policy was considered and rejected — it cannot distinguish "toggling is_discoverable while final" or "unlocking" from a real content edit, since RLS predicates can't compare OLD/NEW field-by-field the way a trigger can). While `draft`, every field remains freely editable and the row remains hard-deletable, exactly as under 0027. While `final`: `title`, `case_number`, `court_name`, `judgment_date`, `citation`, `content`, and `content_text` are locked (any attempted change raises an exception); `is_discoverable` remains freely owner-toggleable in both directions regardless of lifecycle state — privacy and lifecycle are deliberately independent dimensions; the owner may unlock (`final → draft`) at any time, but a single UPDATE statement that combines unlock with any substantive field change is rejected outright (**atomic-bypass prevention** — unlock must be its own statement, edits only follow in a subsequent one). `finalized_at`/`finalized_by` are force-set by the trigger on every `draft → final` transition (client-supplied values are always overwritten), preserved — never nulled — across an unlock, and record only the **most recent** finalization, not a full history; a Judgment can never be INSERTed already-final (the trigger forces `status='draft'`, `finalized_at`/`finalized_by`=NULL on every INSERT regardless of client payload, closing an INSERT-time bypass the approved design's own threat model named). **Deliberately kept out of `can_view_judgment()`/`can_edit_judgment()`** (see §14) — those two 0044 helpers remain pure ownership/mutation-authority checks, reused unmodified by `judgment_tags`, `docket_matter_judgments`, `quick_code_judgments`, and `documents`, all of which continue working exactly as before on a final Judgment (tagging, Docket/Quick-Code linking, and Document attachment all remain fully available post-finalization — finalization locks the Judgment row's own substantive content, not the owner's ability to organize or attach material around it). No versioning, corrigendum table, amendment entity, or full audit history — correction is unlock → edit → re-finalize, nothing more; those remain explicit future work.
- **Deferred, not built in 0027, still deferred after 0045:** `judgment_tags` (resolved separately when `0028` was prepared — see below); Judgment attachments (the live `documents` table cannot represent them until the later polymorphic `documents` refactor — since resolved, see §14); explicit `shares`-based view/edit collaboration; full-text search vectors and global-search functions; and all versioning/corrigendum/full-audit-history behavior.

**`judgment_tags` — Judgment-specific tags (resolved when migration 0028 was prepared, superseding the earlier bare `judgments many—many tags` sketch in §1/§2/§15):**

**Why the existing global `tags` table is NOT reused**, for the same structural reason it was rejected for the Docket in 0026, applied here with even sharper force: `tags` is globally readable to every authenticated user with no access-scoping mechanism at all. A private, individually owned Judgment's tag text could itself disclose sensitive judicial work-product information even while the Judgment itself remains completely inaccessible to everyone but its owner. Judgment-specific tag rows therefore live directly behind the Judgment's own access boundary, in a dedicated child table — never through a shared, globally-readable vocabulary. `tags`, `case_tags`, `bench_note_tags`, `case_law_tags`, `statute_tags`, and `docket_matter_tags` are all left completely unmodified by `0028`.

```
judgment_tags (
  id, judgment_id → judgments (not null, ON DELETE CASCADE),
    -- deliberately CASCADE, not RESTRICT — the opposite of every
    -- Court-Anchored Docket child table. The owner may DELETE a
    -- Judgment while draft (0027, narrowed by 0045 to draft-only —
    -- final blocks hard DELETE, see §6/§14/§16); tag rows are purely
    -- organizational metadata, so a lawful draft-Judgment deletion
    -- removes them automatically rather than blocking deletion or
    -- leaving orphaned rows. Tag mutation itself is unaffected by
    -- lifecycle state — confirmed live, owner may still add/remove
    -- tags on a FINAL Judgment.
  tag_name text not null,   -- free-form, no enum/controlled vocabulary;
                              -- must not be blank after trimming
                              -- whitespace (CHECK); stored trimmed;
                              -- entered/display casing preserved
  created_by uuid not null default auth.uid() references profiles(id) on delete restrict,
    -- provenance ONLY, never access control; forced to auth.uid() at
    -- creation by a guard trigger (cannot be forged)
  created_at timestamptz not null default now()
    -- NO last_updated_by, NO updated_at — tag rows are never edited in
    -- place (see lifecycle below)
)
-- unique index on (judgment_id, lower(btrim(tag_name))) — case-
--   insensitive, whitespace-trimmed duplicate prevention SCOPED TO THE
--   INDIVIDUAL JUDGMENT ONLY; the same tag text on a different Judgment
--   is explicitly NOT a duplicate
```

- **Lifecycle is add/remove only**, the same deliberate exception to judicial-history-style immutability already established for `docket_matter_tags` in 0026: INSERT = add tag, DELETE = remove tag. Renaming is remove-old + add-new, not an in-place edit. No `tag_status`, no `entered_in_error`, no ended-at state, no UPDATE policy. Future audit infrastructure may separately record additions/removals if required; not designed here.
- **Access is fully inherited from the parent Judgment, never from Court/Docket.** SELECT is permitted whenever the requesting user could independently SELECT the parent Judgment under its own current access model (`owner_id = auth.uid()` OR `is_discoverable = true`) — a discoverable-reader may therefore read a Judgment's tags, exactly mirroring the read-only nature of discoverability itself. INSERT and DELETE require Judgment **ownership** specifically — a discoverable reader can read tags but can never add or remove them, preserving the "discoverability is read-only" rule established in 0027. `can_access_court()`, `has_retained_assignment()`, `docket_matter_judgments`, and Court/Docket access generally are never referenced — a Docket link to a Judgment (once `docket_matter_judgments` exists) grants access to neither the Judgment nor its tags. **No admin bypass, anywhere on this table.**
- **Not yet the `shares` path.** When explicit Judgment sharing is eventually implemented, share-based VIEW access to a Judgment should extend to SELECT of its tags; whether share-based EDIT access also includes tag mutation is an explicit future decision, not resolved or implemented in `0028`. For now, INSERT/DELETE remain owner-only regardless of any future share grant.

**`docket_matter_judgments` — the Docket↔Judgment association table (resolved when migration 0029 was prepared):**

**Governing principle, unchanged and now fully field-level resolved:** a `docket_matter_judgments` row is an association only. It never grants access in either direction — Docket access (current Court assignment or retained assignment) never grants Judgment access; Judgment access (ownership or discoverability) never grants Docket access; a successor magistrate who inherits a Court/Docket never automatically gains access to a predecessor's private Judgment merely because the association remains. This turn additionally closes a gap the earlier resolution left open: **the association itself must not become a side-channel for discovering an otherwise-inaccessible record.** It is not enough that the linked *content* stays protected by the parent tables' own RLS — the mere existence of a link, visible to only one side, would itself leak information (that a private Judgment exists and is linked to a matter someone can see, or that a Docket Matter someone cannot access is linked to a Judgment they can read). The resolution below closes that gap by requiring independent lawful access to **both** parents before the join row itself is even visible.

```
docket_matter_judgments (
  id, docket_matter_id → docket_matters (not null, on delete restrict),
    -- RESTRICT, matching the Court-Anchored Docket's judicial-history
    -- convention -- Docket Matters are not intended to be hard-deleted,
    -- and this association defensively prevents privileged/database-
    -- level deletion of a referenced Docket Matter while a link exists
  judgment_id → judgments (not null, on delete cascade),
    -- CASCADE, matching judgment_tags -- Judgment owner DELETE remains
    -- provisionally permitted under 0027; if a Judgment is lawfully
    -- deleted, its purely associative link rows disappear automatically
    -- rather than blocking deletion or leaving orphaned associations.
    -- This does not alter or resolve the future Judgment
    -- lifecycle-locking design.
  created_by uuid not null default auth.uid() references profiles(id) on delete restrict,
    -- provenance ONLY -- the creator of the association does not "own"
    -- the link, and created_by never determines ongoing SELECT/DELETE
    -- access. Forced to auth.uid() at creation by a guard trigger
    -- (cannot be forged).
  created_at timestamptz not null default now()
    -- NO last_updated_by, NO updated_at -- the association has no
    -- editable business fields, present or absent only
)
-- unique(docket_matter_id, judgment_id) -- prevents duplicate
--   associations between the same pair; the relationship remains
--   genuinely many-to-many (no uniqueness on either FK individually)
-- NO status, NO notes, NO court_id/district_id, NO owner_id, and NO
--   denormalized Judgment title/citation or Docket case
--   number/matter_title -- the association row contains nothing
--   beyond its two foreign keys and creation provenance, so that even
--   an unauthorized viewer who somehow saw a raw row learns nothing
--   descriptive from it
```

- **SELECT requires independent lawful access to BOTH linked records** — the conceptual predicate is `DocketAccess AND JudgmentAccess`, never `OR`. Docket access means `can_access_court(dm.court_id) OR has_retained_assignment(dm.id)`; Judgment access means `j.owner_id = auth.uid() OR j.is_discoverable = true`. A magistrate with Court access to the matter but no access to a privately-owned linked Judgment cannot see the association at all; a magistrate who can read a discoverable Judgment but has no Docket access to the linked matter likewise cannot see it. This is the mechanism that closes the side-channel gap described above.
- **INSERT (creating a link) requires Docket access AND Judgment *ownership* specifically** — `is_discoverable = true` is deliberately **not** sufficient to create a link. A magistrate may voluntarily associate their own Judgment with a Docket Matter they lawfully access; a magistrate may not attach another magistrate's Judgment merely because it happens to be discoverable/readable, and owning a Judgment does not permit attaching it to a Docket Matter the owner cannot independently access. `created_by = auth.uid()` is also required and force-set by a guard trigger, so it cannot be forged.
- **DELETE (unlinking) requires the identical substantive authority as creation** — lawful current Docket access AND Judgment ownership, not merely "whoever created the link." A discoverable-reader cannot unlink another magistrate's Judgment; a successor magistrate with inherited Docket access cannot unlink a predecessor's private Judgment merely because they now have Court access; a Judgment owner who has since lost lawful Docket access to the matter cannot unlink the association through ordinary client RLS either. Such a historical association may remain in place until someone satisfying both conditions can act, or until the Judgment itself is lawfully deleted (at which point the `judgment_id` `CASCADE` removes it automatically). This is a deliberate, explicit exception to the no-hard-delete rule used for substantive Docket judicial-history tables — the association itself is treated as organizational metadata, the same category `docket_matter_tags` and `judgment_tags` fall into, not as a judicial-history record in its own right.
- **No UPDATE policy.** The association has no editable business fields — it is either present or absent. Correcting a wrong association is DELETE-then-INSERT (subject to the same authority rules above), not an in-place edit.
- **No admin bypass, anywhere on this table.** The real Admin profile must satisfy the same underlying Docket-access-AND-Judgment-ownership predicates as anyone else to see or mutate an association.
- **Not yet the `shares` path.** The principle is established now for when both `shares` mechanisms eventually exist: association visibility should continue to require independent lawful access to both sides — conceptually `FutureDocketReadAccess AND FutureJudgmentReadAccess`, where each side may eventually be satisfied through its own lawful access mechanism, including a future share grant. A Docket share alone, with no Judgment access, must not make an association visible; a Judgment share alone, with no Docket access, must not make an association visible either. Whether a future *edit*-level share on either side should extend to link creation/removal is an **explicit, undecided future question** — it is not inferred or implemented now, and creation/removal remain Judgment-owner + lawful-Docket-access operations until a deliberate future design says otherwise.

---

## 7. Final Quick Code Architecture

**Resolved when `0031_quick_codes` was prepared, replacing the one-line Revision-2 stub with a full field-level design.** A Quick Code is a PRIVATE, individually owned, reusable text-expansion/snippet — personal productivity tooling (e.g. conceptually `bail1` → reusable bail-condition wording, `adj30` → reusable adjournment wording; illustrative only, never seeded). It is explicitly NOT a Judgment, Case Law, a Docket Matter/Event, a Court-wide institutional template, a discoverable/public legal resource, or a shared administrative record. It belongs to exactly one owner.

```
quick_codes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references profiles(id) on delete restrict,
    -- forced to auth.uid() at creation by a guard trigger (cannot be
    -- forged) and immutable thereafter -- an owner cannot transfer a
    -- Quick Code to another profile by UPDATE, mirroring the
    -- judgments.owner_id pattern from 0027
  code_word text not null,       -- short shorthand/token the owner uses
                                   -- to identify/invoke the snippet
                                   -- (e.g. "bail1"); must not be blank
                                   -- after trimming (CHECK); trimmed
                                   -- before storage; entered/display
                                   -- casing preserved; case-insensitive/
                                   -- whitespace-trimmed uniqueness
                                   -- enforced PER OWNER only (see below)
                                   -- -- no restrictive character grammar
                                   -- imposed in 0031
  title text,                    -- optional human-readable name for
                                   -- browsing (e.g. "Standard bail
                                   -- conditions"); not required, since
                                   -- some owners may identify snippets
                                   -- by code_word alone
  content text not null,          -- the reusable expanded text itself;
                                   -- plain text only in this foundational
                                   -- migration (no JSONB/rich-text/editor
                                   -- schema yet); must not be blank
                                   -- after trimming (CHECK); the
                                   -- substantive value is NOT
                                   -- auto-rewritten/reformatted -- only
                                   -- validated
  description text,               -- optional owner-facing explanation
                                   -- of purpose; distinct from content,
                                   -- never treated as the expansion text
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
    -- maintained by the existing public.set_updated_at() trigger, same
    -- mechanism used everywhere else. No separate last_updated_by --
    -- the only person who can ever edit the row is its owner.
)
-- unique index on (owner_id, lower(btrim(code_word))) -- case-
--   insensitive, whitespace-trimmed uniqueness SCOPED PER OWNER, never
--   global. "Bail1" and "bail1" cannot coexist for the same owner;
--   different owners may independently use the identical code_word.
```

- **Ownership is immutable after creation**, exactly like `judgments.owner_id` — a guard trigger rejects any UPDATE that attempts to change `owner_id`. `owner_id references profiles(id) on delete restrict` reinforces this by making a Quick-Code-owning profile impossible to hard-delete. Normal account departure/offboarding preserves the historical `profiles` row (deactivation, not physical deletion), consistent with the broader BenchBook identity architecture. **Quick Codes never transfer to a successor magistrate** merely because that successor takes over the former owner's Court — there is no Court/Docket relationship of any kind here to trigger such a transfer; this is a deliberately simpler, fully independent access model than `judgments`, with no Court-anchored concept at all.
- **RLS is owner-only on all four commands, with no exceptions.** SELECT/INSERT/UPDATE/DELETE all use `owner_id = auth.uid()`. No `can_access_court()`, no `has_retained_assignment()`, no `is_discoverable` concept, no `is_admin()` bypass anywhere on this table — the real Admin profile behaves exactly like any other non-owner when attempting to access someone else's Quick Codes. This is the simplest, most fully private access model built so far in this project.
- **Owners may UPDATE their own Quick Codes** — `code_word`, `title`, `content`, and `description` are all editable (only `owner_id` is immutable). This is a deliberate difference from every join/tag table built so far (0026, 0028, 0029, 0030), which have no UPDATE policy at all — a Quick Code is a genuine standalone personal record with editable substantive fields, not an association or a lifecycle-locked tag.
- **Owner hard DELETE is approved**, with no archive status, no `entered_in_error`, no `ended_at`, no lifecycle ledger. Quick Codes are personal productivity data, not judicial-history records — the same reasoning already used for tag tables' hard-delete exception, extended here to the entire record since there is no institutional/judicial-history interest in a Quick Code's lifecycle at all. A future trash/archive UX may be designed separately if ever needed; not designed here.
- **Uniqueness is per-owner, never global.** Implemented as a case-insensitive, whitespace-trimmed expression unique index on `(owner_id, lower(btrim(code_word)))`. Different owners may freely reuse the same `code_word` independently.
- **No search infrastructure in 0031.** No `search_vector`, no full-text index, no `global_search()` integration. Quick Code lookup in this migration is supported only by owner filtering and the per-owner unique index on `code_word`. Full-text/global search remains the responsibility of the later, dedicated `0047_search_extensions` migration (renumbered from `0044` by the `0039_fix_bench_notes_entity_guard` repair insertion, to `0045` by the `0041`/`0042` Bookmark enum-safety split, then to `0046` and finally `0047` by the `0046_fix_judgment_lifecycle_search_path` repair insertion — see §16; confirmed unchanged in substance as of `0031`).
- **Deferred, not built in 0031:** `quick_code_docket_matters`, `quick_code_judgments`, `quick_code_case_law` (the future join tables named in §1/§2/§15/§16) — a Quick Code must be able to exist independently of all of them, with zero rows in any of them. **Future-association principle, recorded now:** exactly like every association table built this session, linking a Quick Code to a Docket Matter, Judgment, or Case Law record must never itself grant access to the Quick Code — the Quick Code's own strict owner-only RLS remains the sole gate regardless of what it is later linked to. Also deferred: explicit Quick Code sharing (no `shares` path exists in 0031; if ever introduced, it requires an explicit future design decision, exactly as recorded for `judgments`/`docket_matter_judgments`), and any character-grammar restriction on `code_word` beyond non-blank-after-trim (whether punctuation like `bail-1`/`bail.std`/`adj_30` should be permitted is an explicit open question, not resolved here).

**`quick_code_docket_matters` — the Quick Code↔Docket Matter association table (resolved when migration 0032 was prepared):**

**Governing principle, following the same association-only/BOTH-sides pattern established in 0029/0030, adapted to Quick Codes' fully-private access model:** a `quick_code_docket_matters` row associates one privately owned Quick Code with one Docket Matter for organizational/contextual convenience only. The association is optional and genuinely many-to-many (one Quick Code may link to many Docket Matters; one Docket Matter may link to many Quick Codes). It never grants access in either direction — Docket access never grants Quick Code access, and Quick Code ownership never grants Docket access. The Quick Code remains privately owned throughout; linking it to a Docket Matter never transforms it into Court-owned or shared content. A successor magistrate who inherits a Court/Docket does not automatically inherit a predecessor's linked Quick Codes, and a retained magistrate's Docket access does not make another person's Quick Codes visible.

**Because Quick Codes have no discoverability tier at all** (unlike Judgments' `owner_id OR is_discoverable`), "Quick Code access" collapses to exactly one predicate everywhere it appears in this table: `owner_id = auth.uid()`. This makes `quick_code_docket_matters`' SELECT predicate identical in strength to its INSERT/DELETE predicate — there is no weaker "can read but not mutate" tier the way `docket_matter_judgments` had via Judgment discoverability.

```
quick_code_docket_matters (
  id, quick_code_id → quick_codes (not null, on delete cascade),
    -- CASCADE -- Quick Codes are personal productivity data and owner
    -- hard DELETE is already approved (0031); deleting a Quick Code
    -- removes its purely associative Docket links automatically rather
    -- than blocking deletion or leaving orphaned rows. This holds even
    -- if the owner has since lost Docket access to some linked matters
    -- -- CASCADE is database referential cleanup triggered by the
    -- owner's own authorized deletion of their own record, not an RLS
    -- unlink operation, so it is unaffected by the owner's current
    -- Docket-access state.
  docket_matter_id → docket_matters (not null, on delete restrict),
    -- RESTRICT, matching the Court-Anchored Docket judicial-history
    -- convention and docket_matter_judgments/docket_matter_case_law --
    -- Docket Matters are not intended to be hard-deleted.
  created_by uuid not null default auth.uid() references profiles(id) on delete restrict,
    -- provenance ONLY -- never determines ongoing SELECT/DELETE access
  created_at timestamptz not null default now()
    -- NO last_updated_by, NO updated_at -- present or absent only
)
-- unique(quick_code_id, docket_matter_id) -- prevents duplicate
--   associations while preserving genuine many-to-many cardinality
-- NO status, NO notes, NO code_word/title/content copy, NO Docket case
--   number/matter_title/court/district copy -- the association row
--   contains nothing beyond its two foreign keys and creation
--   provenance
```

- **SELECT requires independent lawful access to BOTH linked records** — `DocketAccess AND QuickCodeAccess`, never OR. Docket access means `can_access_court(dm.court_id) OR has_retained_assignment(dm.id)`; Quick Code access means `qc.owner_id = auth.uid()` (the only access path that exists for Quick Codes). A magistrate with Docket access to the matter but who does not own the linked Quick Code cannot see the association; owning the Quick Code without lawful Docket access to the matter likewise cannot see it.
- **INSERT (creating a link) requires Docket access AND Quick Code ownership** — a magistrate cannot attach someone else's Quick Code even knowing its UUID, and owning a Quick Code does not permit linking it to a Docket Matter the owner cannot independently access. Retained-only Docket access is sufficient on the Docket side, identical to every other association table this session. `created_by = auth.uid()` is also required and force-set by a guard trigger.
- **DELETE (unlinking) requires the identical substantive authority as creation** — lawful current Docket access AND Quick Code ownership, not merely whoever created the link. If the owner later loses all Docket access to a linked matter, they cannot unlink through ordinary client RLS until lawful Docket access exists again (or until the Quick Code itself is deleted, at which point `ON DELETE CASCADE` removes the association automatically regardless of the owner's current Docket-access state — see the field-level note above).
- **No UPDATE policy.** The association has no editable business fields.
- **No admin bypass, anywhere on this table.** The real Admin profile must independently satisfy Quick Code ownership AND lawful Docket access like anyone else — Quick Code ownership is never available to Admin by virtue of being Admin.
- **Not yet the `shares` path.** No Quick Code sharing exists today. The principle is recorded now: association visibility should continue to require independent lawful access to both sides even after a future Quick Code share mechanism exists. A future share must not be assumed to also permit link mutation — that is left an explicit, undecided future question, exactly as recorded for `docket_matter_judgments`.
- **Explicitly deferred, not built in 0032:** Quick Code sharing itself, `quick_code_judgments`, `quick_code_case_law`, full-text/global search over linked context, and any frontend surface.

**`quick_code_judgments` — the Quick Code↔Judgment association table (resolved when migration 0033 was prepared):**

**Governing principle, following the same association-only/BOTH-sides pattern established in 0029/0030/0032:** a `quick_code_judgments` row associates one privately owned Quick Code with a Judgment for the Quick Code owner's own personal workflow/context. The association never transforms the Quick Code into Judgment-owned, shared, or discoverable content, and never grants the Quick Code owner any access to the Judgment beyond whatever they already lawfully have. Quick Code ownership does not grant Judgment access; Judgment ownership/discoverability does not grant Quick Code access; a discoverable-Judgment reader never thereby sees another magistrate's private Quick Codes. The relationship is genuinely many-to-many (one Quick Code may associate with multiple Judgments; one Judgment may have multiple magistrates' Quick Codes associated with it, invisible to each other unless they also happen to own each other's Quick Codes, which they never do).

**Deliberate, explicit difference from `quick_code_docket_matters` and `docket_matter_judgments`: INSERT/DELETE require Judgment *read* access only, not ownership.** A Quick Code is the linking user's own private metadata; associating it with a Judgment they can lawfully read (including another magistrate's discoverable Judgment) grants nobody else anything, since the association row itself remains invisible to everyone except the Quick Code's owner. This is why ownership is not required on the Judgment side here, unlike the Docket-side association tables where the Docket Matter itself has no ownership concept to lean on.

```
quick_code_judgments (
  id, quick_code_id → quick_codes (not null, on delete cascade),
    -- CASCADE -- Quick Code owner hard DELETE is already approved
    -- (0031); deleting a Quick Code removes its purely associative
    -- Judgment links automatically, independent of current Judgment
    -- read access, exactly mirroring quick_code_docket_matters (0032).
  judgment_id → judgments (not null, on delete cascade),
    -- CASCADE -- Judgment owner DELETE is permitted while draft (0027,
    -- narrowed by 0045 to draft-only -- see §6/§14/§16); these personal
    -- organizational link rows must not block a lawful draft-Judgment
    -- deletion. A draft Judgment may still be deleted by its owner even
    -- when another magistrate has privately associated one of their own
    -- Quick Codes with that (formerly discoverable) Judgment -- CASCADE
    -- removes those association rows automatically. This is acceptable:
    -- the association never created a property/ownership interest in
    -- the Judgment, the Judgment owner's lifecycle remains fully
    -- authoritative, and only the link disappears -- the Quick Code
    -- itself is untouched. Link creation/removal itself is unaffected
    -- by lifecycle state — confirmed live, this association continues
    -- to work exactly as before on a FINAL Judgment (0045 deliberately
    -- does not freeze it).
  created_by uuid not null default auth.uid() references profiles(id) on delete restrict,
    -- provenance ONLY -- never determines ongoing SELECT/DELETE access
  created_at timestamptz not null default now()
    -- NO last_updated_by, NO updated_at -- present or absent only
)
-- unique(quick_code_id, judgment_id) -- prevents duplicate associations
--   while preserving genuine many-to-many cardinality. quick_code_id is
--   the leading column, matching the 0032 convention (explicitly
--   approved to remain Quick-Code-centric rather than matching the
--   Docket-association tables' docket_matter_id-leading convention); a
--   dedicated judgment_id index covers the trailing direction.
-- NO status, NO notes, NO code_word/content copy, NO Judgment title/
--   citation copy -- the association row contains nothing beyond its
--   two foreign keys and creation provenance
```

- **SELECT requires `QuickCodeOwnership AND JudgmentReadAccess`, never OR.** Quick Code side: `qc.owner_id = auth.uid()` (the only Quick Code access path). Judgment side: `j.owner_id = auth.uid() OR j.is_discoverable = true` (the existing 0027 Judgment SELECT predicate, unmodified). Concretely: own Quick Code + own private Judgment → visible; own Quick Code + another user's discoverable Judgment → visible; own Quick Code + another user's private Judgment → invisible; another user's Quick Code + any Judgment the viewer can read → invisible regardless of Judgment access, since the viewer never owns that Quick Code.
- **INSERT (creating a link) requires Quick Code ownership AND lawful Judgment read access** — not Judgment ownership. A magistrate may link their own Quick Code to any Judgment they can currently read, including someone else's discoverable Judgment. `created_by = auth.uid()` is also required and force-set by a guard trigger.
- **DELETE (unlinking) requires the identical substantive authority as creation** — Quick Code ownership AND current lawful Judgment read access, not merely whoever created the link. `created_by` is never DELETE authority.
- **Visibility follows Judgment discoverability dynamically, exactly mirroring the 0029 discoverability-transition behavior**, without ever touching the association row itself: if the Judgment owner later sets `is_discoverable = false`, the Quick Code owner immediately loses read access to the Judgment and therefore immediately loses visibility of (and the ability to ordinarily unlink) the association — the row persists in the database, simply invisible under RLS, until Judgment access is regained or the Judgment/Quick Code is deleted (CASCADE). If the owner later sets `is_discoverable = true` again, visibility and unlink ability return immediately, with no mutation to the association row required either way.
- **No UPDATE policy.** The association has no editable business fields.
- **No admin bypass, anywhere on this table.** The real Admin profile must independently satisfy Quick Code ownership AND lawful Judgment read access like anyone else.
- **Not yet the `shares` path.** No Quick Code sharing exists today, and Judgment sharing is likewise not yet built. The principle is recorded now: association visibility should continue to require independent lawful access to both sides — conceptually `QuickCodeReadAccess AND FutureJudgmentReadAccess` (Quick Codes currently have only owner-read access; if Quick Code sharing is ever added, that side may broaden only through a deliberate future design). A future Judgment edit/view share must not be assumed to also permit link creation/deletion beyond whatever explicit policy is later approved — for `0033`, Quick Code ownership + Judgment read access remains the complete mutation rule.
- **Explicitly deferred, not built in 0033:** Quick Code sharing, Judgment sharing, `quick_code_case_law`, full-text/global search over linked context, and any frontend surface.

**`quick_code_case_law` — the Quick Code↔Case-Law association table (prepared for review as migration 0034):**

**Governing principle: this table reuses, unmodified, the exact nested-RLS design explicitly approved for `docket_matter_case_law` (0030).** The Case-Law-side access check is a live `EXISTS` against `case_law` itself rather than a duplicated/inlined predicate, so it automatically and correctly tracks `case_law`'s own current AND future RLS policy with zero change required to this table once `0035_case_law_personal_research` lands. No `can_view_case_law()` helper is created. As of 0034, `case_law` remains the current live/legacy model (globally readable to authenticated users, admin-curated only, no `owner_id`/`is_discoverable`) — the Case-Law side of the predicate below is therefore trivially satisfied whenever the referenced `case_law_id` exists at all, exactly as documented for 0030.

**Mandatory future regression obligation:** when `0035_case_law_personal_research` is implemented, it must regression-test `quick_code_case_law`'s SELECT/INSERT/DELETE behavior alongside `docket_matter_case_law`'s, since both tables share the identical nested-EXISTS pattern and both will begin respecting row-level Case Law privacy automatically — see §17.

**Deliberate, explicit difference from `quick_code_docket_matters`/`docket_matter_judgments`, mirroring `docket_matter_case_law` (0030) and `quick_code_judgments` (0033): INSERT/DELETE require Case Law *read* access only, not ownership/authorship.** Case Law is administratively curated, reusable reference authority; requiring authorship to link it would make ordinary legal research impossible, and the Quick Code — not the Case Law record — is the linking user's private metadata.

```
quick_code_case_law (
  id, quick_code_id → quick_codes (not null, on delete cascade),
    -- CASCADE -- Quick Code owner hard DELETE is already approved
    -- (0031); deleting a Quick Code removes its purely associative
    -- Case Law links automatically, independent of current Case Law
    -- read access.
  case_law_id → case_law (not null, on delete restrict),
    -- RESTRICT -- matches docket_matter_case_law's (0030) Case Law
    -- lifecycle design exactly, and is deliberately NOT the CASCADE
    -- used for quick_code_id on this same table. Case Law DELETE is
    -- admin-only and expected to be rare/deliberate; an admin must
    -- explicitly unlink a still-cited Case Law record first.
  created_by uuid not null default auth.uid() references profiles(id) on delete restrict,
    -- provenance ONLY -- never determines ongoing SELECT/DELETE access
  created_at timestamptz not null default now()
    -- NO last_updated_by, NO updated_at -- present or absent only
)
-- unique(quick_code_id, case_law_id) -- prevents duplicate associations
--   while preserving genuine many-to-many cardinality. quick_code_id is
--   the leading column, matching the 0032/0033 Quick-Code-centric
--   convention; a dedicated case_law_id index covers the trailing
--   direction.
-- NO status, NO notes, NO code_word/content copy, NO Case Law
--   case_name/citation copy -- the association row contains nothing
--   beyond its two foreign keys and creation provenance
```

- **SELECT requires `QuickCodeOwnership AND CaseLawReadAccess`, never OR.** Quick Code side: `qc.owner_id = auth.uid()`. Case Law side: a live existence check against `case_law` (today trivially true for any authenticated user, since `case_law` SELECT is `using (true)`). Another user's Quick Code linked to the same Case Law record remains invisible regardless of Case Law access, since the viewer never owns that Quick Code.
- **INSERT (creating a link) requires Quick Code ownership AND lawful Case Law read access** — not Case Law authorship/ownership. `created_by = auth.uid()` is also required and force-set by a guard trigger.
- **DELETE (unlinking) requires the identical substantive authority as creation** — Quick Code ownership AND current lawful Case Law read access, not merely whoever created the link.
- **No UPDATE policy.** The association has no editable business fields.
- **No admin bypass, anywhere on this table.** The real Admin profile must independently satisfy Quick Code ownership AND lawful Case Law read access like anyone else — Admin's separate write bypass on the parent `case_law` table does not substitute for Quick Code ownership here.
- **Side-channel note:** a Case-Law-only reader with no Quick Code involved can never see this table's rows, since the Quick-Code-ownership `EXISTS` clause independently gates every row regardless of `case_law`'s global readability. A "future private/unreadable Case Law" scenario is not constructible today and is recorded as mandatory `0035` regression coverage rather than force-tested.
- **Not yet the `shares` path.** Neither Quick Code sharing nor any future Case-Law-side personal-authorship sharing exists today. The principle is recorded now: association visibility should continue to require independent lawful access to both sides — conceptually `QuickCodeReadAccess AND FutureCaseLawReadAccess`.
- **Explicitly deferred, not built in 0034:** the `case_law` personal/canonical refactor itself (`0035`), any Case-Law-side ownership/discoverability concept, `case_law_annotations`, full-text/global search over associated authorities, and any frontend surface.

---

## 8. Final Bench Notes Architecture

*(unchanged from Revision 2 — polymorphic parent, `author_id = auth.uid()` only, no admin clause, no cascading from parent access — explicitly reaffirmed as correct and untouched by the Docket pivot in §12/§14 below)*

---

## 9. Final Documents/Storage Architecture

*(unchanged in mechanism — access dispatches to the parent entity's access rule, which for `docket_matter`-typed documents now means the three-path Docket predicate in §14 instead of ownership)*

**Frontend consolidation (this phase):** a single `DocumentsPanel` component (`src/components/common/documents-panel.tsx`) plus `src/hooks/use-documents.ts` now back every polymorphic Document parent (`docket_matter`/`judgment`/`case_law`/`quick_code`/`bench_note`) — the earlier Docket-only implementation was generalized rather than duplicated per feature area. Deletion is Storage-API-first, then the `documents` metadata row, matching the 0049 resolution; a Storage-only-succeeded-but-metadata-delete-failed outcome is surfaced as an explicit partial-failure message rather than a generic error. Upload object paths are `uploaded_by/entity_type/entity_id/timestamp-sanitized_filename` — collision-safe and never derived solely from the user-supplied filename. The Upload control is now conditionally hidden (`canUpload` prop) where the live `documents` INSERT policy would deny it in an obviously-predictable context (canonical Case Law — Admin-only per `can_edit_case_law`); the Delete control is only shown for the row's own `uploaded_by`, matching the live DELETE policy (`uploaded_by = auth.uid() OR is_admin()`, and this frontend exposes no admin bypass).

**Verified, not a defect:** the live `documents` SELECT policy's `quick_code`/`bench_note`/`case` branches check parent existence via a plain (non-`SECURITY DEFINER`) correlated `EXISTS` subquery against `quick_codes`/`bench_notes`/`cases`, with no explicit `owner_id`/`author_id` predicate written inline — this looks superficially under-scoped next to the matching INSERT policy's explicit ownership checks. It is not a gap: because the subquery is *not* wrapped in a `SECURITY DEFINER` function, it runs under the querying role's own privileges, so the target table's own RLS (owner/author-only) applies to it exactly as if queried directly. Confirmed empirically via a rollback-only pretest (a stranger profile querying `documents` for another profile's private Quick Code's attached document returns zero rows). This is the inverse situation from the 0050 defect class (which involved `SECURITY DEFINER` helpers that *do* bypass nested-table RLS) — worth recording so a future pass doesn't "fix" a policy that is already correct.

---

## 10. Final Tags/Annotations Architecture

*(unchanged from Revision 2)*

---

## 11. Final Global-Search Architecture

Unchanged in mechanism (`security invoker` functions inherit whatever RLS allows), with one consequence worth restating: `search_docket_matters()` and "My Docket" now resolve through the three-path Docket predicate (§14) instead of `owner_id = auth.uid()` — no search-function logic needs to change beyond the underlying table's access rule, since the function never encoded ownership logic of its own to begin with.

**`0047_search_extensions.sql` — APPLIED and verified live (renumbered from `0046`/`0044` — see §16). Full 20-item rollback-only pretest (fixture-driven: court/retained/view-share/edit-share Docket access paths, share grant/revoke with `search_vector`-byte-identity proof, Judgment discoverability round-trip, Case Law/Quick Code/Bench Note/legacy Case/Statute regressions, Admin no-bypass confirmation across Judgment/Case-Law/Quick-Code, edge-case query safety, structural SECURITY INVOKER/GIN-index/no-excluded-entity checks) passed clean with zero defects. Applied exactly as reviewed; live post-apply advisor check found zero new findings beyond the three expected `unused_index` INFO findings on the new `search_vector` GIN indexes (matching the `judgments_finalized_by_idx` precedent from 0045).** Extends the original `0010_search` pattern (unmodified: `GENERATED ALWAYS ... STORED` `tsvector`, covering GIN index, per-table `SECURITY INVOKER` `search_X(p_query, p_limit default 20)`, `websearch_to_tsquery('english', ...)`, `ts_rank`/`ts_headline`) to the three tables built since 0010 that still had none: `docket_matters`, `judgments`, `quick_codes`. `global_search()` gains three additive `UNION ALL` branches, returning the unmodified `search_result` composite (`entity_type text, id uuid, title text, subtitle text, headline text, rank real`) — `entity_type` is plain `text`, not an enum, so none of the `bookmark_entity_type` `ALTER TYPE` risk applies here.

Fields: `docket_matters` (`case_number`, `matter_title`, `charge_or_issue`, `orders_summary`, `outcome` — District/Court name metadata deliberately excluded, not an approved searchable Docket field); `judgments` (`title`, `case_number`, `court_name`, `citation`, `content_text` — raw `content` jsonb deliberately excluded, `content_text` is the approved plain-text projection; lifecycle `status` does NOT gate search visibility, only ownership/`is_discoverable` do, unchanged by 0045); `quick_codes` (`code_word`, `title`, `content`, `description` — never `owner_id`).

Security: every new function is `SECURITY INVOKER`, relying entirely on the underlying table's own SELECT RLS — `search_docket_matters()`/`search_judgments()` follow the more recent `search_case_law()` precedent (rely on RLS alone, no redundant explicit predicate) rather than the original `search_cases()`/`search_bench_notes()` pattern (which duplicate an explicit access-check function in the WHERE clause); `search_quick_codes()` relies on `quick_codes`' trivial owner-only RLS. No `SECURITY DEFINER` introduced anywhere. None of the three new `search_vector` expressions reference any access-control field — privacy transitions (a revoked Docket share, a Judgment toggled private/discoverable) take effect immediately on the next call with zero vector rewrite, confirmed live via a rollback-only dynamic-transition pretest (share-granted/revoked and discoverable-toggle-both-directions scenarios).

Explicitly excluded from search-entity status: `docket_events`, `docket_matter_parties`, `docket_matter_tags`, `judgment_tags`, `case_law_annotations` (organizational/child rows of an already-searchable parent, not independent identities); `documents` (file/attachment content search deferred as a distinct storage/privacy question); `shares`, `bookmarks` (association/metadata rows, never independently searchable — no association table in this codebase has ever been given its own search identity).

---

## 12. Final Audit Model

**RESOLVED and APPLIED as `0048_audit_extensions.sql`** — see §16/§17. The content-redaction mechanism this section carried as explicitly deferred is now built: `audit_trigger_fn()` (0009, unchanged as a migration file, `CREATE OR REPLACE`'d by 0048 per the forward-modification pattern already used by 0046) redacts a small, explicit, per-table field list — private substantive judicial work product (Judgment/Bench Note `content`/`content_text`, Quick Code `content`/`description`, Case Law Annotation `annotation_text`, personal Case Law `summary`/`full_text`) is never duplicated in full into the admin-readable `audit_log`; institutional/access-control tables (Docket Matter, Docket Event, Docket Matter Party minus `contact_info`, Docket Matter Assignment, Court assignment, Share) are captured in full, since none of their columns are private work product. A GENERATED `search_vector` column is stripped alongside its source text everywhere redaction applies — caught live during 0048's own pretest as a real defect (an early draft redacted the source columns but not the tsvector derived from them, which still leaked the text via its lexemes) and fixed before application. `audit_log` immutability was hardened (table-level INSERT/UPDATE/DELETE/TRUNCATE grants revoked from `anon`/`authenticated`, mirroring 0043's EXECUTE-revocation precedent; RLS already permitted none of it). Reader model unchanged — admin-only SELECT via `is_admin()`; admin visibility is now, by construction, already limited to redacted/safe payloads. Deliberately NOT expanded into 0048, flagged as follow-up candidates: `profiles` role-change auditing (real security value, e.g. who was promoted to admin — not in this migration's authorized scope), and the legacy `comments`/`case_parties` tables (discovered live outside the original five audited tables, carry the same free-text-privacy/PII shape as bench_notes/docket_matter_parties respectively).

---

## 13. Final Outlook Future-Integration Boundary

Unchanged and reinforced: because a Docket Matter is identified by `court_id`/`district_id`/`case_number` rather than by whoever created it, a successor magistrate can match incoming calendar events to the correct existing matter without needing the predecessor's Outlook calendar at all.

---

## 14. Final RLS/Access-Control Model (Docket predicate fully rewritten)

```
can_access_court(court_id) :=
    exists(select 1 from magistrate_courts mc
           where mc.court_id = court_id
             and mc.profile_id = (select auth.uid())
             and mc.ended_at is null)
    -- deliberately does NOT check courts.is_active — that flag governs
    -- availability for NEW assignments/NEW docket entry only, never a
    -- historical-access kill switch (§9 of Addendum 3 / decision 9 above)

has_retained_assignment(docket_matter_id) :=
    exists(select 1 from docket_matter_assignments dma
           where dma.docket_matter_id = docket_matter_id
             and dma.profile_id = (select auth.uid())
             and dma.ended_at is null)

Docket SELECT := using (can_access_court(court_id)
                         or has_retained_assignment(id)
                         or exists(shares WHERE item_type='docket_matter'
                                   AND item_id=id AND recipient_id=(select auth.uid())
                                   AND revoked_at is null))

Docket INSERT := with check (can_access_court(court_id)
                              and created_by = (select auth.uid()))

Docket UPDATE := using (can_access_court(court_id)
                         or has_retained_assignment(id)
                         or exists(shares WHERE item_type='docket_matter' AND item_id=id
                                   AND recipient_id=(select auth.uid()) AND revoked_at is null
                                   AND permission='edit'))
                 with check (same)
                 -- last_updated_by is trigger-set, never part of the
                 -- client's WITH CHECK payload; district_id likewise
                 -- always trigger-derived from court_id, never trusted
                 -- from the client

Docket DELETE := NO POLICY — no one, including admins, can hard-delete
                  a Docket Matter; status = 'archived' is the only
                  removal mechanism

**Status: the `shares` clauses above, and everything in this section, are PREPARED in `0037_shares.sql` for review — NOT yet applied.** This is REVISION 2 of the 0037 design. Revision 1 (a Docket share grants access to the `docket_matters` row only, with `shares`' own SELECT policy as granter-or-recipient only) was superseded after a confirmed defect and a scope gap, both resolved by direct behavioral testing against live PostgreSQL/Supabase (not merely reasoned about) — see the two corrections below before relying on anything in this section.

**Correction 1 — share-row visibility/revocation.** Empirically tested (a disposable, rolled-back probe against a throwaway table): a row that fails a table's SELECT policy cannot be targeted by that table's UPDATE policy, even when the UPDATE policy's own USING clause independently evaluates true for that row — PostgreSQL requires SELECT-policy passage as a precondition for UPDATE targeting. Under Revision 1, a current Court-assigned or retained magistrate who was neither the share's granter nor its recipient could never actually revoke it — the UPDATE would silently affect zero rows. `shares`' SELECT policy is now widened to also include any current lawful Docket-access holder for that matter, via a new SECURITY DEFINER helper (`has_docket_matter_authority()`) chosen specifically to avoid re-triggering `docket_matters`' own RLS (which itself now depends on `shares`) — see the helper-function block below. This was re-verified end-to-end in a full rolled-back transactional battery: an unrelated Court-access holder who was not the granter successfully revoked a share (1 row affected); an outsider with no relationship to the matter affected 0 rows and saw 0 share rows.

**Correction 2 — child/association inheritance.** Revision 1 granted access to the `docket_matters` row only. This is now corrected: a Docket share extends, according to permission level, to the institutional Docket children (`docket_events`, `docket_matter_parties`, `docket_matter_tags`) using each child's own existing lifecycle rules (no DELETE added where none existed; no UPDATE added where none existed), and to the Docket side of three association tables' SELECT predicates (`docket_matter_judgments`, `docket_matter_case_law`, `quick_code_docket_matters`) — never their INSERT/DELETE authority, except for `quick_code_docket_matters`, where an EDIT share may satisfy the Docket side of INSERT/DELETE specifically, and only where Quick-Code ownership is independently met. **The parenthetical "share recipient therefore gains access to the Docket Matter's own row only... not its appearances, parties, tags, or Judgment/Case-Law associations" that appeared in Revision 1 of this section is superseded — it is no longer the intended or implemented model.**

```
shares row shape (item_type constrained to 'docket_matter' only in 0037 —
see scope-boundary note below):
  id, item_type ('docket_matter' only, CHECK), item_id (genuine FK to
  docket_matters, NOT polymorphic while item_type is single-valued),
  recipient_id (→ profiles, ON DELETE SET NULL, effectively NOT NULL and
  non-self via RLS WITH CHECK + a table-level CHECK constraint
  shares_no_self_share for defense in depth), granted_by (→ profiles,
  ON DELETE SET NULL, provenance only — losing granted_by via profile
  deletion does NOT auto-revoke; only losing recipient_id does), permission
  ('view'|'edit', CHECK, immutable after creation — edit implies view,
  view never implies edit), created_at, revoked_at (NULL = active,
  set-once, mirrors docket_matter_assignments.ended_at).

Helper functions:
  has_docket_matter_authority(docket_matter_id) — SECURITY DEFINER,
    boolean-only, queries docket_matters directly (bypassing its own
    RLS). Used ONLY inside shares' own SELECT/INSERT/UPDATE policies, to
    check "current can_access_court()/has_retained_assignment() holder"
    WITHOUT re-triggering docket_matters' policy — this is what breaks
    what would otherwise be a structurally circular RLS dependency
    (docket_matters → has_docket_share() → shares → [would loop back to
    docket_matters without this]). Never used to grant Docket Matter
    access itself.
  has_docket_share(docket_matter_id, required_permission default 'view')
    — SECURITY INVOKER, queries shares as the calling user. Used by
    docket_matters and its institutional children/associations to check
    for an active share at >= the required level. edit implies view.

shares SELECT := using (
  granted_by = auth.uid() or recipient_id = auth.uid()
  or (item_type='docket_matter' and has_docket_matter_authority(item_id))
)
  -- widened per Correction 1 above.

shares INSERT := with check (
  item_type = 'docket_matter'
  and has_docket_matter_authority(item_id)
  and granted_by = auth.uid()
  and recipient_id is not null and recipient_id is distinct from auth.uid()
)
  -- creation authority = any CURRENT lawful Docket-access holder — NOT
  -- owner_id (docket_matters has none), a genuine, confirmed difference
  -- from the future judgment/case_law shares design. No resharing:
  -- holding a share does not itself satisfy has_docket_matter_authority.

shares UPDATE (revocation only) := using (
  (item_type='docket_matter' and has_docket_matter_authority(item_id))
  or recipient_id = auth.uid()
) with check (same)
  -- revocation authority = identical to creation authority (never merely
  -- "whoever granted it") OR the recipient unconditionally relinquishing
  -- their own share. A guard trigger restricts what an UPDATE may
  -- actually change to revoked_at only (null → now(), never cleared).

shares DELETE := NO POLICY — revocation is soft (revoked_at). No admin
                  bypass anywhere on this table.

Docket child extensions (view → SELECT only; edit → existing mutation
rights, unchanged lifecycle):
  docket_events         : existing SELECT/INSERT/UPDATE, no DELETE.
  docket_matter_parties  : existing SELECT/INSERT/UPDATE, no DELETE.
  docket_matter_tags     : existing SELECT/INSERT/DELETE, no UPDATE.
  Each table's own provenance guard trigger (created_by/last_updated_by/
  presiding_magistrate_id forcing) is untouched — applies identically
  regardless of access path.

Association-table SELECT widening (Docket side only; BOTH-sides
preserved; INSERT/DELETE untouched except quick_code_docket_matters):
  docket_matter_judgments : Docket-side OR'd with has_docket_share(view);
    Judgment-side (owner OR is_discoverable) untouched — a Docket share
    can never expose a private Judgment. INSERT/DELETE still require
    Docket access (Court/retained only, not share) AND Judgment
    ownership, exactly as approved in 0029.
  docket_matter_case_law  : identical treatment; INSERT/DELETE untouched
    from 0030.
  quick_code_docket_matters : SELECT's Docket side widened by view-or-edit
    share; INSERT/DELETE's Docket side widened by an EDIT share
    specifically, but the Quick-Code-side ownership condition is
    completely untouched — a Docket share can never expose, link, or
    unlink another user's Quick Code.
```

**Deliberate scope boundary (0037), preserved from Revision 1:** `item_type` is constrained to `'docket_matter'` only. Widening to `'judgment'`/`'case_law'` requires (a) resolving polymorphic `item_id` existence validation, which this codebase has no precedent for yet, and (b) a corresponding extension to `judgments`/`case_law`'s own SELECT/UPDATE RLS — neither is implemented in `0037`, avoiding a "fake completeness" placeholder. `judgment_tags` and `case_law_annotations` are untouched for the same reason (Judgment sharing is not live; annotations remain separately private owner work product regardless of any future Case-Law sharing). `quick_codes`' own RLS is untouched — Quick Codes remain owner-only in every respect. No `can_view_docket_matter()`/`can_edit_docket_matter()` broader helper architecture is introduced — reserved for the dedicated, later `0042_ownership_rls_helpers.sql`.

Judgment SELECT := using (can_view_judgment(id))
                    -- can_view_judgment() (0044) centralizes:
                    -- owner_id = auth.uid() or is_discoverable = true

Judgment INSERT := with check (owner_id = (select auth.uid()))
                    -- owner_id is also force-set to auth.uid() by
                    -- judgments_guard(); status/finalized_at/
                    -- finalized_by are separately force-set to
                    -- 'draft'/NULL/NULL by protect_judgment_lifecycle()
                    -- (0045) regardless of client payload — a Judgment
                    -- can never be created already-final

Judgment UPDATE := using (can_edit_judgment(id))
                    with check (can_edit_judgment(id))
                    -- can_edit_judgment() (0044) centralizes:
                    -- owner_id = auth.uid(), unchanged by 0045 — WHO
                    -- may attempt an UPDATE is still owner-only, no
                    -- is_admin() bypass; owner_id itself is separately
                    -- immutable (judgments_guard() rejects any UPDATE
                    -- that changes it). WHICH fields may actually
                    -- change is narrowed underneath this, by
                    -- protect_judgment_lifecycle() (0045, BEFORE INSERT
                    -- OR UPDATE trigger, not an RLS predicate — see §6):
                    -- while draft, unrestricted; while final, only
                    -- is_discoverable (and an unlock final->draft with
                    -- no other change) is permitted — title/case_number/
                    -- court_name/judgment_date/citation/content/
                    -- content_text are locked, and unlock+edit combined
                    -- in one statement is rejected

Judgment DELETE := using (can_edit_judgment(id) and status = 'draft')
                    -- APPLIED via 0045 (was PROVISIONAL owner_id-only
                    -- under 0027) — a final Judgment cannot be hard-
                    -- deleted by anyone, owner included, until unlocked
                    -- back to draft. This status check is added directly
                    -- to this policy, not into can_edit_judgment() itself
                    -- — see §6/§14 for why lifecycle state is
                    -- deliberately kept out of the shared helper.

Judgment access NEVER references can_access_court() / has_retained_assignment()
  / my_court_id() / is_admin() — fully independent from Docket/Court
  access, by design (resolved when 0027 was prepared — see §6). No
  admin bypass anywhere on this table, including the 0045 lifecycle
  trigger (finalize/unlock are owner-only, always).

DocketMatterJudgments SELECT := using (
  exists(docket_matters dm WHERE dm.id = docket_matter_id
         AND (can_access_court(dm.court_id) OR has_retained_assignment(dm.id)))
  AND
  exists(judgments j WHERE j.id = judgment_id
         AND (j.owner_id = (select auth.uid()) OR j.is_discoverable = true))
)
  -- BOTH sides required, never OR — resolved when 0029 was prepared,
  -- see §6. Prevents the join row itself from becoming a metadata
  -- side-channel for an otherwise-inaccessible Docket Matter or Judgment.

DocketMatterJudgments INSERT := with check (
  exists(docket_matters dm WHERE dm.id = docket_matter_id
         AND (can_access_court(dm.court_id) OR has_retained_assignment(dm.id)))
  AND
  exists(judgments j WHERE j.id = judgment_id AND j.owner_id = (select auth.uid()))
  AND created_by = (select auth.uid())
)
  -- Judgment side requires OWNERSHIP specifically — is_discoverable
  -- alone is never sufficient to create a link.

DocketMatterJudgments DELETE := using (
  exists(docket_matters dm WHERE dm.id = docket_matter_id
         AND (can_access_court(dm.court_id) OR has_retained_assignment(dm.id)))
  AND
  exists(judgments j WHERE j.id = judgment_id AND j.owner_id = (select auth.uid()))
)
  -- identical substantive authority to INSERT — not merely whoever
  -- created the link (created_by is provenance only, never access
  -- control)

DocketMatterJudgments UPDATE := NO POLICY — the association has no
  editable business fields; correcting a wrong link is DELETE then
  INSERT, subject to the same authority rules above.

No admin bypass anywhere on docket_matter_judgments.

DocketMatterCaseLaw SELECT := using (
  exists(docket_matters dm WHERE dm.id = docket_matter_id
         AND (can_access_court(dm.court_id) OR has_retained_assignment(dm.id)))
  AND
  exists(case_law cl WHERE cl.id = case_law_id)
)
  -- BOTH sides required, never OR -- resolved when 0030 was prepared,
  -- see §5. The Case-Law side is deliberately a live existence check
  -- against case_law itself (today: unconditionally true for any
  -- authenticated user, since case_law's own SELECT policy is `using
  -- (true)`) rather than a duplicated predicate -- this automatically
  -- tracks case_law's future personal/canonical RLS (0035) with no
  -- change required here.

DocketMatterCaseLaw INSERT := with check (
  exists(docket_matters dm WHERE dm.id = docket_matter_id
         AND (can_access_court(dm.court_id) OR has_retained_assignment(dm.id)))
  AND
  exists(case_law cl WHERE cl.id = case_law_id)
  AND created_by = (select auth.uid())
)
  -- Case-Law side requires READ access only, not ownership -- Case Law
  -- is reusable reference authority, not individually authored work
  -- product (deliberate, explicit difference from
  -- DocketMatterJudgments INSERT).

DocketMatterCaseLaw DELETE := using (
  exists(docket_matters dm WHERE dm.id = docket_matter_id
         AND (can_access_court(dm.court_id) OR has_retained_assignment(dm.id)))
  AND
  exists(case_law cl WHERE cl.id = case_law_id)
)
  -- identical substantive authority to INSERT -- not merely whoever
  -- created the link (created_by is provenance only).

DocketMatterCaseLaw UPDATE := NO POLICY — the association has no
  editable business fields; correcting a wrong link is DELETE then
  INSERT, subject to the same authority rules above.

No admin bypass anywhere on docket_matter_case_law.

QuickCodes SELECT/INSERT/UPDATE/DELETE := using/with check (owner_id = (select auth.uid()))
  -- identical predicate on all four commands -- resolved when 0031 was
  -- prepared, see §7. owner_id is also force-set to auth.uid() by a
  -- guard trigger on INSERT (cannot be forged) and is separately
  -- immutable on UPDATE (a guard trigger rejects any change). No
  -- can_access_court()/has_retained_assignment()/is_discoverable/
  -- is_admin() anywhere on this table -- the simplest, most fully
  -- private access model in the schema. code_word uniqueness
  -- (owner_id, lower(btrim(code_word))) is enforced by an expression
  -- unique index, not by RLS.

QuickCodeDocketMatters SELECT := using (
  exists(docket_matters dm WHERE dm.id = docket_matter_id
         AND (can_access_court(dm.court_id) OR has_retained_assignment(dm.id)))
  AND
  exists(quick_codes qc WHERE qc.id = quick_code_id AND qc.owner_id = (select auth.uid()))
)
  -- BOTH sides required, never OR -- resolved when 0032 was prepared,
  -- see §7. Quick Code access collapses to owner_id = auth.uid() since
  -- Quick Codes have no discoverability tier at all -- SELECT and
  -- INSERT/DELETE therefore use an identically-strength Quick-Code-side
  -- check, unlike DocketMatterJudgments where SELECT could be satisfied
  -- by mere discoverability but INSERT/DELETE required ownership.

QuickCodeDocketMatters INSERT := with check (
  exists(docket_matters dm WHERE dm.id = docket_matter_id
         AND (can_access_court(dm.court_id) OR has_retained_assignment(dm.id)))
  AND
  exists(quick_codes qc WHERE qc.id = quick_code_id AND qc.owner_id = (select auth.uid()))
  AND created_by = (select auth.uid())
)

QuickCodeDocketMatters DELETE := using (
  exists(docket_matters dm WHERE dm.id = docket_matter_id
         AND (can_access_court(dm.court_id) OR has_retained_assignment(dm.id)))
  AND
  exists(quick_codes qc WHERE qc.id = quick_code_id AND qc.owner_id = (select auth.uid()))
)
  -- identical substantive authority to INSERT -- not merely whoever
  -- created the link.

QuickCodeDocketMatters UPDATE := NO POLICY.

No admin bypass anywhere on quick_code_docket_matters.

QuickCodeJudgments SELECT := using (
  exists(quick_codes qc WHERE qc.id = quick_code_id AND qc.owner_id = (select auth.uid()))
  AND
  exists(judgments j WHERE j.id = judgment_id
         AND (j.owner_id = (select auth.uid()) OR j.is_discoverable = true))
)
  -- QuickCodeOwnership AND JudgmentReadAccess, never OR -- resolved
  -- when 0033 was prepared, see §7. Visibility follows Judgment
  -- discoverability dynamically, without ever mutating the association
  -- row, exactly mirroring the 0029 discoverability-transition pattern.

QuickCodeJudgments INSERT := with check (
  exists(quick_codes qc WHERE qc.id = quick_code_id AND qc.owner_id = (select auth.uid()))
  AND
  exists(judgments j WHERE j.id = judgment_id
         AND (j.owner_id = (select auth.uid()) OR j.is_discoverable = true))
  AND created_by = (select auth.uid())
)
  -- Judgment side requires READ access only, not ownership -- a
  -- deliberate, explicit difference from DocketMatterJudgments INSERT
  -- and QuickCodeDocketMatters INSERT, since the Quick Code is the
  -- linking user's own private metadata and grants nobody else access.

QuickCodeJudgments DELETE := using (
  exists(quick_codes qc WHERE qc.id = quick_code_id AND qc.owner_id = (select auth.uid()))
  AND
  exists(judgments j WHERE j.id = judgment_id
         AND (j.owner_id = (select auth.uid()) OR j.is_discoverable = true))
)
  -- identical substantive authority to INSERT -- not merely whoever
  -- created the link.

QuickCodeJudgments UPDATE := NO POLICY.

No admin bypass anywhere on quick_code_judgments.

QuickCodeCaseLaw SELECT := using (
  exists(quick_codes qc WHERE qc.id = quick_code_id AND qc.owner_id = (select auth.uid()))
  AND
  exists(case_law cl WHERE cl.id = case_law_id)
)
  -- QuickCodeOwnership AND CaseLawReadAccess, never OR -- prepared as
  -- 0034, see §7. Reuses 0030's nested-RLS design unmodified: the
  -- Case-Law side is a live existence check against case_law itself,
  -- not a duplicated predicate, so it automatically tracks case_law's
  -- future personal/canonical RLS (0035) with no change here.

QuickCodeCaseLaw INSERT := with check (
  exists(quick_codes qc WHERE qc.id = quick_code_id AND qc.owner_id = (select auth.uid()))
  AND
  exists(case_law cl WHERE cl.id = case_law_id)
  AND created_by = (select auth.uid())
)
  -- Case Law side requires READ access only, not ownership/authorship --
  -- mirrors docket_matter_case_law (0030) INSERT and the
  -- QuickCodeJudgments rationale (0033): Case Law is reusable reference
  -- authority, and the Quick Code is the linking user's own private
  -- metadata.

QuickCodeCaseLaw DELETE := using (
  exists(quick_codes qc WHERE qc.id = quick_code_id AND qc.owner_id = (select auth.uid()))
  AND
  exists(case_law cl WHERE cl.id = case_law_id)
)
  -- identical substantive authority to INSERT -- not merely whoever
  -- created the link.

QuickCodeCaseLaw UPDATE := NO POLICY.

No admin bypass anywhere on quick_code_case_law. No can_view_case_law()
helper created for this table either -- same rationale as 0030.

CaseLaw SELECT := using (
  owner_id is null
  OR owner_id = (select auth.uid())
  OR is_discoverable = true
)
  -- APPLIED as 0035 -- see §5. Canonical rows (owner_id IS NULL) are
  -- readable to everyone regardless of is_discoverable; personal rows
  -- are readable to their owner or to anyone once is_discoverable =
  -- true. docket_matter_case_law (0030) and quick_code_case_law (0034)
  -- both express their Case-Law-side check as a live nested EXISTS
  -- against this exact policy, and both were confirmed, behaviorally,
  -- to automatically inherit this narrower predicate with zero code
  -- change to either table -- see the 0035 verification report.

CaseLaw INSERT := with check (
  (owner_id is null AND (select is_admin()))
  OR owner_id = (select auth.uid())
)
  -- canonical creation (owner_id IS NULL) requires is_admin(); personal
  -- creation is open to any authenticated magistrate, with owner_id
  -- force-set to auth.uid() by case_law_ownership_guard() regardless of
  -- what is submitted (cannot be forged to impersonate another user or
  -- to fake a NULL-canonical row as non-admin).

CaseLaw UPDATE := using (
  (owner_id is null AND (select is_admin()))
  OR owner_id = (select auth.uid())
)
with check (
  (owner_id is null AND (select is_admin()))
  OR owner_id = (select auth.uid())
)
  -- admin may update canonical rows; owner may update their own
  -- personal row (including toggling is_discoverable); no admin bypass
  -- into another magistrate's personal row. case_law_ownership_guard()
  -- separately rejects any owner_id change outright, in both
  -- directions, as defense in depth beneath this policy.

CaseLaw DELETE := using (
  (owner_id is null AND (select is_admin()))
  OR owner_id = (select auth.uid())
)
  -- identical predicate to UPDATE. Subject to the existing
  -- docket_matter_case_law/quick_code_case_law RESTRICT FKs -- a
  -- referenced personal Case Law row remains blocked from deletion
  -- until unlinked, exactly like a referenced canonical row.

No can_view_case_law()/can_edit_case_law() helper is created by 0035
either -- neither exists as a function in the live database, and 0035
does not introduce them; docket_matter_case_law/quick_code_case_law
continue to express their Case-Law-side check directly against
case_law's own policy (see §5).

case_law_tags RLS / bench_notes RLS / quick_codes RLS :=
    unchanged by 0035. case_law_tags remains SELECT `using (true)`,
    INSERT/DELETE `is_admin()`-only -- see §5 for why this remains safe
    (no ordinary-user INSERT path into case_law_tags exists, so a
    personal Case Law row can never acquire a tag association today).

CaseLawAnnotations SELECT := using (
  owner_id = (select auth.uid())
  AND exists(select 1 from case_law cl where cl.id = case_law_id)
)
  -- prepared as 0036, not yet applied -- see §5. AnnotationOwnership
  -- AND CaseLawReadAccess, reusing the 0030/0034 nested-RLS pattern
  -- unmodified. The parent Case Law's own owner_id is never referenced
  -- -- owning the annotated record confers no annotation visibility.

CaseLawAnnotations INSERT := with check (
  owner_id = (select auth.uid())
  AND exists(select 1 from case_law cl where cl.id = case_law_id)
)

CaseLawAnnotations UPDATE := using (
  owner_id = (select auth.uid())
  AND exists(select 1 from case_law cl where cl.id = case_law_id)
)
with check (
  owner_id = (select auth.uid())
  AND exists(select 1 from case_law cl where cl.id = case_law_id)
)

CaseLawAnnotations DELETE := using (
  owner_id = (select auth.uid())
  AND exists(select 1 from case_law cl where cl.id = case_law_id)
)

No admin bypass anywhere on case_law_annotations.
```

The three Docket access paths remain semantically distinct by design, per your explicit instruction: **current Court assignment** is the normal operational mechanism; **current retained assignment** is the part-heard/succession-exception mechanism; **explicit `shares`** is discretionary, exceptional consultation. None of the three implies or grants the others. Every predicate wraps `auth.uid()` calls in `(select ...)`, matching the pattern established in migration 0012.

**Staged implementation decision (recorded when `0020_docket_matters` was prepared):** the three paths are implemented incrementally, one per migration, rather than all at once in `0020`, because `has_retained_assignment()` depends on `docket_matter_assignments` and the `shares`-based path depends on `shares` — neither table exists yet when `docket_matters` is created. `0020` implements only `can_access_court()` first. `0022_docket_matter_assignments` (APPLIED) extended Docket SELECT/UPDATE to add `or has_retained_assignment(id)`. The migration that creates `shares` (currently numbered `0037`) will extend Docket SELECT/UPDATE again to add the `shares` clause. No dummy/placeholder tables or functions are created early to avoid this staging — the predicate is genuinely narrower until each dependency lands, not fake-complete. This is a sequencing decision only; the target end-state three-path predicate above is unchanged.

**Stale-assignment risk, recorded explicitly (per your instruction, not solved by weakening admin exclusion):** both `magistrate_courts.ended_at IS NULL` and `docket_matter_assignments.ended_at IS NULL` are real, load-bearing security boundaries — an assignment left open after a magistrate has actually moved on keeps their access alive indefinitely. The mitigation is operational (a straightforward, visible way for magistrates and admins to end assignments promptly, planned as a future UI concern), never a database-level admin override — admins do not gain, and must not gain, universal Docket access as a workaround for this risk.

**Narrow professional-identity resolution (`0043_narrow_professional_identity.sql` — APPLIED and verified live):** `profiles` SELECT remains exactly `(select auth.uid()) = id OR is_admin()` — unchanged, no broadened carve-out. Two context-gated SECURITY DEFINER functions are the sole sanctioned path to another magistrate's display name:

```
resolve_docket_assignment_identity(p_assignment_id uuid) -> (profile_id, display_name)
  authorized iff exists(docket_matters dm joined to the assignment
    where can_access_court(dm.court_id)
       or has_retained_assignment(dm.id)
       or has_docket_share(dm.id, 'view'))
  -- the full three-path Docket read envelope, decorated (duplicated,
  -- not inherited — this is a function, not a nested-RLS SELECT)
  -- includes ended/historical assignments; NULL-safe via LEFT JOIN if
  -- profile_id has been offboarded (ON DELETE SET NULL) or has no
  -- full_name

resolve_docket_share_identity(p_share_id uuid)
  -> (recipient_id, recipient_display_name, granted_by, grantor_display_name)
  authorized iff granted_by = auth.uid()
              or recipient_id = auth.uid()
              or (item_type='docket_matter' and has_docket_matter_authority(item_id))
  -- exactly the live "Share visibility for management" SELECT
  -- predicate, including revoked-but-visible shares (no revoked_at
  -- filter, matching that policy); NULL-safe for either party
```

Both: `display_name`/`*_display_name` sourced from `profiles.full_name` only — no professional-title field exists that doesn't also encode the admin flag (`role` conflates `magistrate`/`clerk`/`admin`), so per instruction neither function invents or exposes one. Neither accepts a bare `profile_id` — each takes a context-row id and re-derives identity, making arbitrary-UUID probing structurally impossible. No `is_admin()` bypass. `EXECUTE` explicitly revoked from `anon` (this schema's `ALTER DEFAULT PRIVILEGES` auto-grants `EXECUTE` on every new `public` function to `anon`/`authenticated`/`service_role` at creation time — confirmed live via `pg_default_acl`; a `revoke ... from public` alone does not reach it, and was confirmed live to leave `anon` still able to execute, just with an always-empty result rather than a denial) and granted only to `authenticated`. Zero rows is the uniform, non-distinguishing response for both "context row doesn't exist" and "caller not authorized." `magistrate_courts` (court-roster) identity resolution and `docket_matters.created_by`/`last_updated_by` attribution were deliberately left out of `0043` — no current UI/spec requirement was found for either, and adding them would broaden scope beyond what's needed now. Applied and verified live via a 25+-scenario behavioral battery (retained-assignment matrix, share matrix, offboarding/NULL-safety, oracle/side-channel probes, `profiles` RLS regression) — PASS, no unintended access change.

**Access-predicate centralization (`0044_ownership_rls_helpers.sql` — APPLIED and verified live):** six narrow, reusable, boolean `SECURITY DEFINER` helper functions replace duplicated inline Docket/Judgment/Case-Law access predicates across 14 tables' RLS policies. This is a pure semantic refactor — it invents no new access right and changes no access outcome anywhere, proven by an exhaustive rollback-only before/after regression matrix run live both before and immediately after application, plus a full post-application live regression pass. Deferred from `0037_shares`.

```
can_view_docket_matter(p_docket_matter_id uuid) -> boolean
  can_access_court(dm.court_id) OR has_retained_assignment(dm.id)
    OR has_docket_share(dm.id, 'view')
  -- the full three-path Docket read envelope, centralized

can_edit_docket_matter(p_docket_matter_id uuid) -> boolean
  can_access_court(dm.court_id) OR has_retained_assignment(dm.id)
    OR has_docket_share(dm.id, 'edit')
  -- view-only share is insufficient; NOT the same predicate as
  -- has_docket_matter_authority() (which excludes shares entirely)

can_view_judgment(p_judgment_id uuid) -> boolean
  j.owner_id = auth.uid() OR j.is_discoverable = true

can_edit_judgment(p_judgment_id uuid) -> boolean
  j.owner_id = auth.uid()   -- owner only, no exceptions, no admin bypass

can_view_case_law(p_case_law_id uuid) -> boolean
  cl.owner_id IS NULL OR cl.owner_id = auth.uid() OR cl.is_discoverable = true

can_edit_case_law(p_case_law_id uuid) -> boolean
  (cl.owner_id IS NULL AND is_admin()) OR cl.owner_id = auth.uid()
  -- deliberately asymmetric: admin may edit canonical rows only,
  -- never another user's personal Case Law merely by being admin
```

All six are `SECURITY DEFINER` with a fixed `set search_path = public` — required, not merely convenient: proven live via a disposable rollback-only probe that a `SECURITY INVOKER` helper querying the same table whose RLS policy calls it fails with "stack depth limit exceeded" (genuine self-referential recursion), while the identical `SECURITY DEFINER` version succeeds, because `SECURITY DEFINER` changes the effective privilege-checking role for the function's entire nested execution — including its own calls to other helpers like `has_docket_share()` — so no query inside it ever re-triggers RLS on the table it protects. No cycle is possible through `has_docket_share()` → `shares`' own SELECT policy → `has_docket_matter_authority()`, since that entire chain also runs with RLS bypassed once inside a `SECURITY DEFINER` context.

`has_docket_matter_authority()`, `can_access_court()`, `has_retained_assignment()`, `has_docket_share()`, `is_admin()` are all reused unmodified, not duplicated. Two association-table families were found, on direct inspection, to be **not symmetric** and both preserved exactly as found: `docket_matter_judgments`/`docket_matter_case_law`'s INSERT/DELETE keep the narrower `has_docket_matter_authority()` (court-or-retained only, no share) rather than the broader `can_edit_docket_matter()`, matching their existing, narrower link-mutation rule; `quick_code_docket_matters`' INSERT/DELETE already used the full edit-share-inclusive predicate and correctly now uses `can_edit_docket_matter()`. The 0043 identity resolvers, `search_case_law()`, `storage.objects`, and `documents`' Quick Code/Bench Note/Legacy Case branches and DELETE policy are all left untouched. Several rewritten policies (`docket_matter_case_law`, `quick_code_case_law`, `case_law_annotations`, and the `judgment`/`case_law` branches of `documents`) previously relied on Postgres transparently re-applying the referenced table's own RLS to a plain nested `EXISTS` (an "auto-inheriting" mechanism); substituting an explicit helper call is behavior-identical today (proven by the regression matrix) but is a disclosed mechanism change — future changes to the parent policy must now be manually mirrored into the helper, rather than propagating for free.

Grants deliberately differ from 0043: all six helpers are left on this schema's default `EXECUTE` grant (`anon`/`authenticated`/`service_role`), NOT explicitly revoked from `anon`. This was a considered decision, not an oversight — `anon` already holds base-table SELECT on `judgments`/`case_law`/`docket_matters` today, and both `judgments`' and `case_law`'s SELECT RLS already have an `is_discoverable = true` branch with no `auth.uid()` dependency, meaning an unauthenticated caller can already read full discoverable rows directly; a boolean helper adds no new information oracle. The four fully `auth.uid()`-gated helpers (`can_view_docket_matter`, `can_edit_docket_matter`, `can_edit_judgment`, `can_edit_case_law`) return `false` unconditionally for `anon`, exactly like the pre-existing `can_access_court()`/`has_retained_assignment()`/`has_docket_matter_authority()`. Explicitly revoking `anon` here — unlike 0043, which was introducing a brand-new capability — would itself have been an unintended behavior change (a hard "permission denied" instead of the current silent empty/RLS-filtered result), which this migration was required not to introduce.

Verified live: structural (all six confirmed `SECURITY DEFINER`/`STABLE` post-application), an exhaustive rollback-only regression matrix run identically before DDL application and after (35 scenarios across Docket/Judgment/Case-Law VIEW/EDIT, all six cross-table associations, zero mismatches), then re-run live against the permanently applied policies post-`apply_migration` (Docket court/retained/view-share/edit-share/revoked-share/unrelated/admin-only; Judgment owner/other-private/other-discoverable/admin-no-bypass; Case-Law canonical/personal-owner/personal-discoverable/personal-non-owner/admin-asymmetric-edit; `docket_matter_judgments` INSERT correctly rejected for an edit-share-only holder, confirming `has_docket_matter_authority()` preservation; `documents` Docket/Judgment/Case-Law branches, including a view-share-only INSERT correctly rejected) — zero mismatches, zero recursion errors, zero unintended access changes. Advisors: the six new helpers produce the expected, pre-disclosed `anon_security_definer_function_executable`/`authenticated_security_definer_function_executable` WARNs — the same accepted class already carried by `is_admin()`/`has_docket_matter_authority()`/`my_court_id()` under this schema's pre-existing default-privilege grant; no new advisory class, no new severity, no `function_search_path_mutable` finding (all six correctly pin `search_path`).

**Judgment lifecycle locking (`0045_judgment_lifecycle_locking.sql` — APPLIED and verified live):** `judgments` gains `status text not null default 'draft' check (status in ('draft','final'))`, `finalized_at timestamptz`, `finalized_by uuid references profiles(id) on delete set null`, and a new `protect_judgment_lifecycle()` `BEFORE INSERT OR UPDATE` trigger. Full field-level design in §6. The critical architectural point, stated once here for cross-reference: **lifecycle state is deliberately kept out of `can_view_judgment()`/`can_edit_judgment()`** — those helpers answer "does this caller have ownership/mutation authority," which remains true for a final Judgment's owner, and are reused unmodified by `judgment_tags`, `docket_matter_judgments`, `quick_code_judgments`, and `documents`, all of which must keep working post-finalization (tagging, linking, and attaching are organizational actions around the Judgment, not edits to its substantive content). Folding `status = 'draft'` into either helper would have silently broken every one of those four consumers the moment a Judgment is finalized — confirmed live via a dedicated behavioral matrix proving tags/Docket-links/Quick-Code-links/Document-attachment all continue to succeed on a final, owner-held Judgment, and that `can_edit_judgment()` still correctly returns `true` for that owner (ownership/mutation authority, not row-level editability, which the trigger narrows separately). Enforcement instead lives in exactly two places: the new trigger (field-level content lock + atomic-bypass prevention + provenance forcing), and the `judgments` DELETE policy directly (`can_edit_judgment(id) AND status = 'draft'` — a table-specific addition, not routed through the shared helper). No `is_admin()` bypass anywhere in the trigger or the DELETE policy. One new, self-introduced advisory finding: `protect_judgment_lifecycle()` lacks an explicit `SET search_path` pin (`function_search_path_mutable`, WARN) — unlike every sibling guard trigger in this codebase (`judgments_guard`, `docket_matters_guard`, `quick_codes_guard`, `shares_guard`, `set_updated_at` all pin `search_path=public`), this one does not, a genuine oversight rather than an accepted pre-existing gap like `validate_bookmark_entity`'s. Not auto-fixed per instruction; flagged as the leading candidate for a small, dedicated forward-only repair migration before or alongside `0046`.

---

## 15. Updated Complete ERD (text form)

```
magisterial_districts
  └── courts (district_id, is_active)
        ├── magistrate_courts (court_id, profile_id, ended_at IS NULL = current)
        │     ↑
        │     └── profiles
        │
        └── docket_matters (court_id NOT NULL, district_id derived+guarded,
                             created_by, last_updated_by — NO owner_id)
              ├── docket_matter_assignments (docket_matter_id, profile_id,
              │     reason, ended_at IS NULL = current — retained/part-heard)
              ├── docket_events (1:many)
              ├── docket_matter_parties (1:many)
              ├── docket_matter_tags (1:many — institutional Docket tags,
              │     own dedicated table; NOT the global tags table; see §4)
              ├── docket_matter_judgments ↔ judgments (m:m — association
              │     only, confers no access in either direction; SELECT/
              │     INSERT/DELETE all require independent access to
              │     BOTH sides (AND, never OR); no descriptive metadata
              │     on the join row; no admin bypass; see §6)
              ├── docket_matter_case_law ↔ case_law (m:m) — association only,
              │     never confers access either way; SELECT/INSERT/DELETE
              │     require BOTH DocketAccess AND CaseLawAccess (INSERT/
              │     DELETE need Case-Law READ access only, not ownership);
              │     no admin bypass; built against the live legacy case_law
              │     model (0035 refactor not yet built) — see §5/§14
              ├── documents (entity_type='docket_matter')
              ├── bench_notes (entity_type='docket_matter' — private to author, always)
              └── shares (item_type='docket_matter' — exceptional consultation only)

profiles
  ├── judgments (owner_id, immutable — private by default, owner-
  │     │     controlled is_discoverable read-only flag, no admin
  │     │     bypass, fully independent from Docket/Court access;
  │     │     status draft/final lifecycle lock APPLIED via 0045 —
  │     │     final blocks hard DELETE and locks title/case_number/
  │     │     court_name/judgment_date/citation/content/content_text;
  │     │     is_discoverable remains toggleable and unlock (final→
  │     │     draft) remains available in both states, owner-only,
  │     │     no admin bypass; see §6/§14)
  │     ├── judgment_tags (1:many — Judgment-specific tags, own
  │     │     dedicated table; NOT the global tags table; ON DELETE
  │     │     CASCADE from judgments; READ inherits owner/discoverable,
  │     │     INSERT/DELETE owner-only, unaffected by 0045 lifecycle
  │     │     state — tags remain mutable on a final Judgment; see §6)
  │     ├── documents (entity_type='judgment' — live and usable since
  │     │     the documents polymorphic refactor; attachment continues
  │     │     unaffected by 0045 lifecycle state — a final Judgment
  │     │     remains attachable by its owner; see §14)
  │     ├── bench_notes (entity_type='judgment')
  │     ├── bookmarks (entity_type='judgment')
  │     └── shares (item_type='judgment' — future work, not in 0027)
  │
  ├── case_law (owner_id NULLABLE — null = canonical/institutional,
  │     │   readable by all regardless of is_discoverable; non-null =
  │     │   personal research, private by default, owner-controlled
  │     │   is_discoverable read-only extension mirroring judgments;
  │     │   ownership immutable after creation, no admin bypass into
  │     │   personal rows, canonical-only citation uniqueness; prepared
  │     │   as 0035, not yet applied — see §5/§14)
  │     ├── case_law_tags → tags (unchanged by 0035 — admin-only INSERT,
  │     │     so personal rows cannot acquire a tag association today)
  │     ├── case_law_annotations (case_law_id ON DELETE CASCADE,
  │     │     owner_id ON DELETE RESTRICT) — always private, multiple
  │     │     allowed per owner per record, AnnotationOwnership AND
  │     │     CaseLawReadAccess (nested-RLS, no admin bypass, parent
  │     │     owner_id never referenced); prepared as 0036, not yet
  │     │     applied — see §5/§14
  │     ├── documents (entity_type='case_law')
  │     ├── bench_notes (entity_type='case_law')
  │     ├── bookmarks (entity_type='case_law')
  │     └── shares (item_type='case_law', only when owner_id is set —
  │           future work, not in 0035)
  │
  ├── quick_codes (owner_id) — private, full stop; SELECT/INSERT/UPDATE/
  │     │   DELETE all owner-only; no admin bypass; no discoverability;
  │     │   no sharing yet; code_word unique per owner (case-insensitive/
  │     │   trimmed); plain-text content; hard DELETE approved — see §7
  │     ├── quick_code_docket_matters (m:m) — association only, never
  │     │     confers access either way; SELECT/INSERT/DELETE require BOTH
  │     │     DocketAccess AND QuickCodeAccess (owner_id = auth.uid(), the
  │     │     only Quick-Code access path); quick_code_id ON DELETE
  │     │     CASCADE, docket_matter_id ON DELETE RESTRICT; no admin
  │     │     bypass; no UPDATE — see §7/§14
  │     ├── quick_code_judgments (m:m) — association only, never confers
  │     │     access either way; SELECT/INSERT/DELETE require BOTH
  │     │     QuickCodeOwnership AND JudgmentReadAccess (owner_id =
  │     │     auth.uid() on the Judgment side is NOT required, only read
  │     │     access -- owner_id=auth.uid() OR is_discoverable=true);
  │     │     both quick_code_id and judgment_id ON DELETE CASCADE;
  │     │     visibility follows Judgment discoverability dynamically;
  │     │     no admin bypass; no UPDATE — see §7/§14
  │     └── quick_code_case_law (m:m) — association only, never confers
  │           access either way; SELECT/INSERT/DELETE require BOTH
  │           QuickCodeOwnership AND CaseLawReadAccess (Case-Law side is
  │           a live existence check against case_law, reusing 0030's
  │           nested-RLS design unmodified — READ access only, not
  │           ownership/authorship); quick_code_id ON DELETE CASCADE,
  │           case_law_id ON DELETE RESTRICT (matching docket_matter_
  │           case_law/0030); no admin bypass; no UPDATE; prepared as
  │           0034 (not yet applied) — see §5/§7/§14
  │
  ├── magistrate_courts (profile_id) — see above
  ├── docket_matter_assignments (profile_id) — see above
  ├── shares (owner/granter and, separately, recipient)
  └── audit_log (actor_id)

statutes ── statute_tags ── tags        (unchanged, admin-curated shared reference)

documents (entity_type ∈ {docket_matter, judgment, case_law, quick_code,
                           bench_note, case[legacy]}, entity_id)
  → Storage bucket "documents" (private, signed URLs)
bookmarks (entity_type ∈ {case, bench_note, statute, case_law,
                           docket_matter, judgment, quick_code}, entity_id)
  -- deliberately NOT the same set as documents: `document` itself is
  -- excluded (0041/0042), `bench_note`/`statute`/`case`(legacy) ARE
  -- included (unchanged since 0008)

[legacy, untouched, not built upon]
cases, case_parties, case_tags
```

---

## 16. Revised Migration Sequence, Beginning at 0013

```
0013_magisterial_districts.sql            — APPLIED
0014_seed_magisterial_districts.sql       — APPLIED (ten original districts)
0015_seed_east_bank_demerara_district.sql — the eleventh district, data-only,
                                             independent of everything else in
                                             this revision — authorized this turn
0016_reference_data_admin_fields.sql      — APPLIED. magisterial_districts.is_active;
                                             courts.district_id (nullable) +
                                             courts.is_active. District-change
                                             immutability trigger deferred until
                                             docket_matters exists (see 0020) —
                                             no interim gap, since no
                                             docket_matters rows can exist before
                                             that table does.
0017_magistrate_courts.sql                — APPLIED and verified (structure, FKs,
                                             indexes, triggers, RLS, advisors, and a
                                             10-scenario transactional test battery,
                                             all rolled back cleanly). ended_at-based
                                             (no is_active column), assignment_type
                                             (constrained text), partial unique index
                                             on (profile_id, court_id) where ended_at
                                             is null. Additionally includes
                                             check_court_active_for_assignment()
                                             (rejects new/current assignments to
                                             inactive courts, no admin exception) and
                                             protect_magistrate_court_history()
                                             (admins retain full correction rights;
                                             ordinary self-service may only set
                                             ended_at on a currently-active own row —
                                             cannot change profile_id/court_id/
                                             started_at/assignment_type, cannot touch
                                             an already-historical row, cannot
                                             reactivate by clearing ended_at). No
                                             DELETE policy.
0018_seed_guyana_magistrates_courts.sql   — APPLIED. Seeded 46 Court rows from an
                                             initial researched/inferred Court/
                                             District master list, each associated
                                             with its correct existing
                                             magisterial_districts row, is_active
                                             specified per row, idempotent via
                                             ON CONFLICT(name, jurisdiction),
                                             existing "General Magistrate Court"
                                             placeholder untouched, no
                                             magistrate_courts rows, no
                                             docket_matters. This list was
                                             subsequently superseded by a
                                             personally verified current
                                             operational structure — see 0019.
                                             0018 itself was NOT edited to reflect
                                             the correction (applied migrations
                                             are immutable in this project); the
                                             correction is a forward migration.
0019_reconcile_guyana_magistrates_courts.sql — APPLIED. Forward reconciliation of
                                             the live 46-row 0018 seed to a
                                             personally verified 55-row current
                                             operational Court structure. Live-state
                                             inspection first confirmed none of the
                                             46 seeded courts were referenced by
                                             magistrate_courts, cases, or profiles
                                             (only the "General Magistrate Court"
                                             placeholder was referenced, and it was
                                             left untouched throughout). Actions:
                                             3 renames (UUID preserved — Diamond/
                                             Golden Grove Court 2→3, New Amsterdam
                                             Court 1→single "New Amsterdam
                                             Magistrate's Court", generic Leonora→
                                             Leonora Court 1), 1 delete (New
                                             Amsterdam Court 2 — an unreferenced row
                                             resulting from the incorrect 0018
                                             structure, not a legitimate dormant
                                             court, so deactivation would have
                                             misrepresented the verified structure),
                                             10 adds (Georgetown 8/9/10, Albion,
                                             Leonora Court 2, West Demerara
                                             Children's Court, Bartica, Mahdia,
                                             Kamarang, Acquero). Defensive
                                             precondition checks re-verify every
                                             renamed/deleted row's exact identity
                                             and continued unreferenced status
                                             immediately before acting, aborting
                                             the whole migration on any drift.
                                             Result: 55 real operational Court rows
                                             + 1 untouched placeholder = 56 total,
                                             54 active, 1 inactive (Vigilance
                                             Magistrates' Court 2, unchanged
                                             throughout).
0020_docket_matters.sql                   — APPLIED and verified (structure,
                                             constraints, enum, triggers,
                                             functions, indexes, RLS, a
                                             16-scenario transactional test
                                             battery, and advisors). court-
                                             anchored: court_id NOT NULL,
                                             district_id derived+guarded,
                                             case_number, matter_title (new
                                             field, human-readable case
                                             style/title, distinct from
                                             case_number and from the future
                                             docket_matter_parties — approved
                                             as an explicit refinement
                                             alongside this migration, not part
                                             of the original §4 sketch),
                                             charge_or_issue/orders_summary/
                                             outcome (nullable text),
                                             created_by/last_updated_by (no
                                             owner_id), no DELETE policy, plus
                                             the district-change immutability
                                             trigger on courts deferred from
                                             0016. matter_type and
                                             search_vector remain deferred (see
                                             §4). RLS implemented
                                             incrementally: this migration
                                             implements ONLY the current-
                                             Court-assignment path
                                             (can_access_court()), since
                                             docket_matter_assignments and
                                             shares — the dependencies of the
                                             other two paths in the full §14
                                             predicate — do not exist yet. No
                                             placeholder tables or functions
                                             created to fake completeness.
                                             Renumbered from 0019 to make room
                                             for the 0019 reconciliation
                                             migration above.
0021_index_docket_matters_last_updated_by.sql — small forward migration
                                             addressing the one new
                                             performance-advisor finding
                                             attributable to 0020
                                             (docket_matters_last_updated_by_fkey
                                             had no covering index). Adds
                                             docket_matters_last_updated_by_idx.
                                             No other schema/policy/trigger/
                                             function/data change. 0020 itself
                                             is not edited, per the
                                             never-edit-applied-migrations
                                             rule. Inserted ahead of Docket
                                             Matter Assignments, shifting
                                             everything below by one. Prepared
                                             for review this turn, not yet
                                             applied.
0022_docket_matter_assignments.sql        — APPLIED and verified (structure,
                                             FKs, constraints, indexes,
                                             triggers, RLS, an 18-scenario
                                             transactional test battery
                                             covering creation-security,
                                             successor lifecycle, ending/
                                             history-protection, parent-matter
                                             lifecycle, and profile-deletion
                                             fallback, plus advisors).
                                             ended_at-based, reason
                                             (constrained text), granted_by,
                                             partial unique index, automatic
                                             release trigger on
                                             docket_matters.status →
                                             completed/archived (not stayed).
                                             profile_id/granted_by are
                                             ON DELETE SET NULL, absorbed
                                             safely by a restructured
                                             history-protection trigger. ALSO
                                             extends Docket SELECT/UPDATE RLS
                                             to add the has_retained_assignment(id)
                                             path, per the incremental RLS
                                             decision recorded in §14.
                                             Renumbered from 0021 to make room
                                             for the 0021 index migration
                                             above.
0023_index_docket_matter_assignments_granted_by.sql — prepared for review
                                             (not yet applied). Small forward
                                             migration addressing the one new
                                             performance-advisor finding
                                             attributable to 0022
                                             (docket_matter_assignments_granted_by_fkey
                                             had no covering index). Adds
                                             docket_matter_assignments_granted_by_idx.
                                             No other schema/policy/trigger/
                                             function/data change. 0022 itself
                                             is not edited, per the
                                             never-edit-applied-migrations
                                             rule. Inserted ahead of Docket
                                             Events, shifting everything below
                                             by one.
0024_docket_events.sql                    — prepared for review (not yet
                                             applied). One appearance/
                                             hearing occurrence per Docket
                                             Matter. No court_id/district_id
                                             duplication (derived via
                                             parent). docket_matter_id
                                             immutable (trigger-enforced
                                             exception on change).
                                             scheduled_date not null,
                                             scheduled_time nullable.
                                             event_type unconstrained text
                                             (the Addendum 2 criminal-
                                             specific enum explicitly not
                                             built). stage_at_event/
                                             outcome_at_event/
                                             orders_made_at_event/notes/
                                             location all nullable text.
                                             presiding_magistrate_id
                                             (ON DELETE SET NULL,
                                             forced/locked provenance,
                                             0022-style FK-nulling
                                             exception + WITH CHECK IS NOT
                                             NULL). event_status
                                             constrained text (scheduled/
                                             completed/cancelled/
                                             entered_in_error), no hard
                                             DELETE ever. created_by
                                             (ON DELETE RESTRICT, matches
                                             docket_matters.created_by) /
                                             last_updated_by (ON DELETE SET
                                             NULL, matches
                                             docket_matters.last_updated_by).
                                             Outlook placeholder columns +
                                             partial unique index on
                                             (external_calendar_provider,
                                             external_calendar_event_id).
                                             Adjournments create a new row;
                                             the historical appearance's
                                             scheduled_date is never
                                             overwritten. RLS SELECT/
                                             INSERT/UPDATE all inherit the
                                             parent Docket Matter's
                                             can_access_court()/
                                             has_retained_assignment()
                                             two-path predicate via EXISTS;
                                             no DELETE policy; no admin
                                             bypass.
0025_docket_matter_parties.sql            — prepared for review (not yet
                                             applied). Structured party/
                                             participant identity per
                                             Docket Matter. No court_id/
                                             district_id duplication.
                                             docket_matter_id immutable
                                             (trigger-enforced exception
                                             on change). full_name text
                                             not null, no cross-matter
                                             identity matching, no
                                             persons/contact registry.
                                             party_type (constrained text:
                                             individual/organization/
                                             government_body/estate/other)
                                             independent of role
                                             (constrained text: accused/
                                             complainant/applicant/
                                             respondent/plaintiff/
                                             defendant/petitioner/
                                             appellant/appellee/landlord/
                                             tenant/child/other — no
                                             default, witness deliberately
                                             excluded, no legacy
                                             party_role enum reuse).
                                             attorney_name/contact_info
                                             nullable free text. No
                                             uniqueness on (docket_matter_id,
                                             full_name[, role]) — names
                                             are not identifiers.
                                             party_status (constrained
                                             text: active/
                                             entered_in_error), no hard
                                             DELETE ever, not tied to
                                             parent matter status.
                                             Corrections to all editable
                                             fields remain ordinary
                                             UPDATEs (no full ledger).
                                             created_by (ON DELETE
                                             RESTRICT) / last_updated_by
                                             (ON DELETE SET NULL) match
                                             docket_matters/docket_events
                                             exactly. RLS SELECT/INSERT/
                                             UPDATE inherit the parent's
                                             two-path predicate; no
                                             DELETE policy; no admin
                                             bypass. Legacy cases/
                                             case_parties/party_role
                                             enum untouched.
0026_docket_matter_tags.sql               — prepared for review (not yet
                                             applied). Institutional Docket
                                             tags only — a dedicated direct
                                             child table of docket_matters,
                                             NOT a join to the existing
                                             global tags table (which
                                             remains untouched, along with
                                             case_tags/bench_note_tags/
                                             case_law_tags/statute_tags).
                                             docket_matter_id not null,
                                             references docket_matters(id)
                                             on delete restrict, no
                                             court_id/district_id
                                             duplication. tag_name free-
                                             form text, no enum, must not
                                             be blank after trimming,
                                             case-insensitive/whitespace-
                                             trimmed uniqueness enforced
                                             per matter only (not global)
                                             via an expression unique
                                             index on (docket_matter_id,
                                             lower(btrim(tag_name))).
                                             created_by (ON DELETE
                                             RESTRICT, provenance only,
                                             forced to auth.uid() at
                                             creation by a guard trigger)
                                             — no last_updated_by, no
                                             updated_at. Lifecycle is
                                             INSERT/DELETE only (a
                                             deliberate, explicit
                                             exception to the no-hard-
                                             delete rule used elsewhere in
                                             the Court-Anchored Docket) —
                                             no tag_status, no
                                             entered_in_error, no ended-at
                                             state, no UPDATE policy.
                                             Access (SELECT/INSERT/DELETE)
                                             inherits the parent matter's
                                             two-path predicate
                                             (can_access_court()/
                                             has_retained_assignment());
                                             no admin bypass; not yet the
                                             shares path. A separate,
                                             private, user-owned personal-
                                             label feature is explicitly
                                             deferred, not built here.
0027_judgments.sql                        — prepared for review (not yet
                                             applied). Individually owned
                                             Judgment records — NEVER
                                             Court-owned, ownership never
                                             transfers on Court
                                             departure. owner_id not
                                             null, references
                                             profiles(id) on delete
                                             restrict, forced to
                                             auth.uid() at creation by a
                                             guard trigger and
                                             immutable thereafter (no
                                             ownership transfer via
                                             UPDATE). title not null;
                                             case_number/court_name/
                                             judgment_date/citation all
                                             optional, no uniqueness
                                             imposed, court_name
                                             deliberately not FK'd to
                                             courts. content jsonb +
                                             content_text text, both
                                             nullable, no auto-
                                             derivation between them, no
                                             editor/search
                                             infrastructure built.
                                             is_discoverable boolean not
                                             null default false —
                                             owner-controlled,
                                             read-only to other
                                             magistrates when true,
                                             never grants edit. RLS:
                                             SELECT owner OR
                                             is_discoverable; INSERT/
                                             UPDATE/DELETE owner-only;
                                             no is_admin() bypass; no
                                             reference to
                                             can_access_court()/
                                             has_retained_assignment()/
                                             my_court_id() anywhere —
                                             Judgment access is fully
                                             independent from Docket/
                                             Court access. Owner-only
                                             DELETE is explicitly
                                             provisional pending the
                                             later judgment_lifecycle_
                                             locking migration. No
                                             judgment_tags,
                                             docket_matter_judgments,
                                             attachments, sharing, or
                                             finalization/locking built
                                             in this migration.
0028_judgment_tags.sql                    — prepared for review (not yet
                                             applied). Judgment-specific
                                             tags only — a dedicated
                                             direct child table of
                                             judgments, NOT a join to
                                             the existing global tags
                                             table (which remains
                                             untouched, along with
                                             case_tags/bench_note_tags/
                                             case_law_tags/statute_tags/
                                             docket_matter_tags).
                                             judgment_id not null,
                                             references judgments(id)
                                             ON DELETE CASCADE
                                             (deliberately the opposite
                                             of the Docket's RESTRICT
                                             convention -- tag rows are
                                             purely organizational and
                                             are removed automatically
                                             if the owner deletes the
                                             still-provisionally-
                                             deletable Judgment).
                                             tag_name free-form text,
                                             no enum, must not be blank
                                             after trimming, stored
                                             trimmed, casing preserved,
                                             case-insensitive/trimmed
                                             uniqueness enforced per
                                             Judgment only (not global)
                                             via an expression unique
                                             index. created_by (ON
                                             DELETE RESTRICT,
                                             provenance only, forced to
                                             auth.uid() at creation by a
                                             guard trigger) -- no
                                             last_updated_by, no
                                             updated_at. Lifecycle is
                                             INSERT/DELETE only, no
                                             UPDATE policy, no
                                             tag_status/entered_in_error/
                                             ended-at state. SELECT
                                             inherits the parent
                                             Judgment's own access model
                                             (owner OR is_discoverable);
                                             INSERT/DELETE are owner-
                                             only even for discoverable
                                             readers. No reference to
                                             can_access_court()/
                                             has_retained_assignment()/
                                             docket_matter_judgments
                                             anywhere -- fully
                                             independent from Docket/
                                             Court access. No admin
                                             bypass. Not yet the shares
                                             path.
0029_docket_matter_judgments.sql          — prepared for review (not
                                             yet applied). Association-
                                             only join table between
                                             docket_matters and
                                             judgments. docket_matter_id
                                             not null, references
                                             docket_matters(id) on
                                             delete restrict (Docket
                                             judicial-history
                                             convention); judgment_id
                                             not null, references
                                             judgments(id) on delete
                                             cascade (matches
                                             judgment_tags -- link rows
                                             disappear automatically if
                                             the still-provisionally-
                                             deletable Judgment is
                                             lawfully deleted).
                                             unique(docket_matter_id,
                                             judgment_id) prevents
                                             duplicate associations; no
                                             uniqueness on either FK
                                             individually -- genuinely
                                             many-to-many. created_by
                                             (ON DELETE RESTRICT,
                                             provenance only, forced by
                                             a guard trigger, never
                                             access control) -- no
                                             last_updated_by/updated_at.
                                             No status, notes,
                                             court_id/district_id,
                                             owner_id, or denormalized
                                             Judgment/Docket descriptive
                                             fields -- the join row
                                             carries only identifiers
                                             and provenance. SELECT
                                             requires independent
                                             lawful access to BOTH the
                                             Docket Matter
                                             (can_access_court()/
                                             has_retained_assignment())
                                             AND the Judgment
                                             (owner_id OR
                                             is_discoverable) -- AND,
                                             never OR, closing the
                                             join-row-as-side-channel
                                             gap. INSERT/DELETE require
                                             Docket access AND Judgment
                                             OWNERSHIP specifically
                                             (is_discoverable alone is
                                             never sufficient to create
                                             or remove a link) -- DELETE
                                             uses the identical
                                             authority as INSERT, not
                                             merely whoever created the
                                             row. No UPDATE policy. No
                                             admin bypass. Not yet the
                                             shares path -- the
                                             BOTH-sides principle is
                                             recorded for when shares
                                             exists on both sides;
                                             share-based mutation
                                             authority is left an
                                             explicit future decision.
0030_docket_matter_case_law.sql            — APPLIED and fully verified
                                             (27-scenario rollback-only
                                             battery): the Docket↔Case-Law
                                             association table, association
                                             only, BOTH-sides SELECT (Docket
                                             access AND Case-Law read
                                             access, never OR); INSERT/
                                             DELETE require Docket access
                                             AND Case-Law READ access only
                                             (NOT ownership -- deliberate,
                                             explicit difference from
                                             docket_matter_judgments, since
                                             Case Law is reusable reference
                                             authority); docket_matter_id
                                             ON DELETE RESTRICT, case_law_id
                                             ALSO ON DELETE RESTRICT
                                             (deliberately not CASCADE --
                                             canonical/admin-curated
                                             material, rare/deliberate
                                             DELETE, unlike a still-
                                             provisional owner-deletable
                                             Judgment); created_by
                                             provenance-only, never DELETE
                                             authority; no UPDATE policy; no
                                             admin bypass; built against the
                                             CURRENT legacy case_law model
                                             (globally readable, no owner_id/
                                             is_discoverable) via a live
                                             existence check rather than a
                                             duplicated predicate, so it
                                             automatically respects the
                                             future case_law personal/
                                             canonical refactor (0035)
                                             without requiring 0030 to
                                             change -- see §5/§14.
0031_quick_codes.sql                       — APPLIED and fully verified
                                             (25-scenario rollback-only
                                             battery): individually owned,
                                             fully private text-expansion/
                                             snippet records (code_word,
                                             title, content, description);
                                             owner_id immutable, forced/
                                             locked by a guard trigger,
                                             ON DELETE RESTRICT; SELECT/
                                             INSERT/UPDATE/DELETE all
                                             owner-only, no exceptions --
                                             no Court/Docket access, no
                                             is_discoverable, no admin
                                             bypass; code_word uniqueness
                                             case-insensitive/trimmed and
                                             scoped PER OWNER via an
                                             expression unique index; plain
                                             text content (no JSONB/editor
                                             schema yet); owner hard DELETE
                                             approved (personal productivity
                                             data, not judicial history); no
                                             search_vector (deferred to
                                             0047_search_extensions, was
                                             0046, was 0045, was 0044 before
                                             the 0039 repair, the 0041/0042
                                             Bookmark-split, and the 0046
                                             judgment-lifecycle-search-path
                                             repair renumberings — see §16); no
                                             quick_code_docket_matters/
                                             quick_code_judgments/
                                             quick_code_case_law join tables
                                             built here -- see §7/§14.
0032_quick_code_docket_matters.sql          — APPLIED and fully verified
                                             (25-scenario rollback-only
                                             battery): the Quick Code↔
                                             Docket Matter association
                                             table, association only, BOTH-
                                             sides SELECT (Docket access AND
                                             Quick Code ownership, never OR
                                             -- Quick Code access collapses
                                             to owner_id = auth.uid() since
                                             there is no discoverability
                                             tier); INSERT/DELETE require
                                             the identical Docket-access-
                                             AND-ownership predicate;
                                             quick_code_id ON DELETE CASCADE
                                             (Quick Code owner hard DELETE
                                             already approved in 0031;
                                             CASCADE is referential cleanup
                                             of the owner's own record, not
                                             an RLS unlink, so it applies
                                             even if the owner has since
                                             lost Docket access);
                                             docket_matter_id ON DELETE
                                             RESTRICT; created_by
                                             provenance-only; no UPDATE
                                             policy; no admin bypass; no
                                             descriptive metadata on the
                                             join row — see §7/§14.
0033_quick_code_judgments.sql               — APPLIED and fully verified
                                             (rollback-only battery
                                             covering all six ownership/
                                             Judgment-access combinations,
                                             the 10-step discoverability-
                                             transition sequence, both
                                             CASCADE-independence proofs,
                                             and side-channel protection):
                                             the Quick Code↔
                                             Judgment association table,
                                             association only, BOTH-sides
                                             SELECT (QuickCodeOwnership AND
                                             JudgmentReadAccess, never OR);
                                             INSERT/DELETE require the
                                             identical predicate --
                                             deliberately Judgment READ
                                             access only, not ownership
                                             (unlike quick_code_docket_
                                             matters/docket_matter_
                                             judgments), since the Quick
                                             Code is the linking user's own
                                             private metadata; BOTH
                                             quick_code_id and judgment_id
                                             ON DELETE CASCADE (Judgment
                                             owner DELETE remains
                                             provisional pre-lifecycle-
                                             locking; these are personal
                                             organizational links, not
                                             judicial history); visibility
                                             follows Judgment
                                             discoverability dynamically
                                             without ever touching the
                                             association row; created_by
                                             provenance-only; no UPDATE
                                             policy; no admin bypass — see
                                             §7/§14.
0034_quick_code_case_law.sql                — APPLIED and fully verified
                                             (22-scenario rollback-only
                                             battery, zero test-authoring
                                             artifacts): the Quick Code↔
                                             Case-Law association table,
                                             reusing the exact nested-RLS
                                             design approved for
                                             docket_matter_case_law (0030)
                                             unmodified for the Case-Law
                                             side; BOTH-sides SELECT
                                             (QuickCodeOwnership AND
                                             CaseLawReadAccess, never OR);
                                             INSERT/DELETE require the
                                             identical predicate --
                                             deliberately Case-Law READ
                                             access only, not ownership/
                                             authorship (mirrors 0030's
                                             docket_matter_case_law
                                             rationale and 0033's Quick-
                                             Code-is-the-private-metadata
                                             rationale); quick_code_id ON
                                             DELETE CASCADE, case_law_id ON
                                             DELETE RESTRICT (matching
                                             0030, deliberately not
                                             CASCADE -- canonical/admin-
                                             curated material); created_by
                                             provenance-only; no UPDATE
                                             policy; no admin bypass; no
                                             can_view_case_law() helper
                                             created; built against the
                                             current legacy case_law model
                                             via the same live existence
                                             check as 0030, so it will
                                             automatically respect the
                                             future case_law personal/
                                             canonical refactor (0035) --
                                             0035 must regression-test
                                             this table alongside
                                             docket_matter_case_law -- see
                                             §5/§7/§14.
0035_case_law_personal_research.sql         — prepared for review (not yet
                                             applied): refactors the live
                                             single-tier case_law table
                                             into a canonical/personal
                                             dual model via nullable
                                             owner_id, in the SAME table
                                             (no split); owner_id IS NULL
                                             = canonical (admin-curated,
                                             globally readable, admin-
                                             only write, unchanged
                                             behavior); owner_id IS NOT
                                             NULL = personal research,
                                             private by default with an
                                             owner-controlled
                                             is_discoverable read-only
                                             extension mirroring
                                             judgments (0027); ownership
                                             immutable after creation via
                                             case_law_ownership_guard();
                                             no admin bypass into
                                             personal rows; citation
                                             uniqueness rescoped to
                                             canonical rows only via a
                                             partial unique index,
                                             replacing the old global
                                             unique index; new owner_id
                                             and discoverable-decided-
                                             date partial indexes added;
                                             search_case_law() and
                                             search_vector confirmed to
                                             require no change (verified
                                             SECURITY INVOKER / generated
                                             column respectively);
                                             case_law_tags confirmed to
                                             require no change (no
                                             ordinary-user INSERT path
                                             exists into it); created_by
                                             left untouched; production
                                             case_law confirmed empty, no
                                             backfill required;
                                             docket_matter_case_law
                                             (0030) and quick_code_
                                             case_law (0034) are NOT
                                             modified -- their nested-RLS
                                             design automatically
                                             inherits this new predicate,
                                             which must be regression-
                                             tested the next time either
                                             table is verified -- see
                                             §5/§14.
0036_case_law_annotations.sql               — prepared for review (not yet
                                             applied): private personal
                                             research notes, one owner
                                             per row, attached to one
                                             Case Law record (canonical
                                             or personal, own or
                                             another's discoverable);
                                             reuses the 0030/0034
                                             nested-RLS pattern
                                             unmodified (AnnotationOwner-
                                             ship AND CaseLawReadAccess);
                                             case_law_id ON DELETE
                                             CASCADE (deliberately unlike
                                             the 0030/0034 RESTRICT
                                             association model --
                                             annotations are subordinate
                                             notes, not citations);
                                             owner_id ON DELETE RESTRICT;
                                             owner_id forced/locked by a
                                             guard trigger; multiple
                                             annotations per owner per
                                             record allowed (no
                                             uniqueness); no admin
                                             bypass; the parent Case
                                             Law's own owner_id is never
                                             referenced, so owning the
                                             annotated record confers no
                                             annotation visibility; no
                                             title/discoverability/
                                             sharing/tags/search_vector
                                             -- see §5/§14.
0037_shares.sql                           — APPLIED and fully verified
                                             (75-scenario rollback-only
                                             battery; see status line
                                             above for the full summary).
                                             recipient_id effectively
                                             NOT NULL (RLS-enforced,
                                             nullable at schema level only
                                             for the offboarding SET NULL
                                             action — mirrors
                                             docket_matter_assignments
                                             exactly). Creating-RLS check
                                             for docket_matter shares is
                                             can_access_court()/
                                             has_retained_assignment(), not
                                             owner_id (docket_matters has
                                             none) — a genuine, confirmed
                                             difference from the future
                                             judgment/case_law shares
                                             design. Extends Docket
                                             SELECT/UPDATE RLS to add the
                                             shares path, completing the
                                             three-path predicate first
                                             described in 0020.
                                             DELIBERATE SCOPE BOUNDARY:
                                             item_type is CHECK-constrained
                                             to 'docket_matter' only in
                                             this migration — a genuine FK
                                             on item_id, not a polymorphic
                                             one — because this codebase
                                             has no precedent yet for
                                             polymorphic existence
                                             validation (documents/
                                             bookmarks are still on the
                                             legacy per-column-FK design;
                                             their own refactor is 0039)
                                             and because creating a
                                             judgment/case_law share row
                                             that judgments'/case_law's
                                             own RLS does not yet consult
                                             would be exactly the "fake
                                             completeness" placeholder
                                             this project has rejected
                                             everywhere else. Widening to
                                             'judgment'/'case_law' is
                                             explicit, disclosed future
                                             work requiring its own
                                             migration. Also NOT extended
                                             in 0037: docket_events,
                                             docket_matter_parties,
                                             docket_matter_tags,
                                             docket_matter_judgments,
                                             docket_matter_case_law — all
                                             five inline their own
                                             Docket-side predicate rather
                                             than nesting against
                                             docket_matters, so none
                                             auto-inherit this widening;
                                             each needs its own future
                                             ALTER POLICY. permission is
                                             constrained text, 'view'
                                             (SELECT only) or 'edit' (full
                                             blanket UPDATE, matching the
                                             other two paths — no
                                             column-level restriction
                                             exists anywhere in Docket
                                             RLS). No resharing (default
                                             NO). Revocation authority =
                                             any current lawful
                                             Docket-access holder
                                             (identical to creation
                                             authority, never merely
                                             "whoever granted it") OR the
                                             recipient relinquishing their
                                             own share. Soft-revocation
                                             only via revoked_at (no
                                             DELETE policy), mirroring
                                             docket_matter_assignments.
                                             ended_at exactly — preserves
                                             audit history. At most one
                                             ACTIVE share per (item_type,
                                             item_id, recipient_id), via a
                                             partial unique index
                                             mirroring
                                             docket_matter_assignments_
                                             current_pair_idx. shares'
                                             own SELECT is granter-or-
                                             recipient only (narrowest
                                             default; whether ordinary
                                             Docket-access holders should
                                             also see shares on their own
                                             matter is an explicit,
                                             disclosed open UX question,
                                             not a blocker). No admin
                                             bypass anywhere. No
                                             can_view_docket_matter()/
                                             can_edit_docket_matter()
                                             helper introduced — reserved
                                             for the dedicated, later
                                             0044_ownership_rls_helpers.sql
                                             (was 0043, was 0042 before the
                                             0039 repair and 0041/0042
                                             Bookmark-split renumberings —
                                             see §16).
                                             See §3/§14/§17.
0038_bench_notes_polymorphic_parent.sql   — APPLIED, but a genuine
                                             defect was found in the
                                             35/36-scenario rollback-only
                                             verification battery and is
                                             NOT yet fixed live: the
                                             bench_notes_entity_guard()
                                             trigger re-validates
                                             entity_id existence on
                                             EVERY UPDATE, not only when
                                             entity_type/entity_id
                                             actually change -- so once
                                             a note's parent is
                                             hard-deleted, the author
                                             can still SELECT the note
                                             (correct) but can no longer
                                             UPDATE even an unrelated
                                             field such as title,
                                             because the trigger
                                             re-checks the now-gone
                                             parent and raises on every
                                             UPDATE. This contradicts
                                             the resolved "Bench Notes
                                             survive deletion of their
                                             referenced parent" decision
                                             -- survival was intended to
                                             mean continued full
                                             usability, not read-only
                                             freezing. A corrected
                                             trigger (skip the existence
                                             check unless entity_type or
                                             entity_id is actually
                                             changing, or on INSERT) has
                                             been proposed for review
                                             but NOT applied. Every
                                             other verified behavior
                                             passed: entity-type matrix
                                             (all three approved types
                                             succeed against a real row,
                                             fail against a nonexistent
                                             UUID; fabricated types
                                             rejected by the CHECK
                                             constraint before the
                                             trigger runs), the critical
                                             parent-access-independence
                                             proof (an author can
                                             reference and later read a
                                             Bench Note pointing at a
                                             parent -- Docket Matter,
                                             Judgment, or Case Law --
                                             they cannot themselves
                                             SELECT under that parent's
                                             own RLS, proving the
                                             SECURITY DEFINER validator
                                             performs existence
                                             validation only, never
                                             access grant), full
                                             author-only RLS (owner
                                             SELECT/INSERT/UPDATE/DELETE;
                                             another user and a
                                             disposable Admin profile
                                             both fully blocked;
                                             is_private proven to have
                                             zero effect on visibility
                                             in either state), parent-
                                             access-transition survival
                                             (losing Court access after
                                             the note was created does
                                             not hide or freeze it), and
                                             the entity_id/entity_type
                                             pair itself surviving a
                                             parent's hard deletion
                                             unchanged. See the 0038
                                             verification report for the
                                             full battery and the
                                             proposed fix. Next-migration
                                             work is deliberately paused
                                             pending resolution of this
                                             defect, per this project's
                                             standing gate rule. Implements §8
                                             exactly: converts case_id
                                             (-> legacy `cases`) to
                                             entity_type/entity_id
                                             (docket_matter | judgment |
                                             case_law), and corrects
                                             live RLS to the resolved
                                             author_id = auth.uid()-only
                                             model with no admin clause
                                             and no parent-access
                                             cascade (the live policies
                                             predate this and still had
                                             an is_admin() bypass on
                                             UPDATE/DELETE and an
                                             is_private-gated Court-mate
                                             SELECT path -- both
                                             removed). entity_id has no
                                             declarative FK (impossible
                                             across three target
                                             tables); existence is
                                             enforced by a new
                                             SECURITY DEFINER guard
                                             trigger, bench_notes_-
                                             entity_guard() --
                                             deliberately SECURITY
                                             DEFINER (unlike the
                                             existing SECURITY INVOKER
                                             bookmarks precedent,
                                             validate_bookmark_entity())
                                             because a note may
                                             legitimately reference a
                                             parent the author cannot
                                             currently see, and an
                                             INVOKER check would be
                                             silently filtered by the
                                             parent's own RLS --
                                             reintroducing the very
                                             parent-access cascade §8
                                             rules out. Two existing
                                             functions required
                                             consequential fixes to
                                             avoid a live break:
                                             user_can_access_bench_note()
                                             (simplified to the
                                             resolved model; same
                                             signature, every existing
                                             caller unaffected) and
                                             search_bench_notes()
                                             (case_id column replaced
                                             with entity_type/entity_id
                                             in its return shape).
                                             is_private is left in
                                             place but becomes fully
                                             inert for access control.
                                             The entity_id-orphan-on-
                                             parent-hard-delete
                                             possibility (no FK means
                                             no ON DELETE behavior) is
                                             disclosed as an open
                                             product question, not
                                             resolved here. Zero live
                                             rows in bench_notes/cases
                                             today, so no data
                                             migration risk. See §8/§16.
0039_fix_bench_notes_entity_guard.sql      — NEW, inserted forward-
                                             reconciliation repair, not
                                             part of the original
                                             planned sequence. Corrects
                                             a genuine defect found
                                             during 0038 verification:
                                             bench_notes_entity_guard()
                                             re-validated parent
                                             existence on every UPDATE
                                             instead of only on INSERT
                                             or when entity_type/
                                             entity_id actually change,
                                             which incorrectly blocked
                                             ordinary edits to a Bench
                                             Note whose parent had since
                                             been lawfully deleted. Does
                                             NOT edit 0038 (applied
                                             migrations are immutable);
                                             replaces only the one
                                             function. See §8/§16 for
                                             the corrected reference-
                                             validation-timing and
                                             unresolved-reference rules
                                             this repair establishes as
                                             authoritative. Inserting
                                             this repair shifted every
                                             originally-planned
                                             migration from here onward
                                             by one number (all were
                                             still unapplied/planning-
                                             only, so this costs
                                             nothing — see §16 closing
                                             note).
0040_documents_polymorphic_refactor.sql    (was 0039) — PREPARED,
                                             PASSED PRE-APPLICATION
                                             REVIEW (Parts A–I),
                                             ABOUT TO BE APPLIED.
                                             Converts `documents` from
                                             its legacy `case_id`/
                                             `bench_note_id` two-
                                             nullable-FK shape to a true
                                             polymorphic parent
                                             (`entity_type`/`entity_id`)
                                             across six approved types:
                                             `docket_matter`, `judgment`,
                                             `case_law`, `quick_code`,
                                             `bench_note`, `case`
                                             (legacy). No declarative FK
                                             is possible across six
                                             target tables (same
                                             constraint as bench_notes,
                                             0038). Zero live rows in
                                             `documents`/
                                             `storage.objects`
                                             (bucket_id='documents')
                                             today — pure schema change,
                                             no backfill, no orphan
                                             risk.

                                             ACCESS MODEL — deliberately
                                             the OPPOSITE trigger-
                                             security strategy from
                                             bench_notes (0038/0039):
                                             a Document's access must
                                             genuinely follow/degrade
                                             with its parent's own real
                                             RLS (§3), so SELECT uses a
                                             plain, `SECURITY INVOKER`
                                             nested `EXISTS` per type —
                                             the "plain nested-RLS
                                             pattern" already used for
                                             `docket_matter_judgments`'
                                             Judgment side (0029) and
                                             Case-Law associations
                                             (0030/0034) — evaluated
                                             under the caller's own
                                             session, auto-inheriting
                                             each parent table's current
                                             AND future RLS with no
                                             additional maintenance. No
                                             `SECURITY DEFINER` existence
                                             validator of any kind is
                                             used for reads (unlike
                                             bench_notes' guard trigger,
                                             which exists specifically
                                             because Bench Notes must
                                             NOT inherit parent
                                             visibility — the opposite
                                             requirement).

                                             READ vs WRITE ARE NOT THE
                                             SAME CHECK (new distinction,
                                             not previously required by
                                             any prior migration in this
                                             project): parent
                                             READ/visibility access does
                                             NOT imply permission to
                                             attach a Document. INSERT
                                             dispatches on each parent's
                                             own separate, narrower
                                             mutation-authority
                                             predicate instead —
                                             Docket Matter: its UPDATE
                                             policy (`can_access_court`
                                             OR `has_retained_assignment`
                                             OR `has_docket_share(...,
                                             'edit')`), NOT its SELECT
                                             policy (which additionally
                                             allows a view-only Docket
                                             Share); Judgment: owner-
                                             only, NOT its SELECT
                                             policy's additional
                                             `is_discoverable` reader
                                             path; Case Law: its own
                                             INSERT/UPDATE ownership
                                             rule (`owner_id IS NULL AND
                                             is_admin()` OR
                                             `owner_id = auth.uid()`),
                                             NOT its SELECT policy's
                                             additional canonical-
                                             everyone/discoverable-
                                             reader paths; Quick Code and
                                             Bench Note: owner/author-
                                             only, identical to their
                                             SELECT policies (no
                                             discoverability tier
                                             exists for either); legacy
                                             `case`: its own UPDATE
                                             policy (`is_admin() OR
                                             court_id = my_court_id()`),
                                             written out explicitly
                                             rather than delegated, even
                                             though it is textually
                                             identical to `cases`'
                                             SELECT policy today, so it
                                             will not silently start
                                             tracking a future, broader
                                             `cases` SELECT policy. These
                                             WRITE branches are
                                             therefore "decorated
                                             EXISTS" (duplicated
                                             predicate, matching 0037's
                                             `docket_events`/
                                             `docket_matter_parties`/
                                             `docket_matter_tags`
                                             precedent) rather than
                                             plain nested EXISTS — they
                                             will NOT auto-inherit a
                                             future change to any
                                             parent's own mutation-
                                             authority policy; a matching
                                             forward-reconciliation
                                             migration will be required
                                             if one of those six policies
                                             ever changes.

                                             STANDALONE DOCUMENTS
                                             (`entity_type`/`entity_id`
                                             both NULL) are explicitly
                                             preserved from the original
                                             design — a pair-consistency
                                             CHECK enforces both-null-or-
                                             both-set. Access for a
                                             standalone Document already
                                             collapses to uploader-only
                                             under the unmodified
                                             `uploaded_by = auth.uid()`
                                             SELECT/INSERT branches; no
                                             new special-case logic was
                                             needed or added.

                                             PARENT-DELETION LIFECYCLE —
                                             resolved by explicit user
                                             decision after this
                                             migration's dependency
                                             inventory (Part A)
                                             discovered that
                                             `documents_case_id_fkey`/
                                             `documents_bench_note_id_-
                                             fkey` are, today, `ON DELETE
                                             CASCADE` (not plain FKs).
                                             Unlike Bench Notes — whose
                                             polymorphic parent reference
                                             is independent work product
                                             that deliberately SURVIVES
                                             deletion of its referenced
                                             parent (0038/0039, §8) — a
                                             Document is an attachment,
                                             not independent work
                                             product: its metadata row
                                             follows its parent's
                                             lifecycle and must be
                                             deleted when its parent is
                                             deleted, for all six
                                             approved types (extending
                                             the two that already had
                                             real-FK CASCADE to the four
                                             that never had a parent
                                             column of their own before
                                             this migration). Because
                                             `entity_id` cannot carry a
                                             declarative FK across six
                                             target tables, this is
                                             reproduced with a single
                                             reusable `SECURITY DEFINER`
                                             `AFTER DELETE` trigger
                                             function
                                             (`documents_parent_cascade_-
                                             delete()`), installed
                                             identically on all six
                                             parent tables, using an
                                             explicit hardcoded
                                             `TG_TABLE_NAME` →
                                             `entity_type` `CASE`
                                             mapping (no dynamic SQL) and
                                             deleting only rows matching
                                             an exact
                                             `(entity_type, entity_id)`
                                             pair — guaranteeing cross-
                                             type UUID isolation (a
                                             `judgment` row can never
                                             delete a `docket_matter`-
                                             typed Document that happens
                                             to share the same UUID).
                                             `SECURITY DEFINER` here is
                                             for a different reason than
                                             bench_notes_entity_guard():
                                             not to bypass a parent's
                                             visibility RLS, but so that
                                             cleanup does not depend on
                                             the deleting user separately
                                             satisfying `documents`' own
                                             DELETE RLS (`is_admin() OR
                                             uploaded_by = auth.uid()`) —
                                             a Docket Matter, for
                                             example, can have Documents
                                             attached by several
                                             different Court-mates or
                                             Docket Share collaborators,
                                             all of whom must be cleaned
                                             up regardless of which
                                             single user deletes the
                                             Docket Matter. Storage blobs
                                             are explicitly NOT deleted
                                             by this migration — they
                                             already survive parent/
                                             document-row deletion today
                                             (no existing trigger removes
                                             them either) — physical blob
                                             cleanup is deferred to
                                             `0047_storage_policy_-
                                             updates.sql`.

                                             REQUIRED CONSEQUENTIAL FIX:
                                             `storage.objects`' own
                                             SELECT policy ("Users can
                                             read documents they have
                                             access to") read
                                             `documents.case_id`/
                                             `documents.bench_note_id`
                                             directly, inline — rewritten
                                             using the same six-branch
                                             READ-level nested-EXISTS
                                             dispatch as `documents`' own
                                             SELECT policy (confirmed NOT
                                             broader than it). A genuine
                                             DDL dependency was also
                                             discovered here (not merely
                                             a latent function-body
                                             reference, unlike the
                                             0038/0039 case): Postgres
                                             tracks a real dependency
                                             from a policy's USING/WITH
                                             CHECK expression onto every
                                             column it names, so
                                             `ALTER TABLE ... DROP COLUMN
                                             case_id` failed outright
                                             until this `storage.objects`
                                             policy (and the two
                                             `documents` policies) were
                                             dropped first — confirmed
                                             live via the mandatory
                                             rollback-only DDL pre-test
                                             (Part I), run twice
                                             (structural + verbatim
                                             identifier/comment check)
                                             against the final file,
                                             both clean. `user_can_-
                                             access_case()`/`user_can_-
                                             access_bench_note()` are NOT
                                             modified — still needed by
                                             `bench_note_tags`/
                                             `comments`/other case-scoped
                                             policies; this migration
                                             simply stops calling them
                                             from `documents`/
                                             `storage.objects` in favor
                                             of direct nested EXISTS.
                                             `audit_documents` (a generic
                                             `to_jsonb`-based
                                             `audit_trigger_fn()`
                                             trigger with no hardcoded
                                             column references) requires
                                             no change. No FKs anywhere
                                             else in the schema point at
                                             `documents`. See §3/§8/§16.
0041_extend_bookmark_entity_type.sql       — APPLIED and fully verified.
                                             Part 1 of 2 of the Bookmark
                                             entity-type extension (was a
                                             single 0041_bookmark_entity_-
                                             extension.sql; split into two
                                             migrations after live
                                             investigation, see below).
                                             Adds three values to the
                                             bookmark_entity_type enum:
                                             docket_matter, judgment,
                                             quick_code. Does ONLY the
                                             ALTER TYPE -- no reference to
                                             the new values anywhere in
                                             this file. Confirmed live via
                                             a rollback-only probe against
                                             the REAL (pre-existing since
                                             0008) bookmark_entity_type,
                                             NOT a same-transaction
                                             disposable enum (which
                                             misleadingly suggested a
                                             single migration would be
                                             safe): a plain equality
                                             comparison, a function
                                             execution, and a table INSERT
                                             all raised "unsafe use of new
                                             value of enum type" when
                                             attempted in the same
                                             transaction as the ALTER TYPE
                                             against the real, pre-
                                             existing type -- only bare
                                             plpgsql function *compilation*
                                             (never executed) succeeded in
                                             the same transaction. This is
                                             the documented Postgres
                                             restriction (a value added to
                                             a type that predates the
                                             current transaction cannot be
                                             used for comparison until
                                             commit); it does not apply to
                                             a type that is itself new in
                                             the same transaction, which is
                                             why the disposable-enum probe
                                             was not representative and had
                                             to be re-tested directly
                                             against the real type before
                                             finalizing migration shape.
                                             PostgreSQL has no ALTER TYPE
                                             ... DROP VALUE -- this is a
                                             disclosed, permanent, one-way
                                             schema change (purely additive
                                             and backward-compatible;
                                             bookmarks had zero live rows).
                                             See §16 closing note for the
                                             resulting +1 renumbering of
                                             every later planned migration.
0042_bookmark_entity_validation_extension.sql — APPLIED and fully
                                             verified. Part 2 of 2,
                                             applied as its own migration/
                                             transaction after 0041
                                             committed (required, per the
                                             finding above). Rewrites
                                             validate_bookmark_entity()
                                             with three new branches:
                                             docket_matter -> docket_-
                                             matters, judgment ->
                                             judgments, quick_code ->
                                             quick_codes, each a plain
                                             SECURITY-INVOKER nested EXISTS
                                             against the parent table
                                             itself (same principle as the
                                             plain nested-RLS pattern used
                                             throughout this project),
                                             auto-inheriting that table's
                                             own current SELECT RLS with no
                                             duplicated predicate -- docket_
                                             matter therefore automatically
                                             gets the full post-0037 three-
                                             path envelope (Court
                                             assignment, retained
                                             assignment, active Docket
                                             view/edit share) for free.
                                             SECURITY INVOKER deliberately
                                             preserved (this function
                                             predates 0038 and was already
                                             INVOKER) -- the opposite
                                             principle from bench_notes_-
                                             entity_guard(): a Bookmark may
                                             only be created against an
                                             entity the caller can
                                             currently, lawfully read; the
                                             check must never bypass parent
                                             RLS. The four original
                                             branches (case, bench_note,
                                             statute, case_law) are
                                             preserved byte-for-byte -- no
                                             modernization. `document`
                                             (0040's polymorphic Documents)
                                             is deliberately EXCLUDED from
                                             the seven approved types --
                                             Documents are subordinate
                                             attachments whose access
                                             follows their parent, and
                                             whether to allow bookmarking
                                             the attachment itself vs. only
                                             its parent record is an
                                             unresolved product question,
                                             not decided here. Also
                                             excluded: case_law_annotation,
                                             docket_event, docket_matter_-
                                             party, tag, association/join
                                             rows, share. No new RLS
                                             policies (bookmarks' three
                                             owner-only policies never
                                             reference entity_type by
                                             value); still no UPDATE policy
                                             on bookmarks (confirmed live,
                                             unchanged) so the function's
                                             unconditional (no reference-
                                             changed guard) revalidation on
                                             BEFORE INSERT OR UPDATE --
                                             structurally similar in shape
                                             to the bug fixed in 0039 for
                                             bench_notes -- was found to be
                                             dormant, not live: with no
                                             UPDATE policy, no UPDATE ever
                                             reaches this trigger for any
                                             of the seven types, old or
                                             new, so it was preserved
                                             unmodified rather than
                                             "fixed" (nothing to fix that
                                             is actually reachable). No
                                             six/seven parent-delete
                                             cleanup triggers added --
                                             bookmarks has no FK to any of
                                             the seven parent tables and no
                                             cleanup trigger existed for
                                             any of the four live types
                                             before this migration
                                             (confirmed live); a Bookmark
                                             already survives deletion of
                                             its referenced parent as
                                             dangling, owner-visible
                                             metadata, and this migration
                                             extends that same behavior to
                                             the three new types rather
                                             than building new cleanup
                                             machinery nothing in the
                                             architecture requires.
                                             Bookmark SELECT already
                                             depends only on ownership
                                             (`user_id = auth.uid()`),
                                             never on the parent's
                                             continued existence or
                                             accessibility, for all seven
                                             types -- confirmed live via a
                                             dedicated lifecycle test (a
                                             Bookmark created while a
                                             Judgment was discoverable
                                             remained fully visible to its
                                             owner after the Judgment went
                                             private again, while the
                                             Judgment itself correctly
                                             remained inaccessible to that
                                             same user -- proving Bookmark
                                             possession never restores or
                                             leaks parent access). A
                                             30-scenario rollback-only
                                             behavioral battery (six-type
                                             matrix including Court/
                                             retained/view-share/edit-
                                             share/revoked-share/no-access/
                                             admin-no-bypass paths for
                                             Docket Matter, owner/
                                             discoverable/private for
                                             Judgment, owner/non-owner/
                                             admin-no-bypass for Quick
                                             Code, full regression of all
                                             four original types, side-
                                             channel isolation, and both
                                             unsupported-type rejections)
                                             passed 100%. One new advisory
                                             finding: validate_bookmark_-
                                             entity() lacks an explicit
                                             `SET search_path` pin
                                             (function_search_path_mutable,
                                             WARN) -- a lower-severity
                                             concern for a SECURITY INVOKER
                                             function than for a DEFINER
                                             one, preserved from the
                                             function's pre-existing shape
                                             (it never had one) rather than
                                             introduced, not auto-fixed,
                                             flagged as a candidate for a
                                             future dedicated hardening
                                             pass. See §3/§14/§16/§17.
0043_narrow_professional_identity.sql     — APPLIED and verified live
                                             (25+-scenario behavioral
                                             battery, structural + tested-
                                             not-assumed EXECUTE grants,
                                             offboarding/NULL-safety,
                                             oracle/side-channel probes,
                                             profiles RLS regression — all
                                             PASS). Adds exactly two
                                             SECURITY DEFINER functions,
                                             resolve_docket_assignment_-
                                             identity(p_assignment_id) and
                                             resolve_docket_share_identity-
                                             (p_share_id) — see §14 for the
                                             full predicate/design write-up.
                                             profiles' own SELECT RLS is
                                             untouched (still self-only);
                                             display_name sourced from
                                             full_name only (no suitable
                                             professional-title field exists
                                             that doesn't also leak the admin
                                             flag via role). Neither function
                                             accepts a bare profile_id — each
                                             is gated by re-deriving the exact
                                             live access predicate of its
                                             context row's parent (the full
                                             three-path Docket read envelope
                                             for assignments; the exact Share
                                             visibility-for-management
                                             predicate for shares), so
                                             arbitrary-profile probing is
                                             structurally impossible. No
                                             is_admin() bypass. EXECUTE
                                             explicitly revoked from anon (a
                                             live pg_default_acl inspection
                                             found this schema auto-grants
                                             EXECUTE on every new function to
                                             anon at creation time — the same
                                             default behind the pre-existing
                                             anon_security_definer_function_-
                                             executable warnings elsewhere in
                                             this codebase; revoking only from
                                             public does not reach it,
                                             confirmed live) and granted only
                                             to authenticated. magistrate_-
                                             courts (court-roster) identity
                                             and docket_matters.created_by/
                                             last_updated_by attribution were
                                             deliberately left out — no
                                             current requirement found for
                                             either; scope not broadened.
                                             18-scenario rollback-only
                                             pre-test battery run live before
                                             application (all 18 passed),
                                             followed by full post-application
                                             live verification. (was 0042,
                                             was 0041 before the 0041/0042
                                             Bookmark split)
0044_ownership_rls_helpers.sql             — APPLIED and verified live.
                                             Six SECURITY DEFINER boolean
                                             helpers (can_view_docket_matter,
                                             can_edit_docket_matter,
                                             can_view_judgment,
                                             can_edit_judgment,
                                             can_view_case_law,
                                             can_edit_case_law) centralize
                                             already-duplicated Docket/
                                             Judgment/Case-Law access
                                             predicates across ~14 tables'
                                             RLS policies — see §14 for the
                                             full predicate/recursion/grants
                                             write-up. Pure semantic refactor:
                                             zero new access rights, zero
                                             changed access outcomes anywhere,
                                             proven by an exhaustive rollback-
                                             only before/after regression
                                             matrix (35 scenarios, run live
                                             both immediately before and
                                             immediately after DDL application
                                             within one transaction, zero
                                             mismatches, zero recursion
                                             errors), then a second full live
                                             regression pass against the
                                             permanently applied policies
                                             post-apply_migration (zero
                                             mismatches). Recursion-safety
                                             empirically proven, not assumed,
                                             via a disposable temp-table probe
                                             (SECURITY INVOKER version:
                                             "stack depth limit exceeded";
                                             SECURITY DEFINER version:
                                             succeeds). Two association-table
                                             families confirmed, by direct
                                             inspection, NOT symmetric and
                                             both preserved exactly:
                                             docket_matter_judgments/
                                             docket_matter_case_law INSERT/
                                             DELETE keep has_docket_matter_-
                                             authority() (narrower, no share);
                                             quick_code_docket_matters INSERT/
                                             DELETE correctly uses the new,
                                             broader can_edit_docket_matter().
                                             Grants deliberately left on the
                                             schema default (anon-executable),
                                             unlike 0043 — proven live via
                                             has_table_privilege() that anon
                                             already has direct base-table
                                             SELECT on judgments/case_law/
                                             docket_matters today and that
                                             both tables' existing SELECT RLS
                                             already has a no-auth.uid()
                                             is_discoverable branch, so these
                                             boolean helpers create no new
                                             information oracle; explicitly
                                             revoking anon here would itself
                                             have been an unintended behavior
                                             change. Advisors: only the
                                             expected, pre-disclosed anon/
                                             authenticated SECURITY DEFINER
                                             EXECUTE WARNs (same accepted
                                             class as is_admin()/has_docket_-
                                             matter_authority()); no new
                                             advisory class or severity.
                                             (was 0043, was 0042)
0045_judgment_lifecycle_locking.sql        — APPLIED and verified live.
                                             Draft/final lifecycle, exactly
                                             two states, constrained TEXT
                                             (not an enum). Adds status/
                                             finalized_at/finalized_by and
                                             protect_judgment_lifecycle()
                                             (BEFORE INSERT OR UPDATE) --
                                             see §6/§14 for the full design.
                                             Draft: fully editable, hard-
                                             deletable, exactly as 0027.
                                             Final: title/case_number/
                                             court_name/judgment_date/
                                             citation/content/content_text
                                             locked; hard DELETE blocked
                                             (DELETE policy narrowed to
                                             can_edit_judgment(id) AND
                                             status='draft'); is_discover-
                                             able remains freely owner-
                                             toggleable in both states;
                                             owner may always unlock
                                             (final -> draft), owner-only,
                                             no is_admin() bypass anywhere.
                                             Atomic-bypass prevention: one
                                             UPDATE combining unlock with a
                                             substantive edit is rejected;
                                             unlock must be its own
                                             statement. finalized_at/
                                             finalized_by force-set by the
                                             trigger (client values always
                                             overwritten), preserved across
                                             unlock, most-recent-only (not
                                             a full history); INSERT-time
                                             bypass closed (a Judgment can
                                             never be created already-
                                             final). Deliberately kept OUT
                                             of can_view_judgment()/
                                             can_edit_judgment() -- tags,
                                             Docket/Quick-Code links, and
                                             Document attachment all remain
                                             fully available on a final
                                             Judgment, confirmed live. No
                                             versioning/corrigendum/full
                                             audit history -- correction is
                                             unlock/edit/re-finalize only.
                                             Rollback-only DDL + behavioral
                                             pretest run clean before
                                             application (one self-inflicted
                                             test-fixture bug found and
                                             fixed during pretesting, not a
                                             migration defect -- disclosed).
                                             Post-application live matrix
                                             (30 scenarios: draft CRUD,
                                             finalize, all seven fields
                                             independently + jointly
                                             rejected while final,
                                             discoverability carve-out,
                                             admin-cannot-unlock/delete,
                                             atomic-bypass rejection,
                                             unlock/edit/re-finalize cycle,
                                             draft-only DELETE, tags/Docket-
                                             link/Quick-Code-link/Document-
                                             attach all working on final,
                                             helper semantics unchanged) --
                                             zero mismatches. One new, self-
                                             introduced advisory finding:
                                             protect_judgment_lifecycle()
                                             lacks a SET search_path pin
                                             (function_search_path_mutable,
                                             WARN) -- inconsistent with
                                             every sibling guard trigger in
                                             this codebase, which all pin
                                             search_path=public; not auto-
                                             fixed per instruction, flagged
                                             as the leading candidate for a
                                             small forward-only repair
                                             migration. RESOLVED — see
                                             0046 immediately below.
                                             (was 0044, was 0043)
0046_fix_judgment_lifecycle_search_path.sql — APPLIED and verified live.
                                             Minimal forward-only repair,
                                             per standing rule (never edit
                                             an applied migration).
                                             CREATE OR REPLACES
                                             protect_judgment_lifecycle()
                                             with a byte-for-byte identical
                                             PL/pgSQL body (captured live
                                             from the applied 0045
                                             function before writing this
                                             migration) plus exactly one
                                             addition: `set search_path =
                                             public`. Trigger name/events/
                                             attachment, Judgment columns,
                                             RLS policies (including the
                                             0045 DELETE policy), 0044
                                             helpers, judgment_tags/
                                             association/documents policies
                                             — all untouched. Rollback-only
                                             pretest (7 scenarios: INSERT-
                                             forged-final forced to draft,
                                             draft->final, final content
                                             edit rejected, final
                                             discoverability toggle,
                                             atomic bypass rejected,
                                             separate unlock, subsequent
                                             draft edit) — zero mismatches,
                                             identical behavior to 0045.
                                             Applied; `pg_proc.proconfig`
                                             confirmed `{search_path=
                                             public}` post-application.
                                             Advisors re-run:
                                             function_search_path_mutable
                                             for protect_judgment_lifecycle
                                             is gone; only the pre-existing,
                                             untouched validate_bookmark_-
                                             entity finding remains; no new
                                             finding attributable to this
                                             repair; all other findings
                                             (anon/authenticated SECURITY
                                             DEFINER EXECUTE WARNs,
                                             auth_leaked_password_-
                                             protection) unchanged. This
                                             insertion shifts every still-
                                             UNAPPLIED migration after it
                                             forward by one, per the same
                                             renumbering convention already
                                             used for the 0039 repair and
                                             the 0041/0042 Bookmark split.
0047_search_extensions.sql                 — APPLIED and verified live
                                             (was 0046, was 0045, was
                                             0044). Extends search to
                                             docket_matters/judgments/
                                             quick_codes, matching the
                                             exact 0010 pattern; adds
                                             three additive UNION ALL
                                             branches to global_search()
                                             with no result-schema
                                             change. Full design write-
                                             up in §11. Full 20-item
                                             rollback-only pretest
                                             (fixture-driven four-path
                                             Docket access, share grant/
                                             revoke with search_vector
                                             byte-identity proof,
                                             Judgment discoverability
                                             round-trip, Case Law/Quick
                                             Code/Bench Note/legacy Case/
                                             Statute regressions, Admin
                                             no-bypass, edge-case query
                                             safety, structural checks)
                                             ran clean, zero defects.
                                             Applied exactly as
                                             reviewed. Live advisor
                                             check: zero new findings
                                             beyond the three expected
                                             unused_index INFOs on the
                                             new search_vector GIN
                                             indexes.
0048_audit_extensions.sql                  — APPLIED and verified live.
                                             Extends audit_trigger_fn()
                                             (0009) with table-specific
                                             redaction and adds audit
                                             coverage to docket_matters/
                                             docket_events/docket_matter_
                                             parties (contact_info
                                             redacted)/docket_matter_
                                             assignments/magistrate_
                                             courts/shares (all
                                             unredacted); judgments/
                                             bench_notes (content+
                                             content_text+search_vector
                                             redacted); quick_codes
                                             (content+description+
                                             search_vector redacted);
                                             case_law_annotations
                                             (annotation_text redacted);
                                             case_law (summary+full_text+
                                             search_vector redacted only
                                             when owner_id is not null --
                                             canonical rows unredacted).
                                             Hardens audit_log via
                                             REVOKE INSERT/UPDATE/DELETE/
                                             TRUNCATE from anon/
                                             authenticated (RLS already
                                             blocked it; defense-in-
                                             depth, mirroring 0043).
                                             Rollback-only pretest: 27/27
                                             PASS, one real defect caught
                                             pre-apply (search_vector
                                             leaking redacted text via
                                             its lexemes -- fixed). Zero
                                             new advisor findings. See
                                             §12/§17.
0049 "Storage Policy Updates" — RESOLVED as a documented NO-OP, no SQL
                                             file created. Storage RLS
                                             (0011, fixed for the
                                             polymorphic documents model
                                             by 0040) was re-inspected
                                             live and found already
                                             correct: object reads
                                             require lawful Document
                                             access, uploads/deletes are
                                             folder-owner-scoped, path/
                                             name knowledge alone grants
                                             nothing. Nothing to change
                                             at the schema/RLS level.
                                             What 0040 deferred here was
                                             physical blob cleanup on
                                             parent-cascade deletion,
                                             which Supabase's own docs
                                             confirm cannot be done
                                             safely via SQL/a DB trigger
                                             (a SQL DELETE against
                                             storage.objects orphans the
                                             blob rather than removing
                                             it -- deletion must go
                                             through the Storage API).
                                             Resolved application-level
                                             rule (no schema impact):
                                             explicit user-driven
                                             Document deletion must call
                                             the Storage API to remove
                                             the blob FIRST, then delete
                                             the documents metadata row
                                             only after that succeeds
                                             (implemented in the
                                             frontend Documents feature,
                                             not the database). Parent-
                                             cascade deletion (the
                                             existing documents_parent_
                                             cascade_delete() trigger,
                                             unchanged) removes the
                                             metadata row but not the
                                             blob -- an orphaned blob
                                             with no metadata/access
                                             path is accepted as known,
                                             non-security-relevant
                                             operational debt for v1
                                             (nobody can reach it once
                                             its documents row is gone,
                                             since the storage.objects
                                             SELECT policy requires a
                                             matching documents row).
                                             Scheduled reconciliation
                                             (comparing the documents
                                             catalogue against the
                                             bucket and removing verified
                                             orphans via the Storage API)
                                             is recorded as deferred
                                             future maintenance, NOT
                                             built now -- no Edge
                                             Functions, pg_net, or
                                             webhook infrastructure
                                             introduced to close this.
                                             Backend migration sequence
                                             is CLOSED at 0048; no 0049
                                             file exists or is planned
                                             unless a genuine future
                                             schema need arises.
0049_storage_policy_updates.sql            (was 0048, was 0047, was 0046)
0050 "Fix RETURNING-visibility self-referencing RLS policies" — APPLIED.
                                             Discovered while pretesting
                                             0051 (unrelated to that
                                             migration's own content): the
                                             `docket_matters`/`judgments`/
                                             `case_law` SELECT and UPDATE
                                             RLS policies called an
                                             id-only SECURITY DEFINER
                                             helper (`can_view_X(id)`/
                                             `can_edit_X(id)`) that
                                             re-queries the SAME table by
                                             id. Confirmed via a minimal,
                                             schema-independent repro that
                                             this self-referencing shape
                                             breaks `INSERT ... RETURNING`
                                             outright (the just-inserted
                                             row is invisible to the
                                             helper's own nested self-
                                             query at RETURNING-time, so
                                             even the row's own creator
                                             gets an RLS violation) and
                                             causes `UPDATE ... RETURNING`
                                             to silently evaluate against
                                             stale, pre-update column
                                             values. Since `supabase-js`'s
                                             `.insert(values).select()` is
                                             exactly `INSERT ... RETURNING`
                                             in one round trip, this
                                             latent defect (present since
                                             0020/0027/0035) blocked
                                             creating a Docket Matter, a
                                             Judgment, or personal Case Law
                                             for a fully authorized user.
                                             Fixed by rewriting those six
                                             policies (`ALTER POLICY ...
                                             USING (...)`) to reference the
                                             row's own columns directly
                                             instead of self-querying —
                                             identical boolean predicates,
                                             no access-control change. The
                                             `can_view_X`/`can_edit_X`
                                             helper functions themselves
                                             are untouched (still used
                                             correctly, cross-table, by
                                             `documents`' policies) and
                                             DELETE policies (unaffected —
                                             the target row already existed
                                             before the statement) are also
                                             untouched. Rollback-only
                                             pretest: 12/12 PASS, including
                                             an explicit before/after
                                             access-control regression
                                             (not just the RETURNING fix).
                                             Zero new advisor findings.
0051_docket_share_recipient_lookup.sql      APPLIED. `resolve_docket_share_
                                             recipient(p_docket_matter_id,
                                             p_email)` — the narrow lookup
                                             RPC needed to unblock Docket
                                             Share creation in the frontend
                                             (`profiles` SELECT RLS is
                                             owner-or-admin only, so there
                                             was previously no RLS-
                                             authorized way to resolve "who
                                             is this email" before creating
                                             a Share). Reuses
                                             `has_docket_matter_authority()`
                                             verbatim for authorization —
                                             the exact same predicate the
                                             `shares` INSERT policy itself
                                             checks (current Court
                                             assignment OR retained
                                             assignment; an existing share
                                             is deliberately NOT authority,
                                             no admin bypass). Exact,
                                             case-insensitive email match
                                             only; recipient must be
                                             active and not the caller;
                                             every failure mode collapses
                                             to the same zero-row result
                                             (no way to distinguish "wrong
                                             email" from "not authorized").
                                             Returns only `(profile_id,
                                             display_name)` — `display_name`
                                             is `profiles.full_name`,
                                             matching the existing
                                             `resolve_docket_share_identity`/
                                             `resolve_docket_assignment_
                                             identity` convention exactly.
                                             SECURITY DEFINER, STABLE,
                                             fixed `search_path`, EXECUTE
                                             revoked from PUBLIC/`anon`,
                                             granted to `authenticated`
                                             only. It does NOT create the
                                             Share — the existing `shares`
                                             INSERT policy remains the sole
                                             authority for that. Rollback-
                                             only pretest: 12/12 PASS
                                             (authorized Court/retained
                                             callers succeed; view-share-
                                             only/edit-share-only/unrelated/
                                             admin-without-authority callers
                                             all get zero rows; self-email,
                                             inactive-recipient, unknown-
                                             email, and partial-email
                                             lookups all get zero rows;
                                             case-insensitive exact match
                                             succeeds; `anon` EXECUTE
                                             denied). Zero new advisor
                                             findings.
```

0013–0022 above are APPLIED and verified against Supabase directly. 0023 is prepared for review this turn (not applied). All numbering from 0024 onward remains anticipated/planning-only — none of those files exist yet and none will be written or renamed until each is actually reached in turn.

Migrations proceed one at a time, each submitted for review before the next is written. Renumbering costs nothing — nothing past what's marked APPLIED above has ever been applied to Supabase (verified directly each time against Supabase's migration history).

---

## 17. Remaining Decisions

**Resolved through this revision:**
- ~~Storage blob-lifecycle / "0049 Storage Policy Updates"~~ → **RESOLVED as a documented NO-OP at the schema level — see §16. Storage RLS (0011/0040) is already correct and unchanged. Application-level rule recorded (not a migration): explicit Document deletion must remove the Storage blob via the Storage API before deleting the `documents` metadata row; SQL/trigger-based blob deletion is rejected outright per Supabase's own documentation (it orphans the object instead of removing it). Parent-cascade deletion leaves an orphaned-but-inaccessible blob, accepted as known v1 operational debt, not a security issue (no live documents row means no live storage.objects SELECT-policy path to it). Scheduled orphan reconciliation is deferred future maintenance, deliberately not built now — no Edge Functions/pg_net/webhooks introduced. Backend migration sequence closes at 0048.**
- ~~Search coverage gap: `docket_matters`/`judgments`/`quick_codes` had no `search_vector`/`search_X()` and were absent from `global_search()`~~ (resolved and **APPLIED** as `0047_search_extensions.sql` — see §11/§16) → **Exact `0010` pattern extended to all three: `GENERATED ALWAYS ... STORED` `tsvector`, covering GIN index, `SECURITY INVOKER` `search_X(p_query, p_limit default 20)`. `search_docket_matters()`/`search_judgments()` follow the `search_case_law()` precedent (RLS alone, no redundant explicit predicate); `search_quick_codes()` relies on `quick_codes`' trivial owner-only RLS. `global_search()` gains three additive UNION ALL branches; `search_result` composite type unchanged (plain `text` `entity_type`, no enum risk). Explicitly excluded: `docket_events`/`docket_matter_parties`/`docket_matter_tags`/`judgment_tags`/`case_law_annotations` (child/organizational rows), `documents` (deferred), `shares`/`bookmarks` (association/metadata). Verified via a 20-item rollback-only pretest (four-path Docket access, share grant/revoke with `search_vector` byte-identity proof that privacy is enforced by RLS not vector content, Judgment discoverability round-trip, Case Law/Quick Code/Bench Note/legacy Case/Statute regressions, Admin no-bypass confirmation, edge-case query safety) — zero defects, applied exactly as reviewed, zero new advisory findings beyond the three expected `unused_index` INFOs.**
- ~~Judgment lifecycle: draft/final states, hard-delete behavior, reversibility, per-field locking, discoverability interaction, tag/association/document mutability post-finalization, correction mechanism, finalization authority~~ (the nine/ten questions raised when `0027_judgments` deliberately deferred all lifecycle behavior; a full options/implications/recommendations package was produced once `0044` passed, then approved and resolved and **APPLIED** as `0045_judgment_lifecycle_locking.sql` — see §6/§14/§16) → **Exactly two states, `draft`/`final`, constrained TEXT with a CHECK (not an enum, learning from the `bookmark_entity_type` enum-migration risk). Draft: fully editable, hard-deletable, exactly as 0027. Final: `title`/`case_number`/`court_name`/`judgment_date`/`citation`/`content`/`content_text` locked; hard DELETE blocked; `is_discoverable` remains freely owner-toggleable in both states (privacy and lifecycle are independent dimensions); owner may always unlock (`final → draft`), owner-only, no `is_admin()` bypass anywhere. A single UPDATE combining unlock with any substantive edit is rejected (atomic-bypass prevention) — unlock must be its own statement, edits only follow in a later one. `finalized_at`/`finalized_by` are force-set by a trigger on every `draft → final` transition (client-supplied values always overwritten), preserved — never nulled — across an unlock, and record only the most-recent finalization, not a full history; a Judgment can never be created already-final. Enforcement is deliberately split: a new `protect_judgment_lifecycle()` `BEFORE INSERT OR UPDATE` trigger supplies field-level state-machine protection (narrowing WHICH fields may change), while the pre-existing owner-only UPDATE RLS (`can_edit_judgment()`, unmodified) continues to supply WHO may attempt it — lifecycle state is deliberately NOT folded into `can_view_judgment()`/`can_edit_judgment()` themselves, since `judgment_tags`, `docket_matter_judgments`, `quick_code_judgments`, and `documents` all reuse those helpers for organizational actions (tagging, linking, attaching) that must and do continue working on a final Judgment, confirmed live. DELETE narrowed directly (`can_edit_judgment(id) AND status = 'draft'`), not through the shared helper. Correction mechanism is unlock → edit → re-finalize only — no corrigendum table, amendment entity, version history, or superseding-Judgment chain; those remain explicit future work, deliberately not over-built for a personal-work-product tool whose audit infrastructure isn't fully wired yet.**
- ~~Narrow professional-identity mechanism~~ (§17 of Addendum 3 / decision 8 above; resolved and **APPLIED** as `0043_narrow_professional_identity.sql` — see §14/§16) → **Two context-gated SECURITY DEFINER functions, not a `profiles` RLS carve-out: `resolve_docket_assignment_identity()` and `resolve_docket_share_identity()`. Display name only (`full_name`); no professional-title field was found that doesn't also encode the admin flag, so none is invented or returned. Neither function accepts a bare `profile_id` — each re-derives its authorization from the exact live access predicate of the context row's parent (full three-path Docket read envelope for assignments; exact Share visibility-for-management predicate for shares), so arbitrary-profile probing is structurally impossible and `profiles` itself stays self-only. `magistrate_courts` identity and `docket_matters.created_by`/`last_updated_by` attribution were deliberately scoped out — no current requirement for either. EXECUTE revoked from `anon` (this schema's default-privilege auto-grant to `anon` on every new function was discovered live and reversed explicitly) and granted only to `authenticated`. Applied and verified live via a 25+-scenario behavioral battery (structural, tested-not-assumed EXECUTE grants, retained-assignment matrix, share matrix, oracle/side-channel tests, `profiles` RLS regression) — PASS.**
- ~~Access-predicate centralization (ownership/edit RLS helpers)~~ (deferred from `0037_shares` — resolved and **APPLIED** as `0044_ownership_rls_helpers.sql` — see §14/§16) → **Six SECURITY DEFINER boolean helpers (`can_view_docket_matter`, `can_edit_docket_matter`, `can_view_judgment`, `can_edit_judgment`, `can_view_case_law`, `can_edit_case_law`) centralize duplicated Docket/Judgment/Case-Law predicates across ~14 tables. Pure refactor — zero new access rights, zero changed outcomes, proven by an exhaustive before/after regression matrix run live (rollback-only, then again against the permanently applied policies). Recursion-safety proven empirically, not assumed: a SECURITY INVOKER helper querying its own protected table from within that table's RLS policy causes genuine "stack depth limit exceeded"; SECURITY DEFINER avoids it by bypassing RLS for the helper's entire nested execution. Two association-table families (`docket_matter_judgments`/`docket_matter_case_law` vs. `quick_code_docket_matters`) confirmed NOT symmetric by direct inspection and both preserved exactly as found — substituting the wrong helper for either would have been an unauthorized access widening. Grants deliberately left on the schema default (unlike 0043) since `anon` already has direct base-table SELECT and an auth-independent `is_discoverable` RLS branch on `judgments`/`case_law` today, so these boolean helpers create no new information oracle. PASS — no new advisory class beyond the expected, pre-disclosed anon/authenticated SECURITY DEFINER EXECUTE WARN already carried by existing helpers.**
- ~~Bookmark entity-type scope, ownership/privacy preservation, parent-access-at-creation vs. ongoing-visibility, parent-deletion lifecycle, and enum-migration sequencing~~ → **Resolved when `0041_extend_bookmark_entity_type.sql`/`0042_bookmark_entity_validation_extension.sql` were prepared and applied — see §2/§14/§16. Seven approved types: `case`, `bench_note`, `statute`, `case_law` (unchanged since `0008`) plus `docket_matter`, `judgment`, `quick_code` (added). `document` explicitly excluded — bookmarking a Document attachment vs. its parent record is a separate, unresolved product question, deferred, not an omission. Bookmark ownership/privacy model preserved exactly (owner-only SELECT/INSERT/DELETE, no admin bypass, no sharing, no UPDATE policy — unchanged). `validate_bookmark_entity()` remains `SECURITY INVOKER` — a Bookmark may only be created against an entity the caller can currently, lawfully read; each new branch is a plain nested EXISTS auto-inheriting the parent table's own current SELECT RLS (Docket Matter gets the full post-`0037` three-path envelope for free). Ongoing Bookmark visibility depends only on ownership, never on continued parent access or existence — confirmed already-authoritative via the existing SELECT policy shape, not newly built; a Bookmark created while its parent was accessible remains fully visible to its owner after that access is lost, and never restores or leaks access to the parent itself. No parent-delete cleanup triggers added for any of the seven types — a Bookmark already survives its parent's deletion as dangling, owner-visible metadata, matching the pre-existing (unmodified) behavior of the four original types. Enum-migration sequencing: a live rollback-only probe proved a single combined migration was NOT safe against the real, pre-existing `bookmark_entity_type` (though it appeared safe against a same-transaction disposable enum, which was found to be a non-representative test) — split into `0041` (`ALTER TYPE` only) and `0042` (validator rewrite, applied after `0041` committed), shifting every later planned migration forward by one further number.**
- ~~Should Docket Matters be owned or court-anchored~~ → **Court-anchored. `owner_id` removed; `created_by`/`last_updated_by` are provenance only, never access control.**
- ~~How to represent retained/part-heard responsibility~~ → **Dedicated `docket_matter_assignments` table, not reused `shares`.**
- ~~`is_active` vs `ended_at` for assignment tables~~ → **`ended_at IS NULL` only, on both `magistrate_courts` and `docket_matter_assignments`. No redundant boolean.**
- ~~Does `courts.is_active`/`magisterial_districts.is_active` gate historical access~~ → **No — new-assignment/new-entry availability only.**
- ~~Should the three-path Docket RLS predicate (§14) be built all at once or incrementally~~ → **Incrementally, one path per migration, as each path's dependency table is created (`0020`: court-assignment only; `0022`: adds retained-assignment — APPLIED; `0037`: adds shares). No placeholder tables/functions created early to fake completeness.**
- ~~`docket_events` field shape, adjournment behavior, presiding-magistrate provenance, event lifecycle/status, and access inheritance~~ → **Resolved when `0024_docket_events` was prepared — see §4. `event_type` left unconstrained text (no enum); adjournments create a new row; `presiding_magistrate_id` is forced/locked provenance, never access control; `event_status` is constrained text with no hard DELETE; access fully inherits the parent Docket Matter's two-path predicate.**
- ~~Previous/next-appearance derivation and `event_status`~~ → **Resolved. Both `cancelled` and `entered_in_error` rows are excluded from previous- AND next-appearance derivation — see §4's closing paragraph. The chronology query/view itself is not built in `0024`; this is the semantic rule it must follow when it is.**
- ~~`docket_matter_parties` field shape, role/type vocabulary, uniqueness, history, and access inheritance~~ → **Resolved when `0025_docket_matter_parties` was prepared — see §4. Structured parties do not generate or synchronize `matter_title`. Witnesses are not modeled as Docket parties (deferred to future structured witness functionality). The legacy `party_role` enum is not reused — `role` and `party_type` are independent constrained-text vocabularies specific to this table. Party rows have no hard-delete path; `entered_in_error` preserves bad/duplicate entries for history. Names are not treated as unique identifiers — no uniqueness on `(docket_matter_id, full_name[, role])`, since one party may legitimately hold more than one role. Richer identity/alias/contact history (a persons/contact registry, cross-matter identity matching, structured address/phone/email, AKA/historical-name tracking) remains deferred, not built.**
- ~~Case Law canonical/personal model, ownership guard, discoverability, citation uniqueness, search/tags privacy analysis~~ → **Resolved when `0035_case_law_personal_research` was prepared — see §5/§14. One unified `case_law` table, NOT split: `owner_id IS NULL` = canonical/institutional (admin-curated, globally readable regardless of `is_discoverable`, admin-only write, behavior unchanged from before 0035); `owner_id IS NOT NULL` = personal research, private by default with an owner-controlled `is_discoverable` read-only extension mirroring `judgments` (0027) exactly. Ownership immutable after creation via `case_law_ownership_guard()` (blocks any `owner_id` change in either direction; forces non-NULL submissions to the inserter's own `auth.uid()`; requires `is_admin()` for a NULL/canonical submission). No admin bypass into personal records — Admin's canonical-curation authority and a magistrate's personal-record privacy are separate concerns, confirmed at the RLS-predicate level. Citation uniqueness rescoped from a global unique index to a **partial** unique index over canonical rows only (`case_law_citation_canonical_unique_idx`, `where owner_id is null`); personal rows have no citation uniqueness constraint (an explicitly flagged, non-obvious design choice — citation is an external identifier, not a user-invented shorthand, so no per-owner uniqueness rule was invented). `search_case_law()` verified `SECURITY INVOKER` with no other bypass — requires no change, automatically narrows with `case_law`'s RLS. `search_vector` verified to be a `GENERATED ALWAYS ... STORED` column excluding `owner_id`/`is_discoverable` — requires no change. `case_law_tags` verified to remain safe unmodified — admin-only INSERT means no path exists for a personal row to acquire a tag association today; a future owner-tagging feature would need the same dedicated-table treatment already given to `docket_matter_tags`/`judgment_tags`. `created_by` left untouched (nullable, `ON DELETE SET NULL`, provenance-only, conceptually distinct from `owner_id`). Production `case_law` confirmed empty — no backfill required. `docket_matter_case_law` (0030) and `quick_code_case_law` (0034) are NOT modified; both automatically inherit the new predicate via their existing nested-`EXISTS` design, which is the mandatory regression-test target the next time either table is verified.**
- ~~Quick Code↔Case-Law association authority, join-row visibility, and FK lifecycle~~ → **Resolved when `0034_quick_code_case_law` was prepared — see §5/§7/§14. Association only, `QuickCodeOwnership AND CaseLawReadAccess` (never OR) for SELECT/INSERT/DELETE alike. Reuses, unmodified, the exact nested-RLS design explicitly approved for `docket_matter_case_law` (0030): the Case-Law side is a live existence check against `case_law` itself rather than a duplicated/inlined predicate, so it automatically respects the future `case_law` personal/canonical refactor (`0035`) with no change required here — `0035` must regression-test `quick_code_case_law` alongside `docket_matter_case_law`. Deliberately mirrors 0030's INSERT/DELETE rule: Case-Law READ access only, not ownership/authorship, since Case Law is reusable reference authority and (independently) the Quick Code is the linking user's own private metadata (mirroring 0033's rationale). `quick_code_id ON DELETE CASCADE` (Quick Code owner hard DELETE already approved, 0031); `case_law_id ON DELETE RESTRICT`, deliberately NOT CASCADE, matching 0030's Case Law lifecycle design (admin-curated canonical material, rare/deliberate admin-only DELETE). `created_by` is provenance only. `unique(quick_code_id, case_law_id)`, `quick_code_id` leading (matching 0032/0033's Quick-Code-centric index convention). No UPDATE policy. No admin bypass. No `can_view_case_law()` helper created.**
- ~~Quick Code↔Judgment association authority, join-row visibility, discoverability dynamics, and FK lifecycle~~ → **Resolved when `0033_quick_code_judgments` was prepared — see §7/§14. Association only, `QuickCodeOwnership AND JudgmentReadAccess` (never OR) for SELECT/INSERT/DELETE alike. Deliberately different from `quick_code_docket_matters`/`docket_matter_judgments`: the Judgment side requires READ access only, not ownership, since the Quick Code is the linking user's own private metadata and the association grants nobody else anything — a magistrate may privately link their own Quick Code to another magistrate's discoverable Judgment. Visibility tracks Judgment discoverability dynamically (appearing/disappearing as the Judgment owner toggles `is_discoverable`) without the association row itself ever being touched. Both FKs use `ON DELETE CASCADE`: `quick_code_id` because Quick Code owner hard DELETE is approved (0031) and these are purely organizational links; `judgment_id` because Judgment owner DELETE remains provisionally permitted pre-lifecycle-locking (0027) and a personal Quick-Code-to-Judgment link must not block lawful Judgment deletion — a Judgment may be deleted by its owner even while another magistrate has privately linked one of their own Quick Codes to it, and CASCADE removes only the link, never the Quick Code itself. `created_by` is provenance only. `unique(quick_code_id, judgment_id)`, `quick_code_id` leading (matching 0032's Quick-Code-centric index convention). No UPDATE policy. No admin bypass.**
- ~~Quick Code↔Docket Matter association authority, join-row visibility, and FK lifecycle~~ → **Resolved when `0032_quick_code_docket_matters` was prepared — see §7/§14. Association only, following the same BOTH-sides pattern as `docket_matter_judgments`/`docket_matter_case_law` (`DocketAccess AND QuickCodeAccess`, never OR). Because Quick Codes have no discoverability tier, "Quick Code access" is simply `owner_id = auth.uid()` everywhere it appears — SELECT and INSERT/DELETE therefore use an identically-strength Quick-Code-side check (a genuine simplification versus `docket_matter_judgments`, where SELECT could be satisfied by mere Judgment discoverability but INSERT/DELETE required ownership specifically). `docket_matter_id ON DELETE RESTRICT` (matching the Docket judicial-history convention); `quick_code_id ON DELETE CASCADE` (Quick Code owner hard DELETE is already approved in 0031; CASCADE is database referential cleanup of the owner's own authorized deletion, not an RLS unlink operation, so it applies even if the owner has since lost Docket access to some linked matters). `created_by` is provenance only and never determines DELETE authority. `unique(quick_code_id, docket_matter_id)` prevents duplicates while preserving many-to-many cardinality. No UPDATE policy. No admin bypass — Admin must independently own the Quick Code AND hold lawful Docket access like anyone else.**
- ~~Quick Code purpose, field shape, ownership, uniqueness, and lifecycle~~ → **Resolved when `0031_quick_codes` was prepared — see §7/§14. A Quick Code is a private, individually owned, reusable text-expansion/snippet (`code_word`, `title`, `content`, `description`) — personal productivity tooling, not judicial content, and fully independent of the Court-Anchored Docket. Ownership (`owner_id`) is forced/locked by a guard trigger and immutable after creation, exactly mirroring `judgments.owner_id`; Quick Codes never transfer to a successor magistrate. RLS is owner-only on all four commands (SELECT/INSERT/UPDATE/DELETE), with no Court/Docket access path, no `is_discoverable` concept, and no `is_admin()` bypass anywhere — the simplest, most fully private access model built so far. `code_word` uniqueness is case-insensitive/whitespace-trimmed and scoped **per owner**, never global, via an expression unique index; different owners may freely reuse the same code word. Unlike every join/tag table built this session, Quick Codes have an UPDATE policy (owner-only) since it is a genuine standalone record with editable substantive fields. Owner hard DELETE is approved (personal productivity data, not judicial history) — no archive/entered_in_error/ended_at lifecycle. `content` is plain text only in this foundational migration (no JSONB/editor schema), NOT NULL and non-blank after trimming; no `search_vector` (deferred to the dedicated search migration, numbered `0044` at the time 0031 was written, now `0047_search_extensions` after the 0039/0041-0042/0046 renumbering insertions — see §16). The future `quick_code_docket_matters`/`quick_code_judgments`/`quick_code_case_law` join tables are explicitly not built in `0031`; a Quick Code must be able to exist independently of all of them, and the future-association principle is recorded now: linking a Quick Code to another entity must never itself grant access to the Quick Code. No sharing path exists yet; introducing one later requires an explicit future design decision.**
- ~~Docket↔Case-Law association authority, join-row visibility, duplicate prevention, and FK lifecycle~~ → **Resolved when `0030_docket_matter_case_law` was prepared — see §5/§14. Association only, following the same BOTH-sides pattern as `docket_matter_judgments` (`DocketAccess AND CaseLawAccess`, never OR). Deliberately built against the CURRENT live, legacy, admin-curated `case_law` model (globally readable to authenticated users; no `owner_id`/`is_discoverable` exist yet) rather than the future personal/canonical split described in §3, which is not implemented until the later `0035_case_law_personal_research` migration. The Case-Law-side predicate is expressed as a live existence check against `case_law` itself rather than a duplicated predicate, so it will automatically respect `0035`'s future privacy model with no change required to `0030`. Unlike `docket_matter_judgments`, INSERT/DELETE require Case-Law **read** access only, not ownership — a deliberate, explicit difference, since Case Law is reusable research/reference authority rather than individually authored work product. `docket_matter_id ON DELETE RESTRICT` (matching the Docket judicial-history convention); `case_law_id` is ALSO `ON DELETE RESTRICT` (deliberately not CASCADE, unlike `judgment_id` in 0029) because Case Law is administratively curated canonical material with rare/deliberate admin-only DELETE, not an individually-owned still-provisional record. `created_by` is provenance only and never determines DELETE authority. `unique(docket_matter_id, case_law_id)` prevents duplicates while preserving many-to-many cardinality. No UPDATE policy. No admin bypass.**
- ~~Docket↔Judgment association authority, join-row visibility, and duplicate prevention~~ → **Resolved when `0029_docket_matter_judgments` was prepared — see §6/§14. The association confers no access in either direction (unchanged principle, now field-level resolved). SELECT requires independent lawful access to BOTH the Docket Matter and the Judgment (`DocketAccess AND JudgmentAccess`, never `OR`) — this closes a gap the earlier resolution left open, where the mere existence/visibility of a link row could otherwise have leaked information about an inaccessible record. INSERT and DELETE both require lawful Docket access AND Judgment *ownership* specifically — `is_discoverable` alone is never sufficient to create or remove a link, and DELETE uses the identical authority as INSERT rather than deferring to whoever originally created the row (`created_by` is provenance only, never access control). `unique(docket_matter_id, judgment_id)` prevents duplicates while preserving genuine many-to-many cardinality. No UPDATE policy (the association has no editable fields). No admin bypass. The join row carries no descriptive metadata — only its two foreign keys and creation provenance. The future `shares` path is recorded in principle (both sides must independently satisfy their own eventual share-based access before an association becomes visible) but not implemented; whether share-based *edit* access should extend to link creation/removal is left an explicit, undecided future question.**
- ~~Judgment tagging: whether the existing global `tags` table should be reused, and access/lifecycle rules for Judgment-specific tags~~ → **Resolved when `0028_judgment_tags` was prepared — see §6. The global `tags` table is explicitly NOT reused, for the same reason it was rejected for the Docket in `0026` — a tag's text could disclose sensitive judicial work-product information even while the parent Judgment remains completely inaccessible. `judgment_tags` is a dedicated direct child table of `judgments`, with `judgment_id ON DELETE CASCADE` (deliberately the opposite of the Docket's RESTRICT convention, since tag rows are purely organizational and a Judgment is still owner-deletable at this pre-lifecycle-locking stage). SELECT inherits the parent Judgment's own access model (owner OR `is_discoverable`); INSERT/DELETE are owner-only, even for a discoverable reader — preserving "discoverability is read-only." No Court/Docket access rule is referenced anywhere. No admin bypass. Lifecycle is add/remove only (no UPDATE, no history/status state), the same deliberate exception to immutability already established for `docket_matter_tags`. Not yet the `shares` path — share-based VIEW access should extend to tag SELECT once `shares` exists; whether share-based EDIT access includes tag mutation is left as an explicit future decision.**
- ~~Judgment ownership, privacy/discoverability, Docket-relationship semantics, and RLS~~ → **Resolved when `0027_judgments` was prepared — see §6. Judgments are individually owned (`owner_id`, immutable after creation) and never Court-owned; ownership never transfers when a magistrate leaves a Court, and a successor magistrate never automatically inherits a predecessor's private Judgments. Linking a Judgment to a Docket Matter via the future `docket_matter_judgments` table is association only and never confers access in either direction — Docket/Court access (`can_access_court()`, `has_retained_assignment()`, future parent-matter `shares`) never grants Judgment access, and Judgment access never grants Docket access. `is_discoverable` is owner-controlled and read-only to other magistrates when true — never edit, never public, never admin-managed, never automatic Docket attachment. No `is_admin()` bypass anywhere. Owner-only DELETE in `0027` is explicitly provisional, expected to be revisited once `judgment_lifecycle_locking` is designed. `judgment_tags` (0028), `docket_matter_judgments` (0029), attachments (pending the `documents` polymorphic refactor), explicit `shares`-based collaboration, and all finalization/locking/versioning behavior remain deferred, not built in `0027`.**
- ~~Docket tagging: institutional vs. personal, and whether the existing global `tags` table should be reused~~ → **Resolved when `0026_docket_matter_tags` was prepared — see §4. The global `tags` table is explicitly NOT reused for the Docket, because a tag's text may itself reveal sensitive judicial information and `tags` has no access-scoping mechanism at all. Institutional Docket tags (`docket_matter_tags`) are a dedicated direct child table of `docket_matters`, access-inherited via the same two-path predicate as `docket_events`/`docket_matter_parties`, with free-form `tag_name` (case-insensitive/whitespace-trimmed uniqueness scoped per matter, not globally), `created_by` provenance only, and an ordinary hard-DELETE lifecycle (a deliberate, explicit exception to the Docket's usual no-hard-delete rule, since tags are operational metadata rather than substantive judicial history). A separate, private, user-owned personal-label mechanism remains explicitly deferred — not designed or built as part of 0026, and must never auto-transfer to a successor magistrate merely because the successor inherits ordinary Court Docket access.**

**Still open, explicitly deferred (not blocking 0015/0016):**
- ~~The audit log's content-redaction mechanism~~ → **RESOLVED and APPLIED as `0048_audit_extensions.sql` — see §12/§16.**
- Whether the optional automatic-release trigger on `docket_matter_assignments` (§4/§6 of this revision) should also fire on any other status transition beyond `completed`/`archived` — currently scoped exactly per your instruction (not on `stayed`).
- `comments`'s eventual fate; Realtime scope; whether a canonical Case Law entry could ever be "promoted" from a personal one — all unchanged, non-blocking.
- ~~Mandatory when `0035_case_law_personal_research` is reached: a `docket_matter_case_law` and `quick_code_case_law` regression pass~~ → **Fulfilled.** `0035`'s own 54-scenario verification battery included a full behavioral regression pass on both tables (canonical/own-private/another's-private/another's-discoverable/no-Docket-or-no-Quick-Code-ownership combinations, plus complete discoverability-transition sequences proving zero association-row mutation) — zero code changes to either `0030` or `0034` were required, confirming the nested-RLS design worked exactly as intended.
- ~~Case Law Annotations purpose, ownership, parent-access requirement, FK lifecycle, indexing~~ → **Resolved when `0036_case_law_annotations` was prepared — see §5/§14.** Private personal research notes, one owner per row, on one Case Law record (canonical or personal, own or another's discoverable) — never canonical content, never modifies the parent. Reuses the `0030`/`0034` nested-RLS pattern unmodified: SELECT/INSERT/UPDATE/DELETE require `AnnotationOwnership AND CaseLawReadAccess` (`owner_id = auth.uid()` AND a plain `EXISTS` against `case_law`), so annotation access automatically tracks the parent's own current RLS, including its future privacy transitions, with zero code change here. Strictly private, permanently — no discoverability, no sharing, no admin bypass — and critically, the parent Case Law's own `owner_id` is never referenced, so owning the annotated record confers zero visibility into another magistrate's annotations on it. `case_law_id ON DELETE CASCADE`, deliberately unlike the `0030`/`0034` RESTRICT association model, since annotations are subordinate personal notes that must never block a lawful Case Law deletion — all annotations disappear automatically with the parent, regardless of author. `owner_id ON DELETE RESTRICT`, forced/locked by a guard trigger. Multiple annotations per owner per record are explicitly allowed (no uniqueness on `(owner_id, case_law_id)`). No title/discoverability/sharing/Court-Docket-association/tags/search_vector.

- ~~Docket Matter Shares: shareable entities, recipient model, permission levels, grant/revoke authority, resharing, lifecycle/history, duplicate-active-share rule, offboarding FK behavior, child-row inheritance, and scope boundary~~ → **Resolved and prepared for review as `0037_shares.sql` (not yet applied) — see §3/§14.** Shareable entity types confirmed as `docket_matters`/`judgments`/personal `case_law` (canonical Case Law is `N/A` — already universal, no owner to grant it); `0037` itself implements ONLY `docket_matter` sharing (`item_type` CHECK-constrained to a single value), a deliberate, disclosed scope boundary — Judgment/Case-Law sharing requires a follow-up migration that both widens `item_type` (solving polymorphic `item_id` existence validation, for which this codebase has no precedent yet) and extends `judgments`/`case_law`'s own SELECT/UPDATE RLS, exactly mirroring the Docket extension; building the row type without the consuming RLS now would be a "fake completeness" placeholder, rejected per the same principle already established in `0020`/`0022`. Recipient model: registered `profiles` only, no external/email/public-link sharing. Permission: exactly two constrained-text levels, `view` (SELECT only) and `edit` (full blanket UPDATE, matching the other two Docket paths — no column-level restriction exists anywhere in Docket RLS, so none is invented for shares specifically). Creation authority: any CURRENT lawful Docket-access holder (`can_access_court()` OR `has_retained_assignment()`) — NOT owner_id (`docket_matters` has none), a genuine, confirmed difference from the future Judgment/Case-Law design. Resharing: explicitly NOT permitted (holding a share does not itself satisfy the creation predicate) — defaults to NO per instruction. Revocation authority: identical to creation authority (never merely "whoever granted it," matching the established DELETE-uses-identical-authority-as-INSERT convention) PLUS the recipient's own unconditional right to relinquish a share made to them. Lifecycle: soft-revocation only via `revoked_at` (no DELETE policy), directly reusing `docket_matter_assignments.ended_at`'s established pattern — preserves audit history for this explicitly security-sensitive grant type; permission is immutable after creation (a level change is revoke-then-create, not in-place UPDATE). Duplicate-active-share rule: at most one ACTIVE share per `(item_type, item_id, recipient_id)` via a partial unique index, directly reusing `docket_matter_assignments_current_pair_idx`'s pattern; unlimited historical rows allowed. Offboarding FK: `recipient_id`/`granted_by` both `ON DELETE SET NULL` (nullable at schema level only for that action; RLS requires real values at creation), mirroring `docket_matter_assignments.profile_id`/`granted_by` exactly, with a guard trigger auto-revoking a still-active share if its recipient is nulled by profile deletion — never left "active but recipientless." `shares`' own SELECT is granter-or-recipient only (narrowest default; whether ordinary current-access holders should also see all shares on their matter is an explicit, open UX question). No admin bypass anywhere. Child-row/association-table inheritance (`docket_events`, `docket_matter_parties`, `docket_matter_tags`, `docket_matter_judgments`, `docket_matter_case_law`) is explicitly NOT implemented in `0037` — each of those five tables inlines its own Docket-side predicate rather than nesting against `docket_matters`, so none auto-inherit this widening (unlike the Case-Law side of the association tables under `0035`); each needs its own future, explicit `ALTER POLICY`. No reusable `can_view_docket_matter()`/`can_edit_docket_matter()` helper is introduced in `0037` — reserved for the dedicated, later `0044_ownership_rls_helpers.sql` (**APPLIED** — see above); `0037` itself continues the established inline-predicate-per-policy convention.

**Nothing beyond what's marked APPLIED in §16 has been written or applied. Each subsequent migration is written and submitted individually for review, per your instruction.**
