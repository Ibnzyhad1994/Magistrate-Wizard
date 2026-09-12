# Day-in-the-life 30-persona hold/break report

**Run:** `DL24FOG`  
**When:** 10 Sep 2026  
**Target:** local API `http://127.0.0.1:56321`, UI `http://localhost:5373`  
**Mode:** report only — no product code, schema, or migration changes  
**Harness:** `npm run test:daylife-30` (`scripts/tests/daylife-30-personas.mjs`)  
**Machine log:** `scripts/tests/daylife-30-results.json` (gitignored)

Users were created the way register works: Auth Admin `createUser` with `user_metadata.requested_role`, `requested_court_ids`, `staff_id`, and `note`, so `handle_new_user()` opened **pending** `magistrate_court_requests` / `clerk_access_requests`. Approvals used `decide_*` RPCs as the signed-in admin or magistrate. Docket and research writes used the same PostgREST + RLS path as the UI.

**31 unique people** were dispatched (password for all: `password123`). Seed `admin@magistrate-wizard.local` was the Court Assignment Administrator.

Harness result: **92 pass / 2 fail** steps. Findings below re-score those two fails in context.

---

## Verdict summary

| Verdict | Meaning | Count (this run) |
|---------|---------|------------------|
| **Holds** | Prevented or recoverable in-product | 22 from the harness, plus UI gates confirmed in the browser |
| **Degrades** | RPC/SQL works, or listing works, but the UI has no control or hides a valid next step | 5 (including multi-magistrate clerk approval) |
| **Breaks** | Deadlock: no in-app admin action completes the job without SQL | 1 cluster: `can_manage_clerks` with no UI |

Nothing in this run corrupted assignments, duplicated pending rows, or let an unassigned magistrate write a docket matter.

---

## How to sign in as the cast

All emails are `@magistrate-wizard.local`. Password: `password123`.

| Email prefix | Role / state |
|--------------|----------------|
| `daylife.mag01` … `mag10` | Magistrates, approved (mag01 Acquero, mag02 Friendship, …) |
| `daylife.clerk01` … `clerk08` | Clerks paired to mag01–08. **clerk01 and clerk02 are still pending** (see break). clerk03–07 approved. clerk08 was rejected then re-requested via RPC. |
| `daylife.wrongcourt1` | Returned (requested occupied Aishalton) |
| `daylife.wrongcourt2` | Returned, then wrongly approved, then assignment ended |
| `daylife.clerkasmag` | Signed up as magistrate; admin corrected to **clerk** |
| `daylife.magasclerk` | Signed up as clerk; admin corrected to **magistrate** |
| `daylife.cancelled` | Cancelled, requested again, then returned |
| `daylife.pending` | Still pending (Leonora 1) — left for the admin inbox |
| `daylife.duplicate` | Duplicate submit blocked; original still pending |
| `daylife.orphanclerk` | Clerk at Leonora 2 with no clerk approver |
| `daylife.multi` | Two courts approved (Georgetown 8 and 9) |
| `daylife.covering` | Own court plus **acting** on Acquero (RPC) |
| `daylife.empty` | Approved, empty docket |
| `daylife.outsider` | Never requested a court |
| `daylife.relinquish` | Approved then self-relinquished |

---

## What holds

### Signup and requests

- Empty `requested_court_ids` creates a magistrate with **no** pending request (outsider).
- Omitting `requested_role` creates a **magistrate** (the clerk-as-magistrate mistake).
- `requested_role=clerk` creates a **clerk** (the magistrate-as-clerk mistake). Signup cannot become admin.
- Register UI (`/register`): neither Magistrate nor Court Clerk is pre-selected; district stays disabled until a type is chosen.
- Duplicate pending for the same court: RPC error `You already have a pending request for this court`.
- Magistrate can **cancel** then **request the same court again**.
- Occupied-court request can be **returned** with a required reason (`decide_magistrate_court_request`).
- Roster **return** (`return_unassigned_magistrate_to_requester`) works with a reason and writes `court_request_decided`.
- **Correct account type** magistrate ↔ clerk works when there is no active court; writes `account_type_corrected`.
- Admin can **end** a mistaken assignment (`relinquish_magistrate_court`). There is no “undo approve” on the request row; ending is the recovery.
- Magistrate can **self-relinquish** a primary assignment.
- Two courts in signup metadata → two pending rows → two assignments after approve (`daylife.multi`).
- `decide_magistrate_court_request` still blocks self-approval (no own pending row for seed admin this run).

### Sitting day (mag01, Acquero)

As the seated magistrate, RLS allowed: create matter `DL-DL24FOG-01`, accused, hearing, procedure patch, next date, draft judgment + link, bench note, bookmark, global search (3 hits), daily docket report (1 row), callover create + populate, bin + restore, share with clerk01.

Statutes browse returned **0 rows** — the local library is empty, not an access bug.

### Isolation

- Unassigned magistrate **cannot** insert `docket_matters` (RLS).
- Browser: `daylife.outsider` lands on `/court-assignments` (“Access is limited until a court is approved”). Navigating to `/docket` is bounced back there. Nav has no Search/Notifications while pending.
- Approved clerk **cannot** insert `judgments` or `docket_callovers` (RLS). clerk01 could still **list** a matter after mag01 shared it, even though clerk01’s court request was never approved — share is a separate grant.

### Admin UI (browser)

- Pending Requests showed **Return to requester** (not generic Reject) for Duplicate Mag and Left Pending.
- History showed return reasons (“That court already has a sitting magistrate…”, “Please request a court that does not already have a magistrate.”).
- People search found `daylife.clerkasmag` as a directory row with a role **badge only** — no edit/correct controls on that page (recovery is on Court Assignments roster).

---

## Degrades (works underneath, UI or process is incomplete)

### 1. Clerk cannot pick a court they already requested (UI)

`submit_clerk_access_request` **allowed** clerk08 to open a new pending row for the same court after reject.

[`src/pages/clerk/clerk-access-page.tsx`](src/pages/clerk/clerk-access-page.tsx) builds the picker from every historical `court_id` (`requestedCourtIds`), including rejected and cancelled. The clerk’s next step after a return is therefore hidden even though the RPC would accept it.

**Admin remedy today:** none needed if the magistrate approves a *new* RPC row; the clerk cannot create that row from the UI. Workaround: magistrate/admin cannot submit a clerk request on their behalf. Practical workaround is SQL or a magistrate asking them to request a *different* court.

### 2. Admin cannot approve orphaned clerk requests

`list_clerk_access_requests_needing_admin_attention` works. Browser `/admin/clerk-access` listed:

- Daylife Clerk 1 — Acquero (no authorized reviewer)
- Daylife Clerk 2 — Friendship (no authorized reviewer)
- Daylife Orphan Clerk — Leonora 2

Each row only has **Fix Court roster**. Seed admin calling `decide_clerk_access_request` failed: `You are not currently authorized to review access requests for this court`.

**Intended recovery:** seat a magistrate who can review, then they approve. There is no admin Approve button. That is survivable **if** a sole magistrate exists. It fails when the court already has magistrates but none may review (next item).

### 3. Acting/relief exists on the RPC, not on the roster Assign control

`admin_assign_magistrate_court(..., p_assignment_type: 'acting')` seated covering Mag as acting at Acquero. The roster still calls `mutate(courtToAssign)` as a **string**, which always creates `regular` ([`use-court-assignments.ts`](src/hooks/admin/use-court-assignments.ts), [`court-assignments-page.tsx`](src/pages/admin/court-assignments-page.tsx)).

**Admin remedy today:** Settings acting self-seat for the admin’s own docket; for anyone else, SQL or calling the RPC.

### 4. People is read-only, but admin JWT can still `UPDATE profiles.role`

The harness updated `daylife.pending` to clerk via PostgREST as the admin, then restored the role. The People page cannot do that. Role mistakes are supposed to go through `correct_unassigned_account_type` (gated: no active courts, not self, magistrate↔clerk only).

**Risk:** a homemade admin client could bypass those gates. The product UI does not.

---

## Break: multi-magistrate courts freeze clerk approval

`can_manage_clerk_access()` is true if the caller is the **sole** current magistrate at that court **or** `magistrate_courts.can_manage_clerks = true`. The column defaults to **false**. There is **no admin UI** to set it.

This run:

| Court | Magistrates currently seated | clerk01/02 approve |
|-------|------------------------------|--------------------|
| Acquero | mag01 (regular) + covering (acting, this run) + persona.novice (acting, leftover) | **Denied** |
| Friendship | mag02 (regular) + persona.covering (relief, leftover) | **Denied** |
| General Magistrate Court | mag03 only | **Allowed** (clerk03) |

Adding a covering/acting magistrate — a normal “help with the list” mistake — turns a working clerk inbox into an orphan. Admin unresolved then says “fix roster”, but ending the extra sitting or flipping `can_manage_clerks` is **SQL only**.

**What admin can do today (not in UI):**

```sql
-- either flag a reviewer
update public.magistrate_courts
set can_manage_clerks = true
where profile_id = '<mag-id>' and ended_at is null;

-- or end leftover acting/relief so one magistrate remains sole
```

Until then, clerks 01 and 02 stay pending even though their magistrates are seated and doing docket work.

This is the only **break** in the sense of “the intended in-app recovery does not complete the job.”

---

## Human errors injected vs outcome

| Mistake | What we did | Outcome |
|---------|-------------|---------|
| Wrong court at signup | Occupied Aishalton | Admin return with reason — **holds** |
| Cancel then need the court again | Cancel + submit same court | **Holds** for magistrates; **degrades** for clerks (picker) |
| Double-submit | Second pending | Clean RPC error — **holds** |
| Clerk signed up as magistrate | `correct_unassigned_account_type` → clerk | **Holds**; notification sent |
| Magistrate signed up as clerk | Correct → magistrate | **Holds** |
| Admin approved the wrong court | Approve then end assignment | **Holds** (no undo-approve) |
| Covering magistrate added to a court | Acting RPC | Clerk approval **broke** at that court |
| Clerk at a court with no reviewer | Orphan list | Listed, cannot approve — **degrades** |
| Unassigned mag opens the suite | `/docket` | Redirect to court-assignments — **holds** |
| Clerk writes a judgment | Insert | RLS deny — **holds** |

---

## Browser sample (not all 31)

- `/register`: no default account type.
- `/admin/people`: directory only.
- `/admin/court-assignments`: pending (2), Return to requester, history with reasons.
- `/admin/clerk-access`: three unresolved rows, Fix roster only.
- `daylife.outsider`: locked to `/court-assignments`.

---

## Re-run

```bash
npm run test:daylife-30
```

Idempotent on email: existing `daylife.*` profiles are reused. Do **not** `db reset` if you want this cast to remain.

Fixes are out of scope for this pass. Highest-value follow-ups if you want a product change next:

1. UI to set `can_manage_clerks` (or treat primary as reviewer even when acting/relief exist).
2. Clerk picker: allow courts whose latest request is rejected/cancelled.
3. Admin Approve on unresolved clerk requests, or document that roster-only is the rule.
4. Roster Assign: acting/relief type picker.
