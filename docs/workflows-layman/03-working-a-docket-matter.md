# 3. Working a docket matter

**Who:** a magistrate (or clerk) who can already open that Court's list  
**Goal:** create and run one case file  
**Everyday analogy:** opening a new folder in the Court's cabinet, not in your briefcase

## Create a matter

1. Go to **Docket**.
2. Start a new matter.
3. Pick a Court you **currently sit**.
4. Enter the official **case number** and a short **title** (the names you would read out).
5. Save.

The district is filled in from the Court. You do not choose it. Case numbers must be unique **inside that district**, not worldwide — two districts may both have "45/2024".

On **Docket**, **List** is the working sheet: one row per file, procedure as columns you can click. **Tiles** is cover-photo browse. Quick filters (stage, custody, disclosure, trial, next date) sit above the list.

```mermaid
flowchart TD
    Start[Docket list] --> Q{Do I currently sit a Court?}
    Q -->|No| No[You cannot create.<br/>You may still see retained or shared files]
    Q -->|Yes| Form[Court, case number, title]
    Form --> File[New folder on that Court's list]
    File --> Tabs[Overview · Events · Parties · Tags ·<br/>Judgments · Case Law · Documents · Sharing]
```

## The matter page

| Tab | What it is for |
|---|---|
| Overview | Charge or issue, **procedure strip**, rolling orders, overall outcome, status, cover image, retain |
| Events | Each listed date — when they must return and what was ordered that day |
| Parties | People and roles, optional identification photo |
| Tags | Court-visible labels such as "urgent" (not your private sticky notes) |
| Judgments | Pin *your* written rulings to this file |
| Case Law | Pin authorities you can read |
| Documents | PDFs and other attachments |
| Sharing | Let one named colleague in |

You can bookmark the matter from the header.

## Procedure board

The sheet (and the strip on Overview) is the live record of where the file is:

Arraignment → Custody (on bail **or** remanded) → Disclosure → Trial → Ruling → Judgment → Sentence → Appeal.

Click a cell to set the result. That does **not** create an Event. After a change you can optionally **Log appearance** to record the date. Completing the board does not mark the matter Completed — that status is still separate.

Setting **Judgment** to Delivered does not pin a written ruling. Pin your reasons on the **Judgments** tab.

## Status

- **Active** — live
- **Stayed** — paused; a retained magistrate still keeps it
- **Completed** — finished; any retain ends automatically
- **Archived** — filed away; retain also ends

There is no "delete this case from history" button. That is the point of a court record.

## Cover image

A cover photo (often a party's identification picture reused) appears on tiles and the top of the page. It is stored as a private file. Anyone who can already open the matter can see it.

## If create is blocked

You are not currently assigned to the Court you picked. Ask an administrator to seat you, or work from a matter that was retained or shared with you.

## What this file is not

It is not your personal notebook. Colleagues who later sit the same Court will see it. Put private thinking in **Bench Notes** or **personal Case Law**, not in the matter's institutional tags.
