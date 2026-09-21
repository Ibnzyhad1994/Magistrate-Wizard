/**
 * Deterministic dashboard coaching. Pure functions over already-fetched
 * RLS-visible board, capacity, and event rows — no LLM, no extra RPCs.
 */

import type { CapacityBand } from "@/lib/docket-capacity";
import { ROUTES } from "@/routes/paths";
import { addDaysIso } from "@/lib/docket-week";
import { outcomeExpectsNextDate, outcomeSuggestsCompletion } from "@/lib/callover";

export const BOARD_INSIGHT_CAP = 100;
export const STALE_DRAFT_DAYS = 14;
export const MAX_INSIGHTS = 12;

export const DASHBOARD_FILE_FOCUSES = [
  "active",
  "no_date",
  "overdue",
  "retained",
  "no_parties",
] as const;
export type DashboardFileFocus = (typeof DASHBOARD_FILE_FOCUSES)[number];

export const isDashboardFileFocus = (value: string | null): value is DashboardFileFocus =>
  value != null && (DASHBOARD_FILE_FOCUSES as readonly string[]).includes(value);

export const dashboardFilesHref = (focus: DashboardFileFocus) =>
  `${ROUTES.dashboard}?files=${focus}`;

export const DASHBOARD_FILE_FOCUS_COPY: Record<
  DashboardFileFocus,
  { title: string; why: string; cappedNote: string }
> = {
  active: {
    title: "Active files",
    why: "Every active matter on the board in view.",
    cappedNote: "Same 100-row board cap as the working sheet.",
  },
  no_date: {
    title: "No next date",
    why: "Active files with an empty next appearance.",
    cappedNote: "Same 100-row board cap as the working sheet.",
  },
  overdue: {
    title: "Overdue sittings",
    why: "Appearances still marked scheduled after their date. One row per sitting.",
    cappedNote: "Drawn from the event pulse of files on the board in view.",
  },
  retained: {
    title: "Retained",
    why: "Part-heard files currently retained to you.",
    cappedNote: "Files not on the 100-row board still appear if they are retained to you.",
  },
  no_parties: {
    title: "Without parties",
    why: "Active files with no party rows yet.",
    cappedNote: "Same 100-row board cap as the working sheet.",
  },
};

export type DashboardFileRow = {
  id: string;
  href: string;
  case_number: string;
  title: string;
  detail: string;
};

export type ExtraRetainedMatter = {
  id: string;
  case_number: string;
  matter_title: string;
  status: string;
};

export type InsightSeverity = "urgent" | "attention" | "nudge";
export type DashboardRole = "magistrate" | "clerk" | "admin";

export type DashboardInsight = {
  id: string;
  severity: InsightSeverity;
  title: string;
  why: string;
  href: string;
  cta: string;
};

export type BoardInsightRow = {
  id: string;
  status: string;
  case_number: string;
  matter_title: string;
  next_appearance: string | null;
  procedure_stage: string;
  workflow_protocol: string;
  ruling_status: string;
  judgment_status: string;
  has_ruling_document: boolean;
  has_judgment_document: boolean;
  created_at: string;
};

export type EventPulseRow = {
  id: string;
  docket_matter_id: string;
  scheduled_date: string;
  scheduled_time?: string | null;
  event_status: string;
  event_type: string | null;
  outcome_at_event: string | null;
  orders_made_at_event: string | null;
  case_number?: string | null;
  matter_title?: string | null;
};

export type CapacityDayPulse = {
  date: string;
  band: CapacityBand;
};

export type CalloverPulseRow = {
  id: string;
  status: string;
  callover_date: string;
  items?: Array<{ outcome: string | null; next_date: string | null }>;
};

export type StaleDraftRow = {
  id: string;
  title: string;
  updatedAt: string;
};

export type DashboardInsightInput = {
  today: string;
  role: DashboardRole;
  board: BoardInsightRow[];
  events: EventPulseRow[];
  capacityDays: CapacityDayPulse[];
  pendingHearings: number;
  pendingClerkReviews: number;
  orphanClerkRequests: number;
  openIssueReports: number;
  staleDraftJudgments: StaleDraftRow[];
  callovers: CalloverPulseRow[];
  boardCapped: boolean;
  mattersWithoutParties: string[];
};

const SEVERITY_RANK: Record<InsightSeverity, number> = {
  urgent: 0,
  attention: 1,
  nudge: 2,
};

export const isActiveMatter = (status: string) => status === "active";

export const stillAtFirstStage = (row: Pick<BoardInsightRow, "procedure_stage">) =>
  row.procedure_stage === "arraignment" || row.procedure_stage === "information_sworn";

export const missingNextDate = (row: Pick<BoardInsightRow, "status" | "next_appearance">) =>
  isActiveMatter(row.status) && !row.next_appearance;

export const isOverdueScheduled = (
  event: Pick<EventPulseRow, "event_status" | "scheduled_date">,
  today: string,
) => event.event_status === "scheduled" && event.scheduled_date < today;

export const sittingMissingPaper = (
  event: Pick<
    EventPulseRow,
    "event_status" | "scheduled_date" | "outcome_at_event" | "orders_made_at_event"
  >,
  today: string,
) =>
  event.event_status === "scheduled" &&
  event.scheduled_date === today &&
  !event.outcome_at_event &&
  !event.orders_made_at_event;

export const rulingFileMissing = (
  row: Pick<BoardInsightRow, "ruling_status" | "has_ruling_document">,
) => row.ruling_status === "delivered" && !row.has_ruling_document;

export const judgmentFileMissing = (
  row: Pick<BoardInsightRow, "judgment_status" | "has_judgment_document">,
) => row.judgment_status === "delivered" && !row.has_judgment_document;

export const daysBetween = (fromIso: string, toIso: string) => {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const from = Date.UTC(fy as number, (fm as number) - 1, fd as number);
  const to = Date.UTC(ty as number, (tm as number) - 1, td as number);
  return Math.round((to - from) / 86_400_000);
};

export const isStaleDraft = (updatedAt: string, today: string) => {
  const day = updatedAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return daysBetween(day, today) >= STALE_DRAFT_DAYS;
};

export const workloadFromBoard = (board: BoardInsightRow[]) => {
  const active = board.filter((row) => isActiveMatter(row.status));
  return {
    total: board.length,
    active: active.length,
    noNextDate: active.filter((row) => !row.next_appearance).length,
    firstStage: active.filter(stillAtFirstStage).length,
    byStage: board.reduce<Record<string, number>>((acc, row) => {
      const key = row.procedure_stage || "unset";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  };
};

export const appearancesByDay = (events: EventPulseRow[], from: string, days: number) => {
  const counts = Array.from({ length: days }, (_, index) => ({
    date: addDaysIso(from, index),
    count: 0,
  }));
  const indexByDate = new Map(counts.map((row, index) => [row.date, index]));
  for (const event of events) {
    if (event.event_status === "cancelled" || event.event_status === "entered_in_error") continue;
    const index = indexByDate.get(event.scheduled_date);
    if (index == null) continue;
    counts[index].count += 1;
  }
  return counts;
};

const byCaseNumber = (a: DashboardFileRow, b: DashboardFileRow) =>
  a.case_number.localeCompare(b.case_number) || a.title.localeCompare(b.title);

const toMatterRow = (
  row: Pick<BoardInsightRow, "id" | "case_number" | "matter_title" | "next_appearance" | "status">,
  detail: string,
): DashboardFileRow => ({
  id: row.id,
  href: ROUTES.docketMatter(row.id),
  case_number: row.case_number,
  title: row.matter_title,
  detail,
});

export const filesForFocus = ({
  focus,
  today,
  board,
  events,
  retainedIds,
  extraRetained,
  mattersWithoutParties,
}: {
  focus: DashboardFileFocus;
  today: string;
  board: BoardInsightRow[];
  events: EventPulseRow[];
  retainedIds: string[];
  extraRetained: ExtraRetainedMatter[];
  mattersWithoutParties: string[];
}): DashboardFileRow[] => {
  const boardById = new Map(board.map((row) => [row.id, row]));

  if (focus === "active") {
    return board
      .filter((row) => isActiveMatter(row.status))
      .map((row) =>
        toMatterRow(row, row.next_appearance ? `Next ${row.next_appearance}` : "No next date"),
      )
      .sort(byCaseNumber);
  }

  if (focus === "no_date") {
    return board
      .filter((row) => missingNextDate(row))
      .map((row) => toMatterRow(row, "No next date"))
      .sort(byCaseNumber);
  }

  if (focus === "overdue") {
    return events
      .filter((event) => isOverdueScheduled(event, today))
      .map((event) => {
        const matter = boardById.get(event.docket_matter_id);
        return {
          id: event.id,
          href: ROUTES.docketMatterEvents(event.docket_matter_id),
          case_number: event.case_number ?? matter?.case_number ?? "",
          title: event.matter_title ?? matter?.matter_title ?? "Matter",
          detail: `Scheduled ${event.scheduled_date}`,
        };
      })
      .sort(
        (a, b) => a.detail.localeCompare(b.detail) || a.case_number.localeCompare(b.case_number),
      );
  }

  if (focus === "no_parties") {
    const without = new Set(mattersWithoutParties);
    return board
      .filter((row) => without.has(row.id))
      .map((row) => toMatterRow(row, "No parties entered"))
      .sort(byCaseNumber);
  }

  const extraById = new Map(extraRetained.map((row) => [row.id, row]));
  return retainedIds
    .map((id) => {
      const onBoard = boardById.get(id);
      if (onBoard) {
        return toMatterRow(
          onBoard,
          onBoard.next_appearance ? `Next ${onBoard.next_appearance}` : onBoard.status,
        );
      }
      const extra = extraById.get(id);
      if (extra) {
        return {
          id: extra.id,
          href: ROUTES.docketMatter(extra.id),
          case_number: extra.case_number,
          title: extra.matter_title,
          detail: extra.status,
        };
      }
      return null;
    })
    .filter((row): row is DashboardFileRow => row != null)
    .sort(byCaseNumber);
};

const fileLabel = (row: Pick<BoardInsightRow, "case_number" | "matter_title">) =>
  row.case_number || row.matter_title || "a file";

const push = (list: DashboardInsight[], insight: DashboardInsight) => {
  if (list.some((item) => item.id === insight.id)) return;
  list.push(insight);
};

export const buildDashboardInsights = (input: DashboardInsightInput): DashboardInsight[] => {
  const insights: DashboardInsight[] = [];
  const active = input.board.filter((row) => isActiveMatter(row.status));

  if (input.boardCapped) {
    push(insights, {
      id: "board-capped",
      severity: "nudge",
      title: `Showing the first ${BOARD_INSIGHT_CAP} files`,
      why: "Only the first 100 files are counted. Open the Docket and filter by day or court for the rest.",
      href: ROUTES.docket,
      cta: "Open docket",
    });
  }

  const overdue = input.events.filter((event) => isOverdueScheduled(event, input.today));
  if (overdue.length > 0) {
    const first = overdue[0];
    push(insights, {
      id: "overdue-scheduled",
      severity: "urgent",
      title:
        overdue.length === 1
          ? `${fileLabel({ case_number: first.case_number ?? "", matter_title: first.matter_title ?? "" })} is still marked scheduled`
          : `${overdue.length} appearances are still scheduled after their date`,
      why: "A past sitting left on Scheduled is not a paper trail. Log the outcome or complete the appearance on the file.",
      href:
        overdue.length === 1 && first
          ? ROUTES.docketMatterEvents(first.docket_matter_id)
          : dashboardFilesHref("overdue"),
      cta: overdue.length === 1 ? "Log outcome" : "See sittings",
    });
  }

  const todayPaper = input.events.filter((event) => sittingMissingPaper(event, input.today));
  if (todayPaper.length > 0) {
    const first = todayPaper[0];
    push(insights, {
      id: "today-missing-paper",
      severity: "urgent",
      title:
        todayPaper.length === 1
          ? "Today's sitting has no outcome or orders yet"
          : `${todayPaper.length} sittings today have no outcome or orders`,
      why: "Record what happened while it is still in mind. Outcome and orders are the sitting's log, not a later memory.",
      href: first ? ROUTES.docketMatterEvents(first.docket_matter_id) : ROUTES.docket,
      cta: "Log appearance",
    });
  }

  const noNext = active.filter(missingNextDate);
  if (noNext.length > 0) {
    push(insights, {
      id: "no-next-date",
      severity: "attention",
      title:
        noNext.length === 1
          ? `${fileLabel(noNext[0])} has no next date`
          : `${noNext.length} active files have no next date`,
      why: "An active file without a next date drops off the week strip. Set the next hearing from the board.",
      href: noNext.length === 1 ? ROUTES.docketMatter(noNext[0].id) : dashboardFilesHref("no_date"),
      cta: "Set next date",
    });
  }

  const firstStage = active.filter(stillAtFirstStage);
  if (firstStage.length > 0) {
    push(insights, {
      id: "first-stage",
      severity: "nudge",
      title:
        firstStage.length === 1
          ? `${fileLabel(firstStage[0])} is still at the first stage`
          : `${firstStage.length} files are still at the first stage`,
      why: "Logging the current column keeps the board honest. A file that never leaves arraignment reads as untouched.",
      href: ROUTES.docket,
      cta: "Log procedure",
    });
  }

  const missingRuling = input.board.filter(rulingFileMissing);
  if (missingRuling.length > 0) {
    push(insights, {
      id: "ruling-file",
      severity: "attention",
      title:
        missingRuling.length === 1
          ? `Ruling delivered on ${fileLabel(missingRuling[0])} without a file`
          : `${missingRuling.length} delivered rulings have no attached file`,
      why: "The board already knows the ruling was delivered. Attach the document so the file, not only the cell, holds the record.",
      href: `${ROUTES.docketMatter(missingRuling[0].id)}?tab=documents`,
      cta: "Attach ruling",
    });
  }

  const missingJudgment = input.board.filter(judgmentFileMissing);
  if (missingJudgment.length > 0) {
    push(insights, {
      id: "judgment-file",
      severity: "attention",
      title:
        missingJudgment.length === 1
          ? `Judgment delivered on ${fileLabel(missingJudgment[0])} without a file`
          : `${missingJudgment.length} delivered judgments have no attached file`,
      why: "A delivered judgment without the PDF is a gap on the file. Attach it on the documents tab.",
      href: `${ROUTES.docketMatter(missingJudgment[0].id)}?tab=documents`,
      cta: "Attach judgment",
    });
  }

  if (input.mattersWithoutParties.length > 0) {
    const firstId = input.mattersWithoutParties[0];
    const row = input.board.find((item) => item.id === firstId);
    push(insights, {
      id: "missing-parties",
      severity: "attention",
      title:
        input.mattersWithoutParties.length === 1
          ? `${fileLabel(row ?? { case_number: "", matter_title: "This file" })} has no parties`
          : `${input.mattersWithoutParties.length} files have no parties`,
      why: "A jacket without parties is hard to call. Add the names on the file.",
      href:
        input.mattersWithoutParties.length === 1
          ? `${ROUTES.docketMatter(firstId)}?tab=parties`
          : dashboardFilesHref("no_parties"),
      cta: input.mattersWithoutParties.length === 1 ? "Add parties" : "See files",
    });
  }

  const openCallovers =
    input.role === "clerk"
      ? []
      : input.callovers.filter((row) => row.status === "draft" || row.status === "in_progress");
  const dueCallover = openCallovers.find((row) => row.callover_date <= input.today);
  if (dueCallover) {
    push(insights, {
      id: "open-callover",
      severity: dueCallover.callover_date < input.today ? "urgent" : "attention",
      title:
        dueCallover.callover_date < input.today
          ? "A callover sitting is still open after its date"
          : "Today's callover is still open",
      why: "Finish the running sheet, or reopen it deliberately. An open draft is not a closed record of the sitting.",
      href: ROUTES.callover(dueCallover.id),
      cta: "Open callover",
    });
  }

  const calloverNudge =
    input.role === "clerk"
      ? undefined
      : input.callovers.find((row) =>
          (row.items ?? []).some(
            (item) =>
              (outcomeExpectsNextDate(item.outcome) && !item.next_date) ||
              outcomeSuggestsCompletion(item.outcome),
          ),
        );
  if (calloverNudge && !dueCallover) {
    push(insights, {
      id: "callover-nudge",
      severity: "nudge",
      title: "A callover item still needs a next date or a close",
      why: "Adjourned and part-heard sittings usually need a next date. Struck out, withdrawn and concluded usually close the file. Only tick that if it's true.",
      href: ROUTES.callover(calloverNudge.id),
      cta: "Finish sheet",
    });
  }

  if (input.pendingHearings > 0) {
    push(insights, {
      id: "offline-outbox",
      severity: "urgent",
      title:
        input.pendingHearings === 1
          ? "One hearing is waiting to sync"
          : `${input.pendingHearings} hearings are waiting to sync`,
      why: "Work logged offline is not on the court file until it flushes. Stay on the network and open Docket.",
      href: ROUTES.docket,
      cta: "Sync hearings",
    });
  }

  const hotCapacity = input.capacityDays.filter(
    (day) =>
      day.date >= input.today &&
      day.date <= addDaysIso(input.today, 4) &&
      (day.band === "amber" ||
        day.band === "full" ||
        day.band === "over_capacity" ||
        day.band === "not_set"),
  );
  if (hotCapacity.some((day) => day.band === "over_capacity" || day.band === "full")) {
    push(insights, {
      id: "capacity-full",
      severity: "urgent",
      title: "A sitting day in the next five is full or over capacity",
      why: "The traffic-light bands are your personal limit, not the day's total. Open the calendar strip before adding another matter.",
      href: input.role === "clerk" ? ROUTES.docket : ROUTES.calendar,
      cta: "See capacity",
    });
  } else if (hotCapacity.some((day) => day.band === "amber")) {
    push(insights, {
      id: "capacity-amber",
      severity: "attention",
      title: "A sitting day this week is filling",
      why: "Amber means at least half the personal limit is already listed. Check the week before stacking more.",
      href: ROUTES.docket,
      cta: "See the week",
    });
  } else if (hotCapacity.some((day) => day.band === "not_set")) {
    push(insights, {
      id: "capacity-unset",
      severity: "nudge",
      title: "Daily capacity is not set",
      why: "Without a personal limit the strip cannot warn you. Set it from the docket week strip.",
      href: ROUTES.docket,
      cta: "Set capacity",
    });
  }

  if (input.role !== "clerk") {
    const stale = input.staleDraftJudgments.filter((row) =>
      isStaleDraft(row.updatedAt, input.today),
    );
    if (stale.length > 0) {
      push(insights, {
        id: "stale-draft",
        severity: "nudge",
        title:
          stale.length === 1
            ? `"${stale[0].title}" has sat as a draft`
            : `${stale.length} draft judgments are older than ${STALE_DRAFT_DAYS} days`,
        why: "A draft that does not move is easy to forget. Continue it, or leave it until the sitting needs it.",
        href: ROUTES.judgmentDetail(stale[0].id),
        cta: "Continue draft",
      });
    }

    if (input.pendingClerkReviews > 0) {
      push(insights, {
        id: "clerk-reviews",
        severity: "attention",
        title:
          input.pendingClerkReviews === 1
            ? "A clerk is waiting on court access"
            : `${input.pendingClerkReviews} clerks are waiting on court access`,
        why: "Approval is the paper trail that lets a clerk onto that court's sheet. Decide the request.",
        href: ROUTES.clerkAccessRequests,
        cta: "Review requests",
      });
    }
  }

  if (input.role === "admin") {
    if (input.orphanClerkRequests > 0) {
      push(insights, {
        id: "orphan-clerk",
        severity: "attention",
        title:
          input.orphanClerkRequests === 1
            ? "An unresolved clerk request has no sitting magistrate"
            : `${input.orphanClerkRequests} clerk requests have no sitting magistrate`,
        why: "Those requests cannot be decided on the magistrate review page. Open the admin queue.",
        href: ROUTES.adminClerkAccess,
        cta: "Open unresolved",
      });
    }
    if (input.openIssueReports > 0) {
      push(insights, {
        id: "issue-reports",
        severity: "nudge",
        title:
          input.openIssueReports === 1
            ? "One issue report is still open"
            : `${input.openIssueReports} issue reports are still open`,
        why: "The ledger of what people could not do in the product. Close or note them from Operations.",
        href: ROUTES.adminIssueReports,
        cta: "Review reports",
      });
    }
  }

  return insights
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.title.localeCompare(b.title),
    )
    .slice(0, MAX_INSIGHTS);
};
