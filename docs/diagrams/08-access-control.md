# 8. Access control and privacy

The security boundary is **Postgres RLS**, not the React UI. Some screens still show edit controls to a view-only recipient; the database refuses the write.

![Three paths onto a Docket Matter](assets/three-path-access.png)

## Three paths onto a Docket Matter

```mermaid
flowchart TB
    Q{Can this user see / edit<br/>this Docket Matter?}

    Q --> P1[Path 1 — Court]
    Q --> P2[Path 2 — Retained]
    Q --> P3[Path 3 — Share]

    P1 --> C1["magistrate_courts<br/>profile_id = me<br/>court_id = matter.court_id<br/>ended_at IS NULL"]
    C1 --> H1["can_access_court(court_id)"]

    P2 --> C2["docket_matter_assignments<br/>profile_id = me<br/>docket_matter_id = matter<br/>ended_at IS NULL"]
    C2 --> H2["has_retained_assignment(matter_id)"]

    P3 --> C3["shares<br/>item_type = docket_matter<br/>item_id = matter<br/>recipient_id = me<br/>revoked_at IS NULL"]
    C3 --> H3["has_docket_share(matter_id)"]

    H1 --> OR((OR))
    H2 --> OR
    H3 --> OR
    OR --> YES[Lawful Docket access]
    OR --> NO[No row returned]
```

`is_admin()` appears on **none** of these paths.

`has_docket_matter_authority()` is **not** a fourth read path. It is Court **or** retained only (never share). It is used to grant/revoke shares and to mutate Judgment / Case Law **links**. Share-only holders can see a matter; they cannot share it onward and cannot pin a Judgment or Case Law card onto it.

View vs edit on a share:

| Permission | Parent matter | Events / parties / tags | Judgment / Case Law **links** | Quick Code ↔ Docket links |
|---|---|---|---|---|
| `view` | SELECT | SELECT | SELECT if BOTH sides already readable | SELECT only |
| `edit` | SELECT + UPDATE | Same mutation rights as a sitting magistrate on those children | SELECT only. INSERT/DELETE need Court or retained (`has_docket_matter_authority`), plus Judgment **ownership** to pin a Judgment | INSERT/DELETE allowed (the Quick Code must still be yours) |

No resharing. Recipient may relinquish. Soft-revoke only. Live `shares.item_type` is **Docket only** (real FK, not a polymorphic uuid).

## Originating authority vs preserving authority

```mermaid
flowchart LR
    subgraph Origin["Originates Court-wide power"]
        ADM[Admin only]
        MC[INSERT magistrate_courts]
        ADM --> MC
        MC --> CA[can_access_court]
    end

    subgraph Preserve["Preserves one matter"]
        MAG[Magistrate who already has Court access]
        RA[INSERT own docket_matter_assignments]
        MAG --> RA
        RA --> HR[has_retained_assignment]
    end

    CA -.->|precondition| MAG
```

Self-assigning to a Court would let anyone grant themselves an entire docket. Self-retaining a matter you already sit is narrowing, not originating.

## Visibility matrix

```mermaid
flowchart TB
    subgraph Open["All authenticated — published / reference"]
        D[magisterial_districts]
        C[courts]
        S[statutes published]
        T[tags]
        CCL[canonical case_law published]
    end

    subgraph ThreePath["Three-path Docket"]
        DM[docket_matters]
        DE[docket_events]
        DP[parties]
        DT[tags]
        DA[assignments - named magistrate]
        SH[shares - granter or recipient]
    end

    subgraph Owner["Owner only, no admin bypass"]
        JU[judgments unless discoverable]
        QC[quick_codes]
        BN[bench_notes]
        PCL[personal case_law unless discoverable]
        ANN[case_law_annotations always]
    end

    subgraph AdminWrite["Admin write, not Docket read"]
        MC[magistrate_courts roster]
        LIB[legal library drafts + publish]
        STW[statutes write]
    end
```

| Entity | Default | Share? | Discoverable pool? | Admin bypass? |
|---|---|---|---|---|
| Docket Matter | Court-anchored | Yes, exceptional | **Never** | **No** |
| Retained assignment | Named magistrate | N/A (it is the grant) | No | **No** |
| Judgment | Private | Future (not in 0037) | Yes, read-only | **No** |
| Canonical Case Law | All authenticated (published) | N/A | N/A | Write yes |
| Personal Case Law | Private | Future | Yes, read-only | **No** |
| Annotation | Annotator only | Never | No | **No** |
| Quick Code | Owner only | No | **Never** | **No** |
| Bench Note | Author only | No | No | **No** |
| Documents | Follows parent | Follows parent | Follows parent | SELECT/INSERT follow parent. **DELETE** still allows `is_admin()` (metadata/blob only — not a Docket read bypass) |
| `magistrate_courts` | Self SELECT; Admin write | N/A | N/A | Yes (roster, not content) |

## Association side-channel rule

```mermaid
flowchart LR
    A[User can see Matter X]
    B[User cannot see Judgment Y]
    L[Join row X↔Y]

    A --> Q{Show the join row?}
    B --> Q
    Q -->|OR would leak Y's existence| HIDE[Hide]
    Q -->|AND both readable| SHOW[Show]
```

Always **AND**. Never **OR**.

Link mutation strengths (live SQL):

```
Docket ↔ Judgment:  Court-or-retained  AND  Judgment OWNERSHIP
Docket ↔ Case Law:  Court-or-retained  AND  Case Law READ
Quick Code ↔ Docket: Docket EDIT (edit-share OK)  AND  Quick Code OWNERSHIP
Quick Code ↔ Judgment / Case Law: Quick Code OWNERSHIP  AND  read access to the other side
```

The Quick Code association UI is **read-only today** — the tables and RLS exist; creating/removing those links is not wired in the SPA.

## Roles in the product today

| Role | UI | Database |
|---|---|---|
| `magistrate` | Full workspace | `profiles.role` is **not** consulted by Docket RLS. Authority is assignment / retain / share / ownership |
| `clerk` | Same nav as magistrate. Copy treats clerks as share recipients | **Enum leftover.** No Clerk policies. Identical RLS to a magistrate if they have the same assignment/share/ownership |
| `admin` | Extra: Court Assignments, Legal Library | Roster + canonical library write. **Zero** extra SELECT on Docket / private Judgment / personal Case Law / Quick Codes / Bench Notes |

An administrator who also sits a Court needs a real `magistrate_courts` row, created the same way as anyone else's.

## Profile privacy

`profiles` SELECT is self-only. Display names on retained assignments and shares come from two narrow `SECURITY DEFINER` functions (`0043`), gated by context, never by opening the whole profiles table.
