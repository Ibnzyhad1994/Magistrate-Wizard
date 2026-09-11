# Case-specific workflow protocol

Signed original: [case-workflow-protocol-spec-1.pdf](./case-workflow-protocol-spec-1.pdf). Do not edit the PDF. This markdown is the working copy for implementation.

## Product rules (from the PDF)

Purpose: the app currently applies a single "Criminal Trial" workflow to every matter. This spec defines classification-specific workflows so that selecting a different matter type drives a different stage sequence, different stage labels, and different data-capture fields at the Decision stage.

### 1. Baseline — Criminal Trial (existing, unchanged)

Arraignment → Custody → Disclosure → Trial → Ruling → Judgment → Sentence → Appeal → Outcome

No changes to this protocol. It remains the default when "Criminal Trial" is selected as the classification.

### 2. New classification — Paper Committal

Trigger: Classification = "Paper Committal"

Stage sequence: Arraignment → Custody → Disclosure → Paper Committal → Ruling → Judgment → Appeal → Outcome

Key differences from Criminal Trial:

- The "Trial" stage is replaced by a "Paper Committal" stage (label change, not just a renamed trial — this stage should not carry any trial-specific fields).
- Paper Committal stage status options: Commenced / Partial / Completed
- No Sentence stage — remove entirely for this classification (the magistrate does not pass sentence on a paper committal).
- Appeal stage is retained.
- Outcome stage: simplified to Completed (this is the terminal status once Judgment/Appeal steps close out).
- Custody stage: field options are Bail / Remanded.

### 3. Revised classifications — Protection Order / Maintenance / Liability matters

Trigger: Classification = "Protection Order Matter", "Maintenance Matter", or "Liability Matter"

These three classifications share one workflow shape, distinct from the criminal-style flow (no Arraignment, no Custody, no Disclosure):

Information Sworn → Summons Served → Returns of Summons → Trial → Decision → Outcome

Stage-by-stage detail:

1. **Information Sworn** — commencement step for the matter (equivalent to case initiation).
2. **Summons Served** — Yes/No field.
3. **Returns of Summons** — Yes/No field.
4. **Trial** — Yes/No field (a trial may or may not occur in these matter types; unlike Paper Committal, this stage keeps the "Trial" label). Build in the ability to adjourn before the trial commences — a matter may need to be stood down so parties can bring supporting documentation (e.g., receipts, payslips, proof of income/expenses for a child, in maintenance matters). This adjournment option should be available at each stage, not just before Trial.
5. **Decision** — the field(s) captured here depend on the classification selected:

   | Classification | Decision field |
   |---|---|
   | Protection Order Matter | Granted / Not Granted (selector) |
   | Maintenance Matter | Amount ordered (numeric input) |
   | Liability Matter | Amount paid (numeric input) |

6. **Outcome** — Completed / Adjourned.

### 4. Implementation notes (from the PDF)

The workflow engine should branch on the Classification field selected at case creation: Criminal Trial, Paper Committal, Protection Order Matter, Maintenance Matter, Liability Matter.

Each classification maps to its own ordered stage list and its own stage-label set (per sections 1–3 above), rather than reusing the Criminal Trial labels with conditional visibility.

The Decision stage for Protection Order / Maintenance / Liability matters needs a classification-aware input: selector for Protection Order, numeric currency field for Maintenance and Liability.

Adjournment should be modeled as a status/state available at the relevant stages (per matter type) rather than a separate stage, so the docket can show "Adjourned — awaiting documentation" without breaking the stage sequence.

## Classification mapping

Lookup names are the live `docket_matter_categories.name` values from 0119 (plus the new Paper Committal row). The spec's title-case labels match those rows.

| Spec classification | `docket_matter_categories.name` | `workflow_protocol` |
|---|---|---|
| Criminal Trial | `Criminal trial` | `criminal_trial` |
| Paper Committal | `Paper Committal` (new row, not Other) | `paper_committal` |
| Protection Order Matter | `Protection order matter` | `civil_summons` |
| Maintenance Matter | `Maintenance matter` | `civil_summons` |
| Liability Matter | `Liability matter` | `civil_summons` |
| Other (spec is silent) | `Other` | `criminal_trial` (keep today's board) |
| Unclassified / null category | — | `criminal_trial` |

Changing classification after create switches the board. Existing Maintenance / Liability / Protection files receive the civil columns at defaults. We do **not** invent a mapping from old criminal cells; magistrates re-enter the civil steps. Criminal cells remain in the database but the board ignores them.

## Intended workflows

### Criminal Trial

- **Happy path:** Arraignment done → custody set (on bail or remanded) → disclosure full → trial completed → ruling delivered → judgment delivered → sentence passed → appeal as needed → Outcome dismissed or completed.
- **Adjournment:** recorded as a dated Event / Next date (existing 0079 path). Completing the board still does not auto-complete the matter.
- **Close-out:** Outcome dismissed or completed, which syncs `docket_matters.status` (0131). Clearing Outcome does not revert status.

### Paper Committal

- **Happy path:** Arraignment done → custody Bail or Remanded → disclosure full → Paper Committal Commenced then Partial then Completed → ruling delivered → judgment delivered → appeal as needed → Outcome Completed.
- **Adjournment:** dated Event / Next date, same as Criminal Trial. No Sentence column at any point.
- **Close-out:** Outcome Completed only (no Dismissed on this protocol). Completing the board still does not auto-complete the matter until Outcome is set.

### Protection / Maintenance / Liability (shared shape)

- **Happy path:** Information Sworn done → Summons Served Yes → Returns of Summons Yes → Trial Yes or No (a recorded answer; a trial may not occur) → Decision (Granted/Not Granted, or amount ordered, or amount paid) → Outcome Completed.
- **Adjournment:** a state **on the current stage**, not a stage of its own. Available at Information Sworn, Summons Served, Returns of Summons, Trial, and Decision. The board can show a reason such as "awaiting documentation" without moving the pointer. Next date still records the return date (0079).
- **Failed service:** Summons Served No or Returns of Summons No keeps the file at that stage (same idea as Arraignment Not Found).
- **Close-out:** Outcome Completed sets `outcome_status = completed` and syncs matter status. Outcome Adjourned does **not** widen `outcome_status` (0131 would otherwise force `docket_matters.status` to an invalid enum value). Adjourned-as-outcome is stored as `outcome_adjourned` with status left Active.

## Checklist A — Criminal Trial (regression)

- [x] Stage order still Arraignment → Custody → Disclosure → Trial → Ruling → Judgment → Sentence → Appeal
- [x] Arraignment still not_started / done / not_found (0131)
- [x] Custody still unset / on bail / remanded
- [x] Outcome column still dismissed / completed and still syncs `status` (0131)
- [x] Completing the board still does not auto-complete the matter
- [x] Filters, List sheet, phone cards, Overview strip, Daily Progress Report still work

## Checklist B — Paper Committal

- [x] Classification option **Paper Committal** at create
- [x] Board columns: Arraignment, Custody, Disclosure, Paper Committal, Ruling, Judgment, Appeal, Outcome
- [x] No Sentence column
- [x] Paper Committal values: Commenced / Partial / Completed; no trial-only fields
- [x] Custody: Bail / Remanded
- [x] Outcome: Completed (terminal)
- [x] Current-stage pointer walks this list, not the Criminal Trial list
- [x] Capacity category can be Paper Committal (new lookup row)

## Checklist C — Protection / Maintenance / Liability

- [x] Same six-step board for all three
- [x] No Arraignment, Custody, Disclosure, Ruling, Judgment, Sentence, Appeal columns
- [x] Information Sworn, Summons Served Yes/No, Returns of Summons Yes/No, Trial Yes/No
- [x] Adjournment available at **each** of those stages, with a visible reason such as “awaiting documentation”, without adding an Adjournment stage
- [x] Decision: Protection Granted / Not Granted; Maintenance amount ordered; Liability amount paid
- [x] Outcome: Completed / Adjourned
- [x] Next date still records the return date (existing 0079 path)

## Checklist D — Engine (all protocols)

- [x] Protocol chosen from classification at create; changing classification switches the board
- [x] Stage labels are protocol-owned, not Criminal Trial labels with `hidden`
- [x] Mixed Docket list (All My Courts) shows inapplicable cells as not-on-this-protocol, never under the wrong name
- [x] SQL `procedure_stage` and TS `currentStage()` stay in lockstep
- [x] Tests: one file per protocol + a Criminal Trial regression
