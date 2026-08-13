# Magistrate Wizard architecture diagrams

Professional diagrams for **Magistrate Wizard**, a legal knowledge platform for Guyana magistrates.

These diagrams follow the **Magistrate Wizard Architecture Specification (Final, Revision 3)** and the live schema (migrations `0001`–`0067`). Addendum 2 is historical only: Docket Matters are **court-anchored**, not individually owned. Root `README.md` still describes an early “cases” product — do not copy that into new diagrams. Live SQL wins over stale §3 notes (for example, a Docket share *does* extend to events, parties, and tags).

## How to read this pack

| Audience | Start here |
|---|---|
| New magistrate / clerk | [Layman workflow guides](../workflows-layman/README.md) |
| Product / operations | [User journeys](09-user-journeys.md) then [Access control](08-access-control.md) |
| Software engineer | [System context](01-system-context.md) → [Containers](02-c4-containers.md) → [ERD overview](04-erd-complete.md) |
| Database / security | [Access control](08-access-control.md) and the detailed ERDs |

Every mermaid diagram is the source of truth. Hero diagrams:

| Preview | File |
|---|---|
| System context | [`assets/system-context.png`](assets/system-context.png) |
| Three-path Docket access | [`assets/three-path-access.png`](assets/three-path-access.png) |
| Court / desk / library | [`assets/domain-map.png`](assets/domain-map.png) |
| Entity map | [`assets/erd-overview.png`](assets/erd-overview.png) |
| Magistrate vs admin day | [`assets/user-swimlanes.png`](assets/user-swimlanes.png) |

Excalidraw source: [`excalidraw/three-path-access.excalidraw`](excalidraw/three-path-access.excalidraw)

Print PDFs:

- [`pdf/Magistrate-Wizard-Architecture-Diagrams.pdf`](pdf/Magistrate-Wizard-Architecture-Diagrams.pdf)
- [`../workflows-layman/pdf/Magistrate-Wizard-Workflows-Plain-Language.pdf`](../workflows-layman/pdf/Magistrate-Wizard-Workflows-Plain-Language.pdf)

Regenerate with `python docs/diagrams/tools/build_pdfs.py`.

## Catalog

### Context and software architecture

1. [System context (C4 Level 1)](01-system-context.md) — who uses the system and what it talks to
2. [Containers (C4 Level 2)](02-c4-containers.md) — SPA, Supabase, storage, search
3. [Application layers (C4 Level 3)](03-application-layers.md) — React providers, routes, hooks

### Data model (ERDs)

4. [Complete ERD — overview](04-erd-complete.md)
5. [Court structure and Docket family](05-erd-court-docket.md)
6. [Judgments, Case Law, Quick Codes, notes](06-erd-work-product.md)
7. [Legal library ingestion and legislation](07-erd-legal-library.md)

### Control, people, and time

8. [Access control and privacy](08-access-control.md) — three-path Docket, no admin bypass
9. [User journeys](09-user-journeys.md) — magistrate, admin, unassigned user
10. [Sequence and state workflows](10-sequence-workflows.md)

## Governing rules visible in every diagram

- **The Court owns the Docket.** A matter is not a magistrate's private file.
- **Judgments, Quick Codes, and Bench Notes are personally owned.** Leaving a Court does not transfer them.
- **Admin manages the roster and the legal library.** Admin does **not** get a back door into another magistrate's private judicial work.
- **Links never grant access.** Associating a Judgment or Case Law record with a Docket Matter requires independent lawful access to **both** sides.
- **History is ended, not deleted.** Assignments and shares use `ended_at` / `revoked_at`.

## Authority

| Document | Role |
|---|---|
| `docs/architecture/Magistrate-Wizard-Architecture-Specification-FINAL.md` | Current architecture |
| `supabase/migrations/` | What is actually live |
| Addenda 2 and 3, Reconciliation Report | Historical design notes only |
