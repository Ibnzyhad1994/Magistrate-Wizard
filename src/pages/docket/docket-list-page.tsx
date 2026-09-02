import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Plus, Gavel, Gauge, Landmark } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { BrowsePage, BrowseHeader, TitleCard, TitleCardSkeletonGallery } from "@/components/browse";
import {
  useDocketMatterBoard,
  usePatchDocketProcedure,
} from "@/hooks/docket/use-docket-matters";
import { useMyCurrentCourts } from "@/hooks/docket/use-lookups";
import { CreateDocketMatterDialog } from "@/pages/docket/create-docket-matter-dialog";
import { DocketEventDialog } from "@/pages/docket/event-dialog";
import { DocketStageFilters } from "@/pages/docket/docket-stage-filters";
import { DocketStageSheet, type LogAppearanceRequest } from "@/pages/docket/docket-stage-sheet";
import { DocketCapacitySettingsDialog } from "@/pages/docket/docket-capacity-settings-dialog";
import { DocketCapacityStrip } from "@/pages/docket/docket-capacity-strip";
import { DailyProgressReportButton } from "@/pages/docket/daily-progress-report-button";
import { useSignedUrls } from "@/hooks/use-signed-urls";
import { ROUTES } from "@/routes/paths";
import { formatDate, toTitleCase } from "@/lib/utils";
import { EMPTY_PROCEDURE_FILTERS, hasActiveProcedureFilters, type ProcedureFilters } from "@/lib/docket-procedure";
import { useUiStore } from "@/store/ui-store";
import { Skeleton } from "@/components/ui/skeleton";
import { ALL_COURTS_PARAM, docketScopeTitle, resolveDocketScope } from "@/lib/docket-scope";


function docketCover(matter: {
  case_number: string;
  matter_title: string;
  status?: string | null;
  charge_or_issue?: string | null;
  headline?: string | null;
  updated_at?: string | null;
  cover_image_path?: string | null;
  court_name?: string | null;
}) {
  const charge =
    matter.charge_or_issue ??
    (matter.headline ? matter.headline.replace(/<\/?b>/gi, "") : undefined);
  return {
    eyebrow: matter.case_number,
    title: matter.matter_title,
    subtitle: charge || undefined,
    badge: matter.status ? toTitleCase(matter.status) : undefined,
    meta: [matter.court_name, matter.updated_at ? formatDate(matter.updated_at) : null].filter(
      (v): v is string => Boolean(v),
    ),
  };
}

export default function DocketListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: myCourts, isPending: courtsPending } = useMyCurrentCourts();
  const lastDocketScope = useUiStore((s) => s.lastDocketScope);
  const setLastDocketScope = useUiStore((s) => s.setLastDocketScope);

  // --- Two-level Docket scope: All My Courts (courtId === null) or one
  // exact court. The URL `?court=` param is the source of truth (so a
  // refresh, a bookmark, and back/forward all behave correctly); a
  // remembered same-device scope only ever supplies a DEFAULT when the
  // param is absent, and is always re-validated against the signed-in
  // user's CURRENT authorized courts before ever being applied — a
  // revoked or unauthorized court is never silently restored. ---
  const requestedCourtId = searchParams.get("court");
  const myCourtIds = myCourts?.map((c) => c.court_id);
  const scope = resolveDocketScope({
    requestedCourtId,
    myCourtIds,
    rememberedCourtId: lastDocketScope,
  });

  useEffect(() => {
    if (scope.status !== "redirect") return;
    const next = new URLSearchParams(searchParams);
    next.set("court", scope.courtId ?? ALL_COURTS_PARAM);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.status, scope.status === "redirect" ? scope.courtId : undefined]);

  useEffect(() => {
    if (scope.status === "resolved") setLastDocketScope(scope.courtId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.status === "resolved" ? scope.courtId : undefined]);

  const courtId = scope.status === "resolved" ? scope.courtId : null;
  const selectedCourt = courtId ? myCourts?.find((c) => c.court_id === courtId) : undefined;
  const scopeReady = scope.status === "resolved";

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ProcedureFilters>(EMPTY_PROCEDURE_FILTERS);
  const [createOpen, setCreateOpen] = useState(false);
  const [capacityOpen, setCapacityOpen] = useState(false);
  const [logAppearance, setLogAppearance] = useState<LogAppearanceRequest | null>(null);
  // The calendar strip can still filter the table to one date. Opening
  // Docket defaults to All Matters — most files have no appearance today,
  // so defaulting to today made the list look empty until the user clicked
  // a matter from Home (which is unfiltered) or pressed All Matters.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Switching Docket scope must never leave a stale search/filter/date
  // combination — or its results — visible from the previously-selected
  // court. React Query already gives each courtId its own cache entry
  // (queryKey includes it), so there's no cross-court data leakage; this
  // just resets the CONTROLS themselves back to a clean slate on switch.
  const previousCourtId = useRef(courtId);
  useEffect(() => {
    if (previousCourtId.current === courtId) return;
    previousCourtId.current = courtId;
    setSearch("");
    setFilters(EMPTY_PROCEDURE_FILTERS);
    setSelectedDate(null);
  }, [courtId]);

  const docketBrowseView = useUiStore((s) => s.docketBrowseView);
  const setDocketBrowseView = useUiStore((s) => s.setDocketBrowseView);
  const { data, isPending, isError, error, refetch } = useDocketMatterBoard(
    search,
    filters,
    selectedDate,
    courtId,
    { enabled: scopeReady },
  );
  const patch = usePatchDocketProcedure();
  const { data: coverUrls } = useSignedUrls(
    (data ?? []).map((m) => m.cover_image_path),
  );
  const noCourts = !courtsPending && (myCourts?.length ?? 0) === 0;
  const filtersOn = hasActiveProcedureFilters(filters);
  const emptyBecauseFilters = !isPending && !isError && (data?.length ?? 0) === 0 && (search || filtersOn);
  const emptyBecauseDate = !isPending && !isError && (data?.length ?? 0) === 0 && !!selectedDate && !search && !filtersOn;

  return (
    <BrowsePage>
      <BrowseHeader
        title={docketScopeTitle(selectedCourt?.court_name ?? null)}
        description="List is the working sheet. Swipe for stages on a phone. Tiles stay for cover-photo browse. Events still hold the dates."
        showViewSelect
        viewSelectValue={docketBrowseView}
        onViewSelectChange={setDocketBrowseView}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setCapacityOpen(true)}>
              <Gauge className="h-4 w-4" />
              Docket Capacity
            </Button>
            <Button
              variant="play"
              onClick={() => setCreateOpen(true)}
              disabled={noCourts}
              title={noCourts ? "You have no current Court assignment." : undefined}
            >
              <Plus className="h-4 w-4" />
              New matter
            </Button>
          </div>
        }
      />

      {noCourts ? (
        <p className="mb-6 text-sm text-muted-foreground">
          You have no current Court assignment, so you can&apos;t create a new
          matter. You can still view and act on matters retained or shared
          with you below. Contact an administrator for a Court assignment.
        </p>
      ) : (
        scopeReady && (myCourts?.length ?? 0) > 1 && (
          <div className="mb-6 flex items-center gap-2">
            <Landmark className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Select
              className="max-w-xs"
              aria-label="Docket scope: choose a court"
              value={courtId ?? ALL_COURTS_PARAM}
              onChange={(e) => {
                const next = new URLSearchParams(searchParams);
                next.set("court", e.target.value);
                setSearchParams(next);
              }}
            >
              <option value={ALL_COURTS_PARAM}>All My Courts</option>
              {myCourts?.map((c) => (
                <option key={c.court_id} value={c.court_id}>
                  {c.court_name}
                </option>
              ))}
            </Select>
          </div>
        )
      )}

      <DocketCapacityStrip
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        onEditLimits={() => setCapacityOpen(true)}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">
          {selectedDate
            ? `Matters scheduled for ${formatDate(selectedDate)}`
            : "All matters"}
        </h2>
        {selectedDate && (
          <div className="flex flex-wrap items-center gap-2">
            <DailyProgressReportButton date={selectedDate} courtId={courtId} />
            <Button size="sm" variant="ghost" onClick={() => setSelectedDate(null)}>
              All Matters
            </Button>
          </div>
        )}
      </div>

      <div className="relative mb-4 w-full max-w-lg">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search case number, title, or issue…"
          className="pl-8"
          aria-label="Search docket matters"
        />
      </div>

      <DocketStageFilters filters={filters} onChange={setFilters} />

      {isPending ? (
        docketBrowseView === "list" ? (
          <Skeleton className="h-64 w-full rounded-sm" />
        ) : (
          <TitleCardSkeletonGallery />
        )
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} className="border-0" />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={Gavel}
          title={
            emptyBecauseFilters
              ? "No matters at this stage"
              : emptyBecauseDate
                ? `No matters scheduled for ${formatDate(selectedDate as string)}.`
                : "No docket matters yet"
          }
          description={
            emptyBecauseFilters
              ? "Nothing matches these filters. Clear them to see the rest of the list."
              : emptyBecauseDate
                ? "Set a matter's Next Date to this date to see it here, or switch to All Matters."
                : "Matters you create, are assigned, or are shared on will appear here."
          }
          action={
            emptyBecauseFilters ? (
              <Button
                variant="play"
                size="sm"
                onClick={() => setFilters(EMPTY_PROCEDURE_FILTERS)}
              >
                Clear filters
              </Button>
            ) : emptyBecauseDate ? (
              <Button variant="play" size="sm" onClick={() => setSelectedDate(null)}>
                All Matters
              </Button>
            ) : (
              !search &&
              !noCourts && (
                <Button variant="play" size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Create the first matter
                </Button>
              )
            )
          }
        />
      ) : docketBrowseView === "list" ? (
        <DocketStageSheet
          rows={data}
          showCourt={courtId === null}
          onPatch={(id, values, expectedUpdatedAt) => patch.mutateAsync({ id, values, expectedUpdatedAt })}
          onLogAppearance={setLogAppearance}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {data.map((matter) => (
            <TitleCard
              key={matter.id}
              layout="tiles"
              tone="docket"
              href={ROUTES.docketMatter(matter.id)}
              imageUrl={
                matter.cover_image_path ? coverUrls?.[matter.cover_image_path] : undefined
              }
              {...docketCover(matter)}
            />
          ))}
        </div>
      )}

      <CreateDocketMatterDialog open={createOpen} onOpenChange={setCreateOpen} defaultCourtId={courtId} />
      <DocketCapacitySettingsDialog open={capacityOpen} onOpenChange={setCapacityOpen} />
      {logAppearance && (
        <DocketEventDialog
          matterId={logAppearance.matterId}
          event={null}
          defaults={{
            event_type: logAppearance.event_type,
            stage_at_event: logAppearance.stage_at_event,
            notes: logAppearance.notes,
          }}
          onClose={() => setLogAppearance(null)}
        />
      )}
    </BrowsePage>
  );
}
