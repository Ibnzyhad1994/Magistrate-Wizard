# BenchBook Architecture Addendum 2 — Docket vs. Case Law

**Status:** Read-only. Supersedes the "Cases" handling in the original Reconciliation Report (Sections 3, 4, 11, 13) wherever it conflicts with this addendum. No SQL executed, no migrations written or applied, no application code changed, no Git actions taken. Existing migrations 0001–0012 remain untouched. Nothing here is implemented until you approve it.

---

## 1. How the existing `cases` table should transition into the Docket model

The safest path turns on one fact already confirmed in the audit: **the live `cases` table currently holds zero rows.** There is no production data to migrate, rename around, or risk. That changes the calculus entirely — this is a "build the right thing next to the old thing" situation, not a "carefully migrate live data" situation.

Recommendation: **do not transition `cases` in place at all.** Instead:

1. Leave `cases` (and `case_parties`) exactly as they are — untouched, per your instruction.
2. Build `docket_matters` (and its child tables, below) as a genuinely new table in a forward migration.
3. Point all new application development at `docket_matters`, never at `cases`.
4. Once `docket_matters` is live and you're satisfied it's the correct replacement, a later, separate, explicit migration formally deprecates `cases`/`case_parties` — either dropping them outright (safe, since nothing will reference them by then) or leaving them as inert legacy tables if you'd rather keep the historical migration trail visually intact. That decision can wait; it costs nothing to defer.

I considered the alternative — renaming `cases` to `docket_matters` via `ALTER TABLE ... RENAME` and evolving its columns in place — and rejected it even as a *future* recommendation. A rename-and-evolve approach only pays off when there's live data worth preserving through the transition; here there isn't, so a clean new table is strictly simpler, avoids any chance of dragging over docket-irrelevant columns (like the `search_vector` generated expression, which would need rebuilding anyway), and avoids any window where the table's name and shape disagree.

---

## 2. `docket_matters` + `docket_events`/`hearings`: recommended, and why

Yes — a parent/child split, not a single flat table. A docket matter (an arraignment, a maintenance dispute, a traffic citation) persists across its lifecycle and typically accumulates multiple hearings: first appearance, pretrial, trial, sentencing, review, etc. Modeling every hearing as more columns on one row (`hearing_1_date`, `hearing_2_date`...) doesn't work — the count is unbounded and per-hearing detail (what happened, what was ordered, at *that* hearing) gets lost or crammed into free text. A child table gives you:

- unlimited hearings per matter without schema changes
- a natural place to record per-hearing outcome/orders distinct from the matter's overall outcome
- an efficient way to answer "what's on my docket this week" (index `docket_events.scheduled_date`, not `docket_matters`)
- a clean, one-row-per-appearance target for calendar sync (Section 3)

Proposed shape:

```
docket_matters (
  id, owner_id, matter_type enum('criminal','civil','maintenance',
    'family_violence','juvenile','traffic','other'),
  case_number, court_id → courts (which court the matter is before),
  charge_or_issue text, stage/status enum, orders_summary text,
  outcome text, created_at, updated_at, search_vector
)

docket_events (
  id, docket_matter_id → docket_matters,
  event_type enum('first_appearance','arraignment','pretrial','trial',
    'sentencing','review','other'),
  scheduled_date, scheduled_time, location/courtroom,
  stage_at_event, outcome_at_event, orders_made_at_event,
  external_calendar_provider text,      -- nullable, forward-compat (see §3)
  external_calendar_event_id text,      -- nullable, forward-compat
  external_calendar_synced_at timestamptz,
  created_at, updated_at
)

docket_matter_parties (   -- same shape as existing case_parties, repointed
  id, docket_matter_id, full_name, role, attorney_name, contact_info, created_at
)
```

"Previous appearance" and "next appearance" are **not** stored as columns on `docket_matters` — they're derived: `next = min(scheduled_date) where scheduled_date >= now()`, `previous = max(scheduled_date) where scheduled_date < now()`, computed via a query (or a view) against `docket_events`. This keeps the data honest — there's no risk of a cached "next hearing" field going stale after a reschedule. If this ever becomes a real performance bottleneck at scale, a trigger-maintained cache column can be added later without any structural change; I wouldn't build that prematurely.

Related-entity links (documents, judgments, legal authorities, bench notes) are join tables or the shared polymorphic pattern rather than more nullable FK columns — see Sections 6–7.

---

## 3. Outlook Calendar integration — how it maps without becoming the source of truth

`docket_events` is the sync target, not `docket_matters`. The columns proposed above (`external_calendar_provider`, `external_calendar_event_id`, `external_calendar_synced_at`) are placeholders only — no sync logic is being built now — but they establish the right boundary:

- Outlook can supply or receive **individual appearance data** (date, time, location) for a `docket_events` row.
- Outlook never touches the matter's legal substance — charges, parties, stage, orders, outcome all live on `docket_matters`/`docket_events` fields that have no Outlook counterpart and are never overwritten by a sync.
- A unique constraint on `(external_calendar_provider, external_calendar_event_id)` prevents the same Outlook event from being imported twice.
- Matching an incoming Outlook event to an *existing* matter (vs. creating a new one) is an application-layer concern for later — but it depends on `docket_matters.case_number` staying indexed and clean, which it already is in this design.

This means BenchBook stays authoritative for what a docket matter *is*; Outlook, if and when connected, is just one possible input/output channel for *when things happen* — exactly the boundary you asked for.

---

## 4 & 5. `case_law` evolution — richer fields, and personal + shared support together

**Current `case_law` shape** (from migration 0005, already applied): `case_name`, `citation`, `court`, `jurisdiction`, `decided_date`, `summary`, `full_text`, `source_url`, `created_by`, timestamps, generated `search_vector`. Admin-curated, org-wide read, admin-only write.

**Gap against what you now want:** no `judges` field, no structured `key_holdings`, no way to pin specific passages with personal notes, and — the bigger issue — no ownership model at all, so it structurally cannot support "a magistrate's personal searchable legal knowledge base."

**Recommended evolution (additive, forward migration, no data loss — 0 live rows today so this is also low-risk):**

```
case_law  (existing columns kept, plus:)
  + owner_id uuid references profiles, nullable
  + is_discoverable boolean default false
  + judges text[]
  + key_holdings text
```

The **nullable `owner_id`** is the key design move: `owner_id IS NULL` means "canonical, admin-curated library entry" (today's behavior, preserved exactly — visible to everyone, writable only by admins). `owner_id = <some magistrate>` means "a personal research entry," which then follows the *same* three-way visibility model as cases/judgments: visible to its owner, or to anyone if `is_discoverable = true`, or to specific recipients via the `shares` table (item_type extended to include `'case_law'`).

This merges "shared library" and "personal knowledge base" into one table and one search surface instead of maintaining two parallel case-law systems — a magistrate searching case law sees canonical entries and their own personal entries (and anything shared with them) in one result set, which is almost certainly what you want in practice. I considered keeping them as two separate tables (e.g., a new `personal_case_law` distinct from the admin `case_law`) and rejected it: it would duplicate the entire schema, double the search-function surface, and force the UI to awkwardly merge two sources everywhere a magistrate looks something up. Flagging this as a real fork in the road, though — if you'd rather keep the canonical library completely separate from anything a magistrate writes themselves, say so and I'll redesign around two tables instead.

**"Relevant passages" + "personal annotations"** — rather than a single text blob, I'd recommend a small child table so a magistrate can pin *multiple* specific excerpts per authority, each with its own note:

```
case_law_annotations (
  id, case_law_id → case_law, owner_id → profiles,
  passage_text text, note text, created_at
)
```

This is inherently per-user and private by nature (owner-scoped RLS, no sharing/discoverable concept needed at the annotation level even when the parent `case_law` entry itself is shared or discoverable) — someone you've shared a case-law entry with sees the entry, not your private annotations on it, unless you separately choose to make an annotation visible (not requested; not building that now).

**"Categorisation/tags" and "legal topics"** — I'd recommend *not* adding a separate `legal_topics` column. `tags`/`case_law_tags` already exist and already serve exactly this purpose; introducing a second, parallel categorization mechanism would just fragment the vocabulary. Legal topics become tags.

**Source documents** — already covered once `documents` goes polymorphic (Addendum §7 / original report §7); `case_law` just needs `'case_law'` added to the `entity_type` enum.

---

## 6. Consequences for RLS, sharing, search, Quick Codes, Judgments, Bench Notes, Documents, Tags

- **RLS — two distinct visibility domains now, not one.** Docket matters are, by default, strictly private business of the presiding magistrate — I'm proposing `docket_matters` support *explicit sharing* (e.g., a covering magistrate needs temporary access to a colleague's docket) but **not** the discoverable pool. Court dockets aren't the kind of thing that should ever be "browsable" the way research material is. Case Law, by contrast, gets the full three-way model (owner/shared/discoverable) as described above, matching the original report's design for cases/judgments. **This assumption — no discoverable pool for the Docket — needs your confirmation; see Section 9.**
- **Global search** groups become **Docket, Case Law, Judgments, Quick Codes, Statutes** (five groups) instead of the earlier three named in the original PRD text ("Cases" has now split into Docket and Case Law, so its search group splits accordingly). Docket search results always respect strict ownership — there's no `is_discoverable` path for docket matters to leak through, by design.
- **Quick Codes** — the "linked cases" join table becomes `quick_code_docket_matters`, and a *new* `quick_code_case_law` join table is added (Quick Codes should link to Case Law directly, per your vocabulary list — "linked where useful to Case Law, Judgments, Docket Matters, statutes"). `quick_code_judgments` is unchanged from the original plan.
- **Judgments** gain a `docket_matter_judgments` join table (many-to-many, not one-to-one — a consolidated judgment can cover multiple matters, and a matter can accumulate more than one judgment, e.g. interim + final rulings).
- **Bench Notes** currently attach only to `case_id` (pointing at the table being phased out). Going forward they need to attach to `docket_matters` and, plausibly, to `judgments` and `case_law` entries too (a working note on a piece of precedent is a completely normal use case). Rather than adding a third and fourth nullable FK column, I'd recommend converting `bench_notes`' parent link to the same polymorphic `entity_type`/`entity_id` pattern being used for `documents` — one consistent mechanism instead of a different shape per table. **This is a design change beyond what either report has proposed so far and needs your sign-off; see Section 9.**
- **Documents** — `entity_type` enum (already being introduced per the original report) now explicitly needs `'docket_matter'` and `'case_law'` added to its value set, alongside `'judgment'`, `'quick_code'`, and (until deprecated) `'case'`.
- **Tags** — no structural change. `case_law_tags` doubles as the "legal topics" mechanism (Section 5). `docket_matters` should get its own `docket_matter_tags` join table for matter categorization (e.g., tagging a matter "contested," "urgent").

---

## 7. Changes to the previously proposed migration sequence (0013+)

The original report's item "add citation, key_holdings, source_url... to `cases`" is **cancelled** — those fields now belong to the evolved `case_law`, not to the docket entity. Revised, reordered sequence (still starting at 0013, still purely additive, still nothing written yet):

```
0013_docket_matters.sql              — docket_matters table, enums, search_vector
0014_docket_events.sql               — child table, calendar-sync placeholder columns
0015_docket_matter_parties.sql       — party records, mirrors old case_parties
0016_docket_matter_tags.sql          — join table
0017_judgments.sql                   — as originally proposed
0018_judgment_tags.sql
0019_docket_matter_relations.sql     — docket_matter_judgments join table
0020_quick_codes.sql                 — quick_codes + quick_code_judgments
0021_quick_code_docket_and_case_law.sql — quick_code_docket_matters, quick_code_case_law
0022_case_law_personal_research.sql  — owner_id, is_discoverable, judges, key_holdings,
                                        case_law_annotations table, RLS rewrite
0023_sharing.sql                     — shares table; item_type now covers
                                        case, judgment, case_law (docket handled
                                        separately per §9's open question)
0024_documents_polymorphic_refactor.sql — full entity_type set from the start:
                                        docket_matter, judgment, case_law,
                                        quick_code, bench_note, (case, legacy)
0025_bench_notes_polymorphic_parent.sql — pending your decision, §9
0026_ownership_rls_and_helpers.sql   — can_view/can_edit helpers; docket RLS
                                        (owner + explicit share, no discoverable path)
0027_judgment_lifecycle_locking.sql
0028_search_extensions.sql           — search_docket_matters, updated search_case_law,
                                        search_judgments, search_quick_codes,
                                        global_search() now grouping into 5 categories
0029_audit_extensions.sql
0030_bookmark_entity_extension.sql   — add docket_matter, case_law(personal), judgment,
                                        quick_code to bookmark_entity_type
```

`cases`/`case_parties` are not touched by any of these and remain exactly as applied in 0001–0012.

---

## 8. Updated Entity Relationship Diagram (text form)

```
auth.users
  └── profiles (role, court_id → courts, settings)
        │
        ├── docket_matters (owner_id)                         ***NEW — replaces cases going forward***
        │     ├── docket_events (docket_matter_id)              1:many, calendar-sync placeholders
        │     ├── docket_matter_parties (docket_matter_id)       mirrors old case_parties
        │     ├── docket_matter_tags → tags
        │     ├── docket_matter_judgments (↔ judgments, m:m)
        │     ├── docket_matter_case_law (↔ case_law, m:m)       "related legal authorities"
        │     ├── documents (entity_type='docket_matter')
        │     ├── bench_notes (entity_type='docket_matter', if polymorphic — §9)
        │     └── shares (item_type='docket_matter' — pending §9)
        │
        ├── judgments (owner_id)
        │     ├── judgment_tags → tags
        │     ├── documents (entity_type='judgment')
        │     ├── bookmarks (entity_type='judgment')
        │     └── shares (item_type='judgment')
        │
        ├── case_law (owner_id NULLABLE — null = canonical shared library)
        │     ├── case_law_tags → tags                          "legal topics"
        │     ├── case_law_annotations (case_law_id, owner_id)   private passages/notes
        │     ├── documents (entity_type='case_law')
        │     ├── bookmarks (entity_type='case_law')
        │     └── shares (item_type='case_law', only when owner_id is set)
        │
        ├── quick_codes (owner_id)
        │     ├── quick_code_docket_matters (m:m)
        │     ├── quick_code_judgments (m:m)
        │     └── quick_code_case_law (m:m)
        │
        ├── bench_notes (author_id; parent via entity_type/entity_id — §9,
        │                or case_id/docket_matter_id if kept flat)
        │     └── bench_note_tags → tags
        │
        ├── shares (owner_id, recipient_id, item_type, item_id, permission)
        │
        └── audit_log (actor_id)

statutes ── statute_tags ── tags        (unchanged, shared reference library)

documents (entity_type ∈ {docket_matter, judgment, case_law, quick_code,
                           bench_note, case[legacy]}, entity_id)
  → Storage bucket "documents" (private, signed URLs)

[deprecated, untouched, not built upon]
cases, case_parties  — remain exactly as in migrations 0001–0012 until
                        a future cleanup migration retires them
```

---

## 9. Decisions still needed from you before I write anything

- **Should `docket_matters` support explicit sharing (covering-magistrate scenarios) even without a discoverable pool?** My working assumption is yes-to-sharing, no-to-discoverable — please confirm or correct.
- **Should `bench_notes` move to the fully polymorphic `entity_type`/`entity_id` parent pattern (my recommendation, for consistency with `documents`), or keep growing as separate nullable FK columns (`docket_matter_id`, `judgment_id`, `case_law_id`) for simplicity?** Both work; polymorphic is more consistent, flat columns are more obviously self-documenting in a schema browser. Your call.
- **Confirm the nullable-`owner_id`-on-`case_law` design** (one table serving both the canonical library and personal research) versus keeping them as two separate tables. I've recommended the merged approach; flagging it because it's the single biggest structural decision in this addendum.
- **Judgment-to-docket-matter relationship: many-to-many (my recommendation) or strictly one matter per judgment?** Affects whether `docket_matter_judgments` is a join table or a plain FK on `judgments`.
- **Are the Outlook-sync placeholder columns on `docket_events` (`external_calendar_provider`, `external_calendar_event_id`, `external_calendar_synced_at`) an acceptable shape to reserve now, even though no sync logic is being built?** If you already know more about how the eventual integration should work (which calendar fields matter, one-way vs. two-way sync), it may be worth refining these column names now rather than later.
- **Should `docket_matters.orders_summary`/`outcome` live on the matter (a rolling summary) in addition to per-event `outcome_at_event`/`orders_made_at_event` on `docket_events` (as I've proposed), or should the matter-level fields be dropped and derived entirely from the latest event?** I lean toward keeping both — the matter-level fields capture the *overall* disposition, the event-level fields capture what happened at each specific hearing — but wanted to surface it explicitly rather than assume.

Nothing will be written or applied until you've weighed in on these and approved the revised plan as a whole.
