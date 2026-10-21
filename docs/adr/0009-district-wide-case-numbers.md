# 0009 - Case numbers are unique across a Magisterial District

**Status:** Accepted (baseline `0020_docket_matters`; recorded after the 2026-10-15 audit, finding B-15)

## Context

A docket matter's `case_number` is the official registry number, and the registry that issues it belongs to the Magisterial District, not to one court inside it.
Two courts in a district never legitimately hold different matters under the same number, and a matter can move between courts without being renumbered.
`docket_matters_district_case_number_unique (district_id, case_number)` enforces that, and the create dialog warns about a collision as the number is typed.

The constraint cannot ignore rows the creator is not allowed to see.
So a magistrate who tries a number already used at another court in the district is refused, and learns that the number exists there.
The audit raised this as an oracle (B-15).

## Decision

Uniqueness stays district-wide.
Scoping it to the court would let one district hold two matters with the same registry number, which is a data-integrity failure in the record the docket exists to keep.

What the refusal discloses is limited to the fact that the number is in use in the district.
It never discloses the matter: the person sees only "That case number already exists in this district." (`src/lib/utils.ts`), and docket RLS (ADR 0005) still hides the other court's matter, its parties and its events.

## Consequences

- A collision with an invisible matter is refused with the plain sentence and no link, while a collision with a visible one links to it.
- No RPC or error may return anything about the colliding matter beyond that sentence.
- Changing the scope of the constraint needs a design review against this record, because it changes what a case number means.
