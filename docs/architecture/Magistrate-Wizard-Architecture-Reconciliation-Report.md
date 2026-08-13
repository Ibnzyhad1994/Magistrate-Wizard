# Magistrate Wizard Architecture Reconciliation Report

**Status:** Read-only analysis. No SQL executed, no migrations applied or edited, no application code changed, no Git actions taken. Everything below is a proposal awaiting your approval.

---

## 1. Executive Summary

The existing implementation is a real, working foundation — not a stub. The frontend stack matches your required stack exactly (React 18, Vite, TypeScript, Tailwind, shadcn/ui, React Router v6, TanStack Query, Zustand, React Hook Form, Zod, Supabase, TipTap installed). The backend is a fully deployed, RLS-hardened 12-migration schema on your live Supabase project.

But the backend was built around the wrong tenancy model. It implements **court-level shared tenancy** — every magistrate at the same court sees every other magistrate's cases and notes, gated by `court_id`. The authoritative requirements you've now provided describe **individual ownership with opt-in sharing**: each magistrate has a private workspace, and material becomes visible to others only through explicit sharing or deliberate discoverability. These are structurally different products, not a small tweak.

Two entities central to Magistrate Wizard's actual purpose — **judgments** and **Quick Codes** — don't exist in the schema at all. Sharing, view/edit permissions, and the discoverable pool don't exist either. No frontend feature pages exist yet for anything (confirmed in the prior audit — only auth screens and an empty dashboard shell are built), so the UI is greenfield regardless of which backend direction is chosen.

**Bottom line recommendation:** keep roughly 70% of the existing schema (its architectural patterns — generated search vectors, polymorphic entity tables, the audit trigger, the storage bucket design — are sound and reusable), rewrite the access-control layer from court-scoped to ownership+sharing+discoverable, and add judgments, Quick Codes, and sharing as new migrations layered on top of 0001–0012 rather than editing history. Details follow.

---

## 2. Current Architecture Assessment

**Backend (Supabase project `gipijpeahkznfwitjccy`):** 12 migrations applied and hardened (0012 resolved all advisor-level RLS performance/security findings). The access-control spine is three functions — `my_court_id()`, `user_can_access_case()`, `user_can_access_bench_note()` — all of which gate visibility by `court_id` equality. There is no `owner_id`-based row visibility anywhere; `created_by`/`author_id`/`uploaded_by` exist but are used for accountability (who created something), not for restricting who can *see* it.

**Frontend:** `package.json` confirms the exact required stack, including all six `@tiptap/*` packages — but nothing in `src/` actually uses TipTap yet, and `src/routes/router.tsx` only wires up `/login`, `/register`, `/forgot-password`, `/dashboard`, `/unauthorized`, and a 404 route. No case, note, document, statute, or (obviously) judgment/Quick-Code pages exist.

**The core mismatch:** the current model is "shared department database, scoped by court." The new model is "personal knowledge base, scoped by owner, with opt-in sharing and an opt-in discoverable pool." Nothing about the frontend build blocks either direction, but the database's authorization logic needs a structural rewrite, not a patch.

**A second, smaller mismatch worth naming now:** the new PRD's "Cases" entity (`citation`, `court_origin`, `year`, `key_holdings`, `source_url`) reads like curated case-*law* knowledge a magistrate collects for reference, whereas the existing `cases` table (`case_number`, `status`, `filed_date`, `assigned_magistrate_id`) reads like docket/litigation tracking. These aren't the same thing. Section 13 covers this as a decision point, but my working assumption for the rest of this report is that both are valid and complementary: `cases` becomes a magistrate's personally-owned, citable case entries (adding the new curation fields, keeping the useful docket fields as optional), while `case_law` remains the separate, admin-curated shared reference library — which conveniently resolves the naming collision instead of creating one.

---

## 3. Table-by-Table Classification

### Existing tables

| Table | Classification | Why |
|---|---|---|
| `profiles` | **MODIFY** | Core shape is fine. Add a `settings jsonb` column (or a `user_settings` table) to satisfy "their own settings." Role enum (`magistrate`/`clerk`/`admin`) stays. |
| `courts` | **MODIFY** | Keep the table, but demote it from an access-control boundary to directory/metadata. See Section 6 for why courts should not gate visibility. |
| `cases` | **MODIFY** | Add `owner_id` (repurpose `created_by`), `citation`, `court_origin` (free text — distinct from the `courts` FK), `year`, `category`, `key_holdings`, `source_url`, `is_discoverable`. Existing docket fields (`case_number`, `status`, `filed_date`, `assigned_magistrate_id`) retained as optional, not removed. RLS fully rewritten (owner/share/discoverable, not court). |
| `case_parties` | **MODIFY** | Shape unchanged; RLS rewritten to route through the new `user_can_access_case()`. |
| `bench_notes` | **MODIFY** | Retained as Magistrate Wizard's personal-notes/annotation system, per your instruction to evaluate it for that role. RLS rewritten: `is_private` now means "visible only to me" vs. "visible to whoever this note's case is shared with" — not "visible to my whole court," which is what it currently means. |
| `statutes` | **KEEP** | Maps directly to "shared reference legal library." Admin-curated, org-wide read, no ownership model needed. No changes required. |
| `case_law` | **KEEP** | Same reasoning — this is the shared/reference half of the "distinguish curated vs. reference" requirement. No changes required. |
| `tags` | **KEEP** (with an open question) | Shared vocabulary is reusable across cases/judgments/Quick Codes/statutes/case law as specified. Whether *personal-only* tags are also needed is a genuine open question — see Section 13. |
| `case_tags` | **MODIFY** | RLS rewrite only. |
| `bench_note_tags` | **MODIFY** | RLS rewrite only. |
| `statute_tags` | **KEEP** | Admin-only write pattern is unaffected by the ownership-model change. |
| `case_law_tags` | **KEEP** | Same. |
| `documents` | **MODIFY** (structural) | Currently semi-polymorphic via two nullable FK columns (`case_id`, `bench_note_id`). Judgments, and potentially Quick Codes and statute source files, need to attach documents too. Recommend refactoring to a true polymorphic shape (`entity_type` enum + `entity_id`), matching the pattern `bookmarks` already uses, rather than adding a new nullable column per entity type forever. |
| `comments` | **MODIFY** | RLS rewrite. Scope stays case/bench-note for now; extending to judgments is listed as optional future work (not explicitly requested). |
| `bookmarks` | **MODIFY** | Extend `bookmark_entity_type` enum to add `'judgment'` and `'quick_code'`. RLS is already owner-only and needs no change beyond that. |
| `audit_log` | **MODIFY** | Generic `audit_trigger_fn()` is reusable as-is — just attach it to the new `judgments`, `quick_codes`, and `shares` tables so creation, edits, finalization, and permission changes are all captured automatically (finalization is just a row UPDATE, so no special-case logging code is needed). |

### New tables required

| Table | Purpose |
|---|---|
| `judgments` | Core entity — see Section 9 for full lifecycle design. |
| `judgment_tags` | Join table, same pattern as `case_tags`. |
| `quick_codes` | Core entity — owner, code word, description. |
| `quick_code_cases` | Join table — a Quick Code can link multiple cases. |
| `quick_code_judgments` | Join table — a Quick Code can link multiple judgments. |
| `shares` | Generic, polymorphic sharing grant: owner → recipient, item type/id, permission (`view`/`edit`). Replaces the need for per-entity share tables. |

### Functions

| Function | Classification | Why |
|---|---|---|
| `set_updated_at()` | **KEEP** | Generic, reusable on every new table with `updated_at`. |
| `handle_new_user()` | **KEEP** | Fine as-is; optionally extend to seed default settings. |
| `is_admin()` | **KEEP** | Unaffected. |
| `my_court_id()` | **MODIFY (repurposed, not removed)** | Stops being used inside access-control predicates. Retained for descriptive/reporting use and as a discoverable-pool filter helper (see Section 13's open question on which "court" a filter should mean). |
| `user_can_access_case()` | **REPLACE** | Current body checks court membership. New body must check `owner_id = auth.uid() OR is_discoverable OR exists(share row)`. |
| `user_can_access_bench_note()` | **REPLACE** | Same reasoning, applied to notes. |
| `can_edit_case()` / `can_edit_judgment()` | **NEW** | View vs. edit is a new distinction the current schema has no concept of; needs its own helper(s) so RLS `UPDATE` policies can check for `'edit'` permission specifically, not just any access. |
| `audit_trigger_fn()` | **KEEP** | Generic; just attach to more tables. |
| `validate_bookmark_entity()` | **MODIFY** | Extend the `case` statement for the two new entity types. |
| `search_statutes`, `search_case_law` | **KEEP** | No ownership model involved; unaffected by the RLS rewrite. |
| `search_bench_notes`, `search_cases` | **MODIFY** | Field lists change (new `cases` columns); underlying access check changes because `user_can_access_*` is being replaced. |
| `search_judgments`, `search_quick_codes` | **NEW** | Same `security invoker` pattern as the existing search functions — RLS enforcement is automatic and free. |
| `global_search()` | **MODIFY** | Union in judgments and Quick Codes, grouped by entity type as required. |

### Triggers

All existing triggers (`set_*_updated_at`, `audit_*`, `validate_bookmark_entity_trigger`) are **KEEP** mechanically — no changes to their logic, just new instances attached to new tables. One **NEW** trigger is required: a `prevent_final_judgment_edit()` `BEFORE UPDATE` trigger enforcing the Draft/Final lock (Section 9).

### Storage

| Bucket | Classification | Why |
|---|---|---|
| `documents` | **KEEP** (policies MODIFY) | Private bucket, signed-URL-appropriate architecture is already correct. RLS policies need the same ownership/share/discoverable rewrite as the tables they reference, and need to recognize judgments (and possibly Quick Codes) as valid parents once `documents` goes polymorphic. |
| `avatars` | **KEEP** | Public-read profile pictures, unaffected by any of this. |
| `legal-documents` | **REMOVE** (not urgent) | Pre-existing, orphaned bucket unrelated to Magistrate Wizard, empty, still can't be deleted via SQL (Supabase blocks that) — recommend deleting via the Dashboard whenever convenient. Not part of the reconciliation work itself. |

---

## 4. Required Schema Changes — Item by Item

**1. Judgments** — new `judgments` table: `id`, `owner_id`, `case_title`, `case_number`, `defendant_name`, `charges`, `judgment_text jsonb` (TipTap JSON), `judgment_text_plain text` (search extraction, same pattern as `bench_notes.content_text`), `status` enum, `category`, `is_discoverable`, `created_at`, `updated_at`, generated `search_vector`. Recommend collapsing the PRD's separate `is_template` boolean into the `status` enum (`draft`/`final`/`template`) rather than keeping both — see Section 13.

**2. Quick Codes** — new `quick_codes` table: `id`, `owner_id`, `code_word`, `description`, `created_at`, `updated_at`, plus `quick_code_cases` and `quick_code_judgments` join tables for the "linked cases/linked judgments" requirement. Private by default (owner-only RLS); sharing deferred as optional future work per the PRD's own "if the product later supports sharing Quick Codes" phrasing.

**3. Individual case ownership** — add `owner_id` to `cases` (repurposing `created_by`), rewrite RLS to `owner_id = auth.uid() OR is_discoverable OR shared-with-me`.

**4. Individual judgment ownership** — same pattern, native to the new `judgments` table from the start.

**5. Explicit sharing** — new `shares` table: `id`, `owner_id`, `item_type` enum(`case`, `judgment`), `item_id`, `recipient_id`, `recipient_email` (denormalized for invite-by-email lookups before the recipient's `id` is known, if that flow matters to you), `permission` enum(`view`, `edit`), `created_at`. A `validate_share_entity()` trigger (same pattern as bookmarks) confirms `item_id` actually exists in the right table before insert.

**6. View/edit permissions** — enforced at the RLS layer, not the application layer: `UPDATE` policies check for a `shares` row with `permission = 'edit'` (or ownership); `SELECT` policies accept `view` or `edit`. A view-permission user physically cannot execute an `UPDATE` that Postgres allows — this is a hard guarantee, not just a UI restriction.

**7. Shared/discoverable pool** — `is_discoverable boolean default false` directly on `cases` and `judgments`. `SELECT` RLS treats it as a third, independent path to visibility (alongside ownership and explicit shares). Private material (`is_discoverable = false` and no share row) is structurally excluded — there's no code path that can leak it.

**8. Judgment templates** — a judgment with `status = 'template'`. "Duplicate into a new judgment" is an `INSERT ... SELECT` (or an RPC `duplicate_judgment_from_template(template_id)`) that copies content into a brand-new row with a new `id`, `owner_id = auth.uid()`, `status = 'draft'` — the template row itself is never touched, which is exactly what an `INSERT` (vs. `UPDATE`) guarantees.

**9. Draft/Final locking** — `prevent_final_judgment_edit()` trigger: if `OLD.status = 'final' AND NEW.status = 'final'`, reject changes to `judgment_text`/other substantive fields. Moving `status` away from `'final'` (the "unlock" action) is allowed as its own explicit `UPDATE`, and is automatically captured by the existing audit trigger as a before/after diff — no bespoke audit code needed.

**10. Global search** — extend `global_search()` to union `judgments` and `quick_codes` alongside the existing four entities, grouped by type as required. Because all search functions are `security invoker`, they inherit whatever RLS policy governs the underlying table automatically — the ownership/sharing rewrite in items 3–7 is what actually enforces search security, the search functions themselves need no separate authorization logic.

**11. Document downloads** — governed by `documents` RLS (rewritten per item 13 below) plus signed URLs issued at the application layer for the private `documents` bucket. No public URLs at any point.

**12. PDF viewing** — same document/storage model; viewing is just a signed URL fetched by an authorized client.

**13. Judgment PDF export** — application-layer generation (e.g., print-friendly render or a PDF library) from the stored TipTap JSON; no schema change required. Optionally, a generated PDF can be saved back into `documents` (with `entity_type = 'judgment'`) if you want generated exports to be persisted and re-downloadable rather than regenerated each time.

**14. Future DOCX export** — architecturally free: because judgment content is stored as portable TipTap JSON plus a plain-text extraction, any export format is a rendering step against existing data, not a new column or table.

**15. Personal notes** — `bench_notes`, retained, RLS rewritten (see item above under Table Classification).

**16. Court relationships** — see Section 6; courts become directory/metadata, not an access boundary.

**17. Audit logging** — attach the existing generic `audit_trigger_fn()` to `judgments`, `quick_codes`, and `shares`. Row-level UPDATE diffs already capture finalization and permission changes without new logic.

---

## 5. Proposed Entity Relationship Diagram (text form)

```
auth.users (Supabase managed)
  └── profiles (1:1)  [role, court_id → courts, settings]
        │
        ├── courts (many profiles → one court; directory only, not an access gate)
        │
        ├── cases (owner_id → profiles)
        │     ├── case_parties (case_id)
        │     ├── case_tags → tags
        │     ├── documents (entity_type='case', entity_id=case.id)
        │     ├── comments (case_id)
        │     ├── bookmarks (entity_type='case')
        │     └── shares (item_type='case', item_id=case.id, recipient_id → profiles)
        │
        ├── judgments (owner_id → profiles)               ***NEW***
        │     ├── judgment_tags → tags                     ***NEW***
        │     ├── documents (entity_type='judgment')
        │     ├── bookmarks (entity_type='judgment')
        │     └── shares (item_type='judgment', item_id=judgment.id)
        │
        ├── quick_codes (owner_id → profiles)               ***NEW***
        │     ├── quick_code_cases (quick_code_id, case_id)  ***NEW***
        │     └── quick_code_judgments (quick_code_id, judgment_id)  ***NEW***
        │
        ├── bench_notes (author_id → profiles; case_id optional)
        │     └── bench_note_tags → tags
        │
        ├── shares (owner_id → profiles, recipient_id → profiles)   ***NEW***
        │
        └── audit_log (actor_id → profiles)

statutes  ──── statute_tags ──── tags        (shared reference library, no ownership)
case_law  ──── case_law_tags ──── tags       (shared reference library, no ownership)

documents (polymorphic: entity_type ∈ {case, judgment, bench_note, quick_code?}, entity_id)
  → backed by Storage bucket "documents" (private, signed URLs)

storage.buckets: documents (private), avatars (public)
```

---

## 6. Proposed RLS / Authorization Model

**Principle:** visibility is a three-way OR, ownership is always exclusive.

```
can_view(item)  :=  item.owner_id = auth.uid()
                     OR item.is_discoverable = true
                     OR exists(shares WHERE item_id = item.id
                                        AND recipient_id = auth.uid())

can_edit(item)  :=  item.owner_id = auth.uid()
                     OR exists(shares WHERE item_id = item.id
                                        AND recipient_id = auth.uid()
                                        AND permission = 'edit')
```

`SELECT` policies use `can_view`; `UPDATE` policies use `can_edit` in both `USING` and `WITH CHECK`; `DELETE` remains owner-only (sharing never implies delete rights, which the PRD doesn't ask for and which would be dangerous to grant). The owner's identity is never reassigned by a share — `owner_id` is immutable after insert (enforce via a trigger or simply never including it in any `UPDATE`'s allowed column set).

**Where courts fit:** courts stop being a visibility gate entirely. A profile's `court_id` becomes descriptive metadata (useful for display, for filtering the discoverable pool by "material from magistrates at X court," and for any future org-level reporting) but grants zero automatic access to anyone else's material. This directly answers your instruction not to assume court-level access equals individual ownership — under this model it doesn't grant access at all.

**Search security (Scenario 8):** because every search RPC is `security invoker`, a search for "hearsay" only ever scans rows the querying user's own RLS policies already permit. There's no separate authorization logic to get wrong in the search layer — it inherits whatever `can_view` allows, which means an unauthorized private judgment simply never enters the result set, not even as a title or snippet.

---

## 7. Proposed Document/Storage Model

Refactor `documents` from two nullable FK columns to a true polymorphic shape:

```
documents (
  id, owner_id, entity_type enum('case','judgment','bench_note','quick_code'),
  entity_id, filename, mime_type, file_size, storage_path,
  created_at, updated_at
)
```

with a `validate_document_entity()` trigger mirroring `validate_bookmark_entity()`. RLS on `documents` becomes `can_view`/`can_edit` dispatched by `entity_type` (view a case's documents if you can view the case; upload only if you can edit the case; etc.). Storage bucket policies on `storage.objects` for the `documents` bucket are rewritten identically, replacing the current `user_can_access_case`/`user_can_access_bench_note` joins with the new `can_view`/`can_edit` logic — the private bucket + signed-URL pattern already in place needs no structural change, just an updated authorization check (Scenario 7 — Magistrate B's download ability follows the case's share permission automatically once the storage policy is rewritten this way).

---

## 8. Proposed Search Architecture

Extend the existing `security invoker` RPC pattern (proven to work, no change needed to the pattern itself):

- `search_judgments(query, limit)` — new, mirrors `search_cases`.
- `search_quick_codes(query, limit)` — new, searches `code_word` + `description`.
- `search_cases`, `search_bench_notes` — field lists updated for new `cases` columns; access checks updated to the new `can_view`.
- `global_search()` — unions all six entity types, `entity_type` column already exists in `search_result` for the "grouped by Cases / Judgments / Quick Codes" requirement.

Full-text indexes: `judgments.search_vector` (generated, GIN) over `case_title || case_number || defendant_name || charges || judgment_text_plain`; `quick_codes` indexed on `code_word || description` (a simple `to_tsvector` or even a plain btree on `code_word` given it's likely exact/prefix-matched more often than full-text searched — worth confirming with you which access pattern matters more).

---

## 9. Proposed Judgment Lifecycle

```
[create blank] ──┐
                  ├──> status = 'draft' ──(autosave + manual save, freely editable)
[from template] ──┘         │
                             │  mark Final
                             ▼
                     status = 'final'  ──(locked: trigger blocks content edits)
                             │
                             │  explicit unlock (owner-only action)
                             ▼
                     status = 'draft'  (editable again, fully audited)

[save as template] ──> status = 'template' (status changed on the *current* row,
                                             or duplicated into a new row —
                                             see Section 13, needs your decision)

[duplicate template] ──> INSERT new row, new id, owner_id = caller,
                          status = 'draft', content copied from template
                          (template row itself untouched — Scenario 6)
```

Locking is enforced in Postgres (`prevent_final_judgment_edit()` trigger), not just in the UI, satisfying "the database and application architecture must prevent accidental modification of a Final judgment" literally. Finalized content is preserved by the same mechanism that prevents edits — there's no separate "archive" step needed.

---

## 10. Proposed Sharing Model

Single generic `shares` table rather than per-entity share tables, to avoid duplicating the same structure for cases and judgments (and anything shareable added later):

```
shares (
  id, owner_id, item_type enum('case','judgment'),
  item_id, recipient_id, recipient_email, permission enum('view','edit'),
  created_at
)
```

- Owner creates a share by `item_id` + recipient (by email lookup → `recipient_id`, or store the email if the recipient hasn't signed up yet — your call, flagged in Section 13).
- `SELECT` on `shares`: owner sees shares they created; recipient sees shares where they're the recipient (so they can see what's been shared with them) — recipients cannot see or alter the `permission` column via `UPDATE` (only the owner can change or revoke a grant).
- Deleting a `shares` row revokes access immediately (next query simply won't match `can_view`/`can_edit` anymore — no separate "revoke" flag needed).
- Ownership is never transferred by a share (Scenario 3 — "the owner remains Magistrate A").
- Every share creation/permission change is audit-logged automatically once `audit_trigger_fn()` is attached to `shares`.

---

## 11. Proposed Migration Sequence

**Recommendation: leave 0001–0012 completely untouched, add new migrations starting at 0013.** Reasons: they're already applied to your live project and already hardened; editing applied migrations retroactively is a well-known way to desync a team's local schema from production, and you've explicitly asked me not to touch them yet anyway. A new baseline or consolidation isn't warranted at this scale — 12 migrations is not enough to justify the risk of a squash, and squashing would erase the audit trail. Additive migrations forward:

```
0013_judgments.sql                    — judgments table, enum, search_vector, indexes
0014_judgment_tags.sql                — join table
0015_quick_codes.sql                  — quick_codes + 2 join tables
0016_sharing.sql                      — shares table + validate trigger
0017_discoverable_pool.sql            — is_discoverable columns on cases/judgments
0018_ownership_rls_rewrite.sql        — replace user_can_access_case/bench_note,
                                         add can_edit_*, rewrite cases/bench_notes/
                                         case_parties/case_tags/bench_note_tags RLS
0019_documents_polymorphic_refactor.sql — entity_type/entity_id migration + data backfill
                                           (currently 0 documents exist, so this is
                                           low-risk today but should still be a
                                           reversible, reviewed migration)
0020_judgment_lifecycle_locking.sql   — prevent_final_judgment_edit() trigger
0021_search_extensions.sql            — search_judgments, search_quick_codes,
                                         updated global_search()
0022_audit_extensions.sql             — attach audit_trigger_fn to new tables
0023_bookmark_entity_extension.sql    — extend bookmark_entity_type enum
```

Each is small, single-purpose, and independently reviewable — matching the granularity of your original 0001–0012 set. None of these will be written or applied without your separate go-ahead.

---

## 12. Git/GitHub Setup Recommendation

Checked `.gitignore` (already present in the project) — it already excludes `.env`, `.env.local`, `node_modules`, `dist`, and Supabase's local `.branches`/`.temp` directories, so it's safe to `git init` without risk of committing your Supabase keys. Recommended flow once approved:

1. `git init` in `/Users/teriqmohammed/Desktop/Magistrate-Wizard`, initial commit of the current state (foundation + 12 migrations) as a clean baseline.
2. Create a GitHub repository (private, given this handles legal-workflow data) and push.
3. Link the Supabase CLI to the project (`supabase link --project-ref gipijpeahkznfwitjccy`) so `supabase db push`/`supabase migration new` become the way new migrations get written and applied going forward, instead of ad hoc `execute_sql` calls — this gives you the `local dev → git commit → GitHub → supabase migration` pipeline you described, with the migrations directory as the single source of truth and Supabase's own migration-history table as the applied-state ledger.
4. Optional, later: a GitHub Action that runs `supabase db push` against a staging project on merge to `main`, keeping production promotion manual until you're comfortable automating it.

No Git action will be taken until you approve.

---

## 13. Risks and Ambiguities Requiring Your Decision

- **Cases: docket tracking vs. personal case-law curation.** The new field list (`citation`, `key_holdings`, `source_url`) doesn't obviously coexist with the old one (`case_number`, `status`, `filed_date`). My working proposal keeps both sets on one table and treats the docket fields as optional — but if "Cases" is meant to *replace* the docket-tracking concept entirely, the docket fields should be dropped instead of kept dormant.
- **Judgment `status` enum vs. separate `is_template`/`is_shared` fields.** The PRD lists `status` supporting Draft/Final/Template *and* separate `is_template`/`is_shared` boolean fields in the judgment field list. I've proposed collapsing template-ness into the status enum and dropping `is_shared` entirely (since the `shares` table and `is_discoverable` flag together already express every "shared" state more precisely than a single boolean could). Confirm you're fine with that simplification, or clarify if `is_template` was meant to be independent of status (e.g., "a Final judgment that's also usable as a template").
- **"Filter the shared pool by court" — which court?** Could mean the discoverable item's originating court (`cases.court_origin`, free text) or the authoring magistrate's home court (`profiles.court_id`, the internal `courts` table). These aren't the same thing and only one is a real FK you can join/filter on cleanly. I've assumed `profiles.court_id` for the filter UI; please confirm.
- **Who can unlock a Final judgment?** PRD says unlocking should be possible "if the product workflow allows this" but doesn't say who's authorized — owner only, or owner + admin? This affects the RLS policy on the `status` transition.
- **Recipient-by-email sharing before signup.** If a magistrate shares with an email address that hasn't registered yet, does the share activate automatically on signup, or is sharing restricted to existing accounts only? Affects whether `shares.recipient_id` can be nullable pending signup.
- **Personal vs. shared tag vocabulary.** Flagged as an open question in Section 3 — worth a decision before the tag join tables are finalized, since retrofitting personal tags later is more disruptive than deciding now.
- **Realtime scope.** The PRD mentions Supabase Realtime "where appropriate" without specifying a use case (live-updating shared judgment views? notification on new share?). I'd recommend deferring this to a later phase unless you have a specific scenario in mind — it's additive and doesn't affect the schema decisions above.

None of these block writing the migrations, but a few (especially the Cases and judgment-status ones) shape the actual column list, so I'd rather confirm than guess.

---

## 14. Recommended Next Implementation Phase

1. You review and approve (or amend) this report, including the Section 13 decisions.
2. I write migrations 0013+ as SQL files only (no apply) for your review — same process as before, but reflecting the corrected ownership model this time.
3. Once you approve the SQL, apply to Supabase, regenerate TypeScript types.
4. Build the judgments + Quick Codes + sharing UI first — these are the entities that don't exist yet and are the actual product differentiators; the existing auth/layout/routing foundation doesn't need to change to support them.
5. Follow with cases/notes/documents UI (adapting to the new ownership model), then search UI, then the shared/discoverable pool browser.
6. Git init + GitHub push, once you're ready to start version-controlling — safe to do any time given `.gitignore` is already correct.

No changes have been made. Waiting for your review.
