# 6. ERD — Judgments, Case Law, Quick Codes, notes

These records are **not** Court property. Linking them to a Docket Matter never opens the other side.

```mermaid
erDiagram
    profiles ||--o{ judgments : owner_id
    judgments ||--o{ judgment_tags : child
    judgments }o--o{ docket_matters : docket_matter_judgments
    judgments }o--o{ quick_codes : quick_code_judgments

    profiles ||--o{ case_law : "personal owner_id"
    case_law ||--o{ case_law_annotations : private_notes
    case_law }o--o{ tags : case_law_tags
    case_law }o--o{ docket_matters : docket_matter_case_law
    case_law }o--o{ quick_codes : quick_code_case_law

    profiles ||--o{ quick_codes : owner_id
    quick_codes }o--o{ docket_matters : quick_code_docket_matters

    profiles ||--o{ bench_notes : author
    bench_notes }o--o{ tags : bench_note_tags

    judgments {
        uuid id PK
        uuid owner_id FK "immutable"
        text title
        text status "draft | final"
        boolean is_discoverable
        jsonb content
        text content_text
        timestamptz finalized_at
    }

    case_law {
        uuid id PK
        uuid owner_id FK "NULL = canonical"
        boolean is_discoverable "personal rows only"
        text case_name
        text citation
        text review_status "draft needs_review ready published"
        uuid court_id FK "legal_authority_courts"
        uuid jurisdiction_id FK
    }

    quick_codes {
        uuid id PK
        uuid owner_id FK
        text code_word "unique per owner"
        text title
        text content
        text category
    }

    case_law_annotations {
        uuid id PK
        uuid case_law_id FK "ON DELETE CASCADE"
        uuid owner_id FK
        text annotation_text
    }

    docket_matter_judgments {
        uuid id PK
        uuid docket_matter_id FK "RESTRICT"
        uuid judgment_id FK "CASCADE"
        uuid created_by FK "provenance"
    }

    docket_matter_case_law {
        uuid id PK
        uuid docket_matter_id FK "RESTRICT"
        uuid case_law_id FK "RESTRICT"
        uuid created_by FK "provenance"
    }
```

## Two Case Law worlds in one table

```mermaid
flowchart LR
    subgraph Canonical["owner_id IS NULL"]
        C1[Admin curated]
        C2[All authenticated may read<br/>if review_status = published]
        C3[Admin write only]
        C4[Citation unique among canonical rows]
    end

    subgraph Personal["owner_id = magistrate"]
        P1[Private by default]
        P2[Owner may set is_discoverable]
        P3[Owner edit / delete]
        P4[No admin bypass]
        P5[Citation need not be unique]
    end
```

Owning a Case Law record does **not** let you see another magistrate's annotations on it.

## Judgment lifecycle

```mermaid
stateDiagram-v2
    [*] --> draft: INSERT always forced to draft
    draft --> final: Owner finalizes
    final --> draft: Owner unlocks
    draft --> [*]: Owner may hard-delete
    note right of final
        Locked: title, case_number, court_name,
        judgment_date, citation, content, content_text
        Still free: is_discoverable, tags, documents, links
        Unlock and edit cannot happen in one statement
    end note
```

## Association-table rules (BOTH sides, never OR)

| Join table | SELECT | INSERT / DELETE | Parent delete |
|---|---|---|---|
| `docket_matter_judgments` | Docket access **and** Judgment read | Docket access **and Judgment ownership** | Matter RESTRICT, Judgment CASCADE |
| `docket_matter_case_law` | Docket **and** Case Law read | Docket **and Case Law read** (not ownership) | Both RESTRICT |
| `quick_code_docket_matters` | Quick Code owner **and** Docket | Same. Edit-share on Docket can mutate the link | Quick Code CASCADE, Matter RESTRICT |
| `quick_code_judgments` | Quick Code owner **and** Judgment read | Same | Both CASCADE |
| `quick_code_case_law` | Quick Code owner **and** Case Law read | Same | Quick Code CASCADE, Case Law RESTRICT |

Discoverability of a Judgment can make a Quick Code↔Judgment link appear or disappear **without mutating the join row**.

## Polymorphic attachments

```mermaid
flowchart TB
    DOC[documents<br/>entity_type + entity_id]
    BN[bench_notes<br/>entity_type + entity_id]
    BM[bookmarks<br/>entity_type + entity_id]

    DOC --> DM[docket_matter]
    DOC --> JU[judgment]
    DOC --> CL[case_law]
    DOC --> QC[quick_code]
    DOC --> BN2[bench_note]
    DOC --> ST[statute]
    DOC --> LEG[case - legacy]

    BN --> DM
    BN --> JU
    BN --> CL
    BN --> SP[statute_provision]

    BM --> DM
    BM --> JU
    BM --> CL
    BM --> QC
    BM --> BN
    BM --> ST
    BM --> SP
    BM --> LEG[case - legacy]
```

Bookmarks **cannot** target a `document` row. Attachments are bookmarked via their parent. Bench Notes are author-private even when the parent is widely readable.
