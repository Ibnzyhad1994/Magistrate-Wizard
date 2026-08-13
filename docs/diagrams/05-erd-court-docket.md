# 5. ERD — Court structure and Docket family

This is the operational heart of Magistrate Wizard. Access is **not** `owner_id`. Access is: current Court assignment **or** retained assignment **or** an active share.

```mermaid
erDiagram
    magisterial_districts {
        uuid id PK
        text name UK
        boolean is_active
    }

    courts {
        uuid id PK
        text name
        uuid district_id FK
        boolean is_active
        text jurisdiction "legacy unused"
    }

    profiles {
        uuid id PK
        text full_name
        user_role role "magistrate | clerk | admin"
        uuid court_id "LEGACY unused"
    }

    magistrate_courts {
        uuid id PK
        uuid profile_id FK
        uuid court_id FK
        text assignment_type "regular acting relief other"
        timestamptz started_at
        timestamptz ended_at "NULL = current"
    }

    docket_matters {
        uuid id PK
        uuid court_id FK "NOT NULL"
        uuid district_id "derived from court"
        text case_number
        text matter_title
        text charge_or_issue
        text orders_summary
        text outcome
        docket_matter_status status "active stayed completed archived"
        uuid created_by FK
        uuid last_updated_by FK
        text cover_image_path
    }

    docket_matter_assignments {
        uuid id PK
        uuid docket_matter_id FK
        uuid profile_id FK "SET NULL on profile delete"
        text reason "retained_part_heard"
        uuid granted_by FK
        timestamptz ended_at "NULL = current"
    }

    docket_events {
        uuid id PK
        uuid docket_matter_id FK "immutable"
        date scheduled_date
        time scheduled_time
        text event_type
        text event_status
        uuid presiding_magistrate_id FK "provenance only"
        text external_calendar_provider "future Outlook"
        text external_calendar_event_id
    }

    docket_matter_parties {
        uuid id PK
        uuid docket_matter_id FK "immutable"
        text full_name
        text party_type
        text role
        text party_status
        text identification_photo_path
    }

    docket_matter_tags {
        uuid id PK
        uuid docket_matter_id FK
        text tag_name
        uuid created_by FK "provenance only"
    }

    shares {
        uuid id PK
        text item_type "docket_matter only in 0037"
        uuid item_id
        uuid owner_id FK "granter"
        uuid recipient_id FK
        text permission "view | edit"
        timestamptz revoked_at "NULL = active"
    }

    magisterial_districts ||--o{ courts : district_id
    courts ||--o{ magistrate_courts : court_id
    profiles ||--o{ magistrate_courts : profile_id
    courts ||--o{ docket_matters : court_id
    profiles ||--o{ docket_matters : created_by
    docket_matters ||--o{ docket_matter_assignments : matter
    profiles ||--o{ docket_matter_assignments : retained_by
    docket_matters ||--o{ docket_events : hearings
    docket_matters ||--o{ docket_matter_parties : parties
    docket_matters ||--o{ docket_matter_tags : tags
    docket_matters ||--o{ shares : exceptional
```

## Constraints that matter

| Rule | Why |
|---|---|
| `UNIQUE (district_id, case_number)` on matters | Case numbers restart per Magisterial District. Not globally unique |
| `UNIQUE (profile_id, court_id) WHERE ended_at IS NULL` | One current assignment per magistrate/court pair. History kept |
| `UNIQUE (docket_matter_id, profile_id) WHERE ended_at IS NULL` | One live retained assignment per person per matter |
| At most one **active** share per recipient per matter | Soft-revoke (`revoked_at`), then create a new row to change permission |
| No `DELETE` policy on matters | Archive via `status`. Judicial history is not erased |
| `district_id` on a matter is trigger-derived | Client cannot pick a district that disagrees with the Court |

## Status of a matter

```mermaid
stateDiagram-v2
    [*] --> active: Create matter
    active --> stayed: Stay proceedings
    stayed --> active: Resume
    active --> completed: Dispose
    stayed --> completed: Dispose after stay
    completed --> archived: File away
    active --> archived: Archive
    note right of completed
        Retained assignment auto-ends
        when status becomes
        completed or archived
        (not on stayed)
    end note
```

## Identification imagery (0067)

Cover photos and party identification photos live in the **same private `documents` bucket**. Path columns on the matter/party are denormalized for list rendering. They do not grant access by themselves.

| Column | Table | Purpose |
|---|---|---|
| `cover_image_path` | `docket_matters` | Browse tile / billboard |
| `identification_photo_path` | `docket_matter_parties` | Party photograph |
| `documents.purpose` | `attachment` / `cover` / `identification_photo` | Lets the Documents panel hide ID photos |

## Outlook boundary (not built)

`docket_events` may later store `external_calendar_provider` + `external_calendar_event_id`. Outlook may supply **when and where**. It must never overwrite charge, parties, orders, or outcome.
