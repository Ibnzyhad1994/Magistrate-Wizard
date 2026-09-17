/**
 * Deterministic dashboard coaching — no live database.
 *
 *   npm run test:dashboard-insights
 */
import {
  appearancesByDay,
  buildDashboardInsights,
  dashboardFilesHref,
  filesForFocus,
  isDashboardFileFocus,
  isOverdueScheduled,
  isStaleDraft,
  missingNextDate,
  stillAtFirstStage,
  sittingMissingPaper,
  workloadFromBoard,
} from "../../src/lib/dashboard-insights.ts";

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
}

const boardRow = (overrides = {}) => ({
  id: "m1",
  status: "active",
  case_number: "2026/1",
  matter_title: "R v Test",
  next_appearance: "2026-09-20",
  procedure_stage: "trial",
  workflow_protocol: "criminal_trial",
  ruling_status: "not_started",
  judgment_status: "not_started",
  has_ruling_document: false,
  has_judgment_document: false,
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

check(
  "active file without a next date",
  missingNextDate(boardRow({ next_appearance: null })),
  true,
);
check(
  "completed file without a next date is ignored",
  missingNextDate(boardRow({ status: "completed", next_appearance: null })),
  false,
);
check(
  "arraignment is still first stage",
  stillAtFirstStage(boardRow({ procedure_stage: "arraignment" })),
  true,
);
check(
  "civil information_sworn is first stage",
  stillAtFirstStage(boardRow({ procedure_stage: "information_sworn" })),
  true,
);
check("trial is not first stage", stillAtFirstStage(boardRow({ procedure_stage: "trial" })), false);

check(
  "scheduled yesterday is overdue",
  isOverdueScheduled({ event_status: "scheduled", scheduled_date: "2026-09-14" }, "2026-09-15"),
  true,
);
check(
  "scheduled today is not overdue",
  isOverdueScheduled({ event_status: "scheduled", scheduled_date: "2026-09-15" }, "2026-09-15"),
  false,
);
check(
  "today sitting missing paper",
  sittingMissingPaper(
    {
      event_status: "scheduled",
      scheduled_date: "2026-09-15",
      outcome_at_event: null,
      orders_made_at_event: null,
    },
    "2026-09-15",
  ),
  true,
);
check(
  "today sitting with outcome is logged",
  sittingMissingPaper(
    {
      event_status: "scheduled",
      scheduled_date: "2026-09-15",
      outcome_at_event: "Adjourned",
      orders_made_at_event: null,
    },
    "2026-09-15",
  ),
  false,
);

check(
  "draft older than 14 days is stale",
  isStaleDraft("2026-08-01T12:00:00Z", "2026-09-15"),
  true,
);
check(
  "draft from yesterday is not stale",
  isStaleDraft("2026-09-14T12:00:00Z", "2026-09-15"),
  false,
);

const workload = workloadFromBoard([
  boardRow(),
  boardRow({ id: "m2", next_appearance: null, procedure_stage: "arraignment" }),
  boardRow({ id: "m3", status: "completed" }),
]);
check("workload active count", workload.active, 2);
check("workload no next date", workload.noNextDate, 1);
check("workload first stage", workload.firstStage, 1);

const spark = appearancesByDay(
  [
    {
      id: "e1",
      docket_matter_id: "m1",
      scheduled_date: "2026-09-15",
      event_status: "scheduled",
      event_type: "hearing",
      outcome_at_event: null,
      orders_made_at_event: null,
    },
    {
      id: "e2",
      docket_matter_id: "m1",
      scheduled_date: "2026-09-16",
      event_status: "cancelled",
      event_type: "hearing",
      outcome_at_event: null,
      orders_made_at_event: null,
    },
    {
      id: "e3",
      docket_matter_id: "m2",
      scheduled_date: "2026-09-15",
      event_status: "completed",
      event_type: "hearing",
      outcome_at_event: "Heard",
      orders_made_at_event: null,
    },
  ],
  "2026-09-15",
  3,
);
check(
  "sparkline ignores cancelled",
  spark.map((row) => row.count),
  [2, 0, 0],
);

const overdue = buildDashboardInsights({
  today: "2026-09-15",
  role: "magistrate",
  board: [boardRow({ next_appearance: null })],
  events: [
    {
      id: "e1",
      docket_matter_id: "m1",
      scheduled_date: "2026-09-10",
      event_status: "scheduled",
      event_type: "hearing",
      outcome_at_event: null,
      orders_made_at_event: null,
      case_number: "2026/1",
      matter_title: "R v Test",
    },
  ],
  capacityDays: [],
  pendingHearings: 0,
  pendingClerkReviews: 0,
  orphanClerkRequests: 0,
  openIssueReports: 0,
  staleDraftJudgments: [],
  callovers: [],
  boardCapped: false,
  mattersWithoutParties: [],
});
check("overdue sits above missing next date", overdue[0].id, "overdue-scheduled");
check(
  "missing next date still fires",
  overdue.some((row) => row.id === "no-next-date"),
  true,
);

const clerkBlocked = buildDashboardInsights({
  today: "2026-09-15",
  role: "clerk",
  board: [],
  events: [],
  capacityDays: [],
  pendingHearings: 0,
  pendingClerkReviews: 4,
  orphanClerkRequests: 2,
  openIssueReports: 3,
  staleDraftJudgments: [{ id: "j1", title: "Draft", updatedAt: "2026-01-01T00:00:00Z" }],
  callovers: [{ id: "c1", status: "draft", callover_date: "2026-09-15" }],
  boardCapped: false,
  mattersWithoutParties: [],
});
check(
  "clerk never sees callover coaching",
  clerkBlocked.some((row) => row.id.startsWith("open-callover") || row.id === "callover-nudge"),
  false,
);
check(
  "clerk never sees judicial drafts",
  clerkBlocked.some((row) => row.id === "stale-draft"),
  false,
);
check(
  "clerk never sees admin queues",
  clerkBlocked.some((row) => row.id === "orphan-clerk" || row.id === "issue-reports"),
  false,
);

const adminOps = buildDashboardInsights({
  today: "2026-09-15",
  role: "admin",
  board: [],
  events: [],
  capacityDays: [],
  pendingHearings: 0,
  pendingClerkReviews: 0,
  orphanClerkRequests: 1,
  openIssueReports: 2,
  staleDraftJudgments: [],
  callovers: [],
  boardCapped: true,
  mattersWithoutParties: [],
});
check(
  "admin sees orphan clerk requests",
  adminOps.some((row) => row.id === "orphan-clerk"),
  true,
);
check(
  "capped board is disclosed",
  adminOps.some((row) => row.id === "board-capped"),
  true,
);

const ruling = buildDashboardInsights({
  today: "2026-09-15",
  role: "magistrate",
  board: [boardRow({ ruling_status: "delivered", has_ruling_document: false })],
  events: [],
  capacityDays: [{ date: "2026-09-16", band: "over_capacity" }],
  pendingHearings: 1,
  pendingClerkReviews: 1,
  orphanClerkRequests: 0,
  openIssueReports: 0,
  staleDraftJudgments: [],
  callovers: [],
  boardCapped: false,
  mattersWithoutParties: ["m1"],
});
check(
  "offline outbox is urgent",
  ruling.find((row) => row.id === "offline-outbox")?.severity,
  "urgent",
);
check(
  "ruling without file is suggested",
  ruling.some((row) => row.id === "ruling-file"),
  true,
);
check(
  "missing parties is suggested",
  ruling.some((row) => row.id === "missing-parties"),
  true,
);
check(
  "over capacity in five days is urgent",
  ruling.find((row) => row.id === "capacity-full")?.severity,
  "urgent",
);

const files = filesForFocus({
  focus: "active",
  today: "2026-09-15",
  board: [
    boardRow({ id: "m2", case_number: "2026/2", matter_title: "R v Two", next_appearance: null }),
    boardRow({ id: "m3", status: "completed", case_number: "2026/3", matter_title: "Closed" }),
    boardRow({ id: "m1", case_number: "2026/1", matter_title: "R v One" }),
  ],
  events: [
    {
      id: "e1",
      docket_matter_id: "m1",
      scheduled_date: "2026-09-10",
      event_status: "scheduled",
      event_type: "hearing",
      outcome_at_event: null,
      orders_made_at_event: null,
      case_number: "2026/1",
      matter_title: "R v One",
    },
    {
      id: "e2",
      docket_matter_id: "m2",
      scheduled_date: "2026-09-11",
      event_status: "scheduled",
      event_type: "hearing",
      outcome_at_event: null,
      orders_made_at_event: null,
      case_number: "2026/2",
      matter_title: "R v Two",
    },
  ],
  retainedIds: ["m1", "off-board"],
  extraRetained: [
    {
      id: "off-board",
      case_number: "2026/9",
      matter_title: "Retained elsewhere",
      status: "active",
    },
  ],
  mattersWithoutParties: ["m2"],
});
check(
  "active files omit completed jackets",
  files.map((row) => row.id),
  ["m1", "m2"],
);
check(
  "active files sort by case number",
  files.map((row) => row.case_number),
  ["2026/1", "2026/2"],
);
check(
  "active file without a date says so",
  files.find((row) => row.id === "m2")?.detail,
  "No next date",
);

const noDateFiles = filesForFocus({
  focus: "no_date",
  today: "2026-09-15",
  board: [
    boardRow({ id: "m2", case_number: "2026/2", next_appearance: null }),
    boardRow({ id: "m1", next_appearance: "2026-09-20" }),
    boardRow({ id: "m3", status: "completed", next_appearance: null }),
  ],
  events: [],
  retainedIds: [],
  extraRetained: [],
  mattersWithoutParties: [],
});
check(
  "no next date lists only active empty dates",
  noDateFiles.map((row) => row.id),
  ["m2"],
);

const overdueFiles = filesForFocus({
  focus: "overdue",
  today: "2026-09-15",
  board: [boardRow()],
  events: [
    {
      id: "e1",
      docket_matter_id: "m1",
      scheduled_date: "2026-09-10",
      event_status: "scheduled",
      event_type: "hearing",
      outcome_at_event: null,
      orders_made_at_event: null,
      case_number: "2026/1",
      matter_title: "R v Test",
    },
    {
      id: "e-today",
      docket_matter_id: "m1",
      scheduled_date: "2026-09-15",
      event_status: "scheduled",
      event_type: "hearing",
      outcome_at_event: null,
      orders_made_at_event: null,
      case_number: "2026/1",
      matter_title: "R v Test",
    },
  ],
  retainedIds: [],
  extraRetained: [],
  mattersWithoutParties: [],
});
check(
  "overdue list is one row per past sitting",
  overdueFiles.map((row) => row.id),
  ["e1"],
);
check("overdue row opens the events tab", overdueFiles[0].href, "/docket/m1?tab=events");

const retainedFiles = filesForFocus({
  focus: "retained",
  today: "2026-09-15",
  board: [boardRow({ id: "m1", case_number: "2026/1" })],
  events: [],
  retainedIds: ["off-board", "m1"],
  extraRetained: [
    {
      id: "off-board",
      case_number: "2026/9",
      matter_title: "Retained elsewhere",
      status: "active",
    },
  ],
  mattersWithoutParties: [],
});
check(
  "retained list merges board and leftover ids",
  retainedFiles.map((row) => row.case_number),
  ["2026/1", "2026/9"],
);

const partyFiles = filesForFocus({
  focus: "no_parties",
  today: "2026-09-15",
  board: [
    boardRow({ id: "m1" }),
    boardRow({ id: "m2", case_number: "2026/2", matter_title: "R v Two" }),
  ],
  events: [],
  retainedIds: [],
  extraRetained: [],
  mattersWithoutParties: ["m2"],
});
check(
  "without parties uses the presence set",
  partyFiles.map((row) => row.id),
  ["m2"],
);

check("files query accepts known focuses", isDashboardFileFocus("no_date"), true);
check("files query rejects unknown focuses", isDashboardFileFocus("all"), false);

const manyOverdue = buildDashboardInsights({
  today: "2026-09-15",
  role: "magistrate",
  board: [boardRow(), boardRow({ id: "m2", case_number: "2026/2" })],
  events: [
    {
      id: "e1",
      docket_matter_id: "m1",
      scheduled_date: "2026-09-10",
      event_status: "scheduled",
      event_type: "hearing",
      outcome_at_event: null,
      orders_made_at_event: null,
      case_number: "2026/1",
      matter_title: "R v Test",
    },
    {
      id: "e2",
      docket_matter_id: "m2",
      scheduled_date: "2026-09-11",
      event_status: "scheduled",
      event_type: "hearing",
      outcome_at_event: null,
      orders_made_at_event: null,
      case_number: "2026/2",
      matter_title: "R v Two",
    },
  ],
  capacityDays: [],
  pendingHearings: 0,
  pendingClerkReviews: 0,
  orphanClerkRequests: 0,
  openIssueReports: 0,
  staleDraftJudgments: [],
  callovers: [],
  boardCapped: false,
  mattersWithoutParties: ["m1", "m2"],
});
check(
  "many overdue sittings open the dashboard list",
  manyOverdue.find((row) => row.id === "overdue-scheduled")?.href,
  dashboardFilesHref("overdue"),
);
check(
  "many files without parties open the dashboard list",
  manyOverdue.find((row) => row.id === "missing-parties")?.href,
  dashboardFilesHref("no_parties"),
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
