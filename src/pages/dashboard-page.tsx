import { useMemo } from "react";
import { BrowsePage } from "@/components/browse";
import { InlineError } from "@/components/common/inline-error";
import { MetricLedger, MetricStat } from "@/components/dashboard/metric-stat";
import { CapacityWeek } from "@/components/dashboard/capacity-week";
import { AppearanceTimeline } from "@/components/dashboard/appearance-timeline";
import { SuggestionList } from "@/components/dashboard/suggestion-list";
import { Sparkline, StageLedger } from "@/components/dashboard/stage-ledger";
import { DashboardFileList } from "@/components/dashboard/dashboard-file-list";
import { DashboardFolio, DashboardKicker } from "@/components/dashboard/dashboard-folio";
import { useAuth } from "@/hooks/use-auth";
import { usePageTitle } from "@/hooks/use-page-title";
import { useDocketMatterBoard } from "@/hooks/docket/use-docket-matters";
import {
  useDashboardEventPulse,
  useDashboardPartyPresence,
  useMatterSummaries,
  useMyRetainedMatterIds,
} from "@/hooks/use-dashboard";
import { useMyCurrentCourts } from "@/hooks/docket/use-lookups";
import { useCallovers } from "@/hooks/docket/use-callovers";
import { useDocketCapacitySettings } from "@/hooks/docket/use-docket-capacity";
import {
  useClerkAccessRequestsToReview,
  useOrphanedClerkAccessRequests,
} from "@/hooks/clerk/use-clerk-access-review";
import { useIssueReports } from "@/hooks/admin/use-issue-reports";
import { useJudgments } from "@/hooks/judgments/use-judgments";
import { usePendingHearings } from "@/hooks/offline/use-pending-hearings";
import { useMyClerkAccessRequests } from "@/hooks/clerk/use-clerk-access";
import { clerkHomeState, clerkPendingDescription } from "@/lib/clerk-home";
import { EMPTY_PROCEDURE_FILTERS } from "@/lib/docket-procedure";
import { addDaysIso, daysOfWeek, weekStartSunday } from "@/lib/docket-week";
import {
  appearancesByDay,
  BOARD_INSIGHT_CAP,
  buildDashboardInsights,
  dashboardFilesHref,
  filesForFocus,
  isDashboardFileFocus,
  isOverdueScheduled,
  workloadFromBoard,
  type BoardInsightRow,
  type DashboardFileFocus,
  type DashboardRole,
} from "@/lib/dashboard-insights";
import { formatDate, getLocalDateOnly } from "@/lib/utils";
import { ROUTES } from "@/routes/paths";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Operational briefing. Home (`/`) keeps the cinematic rows. This page
 * composes the docket board RPC, capacity snapshots, and event pulse —
 * never the Home carousels — and only counts rows the caller can already see.
 */
export default function DashboardPage() {
  const { user, profile } = useAuth();
  const [searchParams] = useSearchParams();
  const filesParam = searchParams.get("files");
  const filesFocus = isDashboardFileFocus(filesParam) ? filesParam : null;
  const role = (profile?.role ?? "magistrate") as DashboardRole;
  const isClerk = role === "clerk";
  const isAdmin = role === "admin";
  const today = getLocalDateOnly();
  usePageTitle("Dashboard");
  const weekDates = useMemo(() => daysOfWeek(weekStartSunday(today)), [today]);
  const pulseFrom = addDaysIso(today, -90);
  const pulseTo = addDaysIso(today, 13);

  const { data: myCourts, isPending: courtsPending } = useMyCurrentCourts();
  const { data: clerkRequests } = useMyClerkAccessRequests();
  const clerkState = !profile
    ? "loading"
    : isClerk
      ? clerkHomeState({ courtsPending, courtCount: myCourts?.length ?? 0 })
      : "ready";
  const isPendingClerk = clerkState === "pending";
  const operational = clerkState === "ready";

  const boardQuery = useDocketMatterBoard("", EMPTY_PROCEDURE_FILTERS, null, null, {
    enabled: operational,
  });
  const eventsQuery = useDashboardEventPulse(pulseFrom, pulseTo, { enabled: operational });
  const retainedIdsQuery = useMyRetainedMatterIds({ enabled: operational && !isClerk });
  const judgmentsQuery = useJudgments({ enabled: operational && !isClerk });
  const calloversQuery = useCallovers(null, { enabled: operational && !isClerk });
  const clerkReviewQuery = useClerkAccessRequestsToReview({ enabled: operational && !isClerk });
  const orphanQuery = useOrphanedClerkAccessRequests({ enabled: operational && isAdmin });
  const issuesQuery = useIssueReports({ enabled: operational && isAdmin });
  const pendingHearings = usePendingHearings();
  const capacitySettings = useDocketCapacitySettings();

  // Derived collections are memoised so the insight/file memos below see
  // stable references between renders (react-hooks/exhaustive-deps).
  const board = useMemo(() => boardQuery.data ?? [], [boardQuery.data]);
  const boardRows = useMemo<BoardInsightRow[]>(
    () =>
      board.map((row) => ({
        id: row.id,
        status: row.status,
        case_number: row.case_number,
        matter_title: row.matter_title,
        next_appearance: row.next_appearance,
        procedure_stage: row.procedure_stage,
        workflow_protocol: row.workflow_protocol,
        ruling_status: row.ruling_status,
        judgment_status: row.judgment_status,
        has_ruling_document: row.has_ruling_document,
        has_judgment_document: row.has_judgment_document,
        created_at: row.created_at,
      })),
    [board],
  );
  const matterIds = useMemo(() => boardRows.map((row) => row.id), [boardRows]);
  const partiesQuery = useDashboardPartyPresence(matterIds, {
    enabled: operational && matterIds.length > 0,
  });

  const workload = workloadFromBoard(boardRows);
  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);
  const overdueCount = events.filter((event) => isOverdueScheduled(event, today)).length;
  const spark = appearancesByDay(events, today, 14);
  const partiesPresent = partiesQuery.data;
  const mattersWithoutParties = useMemo(
    () =>
      operational
        ? boardRows
            .filter((row) => row.status === "active")
            .filter((row) => partiesPresent && !partiesPresent.has(row.id))
            .map((row) => row.id)
        : [],
    [operational, boardRows, partiesPresent],
  );

  const pendingClerkReviews = isClerk
    ? 0
    : (clerkReviewQuery.data ?? []).filter((row) => row.status === "pending").length;
  const openIssues = isAdmin
    ? (issuesQuery.data ?? []).filter(
        (row) => row.status === "open" || row.status === "in_progress",
      ).length
    : 0;
  const userId = user?.id;
  const judgmentRows = judgmentsQuery.data;
  const staleDrafts = useMemo(
    () =>
      !isClerk
        ? (judgmentRows ?? [])
            .filter((row) => row.owner_id === userId && row.status === "draft")
            .map((row) => ({ id: row.id, title: row.title, updatedAt: row.updated_at }))
        : [],
    [isClerk, judgmentRows, userId],
  );

  const calloverRows = calloversQuery.data;
  const callovers = useMemo(
    () =>
      !isClerk
        ? (calloverRows ?? []).map((row) => ({
            id: row.id,
            status: row.status,
            callover_date: row.callover_date,
          }))
        : [],
    [isClerk, calloverRows],
  );

  const leftoverRetainedIds = useMemo(() => {
    if (filesFocus !== "retained") return [] as string[];
    const onBoard = new Set(board.map((row) => row.id));
    return (retainedIdsQuery.data ?? []).filter((id) => !onBoard.has(id));
  }, [filesFocus, board, retainedIdsQuery.data]);
  const extraRetainedQuery = useMatterSummaries(leftoverRetainedIds, {
    enabled: leftoverRetainedIds.length > 0,
  });

  const fileRows = useMemo(
    () =>
      filesFocus
        ? filesForFocus({
            focus: filesFocus,
            today,
            board: boardRows,
            events,
            retainedIds: retainedIdsQuery.data ?? [],
            extraRetained: extraRetainedQuery.data ?? [],
            mattersWithoutParties,
          })
        : [],
    [
      filesFocus,
      today,
      boardRows,
      events,
      retainedIdsQuery.data,
      extraRetainedQuery.data,
      mattersWithoutParties,
    ],
  );
  const filesPending =
    Boolean(filesFocus) &&
    (boardQuery.isPending ||
      eventsQuery.isPending ||
      (filesFocus === "no_parties" && partiesQuery.isPending) ||
      (filesFocus === "retained" &&
        (retainedIdsQuery.isPending || extraRetainedQuery.isFetching)));

  const metricHref = (focus: DashboardFileFocus) =>
    filesFocus === focus ? ROUTES.dashboard : dashboardFilesHref(focus);

  const sitsCourt = (myCourts?.length ?? 0) > 0;
  const capacityUnset = !capacitySettings.isPending && (capacitySettings.data?.length ?? 0) === 0;
  const capacityDays = useMemo(
    () =>
      sitsCourt && capacityUnset
        ? weekDates
            .filter((date) => date >= today)
            .slice(0, 5)
            .map((date) => ({ date, band: "not_set" as const }))
        : [],
    [sitsCourt, capacityUnset, weekDates, today],
  );

  const insights = useMemo(
    () =>
      buildDashboardInsights({
        today,
        role,
        board: boardRows,
        events,
        capacityDays,
        pendingHearings: pendingHearings.count,
        pendingClerkReviews,
        orphanClerkRequests: isAdmin ? (orphanQuery.data ?? []).length : 0,
        openIssueReports: openIssues,
        staleDraftJudgments: staleDrafts,
        callovers,
        boardCapped: board.length >= BOARD_INSIGHT_CAP,
        mattersWithoutParties,
      }),
    [
      today,
      role,
      boardRows,
      events,
      capacityDays,
      pendingHearings.count,
      pendingClerkReviews,
      isAdmin,
      orphanQuery.data,
      openIssues,
      staleDrafts,
      callovers,
      board.length,
      mattersWithoutParties,
    ],
  );

  const pendingClerkRequests = (clerkRequests ?? []).filter((row) => row.status === "pending");
  const sittingLine = (myCourts ?? [])
    .map((court) => court.court_name)
    .filter(Boolean)
    .join(" · ");
  const todayLabel = formatDate(today, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  if (isPendingClerk || clerkState === "loading") {
    return (
      <BrowsePage>
        <DashboardFolio>
          <header className="mb-10 max-w-2xl">
            <DashboardKicker>Briefing</DashboardKicker>
            <p className="mt-3 font-brand text-sm tabular-nums tracking-wide text-muted-foreground">
              {todayLabel}
            </p>
            <h1
              className="mt-4 font-brand text-5xl tracking-[0.08em] text-foreground"
              data-tour="page-dashboard"
            >
              Dashboard
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {clerkState === "loading"
                ? "Loading your court assignment."
                : clerkPendingDescription({
                    pendingRequestCount: pendingClerkRequests.length,
                    pendingCourtName: pendingClerkRequests[0]?.courts?.name,
                  })}
            </p>
          </header>
          {isPendingClerk && (
            <Button asChild>
              <Link to={ROUTES.clerkAccess}>View my requests</Link>
            </Button>
          )}
        </DashboardFolio>
      </BrowsePage>
    );
  }

  return (
    <BrowsePage>
      <DashboardFolio>
        <header className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <DashboardKicker>Chambers briefing</DashboardKicker>
            <p className="mt-3 font-brand text-sm tabular-nums tracking-wide text-muted-foreground">
              {todayLabel}
              {sittingLine ? ` · ${sittingLine}` : ""}
            </p>
            <h1
              className="mt-4 font-brand text-5xl tracking-[0.08em] text-foreground"
              data-tour="page-dashboard"
            >
              Dashboard
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Load, paper trail, and the next log to make — from files you can already see.
            </p>
          </div>
          <Button asChild variant="link" className="h-auto justify-start px-0">
            <Link to={ROUTES.home}>Return to Home</Link>
          </Button>
        </header>

        {boardQuery.isError && (
          <div className="mb-6">
            <InlineError error={boardQuery.error} onRetry={() => void boardQuery.refetch()} />
          </div>
        )}

        <MetricLedger>
          {boardQuery.isPending ? (
            <>
              <Skeleton className="h-28 rounded-none" />
              <Skeleton className="h-28 rounded-none" />
              <Skeleton className="h-28 rounded-none" />
              <Skeleton className="h-28 rounded-none" />
            </>
          ) : (
            <>
              <MetricStat
                label="Active files"
                value={workload.active}
                hint="Active matters on the board in view (same 100-row cap as the working sheet)."
                href={metricHref("active")}
                selected={filesFocus === "active"}
              />
              <MetricStat
                label="No next date"
                value={workload.noNextDate}
                hint="Active files with an empty next appearance. Set the date from the board."
                href={metricHref("no_date")}
                selected={filesFocus === "no_date"}
                tone={workload.noNextDate > 0 ? "warn" : "ok"}
              />
              <MetricStat
                label="Overdue sittings"
                value={overdueCount}
                hint="Appearances still marked scheduled after their date."
                href={metricHref("overdue")}
                selected={filesFocus === "overdue"}
                tone={overdueCount > 0 ? "warn" : "ok"}
              />
              {isClerk ? (
                <MetricStat
                  label="Without parties"
                  value={mattersWithoutParties.length}
                  hint="Active files with no party rows yet."
                  href={metricHref("no_parties")}
                  selected={filesFocus === "no_parties"}
                  tone={mattersWithoutParties.length > 0 ? "warn" : "ok"}
                />
              ) : (
                <MetricStat
                  label="Retained"
                  value={retainedIdsQuery.data?.length ?? 0}
                  hint="Part-heard files currently retained to you."
                  href={metricHref("retained")}
                  selected={filesFocus === "retained"}
                />
              )}
              {isAdmin && (
                <>
                  <MetricStat
                    label="Unresolved clerk access"
                    value={orphanQuery.data?.length ?? 0}
                    hint="Pending clerk requests with no sitting magistrate who can decide them."
                    href={ROUTES.adminClerkAccess}
                    tone={(orphanQuery.data?.length ?? 0) > 0 ? "warn" : "ink"}
                  />
                  <MetricStat
                    label="Open issue reports"
                    value={openIssues}
                    hint="Issue reports still open or in progress."
                    href={ROUTES.adminIssueReports}
                  />
                </>
              )}
            </>
          )}
        </MetricLedger>

        {filesFocus ? (
          <div className="mt-12">
            <DashboardFileList
              focus={filesFocus}
              rows={fileRows}
              isPending={filesPending}
              boardCapped={board.length >= BOARD_INSIGHT_CAP}
            />
          </div>
        ) : (
          <>
            {sitsCourt && (
              <div className="mt-10">
                <CapacityWeek dates={weekDates} today={today} />
              </div>
            )}

            <div className="mt-12 grid gap-12 lg:grid-cols-12 lg:gap-10">
              <div className="space-y-12 lg:col-span-7">
                <SuggestionList insights={insights} isPending={boardQuery.isPending} />
                <AppearanceTimeline events={events} today={today} />
              </div>
              <aside className="space-y-12 lg:col-span-5 lg:border-l lg:border-border lg:pl-8">
                <Sparkline points={spark} />
                <StageLedger counts={workload.byStage} />
              </aside>
            </div>
          </>
        )}
      </DashboardFolio>
    </BrowsePage>
  );
}
