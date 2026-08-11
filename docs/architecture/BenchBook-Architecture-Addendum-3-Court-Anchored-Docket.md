# BenchBook Architecture Addendum 3 — Court-Anchored Docket, Reference-Data Administration, and Assignment History

**Status:** Read-only recommendation. Nothing implemented. No SQL executed, no migrations written or applied beyond the already-applied `0013`/`0014`, no application code changed, no Git action taken. This addendum, once approved, will supersede the owner-based Docket RLS design in the authoritative spec's §4/§6 (Docket section)/§14 (RLS model) — those sections are not yet edited; that happens only after your approval, matching how Addendum 2 was handled before consolidation.

This is a genuine architectural pivot, not a refinement: Docket Matters move from **individually owned** to **Court-anchored, access-governed-by-active-assignment**. I agree with the direction — an institutional docket is operational infrastructure of the court, not personal property of whoever happened to type the first entry — and the design below is built around making that pivot cleanly, without weakening any of the privacy guarantees already approved for Bench Notes, personal Case Law, Quick Codes, and Judgments, none of which are affected by this change.

---

## 1. Should `magisterial_districts` have `is_active`?

Yes. `is_active boolean not null default true`. This cannot be added to the already-applied `0013` migration — per the project's established rule, applied migrations are never edited — so it arrives as a new `ALTER TABLE` in a forward migration (see §20).

## 2. Does `courts` already have an active/inactive mechanism?

No. The current `courts` table (migration 0002) has no such column. It needs the same `is_active boolean not null default true`, added alongside `district_id` in the same forward migration that links courts to districts (see §20) — both are small, non-conflicting `ALTER TABLE courts` operations, so bundling them avoids an unnecessary extra migration.

## 3. How future admins add/edit/deactivate/reactivate Districts and Courts without migrations

The mechanism is mostly already in place and needs no new architecture, just the two columns above. Both `magisterial_districts` (as of `0013`) and `courts` (as of `0002`, hardened in `0012`) already have full admin-only INSERT/UPDATE/DELETE RLS policies plus open SELECT for all authenticated users — that's the entire access-control layer an admin CRUD screen needs; it requires no further schema work. "Deactivate" becomes an ordinary `UPDATE ... SET is_active = false` through that same existing UPDATE policy — not a new endpoint, not a new permission model.

On hard `DELETE`: I'd recommend leaving the existing admin-only DELETE policies in place rather than removing them, because historical preservation is actually enforced somewhere better — the foreign keys. Once any `courts` row is referenced by `magistrate_courts` or `docket_matters` (both `ON DELETE RESTRICT`, recommended below), Postgres itself will refuse the delete regardless of what RLS allows, with a clear constraint-violation error. So an admin can still hard-delete a court or district that was created by mistake and has no history, but the moment real history exists, the database — not application logic, not RLS — is what stops it. This is more robust than trying to encode "has history" as a policy condition.

## 4. Revised `magistrate_courts` schema

```
magistrate_courts (
  id uuid primary key,
  profile_id uuid not null references profiles(id) on delete cascade,
  court_id uuid not null references courts(id) on delete restrict,
  assignment_type text not null default 'regular',  -- or an enum; see §12
  started_at timestamptz not null default now(),
  ended_at timestamptz,          -- null while active
  is_active boolean not null default true,
  created_at, updated_at
)
```

`court_id` uses `RESTRICT`, not `CASCADE` — consistent with the historical-preservation principle: a court with any assignment history, active or ended, cannot be deleted out from under that history. `profile_id` uses `CASCADE`, matching the existing pattern for genuinely personal rows tied to a specific account (if a profile is ever actually removed rather than deactivated, its assignment rows go with it — though in practice deactivation, not deletion, is the intended path everywhere else in this schema, so this is mostly theoretical).

**Constraint tying `is_active` and `ended_at` together**, enforced by the database rather than trusted to the application:
```
check ((is_active and ended_at is null) or (not is_active and ended_at is not null))
```

**Constraint allowing history without allowing duplicate active assignments** — a partial unique index, not a plain one:
```
create unique index magistrate_courts_active_pair_idx
  on magistrate_courts (profile_id, court_id) where is_active;
```
This permits at most one *active* assignment per magistrate/court pair at any moment, while fully allowing a second (or third) historical row for the same pair over time — exactly the Kamarang scenario where a magistrate leaves and later returns.

## 5. How assignment start/end/history should work

Every assignment change is an `INSERT` (new assignment) or an `UPDATE` of the *existing active* row's `is_active`/`ended_at` (ending an assignment) — never a `DELETE`. The full history of who sat where and when is therefore always reconstructable directly from this one table, with no separate history/audit table needed for this purpose (the row itself *is* the history once ended).

## 6. What happens when a magistrate removes a Court from "My Courts"

The application issues a single `UPDATE magistrate_courts SET is_active = false, ended_at = now() WHERE profile_id = <them> AND court_id = <that court> AND is_active`. The row is never deleted. Nothing about `docket_matters` changes at all — no row is touched, no field is rewritten, no transfer happens. The Kamarang docket doesn't move, isn't copied, isn't reassigned — it simply becomes inaccessible to that magistrate the next time their access is evaluated, because the access check (§9) no longer finds an active assignment for them at that court.

## 7. Should Docket Matters be Court-anchored rather than user-owned?

Yes — this is the core of the pivot, and I agree with it. The previous `owner_id`-based design was correct for content that's genuinely personal (Bench Notes, personal Case Law, Quick Codes, Judgments), but wrong for an institutional court docket, where the whole point is continuity across whoever is presently sitting at that court.

## 8. Replacing `owner_id`

```
docket_matters (
  ...
  court_id uuid not null references courts(id) on delete restrict,
  district_id uuid not null,     -- unchanged design: trigger-derived, guarded against NULL
  created_by uuid not null references profiles(id) on delete restrict,
  last_updated_by uuid references profiles(id) on delete set null,
  ...
)
```

`created_by` keeps `RESTRICT` — same accountability reasoning as everywhere else in this schema (`bench_notes.author_id`, the old `cases.created_by`): the record of who originally filed a matter shouldn't be deletable out from under it. `last_updated_by` uses `SET NULL` instead — slightly lower-stakes provenance (losing the identity of the *most recent* editor if their profile is ever removed is a smaller loss than losing the *creator*), and this also means a hypothetical profile removal is never blocked purely because that person once edited a shared court record.

`last_updated_by` should be trigger-populated, not client-submitted — same "never trust the client, always overwrite" principle already applied to `district_id`. I'd recommend a small, generically-named trigger function (`public.set_last_updated_by()`) rather than a docket-specific one, so it can be reused later if Judgments or other tables ever want the same provenance field.

## 9. Revised Docket SELECT/INSERT/UPDATE/DELETE RLS

```
can_access_court(court_id) :=
    exists(select 1 from magistrate_courts mc
           where mc.court_id = court_id
             and mc.profile_id = (select auth.uid())
             and mc.is_active)
    -- deliberately does NOT check courts.is_active — see the security
    -- note in §21 on why that's a separate, later gate, not this one

has_retained_assignment(docket_matter_id) :=
    exists(select 1 from docket_matter_assignments dma
           where dma.docket_matter_id = docket_matter_id
             and dma.profile_id = (select auth.uid())
             and dma.is_active)
    -- see §9a — a third, independent access path, added per your
    -- retained/part-heard matter requirement

SELECT  := using (can_access_court(court_id)
                   or has_retained_assignment(id)
                   or exists(shares WHERE item_type='docket_matter'
                             AND item_id=id AND recipient_id=(select auth.uid())))

INSERT  := with check (can_access_court(court_id)
                        and created_by = (select auth.uid()))

UPDATE  := using (can_access_court(court_id)
                   or has_retained_assignment(id)
                   or exists(shares WHERE item_type='docket_matter' AND item_id=id
                             AND recipient_id=(select auth.uid()) AND permission='edit'))
           with check (same)
           -- last_updated_by is trigger-set, never part of the client's WITH CHECK payload

DELETE  := NO POLICY AT ALL (recommended change from the earlier owner-only design)
```

Still true, unconditionally: no `is_discoverable` column exists on this table (never will), and `is_admin()` appears nowhere in any of the above — admin status remains exactly as forbidden from bypassing Docket access as it was under the ownership model. The pivot changes *who* the ordinary access path is (court assignment instead of ownership), not *whether* admin gets a shortcut around it (still no).

**On removing DELETE entirely:** under the owner model, I'd flagged owner-only delete as worth reconsidering given judicial-record-retention concerns. Under the court-anchored model, the case for removing it is stronger — multiple magistrates can now share full write access to the same court's matters, and a hard delete by any one of them would destroy a record the others are actively relying on. Recommend: no DELETE policy at all for now, with `status = 'archived'` (already in the approved status vocabulary) as the only removal mechanism. This is reversible later (add a policy) but not the other way around.

## 9a. Retained / Part-Heard Matter Access

A real gap in the design above: when Magistrate A's Kamarang assignment ends, `can_access_court()` correctly cuts off their ordinary access to the whole Kamarang docket — but that's too blunt for a part-heard trial they're still required to complete. This needs a third, independent access path, distinct from both ordinary court access and ad hoc `shares`.

**Comparing your two options:**

1. **Reusing `shares` with a "retained" purpose** — I don't recommend this. `shares` is built around a *granter* (an `owner_id`) handing access to a *recipient*, which fits discretionary consultation ("I'll let a colleague look at this") but fits retained responsibility badly — there's no one "granting" Magistrate A access to their own part-heard matter; they're *keeping* residual responsibility they already had, not receiving something new from someone else. Reusing `shares` would also conflate two access reasons you explicitly don't want conflated: "a colleague temporarily wants visibility" and "I am institutionally still responsible for finishing this." A UI built on `shares` alone couldn't cleanly say "part-heard, retained by Magistrate A" versus "shared with Magistrate C for consultation" without an extra field bolted onto a table that wasn't designed to carry that distinction.
2. **A dedicated `docket_matter_assignments` table** — recommended. This models "individual judicial responsibility for one specific matter" as its own first-class concept, structurally separate from court-wide operational access (`magistrate_courts`) and from discretionary sharing (`shares`). The row's existence *is* the semantic signal the UI needs.

**Recommended schema:**

```
docket_matter_assignments (
  id uuid primary key,
  docket_matter_id uuid not null references docket_matters(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete restrict,
  reason text not null default 'retained_part_heard',  -- extensible later; only
                                                          -- one value needed today
  granted_by uuid references profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  is_active boolean not null default true,
  notes text,   -- optional free-text context, e.g. "part-heard trial, awaiting judgment"
  created_at, updated_at
)
```

Same historical-preservation shape as `magistrate_courts`: a `CHECK ((is_active and ended_at is null) or (not is_active and ended_at is not null))`, and a partial unique index `unique(docket_matter_id, profile_id) where is_active` (at most one active retained assignment per magistrate/matter pair, full history preserved across multiple past retentions if it ever happens twice). `docket_matter_id` cascades on delete (it's a child of the matter, meaningless without it); `profile_id` uses `RESTRICT`, consistent with everything else that tracks judicial accountability in this schema.

**Unlike `shares`, no `permission` column** — a retained assignment always grants full access (view and edit), since the entire point is that Magistrate A must be able to continue substantively working the matter to completion, not merely observe it. This is a deliberate simplification, not an oversight.

**How access is granted:** entirely deliberate, never automatic. When a magistrate ends a court assignment, the product flow (future UI work, not built now) asks which active matters they're retaining; for each one selected, the application inserts a `docket_matter_assignments` row with `profile_id` = the outgoing magistrate and `granted_by` = whoever performed the action. This happens as an explicit, separate operation alongside — not instead of — ending the `magistrate_courts` row normally, exactly satisfying "this should not require keeping an obsolete Court-wide assignment active."

**How access ends:** `UPDATE ... SET is_active = false, ended_at = now()`, never a delete — the historical fact that Magistrate A once retained that matter stays on the record permanently. I'd recommend one small automation worth confirming with you: a trigger that auto-deactivates any active `docket_matter_assignments` row when the parent `docket_matters.status` transitions to `'completed'` or `'archived'`, so finishing the matter naturally ends the retained responsibility without a separate manual step. Flagging this as a recommendation, not something I'd build without confirming you want the automatic coupling.

**How the successor sees it:** Magistrate B's visibility is entirely unaffected by any of this — they already see the matter through ordinary `can_access_court()`, independent of who else holds a retained assignment on it. Displaying "Part-heard / retained by Magistrate A" is a read-only join from `docket_matters` to any active `docket_matter_assignments` row, no RLS change needed for B to see *that* a retention exists. There is one real consequence worth flagging now, though: showing *Magistrate A's name* to Magistrate B requires B to be able to read at least Magistrate A's `full_name` from `profiles`, and the current `profiles` RLS (owner-or-admin only) does not allow that — a magistrate today cannot see any other magistrate's profile fields at all. This will need a narrow, deliberate carve-out when this is actually implemented (e.g., a magistrate can read the `full_name` of any profile that holds an active `magistrate_courts` or `docket_matter_assignments` row at a court they themselves can access) rather than opening `profiles` up broadly. Not resolved here — just recorded so it isn't discovered late.

**How this interacts with `magistrate_courts`:** the two tables are entirely independent and additive — ending a `magistrate_courts` row does not touch `docket_matter_assignments` at all (they must be created deliberately, as described above), and having an active `docket_matter_assignments` row never implies or restores the broader court-wide assignment. This is exactly the boundary you asked for: retained access grants only the specific matter(s), never the whole former court docket.

**How this differs from `shares`:** direction and reason. `shares` moves access *outward*, from whoever currently has access to a matter, *to* a different, arbitrary registered magistrate, for discretionary consultation, with an explicit view/edit choice, and no implication that the recipient was ever institutionally responsible for the matter. `docket_matter_assignments` preserves access *for the same person* who already had broader responsibility, narrowed down to just the matters that still require them personally, with no permission choice (always full access) and an explicit institutional reason (`'retained_part_heard'`). One additional consequence worth naming for later: since `docket_matters` no longer has a single `owner_id`, if a magistrate ever wants to create an ad hoc `shares` grant on a docket matter, the RLS for *creating* that share can't check `owner_id = auth.uid()` the way it might for an owned entity like a Judgment — it will need to check that the granter currently has access at all (via `can_access_court()` or `has_retained_assignment()`), which is a small but real difference from how `shares` creation will work for Judgments/personal Case Law. Worth remembering when the `shares` migration is actually written.

## 10. Successor automatic inheritance

This falls directly out of the design above, with no special mechanism needed: `can_access_court()` is evaluated fresh on every query. The instant Magistrate B gets a new active `magistrate_courts` row for Kamarang, every existing `docket_matters` row with `court_id = Kamarang` becomes visible and editable to them — nothing about those rows changes, nothing is migrated, nothing is copied. Access is a live computation over current assignment state, not a stored, per-row grant that needs updating.

## 11. Simultaneous magistrates at the same Court

Already fully supported by the many-to-many shape with no per-court cardinality limit — any number of `profile_id` rows can reference the same `court_id` with `is_active = true` simultaneously. Each independently satisfies `can_access_court()`. No design change needed beyond what's already described.

## 12. Acting/temporary assignments

Recommend a lightweight `assignment_type text not null default 'regular'` column (or an enum with values like `'regular'`, `'acting'`, `'relief'` if you'd rather constrain it) purely for record-keeping and future UI labeling — **it deliberately does not create a second access tier**. An acting or relief magistrate with `is_active = true` gets exactly the same operational access as a permanent one, for exactly as long as the assignment stays active; the RLS predicate never branches on `assignment_type` at all. This satisfies "represent temporary assignments" without adding any complexity to the normal workflow, since ending a temporary assignment is the identical `is_active = false` / `ended_at` operation as ending a permanent one.

## 13. Is explicit Docket sharing still required?

Yes, but for a narrower purpose than before. Ordinary succession (Kamarang example) and ordinary multi-magistrate coverage are now both handled by active court assignment — sharing is no longer the mechanism for either. What sharing remains good for: a magistrate at Court X wants to give a colleague **who isn't assigned to Court X at all** temporary, single-matter access — for a consultation, a second opinion, or narrow coverage on one case — without granting them assignment to the entire court (which would expose every other matter at that court too). That's a genuinely different, finer-grained need than court assignment solves, so I'd keep the `shares` mechanism, scoped exactly as already approved (registered users only, view/edit, fully audited), as the deliberate exception path rather than the everyday one.

## 14. Private material stays inaccessible to successors

No change needed here — and that's worth stating plainly, because it confirms the earlier design was already correct for this exact future scenario. `bench_notes` RLS has never referenced its parent entity's access rules at all (`author_id = auth.uid()`, full stop, no parent lookup) — that was deliberately designed that way specifically so that sharing or reassigning a parent could never cascade into someone's private notes. The same is true of personal Case Law annotations (`case_law_annotations`, owner-only, no exceptions), personal Quick Codes (owner-only), and personally-owned Case Law (owner/share/discoverable, entirely independent of any court). None of these tables reference `docket_matters` for authorization, so the Court-anchoring pivot has zero effect on any of them. A private Bench Note attached to a Kamarang matter remains exactly as invisible to Magistrate B as it was designed to be from the start.

**Judgments are explicitly out of scope for this pivot** — per your own framing in point I, Judgments keep their existing individually-owned model (owner_id, owner-only unlock, `shares`, `is_discoverable`) unchanged. Only `docket_matters` becomes court-anchored.

## 15. Creator/editor and assignment history preservation

Three independent, permanent records together give full accountability: `docket_matters.created_by` (who originally filed the matter — immutable, `RESTRICT`-protected), `docket_matters.last_updated_by` (who most recently made a substantive change — trigger-maintained, always current), and the full, never-deleted `magistrate_courts` row history (exactly who was actively assigned to which court during which periods). None of these three identities function as an access-control gate any more — they're pure provenance.

## 16. Consequences for global search

Minimal, and in the good sense: `search_docket_matters()` and "My Docket" both become "every `docket_matters` row this query's RLS allows," which is now computed via `can_access_court()` instead of `owner_id = auth.uid()` — but since every search function in this schema is `security invoker` and inherits the underlying table's RLS automatically, **no search-function logic needs to change beyond the table's own access predicate**. Filtering by district, by specific court, or by case number remain ordinary `WHERE` clauses layered on top of whatever the RLS already permits, exactly as before.

## 17. Consequences for Outlook integration

This reinforces, rather than complicates, the existing boundary. Because a Docket Matter is now identified by `court_id`/`district_id`/`case_number` rather than by whoever's account created it, a successor magistrate can match incoming Outlook events to the correct existing matter using the same court+case-number lookup regardless of whose calendar the event came from — directly satisfying "successor shouldn't need the predecessor's Outlook calendar." No change to the placeholder columns already planned on `docket_events`.

## 18. Consequences for the audit architecture

The redaction direction already recorded for the eventual audit migration still stands unchanged. One new consideration worth flagging for when that migration is actually designed (not now): since multiple magistrates can legitimately share and edit the same Docket Matter, a redacted, metadata-only audit trail (who/when/what-changed, no content) stops being purely a privacy safeguard against admin access and becomes something the *assigned magistrates themselves* would plausibly want to see as an ordinary collaboration feature — e.g., "who last updated this matter's status." That's a product question for later, not a schema decision needed today; I'm noting it so it isn't lost.

## 19. Which planned migrations need to change

- The previously planned `magistrate_courts` migration needs the full revision in §4 (started_at/ended_at/is_active/assignment_type, partial unique index, CHECK constraint) in place of the earlier simple `unique(profile_id, court_id)` design.
- The previously planned `docket_matters` migration needs `owner_id` removed entirely, replaced by `created_by`/`last_updated_by` (§8), and its RLS completely redesigned around `can_access_court()` (§9) instead of ownership equality, including dropping the DELETE policy.
- Two migrations not previously planned are now needed: `magisterial_districts.is_active` (can't be added to the already-applied `0013`) and `courts.district_id` + `courts.is_active` together (the latter wasn't previously scoped into the courts-link migration).
- A third, new migration is now needed: `docket_matter_assignments` (§9a), for retained/part-heard matter access — a dedicated table, not a reuse of `shares`, created after `docket_matters` exists (it has a FK to it).
- The Docket RLS in the `docket_matters` migration now needs the third `has_retained_assignment()` OR-clause on SELECT and UPDATE, per §9.

## 20. Revised migration sequence

```
0013_magisterial_districts.sql            — APPLIED
0014_seed_magisterial_districts.sql       — APPLIED
0015_seed_east_bank_demerara_district.sql — data-only, fully independent of everything
                                             in this addendum (see §22) — safe to apply
                                             separately whenever you authorize it; NOT
                                             applied as part of this review
0016_reference_data_admin_fields.sql      — magisterial_districts.is_active;
                                             courts.district_id + courts.is_active
                                             (bundled — both exist purely to make these
                                             two reference tables admin-manageable
                                             without further migrations, per §3)
0017_magistrate_courts.sql                — revised schema per §4/§5
0018_docket_matters.sql                   — revised: court-anchored, created_by/
                                             last_updated_by, RLS per §9 (including the
                                             has_retained_assignment() OR-clause), no
                                             DELETE policy
0019_docket_matter_assignments.sql        — new (§9a): retained/part-heard matter
                                             access — profile_id, reason, started_at/
                                             ended_at/is_active, granted_by, partial
                                             unique index, RLS granting full access
                                             (no permission column) to the retained
                                             magistrate; optional status-completion
                                             auto-deactivation trigger (flagged for
                                             confirmation, not assumed)
0020 onward                               — docket_events, docket_matter_parties,
                                             docket_matter_tags, judgments, etc., shifted
                                             one further than previously recorded (net
                                             effect of inserting both the 0016
                                             reference-data-fields migration and this
                                             new 0019 table)
```

This keeps your proposed 0015/0017/0018 numbers for East Bank Demerara, `magistrate_courts`, and `docket_matters` exactly as you specified in point N — the one deviation is broadening what "0016" contains (from "courts/district link only" to "courts/district link + both is_active columns"), which I'd recommend rather than adding yet another standalone migration for two small `ALTER TABLE` statements. Happy to split them back out if you'd prefer strict one-concern-per-migration here.

## 21. Security issues and unintended access paths to consider

- **Stale active assignments are now a real operational risk, not just a schema concern.** Under the ownership model, access was tied to who created something and couldn't silently drift. Under this model, if an admin forgets to deactivate a magistrate's assignment after they actually leave a court, that magistrate retains full docket access indefinitely — a process/hygiene risk rather than a design flaw, but worth naming, since the security boundary now depends on assignment records being kept current.
- **Shared write access among simultaneous magistrates removes any single "responsible party" for day-to-day edits.** Mitigated by `created_by`/`last_updated_by`/the audit trail, but it's an inherent trade-off of court-based access, not something further schema changes would eliminate.
- **`courts.is_active` must NOT feed into `can_access_court()`.** I've deliberately excluded it from the access predicate in §9: `is_active` on `courts` should only gate whether a court appears in *new* assignment/docket-entry pickers, not whether existing active assignments continue to grant access. If a court is later reopened after being marked inactive, magistrates who were never actually removed from it shouldn't have had a gap in access just because the court's own flag was toggled — ending access for a specific person should always go through ending *their* `magistrate_courts` row, not through the court's own status. This is a subtle interaction worth explicitly confirming you agree with, since the alternative (court inactive ⇒ immediate access cutoff for everyone) is a defensible different choice.
- **Removing the DELETE policy is itself a deliberate mitigation**, proposed specifically because shared multi-magistrate write access raises the stakes of any one person being able to unilaterally destroy a record others depend on.
- **`shares` remains a controlled exception, not a loophole** — it's still governed by the already-approved rules (registered users only, explicit view/edit, fully audited), so a magistrate can't use it to casually route around the court-assignment boundary at scale; it only ever grants access one specific matter at a time, deliberately and traceably.
- **`docket_matter_assignments` is narrow by construction, not by convention** — it only ever grants access to the one matter it names, never the court, never other matters at that court, and carries no permission escalation beyond ordinary read/write on that single row's parent matter. The main risk to watch for isn't over-broad access, it's staleness in the other direction: a retained assignment left active long after a matter is actually finished would keep a departed magistrate's access alive unnecessarily — which is exactly why I've flagged the status-completion auto-deactivation trigger (§9a) as worth adopting rather than relying solely on someone remembering to release it manually.
- **The successor-visibility label ("Part-heard / retained by Magistrate A") requires a `profiles` read carve-out that doesn't exist yet** (§9a) — worth resolving deliberately, narrowly, when this is actually built, rather than widening `profiles` SELECT access more broadly than needed.

## 22. East Bank Demerara — independence confirmation

Confirmed: adding the newly constituted East Bank Demerara Magisterial District as a forward `INSERT` migration is completely independent of everything in this addendum — it touches only `magisterial_districts.name` data, the same table and mechanism already used in `0014`, and requires none of the schema changes described above. It's safe to write and apply as its own migration whenever you'd like, separately from this reconciliation. Not applied now, per your instruction to keep it out of this review step unless expressly authorized.

---

**Nothing has been implemented from this addendum. Waiting for your review and approval before writing any of the migrations described in §20.**
