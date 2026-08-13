# 9. User journeys

Actors, screens, and blocked paths as implemented in the SPA.

![A sitting day versus an admin day](assets/user-swimlanes.png)

## Personas

```mermaid
flowchart TB
    subgraph Unassigned["Registered, no Court"]
        U1[Can: research library, write personal Case Law,<br/>Judgments, Quick Codes, Bench Notes, Bookmarks]
        U2[Cannot: create Docket Matters]
        U3[Can: open matters retained or shared with them]
    end

    subgraph Sitting["Magistrate with current Court"]
        S1[Full Docket for that Court]
        S2[Create matters, events, parties]
        S3[Retain a matter before leaving]
        S4[Share a matter view or edit]
        S5[Link own Judgments / readable Case Law]
    end

    subgraph AdminP["Administrator"]
        A1[Assign / end Court sittings]
        A2[Import and publish Case Law + Legislation]
        A3[No automatic Docket visibility]
    end
```

## Journey A — First login

```mermaid
flowchart TD
    Start([Open app]) --> Session{Session?}
    Session -->|No| Login[/login/]
    Login --> Auth{Credentials ok?}
    Auth -->|No| Login
    Auth -->|Yes| Dash[/dashboard/]
    Session -->|Yes| Dash
    Dash --> Courts{Current magistrate_courts?}
    Courts -->|Yes| Work[Today's Courts, upcoming appearances,<br/>active matters, retained, drafts]
    Courts -->|No| Empty[Dashboard still works.<br/>Library / notes / judgments available.<br/>Docket create is blocked]
```

Register (`/register`) creates `auth.users` + `profiles`. It does **not** assign a Court.

## Journey B — Sit a Court (admin)

```mermaid
flowchart TD
    A[Admin opens /admin/court-assignments] --> P[Pick a profile]
    P --> C[Pick an active Court]
    C --> I[INSERT magistrate_courts]
    I --> L[Magistrate immediately has<br/>can_access_court for that Court]
    L --> E[Later: Admin sets ended_at]
    E --> R{Magistrate retained matters?}
    R -->|Yes| Keep[Those matters remain via Path 2]
    R -->|No| Gone[That Court's Docket disappears for them]
```

Magistrates cannot insert or end their own Court assignment in V1.

## Journey C — Work a matter (magistrate)

```mermaid
flowchart TD
    L[/docket list/] --> Create{Has current Court?}
    Create -->|No| Blocked[Cannot create.<br/>List still shows retained + shared]
    Create -->|Yes| New[Create: court, case number, title]
    New --> Detail[/docket/:id/]
    L --> Detail
    Detail --> O[Overview: charge, orders, outcome, status, cover, retain]
    Detail --> E[Events: date required, time optional]
    Detail --> P[Parties: type + role, ID photo]
    Detail --> T[Institutional tags]
    Detail --> J[Judgments tab: link a Judgment you own]
    Detail --> C[Case Law tab: read-only reverse view]
    Detail --> D[Attach documents]
    Detail --> S[Share view or edit]
```

## Journey D — Leave a Court but keep a part-heard matter

```mermaid
flowchart TD
    Sit[Currently assigned to Court] --> Retain[Overview: Retain this matter]
    Retain --> Check{can_access_court right now?}
    Check -->|No| Fail[Blocked — you cannot originate access]
    Check -->|Yes| Row[Self-only assignment row<br/>reason = retained_part_heard]
    Row --> AdminEnds[Admin ends Court assignment]
    AdminEnds --> Keep[You still see THIS matter only]
    Keep --> Done{Matter completed or archived?}
    Done -->|Yes| Auto[Trigger ends the retained row]
    Done -->|No| Self[You may end it yourself]
```

A successor assigned to the Court also sees the matter. Retained access is **not exclusive**.

## Journey E — Write and finalize a Judgment

```mermaid
flowchart TD
    J[/judgments/] --> N[Create — always draft, always yours]
    N --> E[Edit content, tags, documents]
    E --> Disc{Make discoverable?}
    Disc -->|Yes| Read[Others may read, never edit]
    Disc -->|No| Priv[Only you]
    E --> Fin[Finalize]
    Fin --> Lock[Substance locked]
    Lock --> Un{Unlock?}
    Un -->|Yes| Draft[Back to draft — then edit in a later save]
    Lock --> Link[Tags and documents still work.<br/>Pin to a Docket from the matter, not this page]
```

Leaving a Court does **not** transfer Judgments.

## Journey F — Research Case Law

```mermaid
flowchart TD
    CL[/case-law/] --> Tabs{Tab}
    Tabs --> Can[Canonical published]
    Tabs --> Mine[My personal research]
    Can --> Ann[Private annotations]
    Mine --> New[Create personal row]
    New --> Disc2[Optional is_discoverable]
    Can --> Link[Link to a matter — needs Court or retained,<br/>not share-only]
    Mine --> Link
```

Unpublished library drafts never appear here. Admins review them at `/admin/legal-library`.

## Journey G — Admin legal library

```mermaid
flowchart TD
    LL[/admin/legal-library/] --> S[Sources — registry, not a crawler]
    LL --> I[New Import or Bulk batch]
    I --> RPC[create_*_import]
    RPC --> Draft[Canonical row as draft]
    Draft --> RQ[Review Queue]
    RQ --> Pub{Publish?}
    Pub -->|Placeholders remain| Rejected[RPC refuses]
    Pub -->|Metadata complete| Live[Magistrates can read]
    RQ --> Dup[Duplicate jobs stay on the batch]
```

## Journey H — Search and bookmarks

Global search (`/search`) groups **seven** SQL branches in the browser by `entity_type`. Every hit is something the caller could already open. Legacy `case` rows can appear with **no** detail route.

The Legislation **list** search matches provision body text. **Global** search’s statute branch still searches only the Act-level `search_vector` — a phrase that lives only inside a section may miss in `/search` and hit on `/legislation`.

Bookmarkable: Docket Matter, Judgment, Case Law, Quick Code, Bench Note, Statute, Statute Provision, leftover Case. **Not** a raw document file.

## Honest gaps in the live UI

| You might expect | What the SPA actually does |
|---|---|
| View-share disables editors | Controls stay enabled; RLS rejects the write with a toast |
| Link Case Law from the matter tab | Matter tab is read-only. Link from **Case Law** detail |
| Link a Judgment from the Judgment page | Links panel is read-only. Link from the **matter** Judgments tab |
| Type a Quick Code to expand in an editor | **Copy** copies `content` to the clipboard |
| Create Quick Code ↔ matter/judgment/case-law links | Associations dialog is **read-only** |
| New Bench Note on a docket / judgment / case-law page | Create from Bench Notes list, or from a legislation section |
| Password-reset email sets a new password in-app | Link lands on `/login`. No set-password page. Profile / Settings are disabled |
| Clerk-only screens | None. Clerk collapses onto the magistrate RLS envelope |

## Screen map

| Path | Who | Purpose |
|---|---|---|
| `/dashboard` | Any signed-in user | Courts, upcoming appearances, retained, drafts |
| `/docket` | Any | Matters via the three paths |
| `/docket/:id` | Lawful access | Operational workspace |
| `/judgments` | Any | Own + discoverable |
| `/case-law` | Any | Published canonical + own/discoverable personal |
| `/legislation` | Any | Published statutes + provision reader |
| `/quick-codes` | Any | Own snippets only |
| `/bench-notes` | Any | Own notes only |
| `/bookmarks` | Any | Own bookmarks |
| `/search` | Any | RLS-filtered global search |
| `/admin/court-assignments` | Admin UI role | Roster |
| `/admin/legal-library` | Admin UI role | Ingestion + review |
