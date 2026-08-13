# 10. Sequence and state workflows

Time-ordered views of the rules in [access control](08-access-control.md).

## Create a Docket Matter

```mermaid
sequenceDiagram
    actor M as Magistrate
    participant UI as Create dialog
    participant DB as Postgres RLS

    M->>UI: Choose Court, case number, title
    UI->>DB: INSERT docket_matters
    DB->>DB: Trigger derives district_id from courts
    alt No district on that Court
        DB-->>UI: Reject
    else No current magistrate_courts for that Court
        DB-->>UI: RLS denies INSERT
    else OK
        DB-->>UI: Row with created_by = auth.uid()
        UI-->>M: Open /docket/:id
    end
```

## Share, then revoke

```mermaid
sequenceDiagram
    actor G as Current Court or retained holder
    actor R as Recipient
    participant DB as shares

    G->>DB: INSERT permission view or edit
    Note over DB: At most one active share per recipient
    DB-->>R: Matter appears on R's Docket
    alt G or another current authority holder revokes
        G->>DB: SET revoked_at = now()
    else R relinquishes
        R->>DB: SET revoked_at = now()
    end
    DB-->>R: Matter disappears unless another path remains
    Note over DB: To change view→edit, revoke then insert a new row
```

## Link a Judgment to a matter

```mermaid
sequenceDiagram
    actor M as Magistrate
    participant DB as docket_matter_judgments

    M->>DB: INSERT link
    DB->>DB: Docket access? AND owner of Judgment?
    alt Either fails
        DB-->>M: Denied — discoverable-only is not enough to link
    else Both pass
        DB-->>M: Association row (no extra access granted)
    end
    Note over M: A colleague with Court access still cannot open a private Judgment
```

## Offboarding a sitting magistrate

```mermaid
sequenceDiagram
    actor A as Admin
    actor M as Magistrate
    participant MC as magistrate_courts
    participant RA as docket_matter_assignments
    participant DM as docket_matters
    participant J as judgments

    A->>MC: ended_at = now() on current rows
    Note over DM: Court's Docket stays. Successor gets it via a new assignment
    M->>RA: Should already have retained part-heard rows
    Note over RA: Remaining live retained rows must be ended as part of offboarding
    Note over J: Judgments stay with M. Never transferred
    Note over M: Do not DELETE profiles. Deactivate instead
```

## Publish canonical Case Law

```mermaid
sequenceDiagram
    actor A as Admin
    participant RPC as publish_case_law_import
    participant CL as case_law
    participant MAG as Magistrate browse

    A->>RPC: Publish
    RPC->>RPC: is_admin()?
    RPC->>CL: Placeholder metadata?
    alt Untitled / missing court or jurisdiction
        RPC-->>A: Refuse
    else Complete
        RPC->>CL: review_status = published
        RPC->>RPC: Linked import_jobs.status = published
        MAG->>CL: SELECT now returns the row
    end
```

## Quick Codes (as implemented)

Quick Codes are private text snippets (`code_word` unique per owner). The live workspace **Copy** action puts `content` on the clipboard. There is no in-editor expander. Association tables exist; the SPA associations dialog is read-only.

Nobody else ever reads another user's Quick Codes — not even an administrator, and not via a Docket share.

## Document upload

```mermaid
sequenceDiagram
    actor U as User with parent access
    participant API as Storage + documents

    U->>API: Upload bytes to documents bucket
    U->>API: INSERT public.documents metadata
    Note over API: Storage SELECT requires the metadata row
    alt Parent is a Docket Matter
        API->>API: Parent RLS = three-path access
    else Parent is a Judgment
        API->>API: Owner or discoverable for read
    else Parent is draft canonical Case Law
        API->>API: Admin only until published
    end
```

## What is not a workflow yet

| Topic | Status |
|---|---|
| Outlook calendar sync | Columns reserved; no sync |
| Judgment / personal Case Law sharing | Designed in principle; `shares.item_type` is Docket-only in 0037 |
| Clerk-specific permissions | Role exists; no Clerk RLS |
| URL crawlers / AI extract | Not built |
| Scanned-PDF OCR | Built in-browser (Tesseract.js); curator must still verify |
| Password reset completion page | Email currently returns the user to `/login` |
| Profile / Settings | Disabled in the user menu |
| View-share greying out editors | RLS only; controls stay enabled |
