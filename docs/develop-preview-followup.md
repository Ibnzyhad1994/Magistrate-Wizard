# Develop preview follow-up (court assignment + access)

Checked 31 Aug 2026 against
[magistrate-wizard-git-develop-teriq-projects.vercel.app](https://magistrate-wizard-git-develop-teriq-projects.vercel.app/admin/court-assignments)
and its hosted database (`kmfjejfsbtvbhvpoxvhb.supabase.co`).

This is a punch list, not a product spec. Current `main` / `develop` **source** already contains most of the intended behaviour. The Teriq Vercel preview was serving an **older bundle**, so testers saw the old rules.

Do **not** confuse that host with:

- Production (`gipijpeahkznfwitjccy.supabase.co` / magistrate-wizard.vercel.app)
- Local Docker (`127.0.0.1:55321`), which was only at migration **0070** and still uses the old `*@benchbook.local` seed

---

## 1. Do this first (unstick the preview)

1. Confirm which Git SHA Teriq’s Vercel project actually builds (`magistrate-wizard` on the **teriq-projects** team, branch `develop`). It was **behind** `origin/develop` when checked: no Pending Requests UI, no `/court-assignments` page.
2. Merge or reset that project onto current `origin/develop` (same SHA as `origin/main` when last checked) and **redeploy**.
3. After deploy, hard-refresh and verify:
   - `/court-assignments` exists (not a 404).
   - `/admin/court-assignments` has **Pending Requests** and **Waiting for assignment**, not search-only roster.
   - An unassigned magistrate cannot open Dashboard / Case Law / Judgments / Legislation. They are sent to `/court-assignments`.
4. Only then re-test “a user requests a court and the admin sees it.” Until the new UI is live, requests cannot be filed on that preview, and the admin page cannot show them.

Current source already gates those routes with `requireApprovedMagistrateCourt` (`src/routes/router.tsx`, `src/lib/protected-route-gate.ts`) and hides the extra nav links for a pending magistrate (`src/components/layout/nav-config.ts`).

---

## 2. What was wrong on the live preview

### Admin roster vs requests

- The preview Court Assignments screen was **search → assign** only. No pending-request inbox, no waiting list.
- `/court-assignments` (magistrate self-service) **404’d**, so nobody could submit a request.
- The database **did** have `magistrate_court_requests`. There were **zero pending** rows. Three older **approved** rows existed (seed/bootstrap that morning). Unassigned people had never got a request row because they had no UI to create one.

### Unassigned magistrate still saw Case Law

Reported on `/dashboard` for an unassigned magistrate (Samir Mohammed): full nav, Case Law still open, banner *“Judgments, Case Law, Quick Codes, and Bench Notes remain available.”*

That banner is the **old** product rule (library open, only Docket needs a court). Current `develop` is supposed to lock the full suite until a court is approved. The preview bundle still shipped the old rule, which is why the screenshot happened.

### Roster on that database (spot-check)

Active assignments matched the admin UI when a profile was searched (e.g. Teriq at Kamarang + Vigilance 1). Unassigned magistrates with no request row still need either:

- an admin **Assign** on the roster, or
- a working request flow after redeploy.

Hand-assigning (as with some sittings that day) never creates a pending request. That is expected.

---

## 3. What else to fix (after the preview matches source)

### Product copy that still lies

`src/pages/dashboard-page.tsx` still says Case Law / Judgments remain available without a court. Magistrates without a court should never reach that page. The sentence is leftover and will confuse the next stale deploy. Replace it (or drop the `noCourts` magistrate billboard) so it matches the gate: request a court, do not browse the library.

`docs/workflows-layman/02-court-assignment.md` still says a magistrate cannot request a sitting and cannot end their own assignment. Source now has `/court-assignments` request + relinquish. Update the layman guide (and any PDF rebuild) so it matches.

### Route gate vs database (RLS)

The lock is **UI/route** only. Published canonical Case Law is still readable under RLS without a `magistrate_courts` row (`can_view_case_law()` / Case Law SELECT). A stale client or a direct API call can still fetch the library. Decide whether unassigned magistrates should be blocked in Postgres too, or whether the route gate is enough.

Clerks are already kept out of the library by role. Do not mix that up with the magistrate-without-court case.

### Local database lag

A local `supabase start` that has not been reset is missing `magistrate_court_requests`, clerk request tables, and everything after **0070**. You cannot reproduce the request inbox locally until `npm run db:reset` (or equivalent) applies through **0116**. Do not debug preview bugs against that old local roster.

### Admin review edge cases (already in source, confirm on the new deploy)

- Pending requests should show even if the requester has not confirmed email (**0115** + `list_magistrate_court_request_email_confirmation`).
- Approving a request must create an active `magistrate_courts` row; the person should leave **Waiting for assignment**.
- Primary exclusivity: ending one sitting so another magistrate can take that court is how succession works; the old request stays **approved** in history even if that sitting was later ended.
- Embedding `profiles` on `magistrate_courts` can fail (more than one FK to `profiles`). Admin assignment queries should keep using the `courts(...)` embed, not a bare `profiles(...)` join.

### Other hosts

- **Production PDF viewer:** signed Storage URLs in an iframe were blocked by `frame-src 'self' blob:`. `main` later previewed PDFs with **pdf.js** (`5150de3`) instead of relying on that iframe. If production still iframes Storage, CSP must allow the Supabase origin (`scripts/content-security-policy.ts` / `vite.config.ts`).
- **Two hosted projects:** preview data is not production data. Assignments and requests must be checked on the project the Vercel env `VITE_SUPABASE_URL` points at.
- Teriq’s Vercel team is not the same as every other Cursor/Vercel login. Redeploy has to happen on **teriq-projects**, or the Git remote that feed that preview must be fast-forwarded.

### Leftover local file (do not commit unless wanted)

`scripts/seed-legal-library/rerun-attachments.mjs` is untracked scratch. Keep it out of the request/access work.

---

## 4. Suggested verification after redeploy

1. Admin: `/admin/court-assignments` → Pending Requests count matches `select count(*) from magistrate_court_requests where status = 'pending'`.
2. Unassigned magistrate: sign in → only `/court-assignments` (and auth). `/dashboard`, `/case-law`, `/judgments`, `/legislation` redirect.
3. Submit a request → it appears on the admin Pending tab without searching the roster.
4. Approve → active sitting appears; requester can open Docket for that court; they disappear from Waiting.
5. Clerk path (separate page): `/admin/clerk-access` vs magistrate requests. Zero clerk rows on the preview DB when checked; do not assume that inbox is the magistrate inbox.

---

## 5. Why this note exists

Testers were looking at a **stale preview** while `main` already had the court-request inbox and the unassigned-magistrate lock. The database was ahead of that UI in some places (tables present) and the UI was behind in others (no request page). Fix the deploy first; then the copy, layman docs, and optional RLS tightening.
