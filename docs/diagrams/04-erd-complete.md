# 4. Complete ERD — overview

High-level map. Detail lives in the next three diagrams. Legacy `cases` / `case_parties` / `case_tags` exist in the database but are **not used** by new development.

![Entity map](assets/erd-overview.png)

```mermaid
erDiagram
    profiles ||--o{ magistrate_courts : "assigned to"
    courts ||--o{ magistrate_courts : "hosts"
    magisterial_districts ||--o{ courts : "contains"
    courts ||--o{ docket_matters : "lists"
    profiles ||--o{ docket_matters : "created_by"

    docket_matters ||--o{ docket_events : "hearings"
    docket_matters ||--o{ docket_matter_parties : "parties"
    docket_matters ||--o{ docket_matter_tags : "institutional tags"
    docket_matters ||--o{ docket_matter_assignments : "retained / part-heard"
    docket_matters ||--o{ shares : "exceptional share"

    docket_matters }o--o{ judgments : "docket_matter_judgments"
    docket_matters }o--o{ case_law : "docket_matter_case_law"
    docket_matters }o--o{ quick_codes : "quick_code_docket_matters"

    profiles ||--o{ judgments : "owns"
    profiles ||--o{ quick_codes : "owns"
    profiles ||--o{ bench_notes : "author"
    profiles ||--o{ case_law : "personal rows only"

    judgments ||--o{ judgment_tags : "tags"
    judgments }o--o{ quick_codes : "quick_code_judgments"
    case_law ||--o{ case_law_annotations : "private notes"
    case_law }o--o{ tags : "case_law_tags"
    case_law }o--o{ quick_codes : "quick_code_case_law"

    statutes }o--o{ tags : "statute_tags"
    statutes ||--o{ statute_provisions : "hierarchy"

    docket_matters ||--o{ documents : "polymorphic"
    judgments ||--o{ documents : "polymorphic"
    case_law ||--o{ documents : "polymorphic"
```

## Domain clusters

```mermaid
flowchart TB
    subgraph Ref["Reference — admin write, all authenticated read"]
        MD[magisterial_districts]
        CT[courts]
        ST[statutes + provisions]
        TG[tags]
        LJ[legal_jurisdictions]
        LC[legal_authority_courts]
        LS[legal_sources]
    end

    subgraph Court["Court operations — three-path access"]
        MC[magistrate_courts]
        DM[docket_matters]
        DE[docket_events]
        DP[docket_matter_parties]
        DA[docket_matter_assignments]
        SH[shares]
    end

    subgraph Own["Individually owned — no Court grant"]
        JU[judgments]
        QC[quick_codes]
        BN[bench_notes]
        PCL[personal case_law]
        ANN[case_law_annotations]
    end

    subgraph Canon["Canonical library — published to all"]
        CCL[case_law owner_id IS NULL]
        ST2[published statutes]
    end

    MC --> DM
    DM -.->|association only| JU
    DM -.->|association only| CCL
    DM -.->|association only| PCL
    QC -.->|association only| DM
    QC -.->|association only| JU
    QC -.->|association only| CCL
```

## Cardinality cheat sheet

| From | To | How |
|---|---|---|
| District | Courts | 1 — many |
| Court | Magistrates | many — many via `magistrate_courts` (time-bounded) |
| Court | Docket Matters | 1 — many |
| Matter | Events / Parties / Tags / Assignments | 1 — many |
| Matter | Judgments | many — many, association only |
| Matter | Case Law | many — many, association only |
| Magistrate | Judgments / Quick Codes / Bench Notes | 1 — many, owned |
| Case Law | Annotations | 1 — many, always private to the annotator |
| Statute | Provisions | 1 — many, self-parented tree |

## Deliberate non-relationships

- `judgments.court_name` is **free text**, not an FK to `courts`. A written judgment may concern a historical or external court.
- `legal_authority_courts` is **not** `courts`. One is the deciding court of a reported case; the other is a physical Guyana Magistrates' Court used for Docket authority.
- `docket_matter_tags` and `judgment_tags` are **not** joins to the global `tags` table. Global tags are readable by everyone; private tag text would leak.
- `profiles.court_id` is **legacy**. Live assignment is `magistrate_courts.ended_at IS NULL`.
