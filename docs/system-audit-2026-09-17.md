# Magistrate Wizard — System Audit and Fix Checklist

**Audit date:** 2026-09-17
**Tree audited:** `develop` @ `1011d61` (v0.3.0, 151 migrations 0001–0153, 364 source files / 64k lines, 79 test scripts)
**Method:** static review of the full tree by seven parallel audits (security, accessibility, UI/UX and design system, performance, end-user workflows, code quality, CI/CD and ops) plus a fresh `npm run lint`, `npm run typecheck`, `npm audit`, and `vite build`. Every High/Critical item was checked against the cited file and line; the four most consequential claims were re-verified by hand (marked **[verified]**). Items that need a live environment, a browser run, or dashboard access are marked **[unverified]**.
**Relation to `docs/codebase-audit.md` (2026-09-03):** that document was a feature-gap audit and most of its items have since landed (notifications, versions, sharing, flags, webhooks, DSR, migration CI, Sentry). This document does not repeat it; it covers quality, safety and usability of what now exists.

Checkbox key: `[ ]` proposed, `[x]` implemented in this pass. Severity: **C** critical, **H** high, **M** medium, **L** low. Effort: **S** ≤ half a day, **M** 1–3 days, **L** a week or more.

> **Status update (same day, end of the implementation pass):** items marked `[x]` were implemented in the working tree on 2026-09-17 by six parallel implementation passes plus a coordinator pass (codemods, Prettier, lockfile, local migration apply). `[ ]` items remain open; most are product decisions or multi-day refactors listed under §11 as design-first or Sprint 4. New migrations 0154–0157 are **unapplied to hosted projects** and follow the in-review rule in `DEVELOPMENT_WORKFLOW.md`. The full live suite (`npm run test:live`, 78/78) was run against a from-scratch local stack once Docker was back; 0157 fixes the two defects that surfaced (magistrate own-draft statute reads, `search_statutes` ambiguity).

---

## 0. Hard numbers from this run

| Check                                  | Result                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                    | passes                                                                                                                                                                                                                                                                                        |
| `npm run lint`                         | **fails** — 8 `react-hooks/exhaustive-deps` warnings in `src/pages/dashboard-page.tsx` with `--max-warnings 0`                                                                                                                                                                                |
| `origin/main` vs `origin/develop`      | main is **8 commits behind** (since 2026-09-12); consistent with the lint failure blocking the auto-merge                                                                                                                                                                                     |
| `npm audit`                            | 1 critical, 16 high, 30 moderate. All critical/high are in the build toolchain (`tar`, `electron-builder`, `vite`, `@capacitor/cli`) except **Electron 34.5.8 itself**. Moderate in the shipped bundle: TipTap 2.x (`mergeAttributes` prototype pollution), react-router 6.30 (open redirect) |
| Production build                       | 17 JS chunks, 4.39 MB JS. Main chunk **2.87 MB (830 kB gzip)** contains every page plus TipTap, jsPDF, JSZip, mammoth. pdf.js emitted twice (modern 535 kB + legacy 479 kB)                                                                                                                   |
| `public/`                              | 58 MB, of which `tesseract/` is 54 MB (six core variants; one is ever loaded)                                                                                                                                                                                                                 |
| Prettier                               | 0 of 365 source files conform to `.prettierrc.json`; nothing enforces it                                                                                                                                                                                                                      |
| `as unknown as` / `any` / `@ts-ignore` | 39 / 0 / 1                                                                                                                                                                                                                                                                                    |

---

## 1. Scorecard

| Area                  | Status                        | One-line verdict                                                                                                          |
| --------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Security              | Good, two real gaps           | RLS discipline is excellent; one self-service `court_id` hop and an unowned judgment-lifecycle path need closing          |
| Accessibility         | Partial                       | Landmarks, dialogs, icons and themes are strong; page titles, form labels, focus rings and input contrast are not         |
| UI/UX & design system | Good bones, drift             | Primitives are used consistently; tokens, radii, toasts and dialog dismissal need tightening                              |
| Performance           | Weak at the bundle level      | No route splitting; heavy libs in the entry chunk; N+1 image downloads on the board                                       |
| End-user workflows    | Strong core, rough edges      | Docket and lifecycle invariants are enforced in SQL; offline, notifications, eviction and ingestion recovery are the gaps |
| Code quality          | Good typing, weak enforcement | Layering is clean; formatting, test discovery, docs and god files are the debt                                            |
| CI/CD & ops           | Partial                       | Fast gate exists but is red and silent; no DB deploy path; browser tests never run                                        |

---

## 2. Top 15 (do these first)

1. `[x]` **H/S** Fix the 8 `useMemo` warnings in `src/pages/dashboard-page.tsx` so develop→main can merge again. (§8.1)
2. `[x]` **H/S** Pin `court_id`, `is_active` and `email` in the profiles self-update policy. **[verified]** (§3.1)
3. `[x]` **H/S** Require judgment ownership for `status`/`is_discoverable` changes in `protect_judgment_lifecycle`; scope DELETE to owner. **[verified]** (§3.1)
4. `[x]` **H/S** Stop `lockCurrentSession` from deleting the offline outbox; keep it until explicit sign-out. **[verified]** (§7.7)
5. `[x]` **H/M** Route-level code splitting plus dynamic import of jsPDF, JSZip, mammoth and the TipTap editor. (§6.1)
6. `[x]` **H/S** Per-route `document.title`, route-change live region, focus reset to `#main-content`. (§4.1)
7. `[x]` **H/S** Fix the shared `Field` wrapper so `<label htmlFor>` matches the input `id`; label the ~17 placeholder-only admin inputs. (§4.2)
8. `[x]` **H/S** Global `:focus-visible` outline for all six palettes; Input uses `border-input` and `--input` raised to ≥3:1. (§4.3, §4.4)
9. `[x]` **H/S** Move the full CSP from the `<meta>` tag into `vercel.json` headers; add HSTS and immutable cache headers for `/assets`. (§9.3)
10. `[x]` **H/S** Failure notification for the develop workflow plus a "main behind develop" check. (§9.1)
11. `[x]` **H/M** Run Playwright on develop pushes and make `merge-to-main` depend on it. (§9.2)
12. `[x]` **H/S** Notify the displaced magistrate (and admins) on first-sign-in auto-eviction, replace, co-sit and transfer. (§7.1)
13. `[x]` **H/S** Surface offline replay failures instead of silently dropping them; add an `updated_at` guard to replayed updates. (§7.7)
14. `[x]` **H/S** Dedupe error toasts: one layer only (global mutation-cache subscriber or per-hook `onError`). (§5.1)
15. `[x]` **H/S** Upgrade Electron to a supported major and electron-builder to 26.15+; `npm update react-router-dom`. (§10)

---

## 3. Security

Established invariants from `DEVELOPMENT_WORKFLOW.md` (owner-only quick codes, no admin bypass on judgments/personal case law/bench notes, three-path docket predicate, share view/edit split) were checked and are honoured in code. Nothing below reopens them.

### 3.1 Access control

- `[x]` **H/S** **Self-editable `profiles.court_id` grants access to any court's legacy `cases` rows and their documents.** **[verified]** `supabase/migrations/0132_fix_profiles_self_update_recursion.sql:41-49` pins only `role`; there are no column-level grants on `profiles`; `my_court_id()` (`0002_courts.sql:35-43`) reads `profiles.court_id`; `cases` and case documents gate on it (`0012:90-105`, `0134:48,80`). The 0113 privilege trigger does not audit `court_id` changes. Fix: extend WITH CHECK to pin `court_id`, `is_active`, `email` via a DEFINER helper (same pattern as `current_profile_role()`), add `court_id` to the 0113 audit trigger, add a case to `scripts/tests/test-clerk-access-security.mjs`.
- `[x]` **H/S** **Edit-share recipient can finalise, unlock, delete or make discoverable another magistrate's judgment.** **[verified]** `can_edit_judgment` (`0121:229-247`) accepts `has_item_share('judgment', id, 'edit')`; `protect_judgment_lifecycle` (`0116:127-215`) stamps `finalized_by := auth.uid()` with no owner check. Fix: in the trigger, raise when `status` or `is_discoverable` changes and `old.owner_id <> auth.uid()`; restrict DELETE policy to owner; hide lifecycle controls from non-owners in `judgment-detail-page.tsx:246-260,490-551`.
- `[x]` **L/S** Six RPCs never had PUBLIC EXECUTE revoked: `return_unassigned_magistrate_to_requester` (0135), `correct_unassigned_account_type` (0136), `submit_magistrate_court_request` (0107), `can_manage_clerk_access` (0086), `court_has_no_clerk_approver` (0092), `current_profile_role` (0132). All fail closed, but anon can invoke and read error text. Fix: one forward migration `revoke all ... from public, anon`.

### 3.2 Edge functions

- `[x]` **M/S** Both functions rely only on platform `verify_jwt`; the anon key is a valid JWT. `webhook-dispatch/index.ts:27-37` has no auth check; `clerk-access-notify/index.ts:94-100` trusts a caller-supplied `request_id`. Fix: `admin.auth.getUser(jwt)` and require a real user; for `webhook-dispatch` require the service-role key or a shared cron secret header; for `clerk-access-notify` require the caller to be the request's clerk or an approver. **[unverified]** whether the hosted project has `verify_jwt` off.
- `[x]` **M/S** HTML injection in notification emails: `clerk-access-notify/index.ts:170-174,206` interpolates `full_name`, `email`, `staff_id`, `note`, `rejection_reason` unescaped. Fix: HTML-escape every value or send plain text.

### 3.3 Client, native and headers

- `[x]` **H/S** Electron 34.5.8 carries context-isolation-bypass and UAF advisories (fix ≥ 44). `electron/main.mjs:74-77` opens any URL via `shell.openExternal` and has no `will-navigate` guard. Fix: upgrade; allow only `http(s):`/`mailto:`; add `will-navigate` restricted to the local origin.
- `[x]` **M/S** Android ships `cleartext: true`, `allowMixedContent: true` (`capacitor.config.ts:12,15`), `usesCleartextTraffic="true"` and `allowBackup="true"` (`AndroidManifest.xml:5,10`). Fix: dev-flavour only via `network_security_config.xml` limited to `10.0.2.2`; `allowBackup="false"`.
- `[x]` **M/S** `source_url` anchors render DB-controlled URLs without scheme filtering (`case-law-detail-page.tsx:328`, `legislation-viewer-page.tsx:194`, `legal-library-admin-page.tsx:2598,2801`); `z.string().url()` accepts `javascript:`. Fix: gate on `isSafeHref` (`src/lib/html-sanitize.ts:77`), `.refine(isSafeHref)` in zod, `CHECK (source_url ~* '^https?://')`.
- `[x]` **M/S** Google OAuth: no random `state` nonce (`oauth.ts:82,190-210`); refresh tokens in `localStorage`/Capacitor `Preferences` (`google-calendar/storage.ts:235-250`). PKCE S256 is correct. Fix: random `state` bound to the PKCE verifier; secure storage plugin on native. **Status:** Done: state nonce. Open: secure token storage on native (no plugin installed).
- `[x]` **M/S** react-router 6.30.4 open-redirect advisories; `notifications.link` navigated verbatim (`notification-bell.tsx:143`, `notifications-page.tsx:309`). Fix: `npm update`; guard `startsWith("/") && !startsWith("//")`.
- `[x]` **L/S** Dev token proxy is registered unconditionally with `server.host: true` (`vite.config.ts:25,50-55`); inert in build, but add `apply: "serve"`, loopback binding, and an `Origin` check (`scripts/google-oauth-token-proxy.mjs:40-43`).
- `[x]` **L/S** Sentry has no `beforeSend` PII scrub and no explicit `tracesSampleRate` (`src/lib/sentry.ts:7-10`).
- `[x]` **L/S** Password reset signs out `scope: "local"` only (`use-auth.ts:183-192`); use `global`. Local `config.toml` has `minimum_password_length = 6`; hosted value **[unverified]**.
- `[x]` **L/S** Google Fonts loaded from a third party (privacy; also see §6.5).

### 3.4 Data integrity and abuse

- `[x]` **M/S** Audit hash chain can fork under concurrent inserts (`0126_audit_tamper_evidence.sql:86-93`, `ORDER BY id DESC LIMIT 1 FOR UPDATE`). Fix: `pg_advisory_xact_lock` in `audit_log_assign_hash`.
- `[x]` **M/S** `enforce_rpc_rate_limit` is DEFINER, granted to `authenticated`, with caller-chosen bucket name (`0137:27-76`); bucket table can bloat and limited RPCs are bypassable by direct table reads. Fix: revoke direct EXECUTE, fixed allowlist of names, periodic full cleanup.
- `[x]` **L/S** Webhook URL check allows loopback/RFC1918 and dispatch has no timeout or retry (`0128_webhooks.sql:18,91-150`; `webhook-dispatch/index.ts:53`). **Status:** Done: 10 s timeout, retry RPC, attempts. Open: loopback/RFC1918 block in production.
- `[x]` **L/S** CSV audit export lacks formula-injection neutralisation (`src/lib/audit-export.ts:4-7`).
- `[ ]` **L/S** `record_auth_event` accepts unlimited distinct emails from anon (`0113:219-235`).
- `[ ]` **L/S** `download_my_data()` dumps `to_jsonb(profile)` wholesale (`0137:456-460`).
- `[x]` **L/S** Cached DOCX preview reused without re-sanitising (`document-viewer-dialog.tsx:87-90`; still in a script-less sandboxed iframe).

### 3.5 Security test gaps

- `[x]` **M/M** Add tests for: profiles self-update of `court_id`/`is_active`/`email`; judgment lifecycle by share recipient; edge-function auth; `source_url` scheme; audit-chain concurrency; rate-limit bypass; CSV injection; Android manifest / Capacitor config assertions. **Status:** Done: all but the audit-chain concurrency test.

**Already strong:** RLS on all 59 tables with no `WITH CHECK (true)`; every DEFINER function in 0123–0153 pins `search_path`; no `dangerouslySetInnerHTML` in `src/`; DOMPurify allowlists plus sandboxed `srcDoc` iframes; hash-based CSP with no `unsafe-inline`; tokens in `sessionStorage` unless Remember-me; magic-byte upload checks, 25 MB cap, 60 s signed URLs; rasterised redaction with a test; hash-chained immutable audit log; service-role usage confined to guarded local scripts.

---

## 4. Accessibility (WCAG 2.2 AA)

### 4.1 Navigation and announcements

- `[x]` **C/S** No per-route `document.title` (0 hits in app code), no route-change live region, no focus reset on navigation. Fix: `usePageTitle()` called from `browse-header.tsx:28` and the auth/dashboard pages; a `RouteAnnouncer` (`aria-live="polite"`, `sr-only`) in `layouts/app-layout.tsx`; focus `#main-content` (already `tabIndex={-1}`, `app-layout.tsx:33`) on pathname change; Playwright asserts `page.title()` per route.

### 4.2 Forms

- `[x]` **C/S** Shared `Field` wrapper (`components/legal-library/taxonomy-fields.tsx:35-56`) renders `<label>` as a sibling with no `htmlFor`/`id` — used 41 times (legislation edit, PDF upload panel, taxonomy). Same sibling pattern at `docket/sections/overview-section.tsx:379-386`. 28 `<label>` elements lack `htmlFor`. Fix: `useId()` inside `Field`, pass the id to the child.
- `[x]` **H/S** ~17 placeholder-only inputs in `legal-library-admin-page.tsx:811-853,1207,1241,2809-2887` plus `clerk-access-admin-page.tsx:102`, `magistrate-court-request-review-panel.tsx:259`, `case-law-detail-page.tsx:695,733`, `court-assignments-page.tsx:339`, `clerk-access-requests-page.tsx:181`, `create-bench-note-dialog.tsx:192`, `hearing-progress-section.tsx:535`. Placeholder colour is 2.48:1 in light mode. Fix: migrate to the shadcn `Form`/`FormField` (already wires `aria-describedby`/`aria-invalid`), or `aria-label`.
- `[x]` **M/S** 13 raw `text-destructive` error paragraphs are not linked to their field with `aria-describedby`/`aria-invalid`. **Status:** Done where the field sits in an edited file; remaining sites are wrapped-label forms that pass lint.

### 4.3 Focus visibility

- `[x]` **H/S** Focus is invisible in 4 of 6 palettes on: the "More" nav trigger (`top-nav.tsx:163`, `outline-none` with no ring), TipTap editor (`rich-text-editor.tsx:63`), notification bell items (`notification-bell.tsx:145`, 1.41:1), dropdown items (`ui/dropdown-menu.tsx:78,94,118`, 1.33:1). 31 `outline-none` uses, 7 with no replacement. Fix: promote the high-contrast rule (`index.css:437-440`) to all palettes as `:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px }`; lint-ban bare `outline-none`.

### 4.4 Colour and contrast

- `[x]` **H/S** Input borders fail non-text contrast in every palette including high-contrast: `ui/input.tsx:77` uses `border-foreground/10 bg-card` instead of `border-input` (1.20–1.33:1). `border-foreground/10|15` used 74× vs `border-input` 10×. Fix: `border-input`; raise `--input` to ≥3:1 in all palettes; sweep interactive controls.
- `[x]` **H/M** Opacity-derived text fails 4.5:1: 66 uses of `text-foreground/{60..10}` (light: /60 = 4.45, /50 = 3.28, /40 = 2.48) and they bypass the high-contrast tuning of `--muted-foreground`. Token pairs that fail: light `--stage-progress` as text (3.75), dark `--primary` as text (3.86, used 23× incl. links), dark `--capacity-over` (1.86), colourblind-dark `destructive-foreground` on `destructive` (2.70), HC-dark `primary-foreground` on `primary` (3.96). Fix: codemod `text-foreground/≤60` → `text-muted-foreground`; separate `--link` token for dark; darken light amber; extend `scripts/tests/test-theme.mjs` with contrast-ratio assertions over these pairs.

### 4.5 Dialogs and custom widgets

- `[x]` **H/S** Tour overlay is `role="dialog" aria-modal="true"` with no focus trap, initial focus, restore, or `inert` on the page (`tour-overlay.tsx:206`). Fix: Radix `Dialog`/`FocusScope`; focus the step heading; `inert` on `#main-content`.
- `[x]` **H/S** `legislation-viewer-page.tsx:208` `SheetContent` has no title; 7 `DialogContent` uses lack a description or `aria-describedby={undefined}` (`document-viewer-dialog`, `legislation-pdf-viewer-dialog`, `event-dialog`, `next-date-cell`, hearing-progress/overview/parties sections).
- `[x]` **M/S** Clickable `<div onClick>` per appearance entry (`hearing-progress-section.tsx:215-218`). Use a `<button>`.
- `[x]` **M/S** Notifications "tabs" (`notifications-page.tsx:94-115`) have `role="tab"` without `aria-controls`/roving tabindex; capacity strip buttons (`docket-capacity-strip.tsx:305-322`) carry both `aria-checked` and `aria-pressed`. Use Radix `Tabs` / `aria-pressed` in a `role="group"`.
- `[x]` **M/S** TipTap editor has no `role="textbox"`, `aria-multiline`, or label; toolbar lacks `role="toolbar"`; link insertion uses `window.prompt` (`rich-text-editor.tsx:61-127`).
- `[x]` **M/M** Redaction surface is `role="application"` with pointer-only box drawing (`pdf-viewer-page.tsx:258-264`). Provide a keyboard path or a text alternative.
- `[x]` **M/M** PDF pages are canvas-only; text layer used for search only. Offer a "Text view" toggle using `lib/pdf-text-extraction.ts`.

### 4.6 States, motion, structure

- `[x]` **M/S** Loading not announced: 79 `<Skeleton>` (no `aria-hidden`), 6 `aria-busy`, 6 spinners without `sr-only` text. Fix: `aria-hidden` on Skeleton; shared `LoadingRegion` with `role="status"`.
- `[x]` **M/S** Reduced motion only covers the tour pulse and auth splash (`index.css:566-575`); dialog/sheet/animate-in/pulse are unguarded; 0 `motion-reduce:` utilities. Fix: global `prefers-reduced-motion` block.
- `[x]` **M/S** Auth pages have no h1 (`CardTitle` renders `<h3>`, `ui/card.tsx:35`). Add an `as` prop.
- `[x]` **M/S** 10 `<Table>` uses, none with `aria-label` or `TableCaption`; `aria-sort` 0×.
- `[ ]` **L/S** Desktop `<nav>` unlabelled (`top-nav.tsx:136`); 137 muted-text uses at 10–12 px; truncated titles with no tooltip (`notification-bell.tsx:159`); `toast.error` not promoted to assertive; `overflow-x: clip` on `html`/`body` may hide content at 400 % zoom **[unverified]**.

### 4.7 Tooling

- `[x]` **H/S** Install `eslint-plugin-jsx-a11y` (recommended preset; `--max-warnings 0` already enforced).
- `[x]` **M/M** `@axe-core/playwright` smoke on login, dashboard, docket, judgments, people.

**Already strong:** skip link and `<main id="main-content" tabIndex={-1}>`; landmarks in both layouts; `lang="en"`; viewport allows zoom; Radix dialogs give trap/restore and all 26 have titles; 47/47 icon buttons named; 41 decorative icons hidden; 44 px nav targets; six palettes including true high-contrast and Okabe–Ito colourblind; `prefers-contrast` honoured pre-paint; status never colour-only; `TableHead` defaults `scope="col"`; live regions on save state, offline banner, idle warning.

---

## 5. UI/UX and design system

### 5.1 Feedback and safety

- `[x]` **H/S** Every unhandled mutation error toasts twice: global subscriber (`src/lib/query-client.ts:58-65`) plus per-hook `onError` in 22 files, 12 of which never set `meta.silent` (e.g. `use-docket-tags.ts:46-47`, `use-clerk-access.ts:127,144`, `use-operations.ts:48-49`). Fix: one layer; lint rule that `onError` + `toast.error` requires `meta.silent`.
- `[x]` **H/S** Long dialog forms dismiss on outside-click/Escape with no dirty check: `ui/dialog.tsx` and `ui/sheet.tsx` set no `onInteractOutside`; 12 form dialogs including `create-docket-matter-dialog.tsx:229` (580 lines). `useUnsavedChangesGuard` exists but is used by only 2 pages. Fix: `preventDismissWhenDirty` prop on `DialogContent`/`SheetContent`.
- `[x]` **M/S** Two destructive actions with no confirm or undo: capacity setting delete (`docket-capacity-settings-dialog.tsx:43`) and "Unlink judgment" (`judgments-section.tsx:36,87-92`). All 20+ others are confirmed.
- `[ ]` **M/M** Three save models for editors (bench-note autosave, judgment explicit save + guard, legal-library autosave via `save-state`, dialogs nothing). Fix: one `EditorFrame` with autosave + `SaveIndicator` + guard; state the rule in `docs/workflows-layman/06`.
- `[ ]` **M/S** Validation is submit-only (0 forms set `mode:`). Fix: `mode: "onTouched"` in a shared `useAppForm`.
- `[x]` **M/S** Toasts are visually undifferentiated (`ui/sonner.tsx:19-28`); error copy mixes "Couldn't"/"Could not"/raw `error.message`; `getErrorMessage` (`utils.ts:345-383`) still leaks raw PostgREST text for unmapped errors. Fix: left-border treatment for errors; house style; generic sentence for `/^(PGRST|duplicate key|permission denied|violates)/i` with the raw text sent to Sentry.
- `[ ]` **M/S** Loading idioms split (Skeleton 42 files, spinner 35, `PageLoader` 3, literal "Loading…" 11, 10 page files with none); 19 ad-hoc "No … yet" paragraphs beside 38 `EmptyState` uses. Fix: one-paragraph rule in a UI README and a sweep.

### 5.2 Mobile

- `[x]` **H/S** Inputs are 14 px (`ui/input.tsx:12`, `select.tsx:115`, `textarea.tsx:11`), which triggers iOS zoom-on-focus in the Capacitor build; default Button is 36 px and `size="sm"` (32 px) is used 192×. Fix: `text-base lg:text-sm` and `min-h-11 lg:h-9` on the primitives (as `nav-search.tsx:84` already does). Do not add `maximum-scale`.
- `[ ]` **L/S** Tables scroll horizontally on phones with no fade/shadow affordance (`ui/table.tsx:8`); docket responsive switching is JS-driven (`useIsDesktop`) contrary to the density plan's CSS preference.

### 5.3 Tokens and primitives

- `[x]` **M/S** `rounded-sm` renders 0 px and `rounded` (4 px) is larger than `rounded-md` (2 px) because `--radius: 0.25rem` with `sm: calc(var(--radius) - 4px)` (`tailwind.config.ts:74-78`). 59/51/31 uses respectively. Fix: explicit scale (e.g. sm 2 / md 4 / lg 6) and codemod.
- `[x]` **M/M** Competing conventions: `text-muted-foreground` 322 vs `text-foreground/NN` 147; `border-border` 64 vs `border-foreground/NN` 92. The opacity forms bypass high-contrast tuning (overlaps §4.4). Codemod. **Status:** Done for opacities ≤60 and border /10,/15 (exceptions kept on cinematic surfaces).
- `[x]` **M/M** Domain tokens (`--stage-*`, `--notice-*`, `--capacity-*`) are not registered in Tailwind, so 93 sites write `bg-[hsl(var(--notice-action))]`; amber warning colour is hardcoded 28× in `legal-library-admin-page.tsx` and ignores the colourblind/high-contrast themes; no `Alert` primitive. Fix: register tokens, add `warning`/`success` aliases, add `ui/alert.tsx`.
- `[x]` **L/S** No z-index scale (nine arbitrary values from `z-[60]` to `z-[220]`). Define named tiers in `tailwind.config.ts`.
- `[x]` **L/S** Dead design surface: `netflix.*` colours (0 uses), `font-serif` Source Serif 4 (configured, never loaded or used), `--match` token, `commandPaletteOpen` store state.
- `[ ]` **L/M** Missing primitives: Popover, Combobox/Command, Switch, RadioGroup, Progress, Accordion, date-picker. `select.tsx` is a DropdownMenu emulation; `alert-dialog.tsx` wraps Dialog; batch progress is prose because there is no `Progress`.

### 5.4 Navigation and IA

- `[ ]` **M/M** Command palette is declared (`ui-store.ts:18,38,55,65`) but does not exist; 25 nav destinations sit behind a 5-item bar plus "More"; no breadcrumbs; no keyboard jump. Decide: build (cmdk over `NAV_ITEMS` + recent matters, Ctrl+K) or delete the dead state. Page titles are covered in §4.1.

### 5.5 Copy

- `[x]` **L/S** Mixed UK/US spelling in user-facing text: "Finalize"/"finalized" (`judgment-detail-page.tsx:335,361,363`, `judgment-list-page.tsx:114`), "recognized" vs "cancelled"/"colour". Guyanese convention is British. Also inconsistent capitalisation of Docket Matter / Bench Note in toasts and 4 success toasts without a full stop. **Status:** Done for judgment pages, hooks and the legal-library page; no full-repo sweep.
- `[x]` **L/S** Three raw `toLocaleString()` calls on court PDFs print month-first on US-locale devices (`judgment-detail-page.tsx:206`, `bench-note-detail-page.tsx:166`, `callover-report-button.tsx:44`). Route through `formatDateTime`.
- `[ ]` **L/S** `docs/workflows-layman/03:64` says there is no delete button; the bin page offers permanent purge. Reconcile.

**Already strong:** primitives adopted almost everywhere (6 raw `<button>`, 0 raw `<select>`/`<table>` outside `ui/`); 22 files use `AlertDialog` for destructive actions; `formatDate` enforces `en-GB`; `America/Guyana` pinned for calendar and reminders; docket density plan implemented faithfully with undo toasts and a sticky toolbar; six carefully tuned themes.

---

## 6. Performance

### 6.1 Bundle

- `[x]` **H/M** No route-level code splitting: `src/routes/router.tsx:8-45` statically imports all 38 pages; no `build` block in `vite.config.ts`. TipTap (via `rich-text-editor.tsx` → judgment and bench-note pages), jsPDF (`docket-report-pdf.ts:1`, `export/report-writer.ts:1`, `redaction-pdf.ts:1`), JSZip (`matter-pack-io.ts:1`, `ingest-source.ts:6`), mammoth (`docx-text-extraction.ts:6`) and all admin pages ship to every clerk. Fix: `React.lazy` per route with a `Suspense` fallback in `AppLayout`; `await import()` for jsPDF/JSZip/mammoth/editor at call sites; `manualChunks` for react, supabase, tiptap+prosemirror, radix; add `rollup-plugin-visualizer` and a size budget.
- `[x]` **H/S** pdf.js bundled twice: the `typeof window === "undefined"` branch in `ocr/rasterize-pdf.ts:51-54` and `redaction-pdf.ts:52-54` pulls the legacy build (479 kB) into every native package. Fix: inject the loader from the test harness or gate on `import.meta.env.SSR`.
- `[x]` **H/S** `public/tesseract/` is 54 MB (6 core variants × 3 files, plus `.wasm` and base64 `.wasm.js` duplicates); tesseract.js loads one. A stray uncompressed `eng.traineddata` (5.2 MB) is tracked at the repo root and copied to `public/` but referenced by nothing. Fix: copy only the requested variant in `scripts/copy-ocr-assets.mjs:28-34`; delete the root file; gitignore `public/tesseract`.
- `[ ]` **L/S** Sentry is currently tree-shaken out because the DSN was unset at build; expect roughly 100 kB gzip more once set. Budget for it.

### 6.2 Data fetching

- `[x]` **H/S** Docket board downloads every cover image as a full Blob per row: `use-signed-urls.ts:20-26` calls `storage.download()` for each path in `Promise.all` (board `p_limit: 100`, `docket-list-page.tsx:217-219`; also `home-page.tsx:76`). Fix: `createSignedUrls(paths)` in one call plus `<img loading="lazy">`, or thumbnails via image transforms.
- `[x]` **M/S** Per-row RPC N+1 for share/assignment identities (`use-docket-shares.ts:46-49`, `use-docket-assignments.ts:42-45`, `use-shares.ts:33`). Fix: array-taking RPCs.
- `[x]` **M/S** Legislation viewer fetches every provision with `select("*")` including body text to render a TOC (`use-legislation.ts:461-464`; `legislation-viewer-page.tsx:112`). Fix: narrow select for the nav; fetch the selected provision's body on demand; virtualise long lists.
- `[ ]` **M/M** List pages cap and filter client-side with no pagination: case law `.limit(300)`, judgments 200, bench notes 300, legislation 500, dashboard pulls 400 events; `select("*")` 31×; `React.memo` 0×. Fix: move search/facets to the existing FTS RPCs, `useInfiniteQuery` with keyset pagination, narrow selects on detail hooks.
- `[x]` **M/S** Startup waterfall: `hydrateOfflineStore()` → `getSession()` → `loadProfile()` serially before any route renders (`auth-provider.tsx:57,77,89`). Fix: run the first two concurrently; render the shell from the cached profile and reconcile.
- `[x]` **M/S** Notification bell runs realtime plus a 60 s count poll plus a 5 min page poll (`notification-bell.tsx:53-55`; `use-notifications.ts:27,73,141`). Fix: poll only when the channel is not `SUBSCRIBED`.
- `[ ]` **M/M** Offline store serialises whole JSON blobs to `localStorage` on every write with no size cap (`device-storage.ts:2-3,38`; `offline/store.ts:11-13`). Fix: IndexedDB, per-matter records, LRU cap, quota-exceeded path.

### 6.3 Database

- `[x]` **M/S** 20 policies still use bare `auth.uid()` (bench_notes, tags, documents, comments, bookmarks ×3 each; profiles; issue_reports ×2; cases ×1; `0151:26`). Wrap in `(select auth.uid())`. **Status:** Re-check found only 3 live bare uses (issue_reports ×2, can_manage_clerk_access); 0012 had already wrapped the rest.
- `[x]` **M/M** Heuristic scan flags 32 FK columns with no leading-column index, notably `docket_matter_case_law.docket_matter_id`, `docket_matter_judgments.docket_matter_id`, `docket_matters.district_id`, `shares.item_id`, `statutes.primary_document_id`, `docket_callover_items.created_by`, `webhook_outbox.endpoint_id`, `quick_code_*.quick_code_id`. Composite PKs may already cover some. Fix: run the Supabase performance advisor and `pg_stat_user_tables` before adding. **Status:** Two indexes added; the rest were already covered by leading-column unique indexes.
- `[ ]` **L/S** `can_access_court` is the one RLS helper that is not `SECURITY DEFINER` (`0020:229`); confirm intent.

### 6.4 Measurement

- `[ ]` **L/S** No bundle analyser, size budget, Lighthouse CI, or web-vitals reporting; no PWA/service worker for the web target (asset caching across deploys, offline shell).

### 6.5 Assets

- `[x]` **M/S** Google Fonts as a render-blocking stylesheet (`index.html:57-62`) in an offline-capable, natively packaged app. Fix: `@fontsource/inter` + `@fontsource/cinzel` subset, preload the two woff2 files, drop the origin from the CSP.

**Already strong:** sensible Query defaults (`staleTime` 30 s, `gcTime` 5 min, no refetch on focus); Zustand selectors everywhere; docket board is one RPC with server-side search; audit activity paginated; notifications use explicit columns and `head: true` counts; pdf.js worker, cmaps and OCR worker are lazy and correctly configured; theme resolved before first paint; devtools DEV-gated; no prod sourcemaps; 12 GIN indexes for FTS; offline flush is event-driven.

---

## 7. End-user workflows

### 7.1 Onboarding and court access

- `[x]` **H/S** Silent auto-eviction on first sign-in: when two regulars are approved for one court, the second to sign in has their assignment ended by trigger (`0152:238-283`) with no notification to either the magistrate or admins; the request row stays `approved`; the court-assignments page lists only `ended_at is null` rows (`use-magistrate-court-requests.ts:106-117`), so the user sees "Request a court below" with no explanation. Fix: `notify_user` + `notify_admins` from the trigger; show ended assignments with `end_reason`.
- `[x]` **M/S** Replace, co-sit and transfer (`0152:326-350,564,742,813`) end other regulars without notifying them. Reuse `notify_user('court_ended')` in `end_other_regular_assignments_at_court`.
- `[ ]` **M/M** Sitting end without handover: `relinquish_magistrate_court` (`0108:89-111`), the relinquish dialog (`court-assignments-page.tsx:315-357`) and admin End/Transfer never check for un-retained part-heard matters. Fix: pre-flight count with a "Retain these first" link.
- `[x]` **L/S** Pending magistrates cannot reach Settings or Notifications (`router.tsx:91-100`) while pending clerks can. Allow both.

### 7.2 Daily docket

- `[x]` **M/S** Duplicate case number surfaces as "That already exists." — `docket_matters_district_case_number_unique` (`0020:91`) is missing from `UNIQUE_VIOLATION_MESSAGES` (`utils.ts:286-302`); no pre-submit lookup. Fix: mapping with a link to the existing matter; debounced pre-check in the create dialog.
- `[x]` **M/S** Matter status is a free Select (`overview-section.tsx:164-183`); Completed/Archived irreversibly ends all retained assignments via trigger (`0022:288-296`) with no warning, and reopening does not restore them. Fix: confirm dialog listing retained holders; offer to clear outcome on reopen.
- `[ ]` **M/M** No end-of-day close-out: no view of today's scheduled events still lacking an outcome or next date; `run_scheduled_maintenance` silently flips past hearings (`0124:154-171`). Fix: end-of-day panel on the date-filtered list with bulk "Adjourn to…".
- `[ ]` **L/M** No bulk actions on the docket list (no selection in `docket-list-page.tsx`/`docket-toolbar.tsx`).
- `[x]` **L/S** A matter with all stages done and no outcome stays Active forever; add a "Board complete — set Outcome?" hint. Clerk-created events carry NULL presiding magistrate (`0090:122-131`) with no later prompt to claim them.

### 7.3 Judgments

- `[x]` **H/S** Share-recipient lifecycle gap — see §3.1 (verified).
- `[x]` **M/S** Non-owners see live editing and lifecycle controls gated on `isDraft` only (`judgment-detail-page.tsx:246-260,490-551,810`); Unlock has no confirm (line 344) while Finalise does.
- `[x]` **M/S** Discoverable toggle mutates immediately with no warning, including on drafts (`judgment-detail-page.tsx:576-590`).
- `[ ]` **M/M** Orphan pins: when the author leaves the court the `docket_matter_judgments` row persists but is invisible to the successor and un-unlinkable by the author (`0029:85-131`). Fix: owner may unlink from the judgment side; matter shows "pinned judgment not visible to you".
- `[x]` **M/S** PDF export is unaudited and open to any reader; draft PDFs carry no watermark (`src/lib/export/judgment-pdf.ts`). **Status:** Done: draft watermark. Open: export audit row.
- `[ ]` **L/M** No version diff/compare; unlock sends no notification; `owner_id` ON DELETE RESTRICT with no ownership transfer means departed authors can never be deleted (`0027:30`).

### 7.4 Legal library and search

- `[ ]` **M/L** No docket↔legislation cross-link at all (no `docket_matter_statute*` table or UI). Needs a design review first because of the deliberate asymmetry rule in `DEVELOPMENT_WORKFLOW.md`.
- `[ ]` **M/M** Global search: mixed rank scales, single `LIMIT 40` lets one type crowd others, no type chips, legislation branch searches title/summary only (`0120:366-377`; `search-page.tsx:128`). Fix: per-type limits, type chips, a `statute_provision` branch.
- `[ ]` **L/M** Provision-level editing hooks exist (`use-legislation.ts:472-527`) but no page uses them; bench notes cannot be started from a matter/judgment/case-law page; no personal→canonical "propose to library" path for quick codes or personal case law.

### 7.5 Ingestion

- `[ ]` **H/M** Bulk import is not resumable: retry needs the in-memory `File`; Batch Detail has no Retry (`use-bulk-import.ts:483-498`; `legal-library-admin-page.tsx:1602-1611`); after a refresh rows stay `queued/extracting` forever. Fix: upload originals to storage first so a later session can re-run (the `useReprocessCaseLawExtraction` path already works from storage).
- `[x]` **H/S** Switching tabs unmounts the running import (bulk panel inside `TabsContent`, `legal-library-admin-page.tsx:705-710`); no unmount abort or `beforeunload` guard. Fix: hoist state above the tabs.
- `[x]` **M/S** No no-SQL recovery for stuck rows (`useUpdateImportJob`/`useDeleteImportJob` have no UI consumer); no cron sweep of abandoned in-flight jobs; "Quality: Failed" badge shows no reason (`:1945`).

### 7.6 Notifications and scheduled jobs

- `[ ]` **H/M** Nothing reaches a user who does not open the app: in-app only by design (`0123:3`); the only email path is clerk-access-notify, a no-op without `RESEND_API_KEY`; browser reminders need an open tab. Fix: outbox from `notify_user` to email or Web Push for `hearing_tomorrow` and court decisions.
- `[x]` **H/S** `stale_draft` re-fires daily: 20 h dedupe (`0123:96-105`) against a daily cron, and Dismiss deletes the row which resets dedupe. Fix: `stale_notified_at` on the draft or a 30-day dedupe.
- `[ ]` **M/M** No per-user notification preferences (mute, digest). Cron runs 06:00 server time, likely 02:00 Guyana **[unverified]**.

### 7.7 Offline

- `[x]` **H/S** Idle lock wipes the outbox. **[verified]** `lockCurrentSession` → `clearOfflineForProfile` (`session-lock.ts:53`), which deletes `outbox` as well as cache and profile (`offline/store.ts:96-107`); `runtime.ts:146` calls it on auth expiry. The later unlock flush (commit `bc0fc84`) finds nothing left to send. Fix: clear cache and profile only; keep the outbox until explicit sign-out.
- `[x]` **H/S** Replay failures for permission/validation errors are dropped silently (`flush.ts:55-70` returns `"drop"` with no toast or dead-letter). A magistrate whose sitting ended while offline loses the hearing unseen. Fix: failed list in the banner with reason and discard.
- `[x]` **H/S** Last-write-wins on replayed updates: full-row `.update().eq("id")` with no `updated_at` guard (`runtime.ts:259-262`; `outbox.ts:105-113`), unlike matters. Fix: store the base `updated_at`, add `.eq("updated_at")`, surface conflicts.
- `[ ]` **M/L** Only hearings are queueable; matter, cell, next-date, party, tag, share and bench-note writes throw offline; no service worker so a reload offline fails on web.

### 7.8 Admin operations

- `[x]` **H/S** Webhook signing secret is never shown to the admin (`operations-admin-page.tsx:34-38,214`; `use-operations.ts:54-61`), so endpoints cannot verify HMAC.
- `[x]` **H/S** Webhook "delivered" is set when `net.http_post` is enqueued, not on HTTP success (`0128:120-136`); `failed` rows are terminal with no retry.
- `[ ]` **M/M** No reminders for periodic admin chores (backup verification, hash-chain check, audit export, secret rotation). Fix: Operations health card plus a monthly `admin_chores` notification.
- `[ ]` **M/S** Audit export capped at 200 rows per table, kind-only filter, export itself unaudited (`use-audit-activity.ts:41-56`).
- `[ ]` **M/M** No admin-side DSR export/erase/anonymise per person; only self-service `download_my_data`.

### 7.9 Help and feedback

- `[x]` **M/S** Issue reporters never see status or get a notification (RLS allows self-select, `0103:34-36`; no UI or trigger).
- `[x]` **M/S** Training manual PDF and the layman guides are not linked anywhere in-app.
- `[ ]` **L/S** No screenshot attachment on issue reports; no per-page "?" help.

**Invariants to preserve (enforced in SQL today):** docket belongs to the court and relinquish never touches matters; at most one occupying primary per court and pending requests never occupy; nobody approves their own request; next date only via `set_docket_matter_next_date` (supersede, never overwrite); outcome→status sync one-way; hard delete only via DEFINER not granted to clients; judgments cannot be born final and unlock must be the sole substantive change; no admin bypass on judicial content; bulk ingestion is never bulk publication; sync never turns a successful legal save into a failure; retention purge cannot reach audit or judicial tables; search is RLS-scoped and never client-supplemented.

---

## 8. Code quality and engineering practice

### 8.1 Blocking and enforcement

- `[x]` **H/S** Lint is red on develop (8 `useMemo` dependency warnings, `dashboard-page.tsx:90,109,112,125,132,183`), so the develop→main fast-forward cannot fire; `origin/main` is 8 commits stale and its last commit is itself "fix … so lint can pass". Fix the warnings; add a pre-push hook.
- `[x]` **H/M** Prettier config is dead: 0/365 files conform; no `lint-staged`, `husky`, `.editorconfig`, or `prettier --check` in CI; `.prettierrc.json` says `semi: true, printWidth: 80` but most recent code is no-semi at >100 cols. Fix: choose the majority style, one format-only commit, then enforce.
- `[x]` **H/S** No `engines`, `.nvmrc`, or `packageManager`; three workflows run `npm install -g npm@11.6.2` to work around lockfile drift; `@types/node` is 22 on Node 24. Fix: regenerate the lockfile once, add `engines` + `.nvmrc`, delete the hack, bump `@types/node`.
- `[x]` **H/S** `npm run supabase:types` overwrites `src/types/database.types.ts`, which contains ~50 hand-appended aliases at lines 4713–4760 (`export type Profile = Tables<"profiles">` …) re-exported by `src/types/index.ts`. Following the README breaks the build. Fix: move the aliases to `src/types/index.ts`.

### 8.2 Type safety and validation

- `[ ]` **M/M** 63 `.rpc(` sites and joined selects with 0 runtime validation; 39 `as unknown as` casts (11 in `use-import-jobs.ts`). Fix: zod schemas in `src/lib/validations/rpc/*` with a `parseRows` helper; lint budget on `as unknown as`.
- `[ ]` **L/M** `tsconfig` lacks `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`; ESLint 8.57 (EOL) with legacy config, no `jsx-a11y`, `import/order`, or `no-restricted-imports` (layering is currently clean — lock it in); `e2e/` and `vite.config.ts` are unlinted.

### 8.3 Structure

- `[ ]` **M/L** God files with obvious seams: `src/pages/admin/legal-library-admin-page.tsx` (2,975 lines, 30 inline components, 32 `useState`) → `src/pages/admin/legal-library/{sources,import/*,batches/*,review/*}`; `src/hooks/legal-library/use-import-jobs.ts` (1,284) → keys + repo + 4 hooks; `src/lib/legal-extraction.ts` (1,355) → 5 modules; extract `useAutoClassifyJudgment` (200 lines) from `judgment-detail-page.tsx`.
- `[ ]` **M/S** Duplication: `src/hooks/docket/use-docket-shares.ts` is the pre-polymorphic twin of `src/hooks/shares/use-shares.ts` (delete it); `FieldsCard`/`DiscoverabilityCard` defined in both judgment and case-law detail pages; 18 inline `toLocaleDateString`/`Intl.DateTimeFormat` calls beside `formatDate` helpers; 11 near-identical `create-*-dialog.tsx` files that would share a `FormDialog` shell; 31 `toast.error` calls bypass `getErrorMessage`.
- `[ ]` **M/S** Effects that copy props/URL into state and 14 `exhaustive-deps` suppressions cluster in `date-only-input.tsx`, `taxonomy-fields.tsx`, `legislation-pdf-viewer.tsx`, `next-date-cell.tsx`, `docket-list-page.tsx`, `bench-note-detail-page.tsx`. Key the component on the prop or derive during render.
- `[x]` **M/S** Sentry receives only render errors from the ErrorBoundary; query/mutation failures, OCR failures and 21 `console.error/warn` sites never reach it; 83 `catch {` blocks swallow silently. Fix: `reportError(err, context)` wired into the query-client subscribers and `Sentry.setUser` on auth change.

### 8.4 Tests

- `[x]` **M/M** Test discovery is manual: every script needs an npm alias and a CI line; 15 scripts have no alias, 7 run in CI by raw path, 6 pure-logic scripts (`test-dashboard-insights`, `test-docket-procedure`, `test-docket-matter-bin-purge`, `test-matter-pack`, `test-docket-calendar-mismatch`, `test-case-law-title`) are simply missing from CI; 65/79 re-implement the same `check()` helper. Fix: `scripts/test-support/run-all.mjs` that globs `test-*.mjs`, skips a `// @live-db` tag, and becomes `npm test`; shared assert helper or `node:test`; collapse the ~45-step workflow to a handful.
- `[x]` **L/S** `--experimental-strip-types` is a no-op on Node 24 (60+ copies of the command line); `scripts/test-support/seed-e2e-personas.sql` is untracked and referenced by nothing; Playwright has 6 tests across 3 specs and runs on PRs only (§9.2).

### 8.5 Migrations and dependencies

- `[ ]` **L/S** Undocumented numbering gap at 0140 (0049 is documented). `set_updated_at()` (`0001:30`) and `validate_bookmark_entity()` (`0042:73`) are defined without `SET search_path` **[unverified whether re-pinned later]**. `supabase/README.md` still describes 11 migrations. `supabase/snippets/` is an empty untracked dir.
- `[x]` **L/S** `@napi-rs/canvas` (Node-only) and `@tanstack/react-query-devtools` should be devDependencies; `postinstall` downloads `eng.traineddata.gz` from jsDelivr during `npm ci` (breaks air-gapped installs); `docs/diagrams/tools/__pycache__` is committed. **Status:** Done: both moved to devDependencies. Open: postinstall network fetch.

### 8.6 Documentation

- `[x]` **H/S** `README.md` mis-describes the system: "11 migrations" (151), "dashboard placeholder", "hand-authored types". `supabase/README.md` lists 0001–0011. No root `CLAUDE.md`, ADRs, CHANGELOG, PR template, or CODEOWNERS. `docs/codebase-audit.md` is already stale. `docs/workflows-layman/06`/`07` say sharing is "not built" (it is). Fix: regenerate the README tree; fold the architecture spec + 2 addenda + reconciliation report into one living spec plus `docs/adr/` seeded from the `DEVELOPMENT_WORKFLOW.md` invariants; short root `CLAUDE.md`.

**Already strong:** zero real `any`; strict TS; 249 consistent `if (error) throw error`; single `getErrorMessage`; clean layering (0 page→page, 0 lib→component imports); kebab-case everywhere; Zustand and Query cleanly separated; migrations uniformly named and forward-only; 288/288 functions pin `search_path` in aggregate; 58/60 recent commits follow `type(scope):`.

---

## 9. CI/CD and operations (light)

### 9.1 Visibility

- `[x]` **H/S** The develop gate is red and nobody is told: no failure notification, no README badge, no "main behind develop" alarm. Fix: issue-on-failure or chat notification; scheduled check that fails when main trails develop by more than N commits. **[unverified]** which step fails on GitHub (`gh auth login` then `gh run list --workflow=develop-ci-automerge.yml`).

### 9.2 Gates

- `[x]` **H/M** Playwright runs on `pull_request` only, but the team pushes straight to develop (one PR merge in the last 20 merges), so browser tests never gate anything. Fix: add `push: branches: [develop]` and `needs: [test, smoke-auth, smoke-unauth]` on `merge-to-main`, or adopt PRs with required checks.
- `[x]` **M/S** Develop job: no `timeout-minutes`, no `concurrency` group, no `cache: npm`, workflow-level `contents: write` for a 40-step job running third-party code (only `merge-to-main` needs write); `build-check-ios.yml` has no `permissions:` block; third-party actions pinned by tag not SHA.
- `[x]` **M/S** Migration CI is path-filtered, so a frontend commit depending on a hosted-only schema change is never caught. Run it on every develop push (cached, ≤25 min).
- `[x]` **L/S** `npm audit` is `continue-on-error` with 10 Dependabot branches unmerged. Merge/close them, then block on `critical`. **Status:** Done: blocks on critical; Dependabot PRs still to merge.

### 9.3 Deployment and headers

- `[x]` **H/S** Full CSP is a `<meta>` tag (`vite.config.ts:20-38`); `vercel.json` sends only `frame-ancestors 'none'`. Meta CSP cannot carry `frame-ancestors`, `report-to`, or `sandbox` and applies late. Missing `Strict-Transport-Security` and `Cache-Control: immutable` for `/assets/(.*)`. Fix: emit the hashed CSP into `vercel.json` headers (asserted by `test-csp.mjs`); keep the meta tag for the Capacitor/Electron shells only.
- `[x]` **H/M** No automated DB deploy path: migrations reach production by manual `supabase db push`; edge functions by manual `supabase functions deploy`; schema-alignment only warns and explicitly does not block the merge. A frontend depending on 0153 can deploy before 0153 is applied. Fix: `deploy-db.yml` on push to main (paths `supabase/**`) with `db push --dry-run` then `db push` + `functions deploy`, gated by an environment with required reviewers; or make `merge-to-main` fail when prod is behind.
- `[x]` **M/S** No post-deploy smoke, uptime check, or written rollback procedure (Vercel promote-previous plus forward-only migrations). Add a `smoke-prod.yml` that curls `/login` and checks the CSP header; one paragraph in `docs/backup-and-recovery.md`.
- `[x]` **M/S** Android release attaches an APK to a GitHub Release even when unsigned (`release-android.yml` gates only on the tag; `android/app/build.gradle:23-24` falls back silently). Gate on the keystore secret.
- `[x]` **M/S** Versioning is undocumented and divergent: tags stop at `v0.2.0-alpha.2` while `package.json` is 0.3.0; no CHANGELOG; Electron NSIS built locally only, unsigned, no auto-update. Document the bump→sync→tag flow; add `release-electron.yml`; consider `release-please`. **Status:** Done: release doc, CHANGELOG, release-electron workflow. Open: signing, auto-update, a v0.3.0 tag.
- `[x]` **L/S** Environment topology lives only in `docs/develop-preview-followup.md` (prod + preview Supabase refs, two Vercel teams, one found serving a stale bundle). Add `docs/environments.md`.
- `[x]` **L/S** Backup runbook lacks PITR confirmation **[unverified]**, bucket backup, restore-drill cadence, RTO/RPO; pg_cron jobs (0120 purge, 0124 maintenance) have no "did it run" monitoring. **Status:** Done: rollback, drill cadence, RTO/RPO placeholders. Open: PITR confirmation, bucket backup, cron monitoring.
- `[x]` **L/S** No PR template, CODEOWNERS, issue templates, or pre-commit hooks; the 13-step DB change process in `DEVELOPMENT_WORKFLOW.md` has no tooling support. Add a PR template mirroring that checklist. **Status:** Done: PR template, husky + lint-staged. Open: CODEOWNERS (no handles known).

**Already strong:** fast-forward-only merge with a clear divergence note; CodeQL on both branches; Dependabot; PR workflows scope `contents: read` and set timeouts; Supabase CLI cached; only `VITE_*` values enter the build; hash-based CSP with a regression test; version sync script for native; candid dated ops notes.

---

## 10. Dependency upgrades (from `npm audit` and version lag)

| Package                           | Now     | Target              | Why                                                                                      | Effort |
| --------------------------------- | ------- | ------------------- | ---------------------------------------------------------------------------------------- | ------ |
| electron                          | 34.5.8  | ≥ 44.4              | context-isolation bypass, UAF, ASAR bypass advisories                                    | M      | ✅ done |
| electron-builder                  | 25.1.8  | 26.15+              | clears the critical `tar` and the high `builder-util-runtime` credential-leak advisories | S      | ✅ done |
| react-router-dom                  | 6.30.4  | 6.30.x patch (or 7) | open redirect via backslash; `fixAvailable: true` non-major                              | S      | ✅ done |
| @tiptap/*                         | 2.27    | 3.31+               | `mergeAttributes` prototype pollution (moderate, shipped bundle)                         | M      |
| vite                              | 5.4     | 6.x/7.x             | dev-server path traversal and esbuild request advisories (dev only)                      | M      |
| @capacitor/*                      | 6       | 8.5                 | `@capacitor/cli` tar advisory; two majors behind                                         | M      |
| eslint                            | 8.57    | 9 flat config       | EOL; enables `jsx-a11y` and stricter presets cleanly                                     | M      |
| tailwindcss / @hookform/resolvers | 3.4 / 3 | 4 / 5               | version lag only; codemods exist                                                         | M      |

---

## 11. Suggested sequencing

**Sprint 0 — unblock and close the two access gaps (≤ 1 week).** Items 1–4 and 9–10 of the Top 15; `npm update react-router-dom`; electron-builder bump; lockfile/engines fix; move the type aliases; revoke the six PUBLIC executes; escape the email HTML.

**Sprint 1 — safety and feedback (1–2 weeks).** Offline replay visibility and `updated_at` guard; eviction/displacement notifications; toast dedupe; dialog dirty-guard; duplicate case-number message; matter status confirm; webhook secret display and honest delivery status; stale-draft dedupe; Playwright on develop pushes; CSP as a header.

**Sprint 2 — accessibility and mobile (1–2 weeks).** Page titles and route announcer; `Field` label wiring and admin form labels; global focus ring; `border-input` and token contrast fixes with a contrast test; tour dialog focus management; sheet/dialog names; mobile-first primitive sizing; `jsx-a11y` lint; axe smoke.

**Sprint 3 — performance (1–2 weeks).** Route splitting and dynamic heavy-lib imports; batched signed URLs or thumbnails; drop legacy pdf.js from the browser build; trim `public/tesseract`; self-host fonts; parallel bootstrap; provision select narrowing; batched identity RPCs; advisor pass on `auth.uid()` policies and FK indexes.

**Sprint 4 — engineering hygiene (ongoing).** Prettier reformat then enforce; `run-all.mjs` test runner and single `npm test`; README/docs rewrite plus ADRs; god-file splits; zod validation layer for RPCs; Electron 44 and TipTap 3 upgrades; DB deploy workflow; release/versioning docs.

**Product follow-ups (design first).** Ingestion resumability; out-of-app notification delivery and preferences; end-of-day close-out and bulk adjourn; docket↔legislation links; handover pre-flight on sitting end; command palette decision; admin chores card; issue-report status for reporters.
