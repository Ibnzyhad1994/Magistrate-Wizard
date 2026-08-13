# 3. Application layers (C4 Level 3)

The SPA never invents access rules. Hooks call Supabase; Postgres RLS decides what comes back. Some editors remain clickable for a view-only share; the write still fails.

```mermaid
flowchart TB
    subgraph Shell["App shell"]
        AP[AppProviders]
        EB[ErrorBoundary]
        TH[ThemeProvider]
        QP[QueryProvider]
        AU[AuthProvider]
        RR[RouterProvider]
        AP --> EB --> TH --> QP --> AU --> RR
    end

    subgraph Routes["Route gates"]
        PUB[PublicRoute<br/>/login /register /forgot-password]
        PR[ProtectedRoute<br/>any authenticated role]
        AD[ProtectedRoute allowedRoles=admin<br/>/admin/court-assignments<br/>/admin/legal-library]
    end

    subgraph Pages["Feature pages"]
        DA[Dashboard]
        DO[Docket list + detail tabs]
        JU[Judgments]
        CA[Case Law]
        LE[Legislation]
        QC[Quick Codes]
        BN[Bench Notes]
        BM[Bookmarks]
        SE[Search]
        AA[Court Assignments]
        LL[Legal Library]
    end

    subgraph Data["Data access"]
        HO[Feature hooks]
        SB[supabase.ts typed client]
        ST[(Postgres RLS)]
    end

    RR --> PUB
    RR --> PR
    RR --> AD
    PR --> DA & DO & JU & CA & LE & QC & BN & BM & SE
    AD --> AA & LL
    Pages --> HO --> SB --> ST
```

## Auth flow

```mermaid
sequenceDiagram
    actor U as User
    participant AP as AuthProvider
    participant AS as Zustand auth-store
    participant SA as supabase.auth
    participant PR as ProtectedRoute

    U->>AP: Open app
    AP->>SA: getSession()
    SA-->>AP: session or null
    AP->>AS: write user + profile
    AP->>SA: onAuthStateChange (lifetime)
    U->>PR: Visit /docket
    PR->>AS: read session
    alt No session
        PR-->>U: Redirect /login
    else Session present
        PR-->>U: Render AppLayout
    end
```

`useAuth()` is the only mutation surface for sign-in, sign-up, sign-out, and password reset. Pages do not talk to Auth directly.

## Docket detail — real tabs

The matter page is the operational workspace. Tabs map 1:1 to child tables or association tables.

```mermaid
flowchart LR
    D["/docket/:id"] --> O[Overview<br/>title, charge, status,<br/>retain / end retain]
    D --> E[Events<br/>docket_events]
    D --> P[Parties<br/>docket_matter_parties<br/>+ ID photo]
    D --> T[Tags<br/>docket_matter_tags]
    D --> J[Judgments<br/>docket_matter_judgments]
    D --> C[Case Law<br/>read-only reverse view]
    D --> DOC[Documents<br/>polymorphic documents]
    D --> S[Sharing<br/>shares item_type=docket_matter]
```

## Provider / store facts

| Layer | Module | Role |
|---|---|---|
| Composition | `src/providers/app-providers.tsx` | Order: Error → Theme → Query → Tooltip → Auth |
| Session | `src/store/auth-store.ts` | Mirrors Supabase user + profile |
| Chrome | `src/store/ui-store.ts` | Sidebar, mobile nav, command palette |
| Routes | `src/routes/router.tsx` | Admin routes are a separate `allowedRoles={["admin"]}` tree |
| Nav | `src/components/layout/nav-config.ts` | Court Assignments and Legal Library are admin-only items |
