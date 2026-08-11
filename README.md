# BenchBook

A legal knowledge management platform for magistrates. The app shell
(routing, auth, layout, reusable UI primitives) and the full Supabase
backend (schema, RLS, storage, search) are in place; feature UI for
cases, bench notes, and the reference library lands in later phases on
top of this base.

## Stack

React 18 · Vite · TypeScript · Tailwind CSS · shadcn/ui · React Router v6 ·
TanStack Query · Zustand · React Hook Form · Zod · Supabase · TipTap

## Getting started

```bash
npm install
cp .env.example .env   # fill in your Supabase project URL + anon key
npm run dev
```

Apply the database schema to your Supabase project (via the CLI, or the
SQL editor pasting each migration in order) — see **`supabase/README.md`**
for the full walkthrough, including the one-time admin/court setup steps:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Other scripts: `npm run build`, `npm run lint`, `npm run typecheck`,
`npm run format`, `npm run supabase:types` (regenerates
`src/types/database.types.ts` from your live schema).

## Architecture

```
src/
  App.tsx                 Composition root: AppProviders + RouterProvider
  main.tsx                React DOM entry point

  providers/               App-wide context providers
    app-providers.tsx      Combines all providers in the correct order
    theme-provider.tsx     Light/dark/system theme, persisted to localStorage
    query-provider.tsx     TanStack Query client + devtools
    auth-provider.tsx      Bootstraps Supabase session, syncs auth-store

  store/                   Zustand stores
    auth-store.ts           Mirrors Supabase session/user/profile
    ui-store.ts              Sidebar/mobile-nav/command-palette UI state

  routes/
    router.tsx               createBrowserRouter route tree
    paths.ts                 Centralized route path constants
    protected-route.tsx      Auth (+ optional role) gate for private routes
    public-route.tsx         Redirects already-authenticated users away

  layouts/
    app-layout.tsx           Sidebar + header shell for authenticated routes
    auth-layout.tsx          Centered shell for login/register/etc.

  components/
    layout/                  Sidebar, header, mobile nav, nav config, user menu
    ui/                      shadcn/ui primitives (button, input, card, dialog, ...)
    common/                  Error boundary, loaders, full-page error state

  hooks/
    use-auth.ts               Sign in/up/out + password reset mutations
    use-media-query.ts        Reactive matchMedia hook (desktop breakpoint)

  pages/
    auth/                    Login, register, forgot-password
    dashboard-page.tsx        Placeholder authenticated landing page
    not-found-page.tsx        404
    unauthorized-page.tsx     403 (role-gated routes)

  lib/
    supabase.ts               Typed Supabase client singleton
    query-client.ts           QueryClient + global error-to-toast wiring
    utils.ts                  cn(), formatting, error-message helpers
    constants.ts               App-wide constants (roles, storage keys, ...)
    validations/auth.ts        Zod schemas for the auth forms

  types/
    database.types.ts         Hand-authored Supabase schema types
    index.ts                  Shared app types (NavItem, ApiError, ...)

supabase/
  migrations/                11 migrations: schema, RLS, storage, search — see supabase/README.md
```

### Auth flow

`AuthProvider` calls `supabase.auth.getSession()` on mount, subscribes to
`onAuthStateChange` for the app's lifetime, and writes the session/profile
into `useAuthStore`. `ProtectedRoute` and `PublicRoute` read that store to
gate the router tree — no route needs to know how auth is implemented.
`useAuth()` is the mutation surface (sign in/up/out, password reset) that
feature code and forms should call.

### Data model

`profiles` (1:1 with `auth.users`, auto-provisioned on signup) sits at
the center, scoped to a `court`. From there: `cases` (+ `case_parties`)
are the primary work unit; `bench_notes` hold TipTap-authored notes,
optionally tied to a case and privacy-scoped to their author; `statutes`
and `case_law` are an admin-curated, court-agnostic reference library;
`tags`, `documents`, `comments`, and `bookmarks` attach to one or more of
the above; `audit_log` is an admin-only append-only trail populated by
triggers on the tables that matter for compliance review. Every table
has row-level security scoping magistrates/clerks to their own court
(via `my_court_id()`/`user_can_access_case()`/`user_can_access_bench_note()`)
while admins see everything. Full details, including the exact commands
to run and the one-time setup after migrating, are in
`supabase/README.md`.

### Adding a shadcn/ui component

`components.json` is configured for the shadcn CLI. Since network access
to the registry may not always be available in this environment, new
primitives can also be hand-added under `src/components/ui/` following
the existing files as a template (Radix primitive + `cva` variants +
`cn()`).

### Conventions

- Path alias `@/*` maps to `src/*` (configured in both `vite.config.ts`
  and `tsconfig.app.json`).
- Route paths live in `src/routes/paths.ts` — never hardcode a path string.
- Query/mutation errors surface globally as toasts (`src/lib/query-client.ts`);
  opt out per-call with `meta: { silent: true }`.
- Role checks use the `UserRole` union in `src/lib/constants.ts`, which
  mirrors the `user_role` Postgres enum.
