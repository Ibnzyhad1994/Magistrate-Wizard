# 7. ERD — Legal library ingestion and legislation

Canonical Case Law and Legislation are **administrative resources**. Drafts are invisible to ordinary magistrates until `review_status = published`.

```mermaid
erDiagram
    legal_regional_groups ||--o{ legal_jurisdictions : contains
    legal_jurisdictions ||--o{ legal_authority_courts : "optional home"
    legal_regional_groups ||--o{ legal_authority_courts : "optional group"

    legal_sources ||--o{ import_jobs : source
    import_batches ||--o{ import_jobs : groups
    profiles ||--o{ import_batches : created_by

    import_jobs ||--o| case_law : target_case_law_id
    import_jobs ||--o| statutes : target_statute_id
    import_jobs ||--o| documents : uploaded_document_id

    case_law }o--|| legal_authority_courts : court_id
    case_law }o--|| legal_jurisdictions : jurisdiction_id
    statutes }o--|| legal_jurisdictions : jurisdiction_id
    statutes ||--o{ statute_provisions : tree
    statutes ||--o| statutes : supersedes_statute_id

    statutes }o--o{ tags : statute_tags
    case_law }o--o{ tags : case_law_tags

    legal_sources {
        uuid id PK
        text name
        text source_type "case_law legislation mixed"
        text connector_type "registry only - not a crawler"
        text status "proposed testing approved disabled failed"
        boolean canonical_trusted
    }

    import_batches {
        uuid id PK
        int expected_file_count "baseline at create"
        uuid created_by FK
    }

    import_jobs {
        uuid id PK
        uuid batch_id FK
        text content_type
        text status "queued fetching extracting structuring needs_review ready published failed duplicate"
        uuid target_case_law_id FK
        uuid target_statute_id FK
        text duplicate_warning
        jsonb extracted_metadata
    }

    statutes {
        uuid id PK
        text title
        text code
        text review_status
        boolean is_current_version
        uuid supersedes_statute_id FK
    }

    statute_provisions {
        uuid id PK
        uuid statute_id FK
        uuid parent_provision_id FK
        text level "Part Chapter Section Subsection Paragraph Schedule"
        text number
        text heading
        text body_text
        int sort_order
    }
```

## Ingestion state machine

```mermaid
stateDiagram-v2
    [*] --> draft: create_*_import RPC
    draft --> needs_review: extraction ran
    needs_review --> ready: curator satisfied
    ready --> published: publish_*_import
    needs_review --> published: publish_*_import
    draft --> failed: reject_*_import
    needs_review --> failed: reject_*_import
    queued --> duplicate: exact hash or citation conflict
    queued --> failed: genuine error

    note right of published
        Magistrates can now read the
        canonical row. Drafts never
        appear in Case Law / Legislation
        browse or search.
    end note
```

## Draft-row-first (why)

A real `case_law` or `statutes` row is created immediately as `review_status = draft`. Publish is a status flip, not a copy. That lets the existing `documents` attachment model parent a file to a real id without a second storage row.

Publish RPCs reject placeholder metadata (for example `"Untitled (pending review)"`) so a record cannot go live empty.

## Duplicate is not failure

Bulk import records every file:

| Outcome | `import_jobs.status` | Row created? |
|---|---|---|
| New draft | `needs_review` / `ready` | Yes |
| Byte-identical file | `duplicate` | No new authority; link to existing |
| Same citation, different file | `duplicate` | File attached to the **existing** Case Law as another source document |
| Validation reject / crash | `failed` | Bare job row so the batch still accounts for the file |

`import_batches.expected_file_count` is stored at create time. A batch is fully accounted when `count(jobs) >= expected_file_count`. Older batches with a null count are labelled **legacy — incomplete history**.

## Two different "courts"

```mermaid
flowchart LR
    subgraph Physical["Physical Guyana court<br/>Docket authority"]
        C[courts]
        MC[magistrate_courts]
        DM[docket_matters]
        C --> MC
        C --> DM
    end

    subgraph Reported["Reported / appellate court<br/>Case Law metadata"]
        LAC[legal_authority_courts]
        CL[case_law.court_id]
        LAC --> CL
    end
```

Never join these. "Vigilance Magistrate's Court" is a sitting venue. "Caribbean Court of Justice" is a deciding authority.
