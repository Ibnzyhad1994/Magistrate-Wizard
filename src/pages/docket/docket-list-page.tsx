import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Search, Plus, ClipboardList, Landmark } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { BrowsePage, BrowseHeader, TitleCard, TitleCardSkeletonGallery } from "@/components/browse";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useAuth } from "@/hooks/use-auth";
import {
  useDocketMatterBoard,
  usePatchDocketProcedure,
  useTakeBoardOffline,
} from "@/hooks/docket/use-docket-matters";
import { useMyCurrentCourts } from "@/hooks/docket/use-lookups";
import { CreateDocketMatterDialog } from "@/pages/docket/create-docket-matter-dialog";
import { DocketEventDialog } from "@/pages/docket/event-dialog";
import { DocketStageFilters } from "@/pages/docket/docket-stage-filters";
import { DocketStageSheet, type LogAppearanceRequest } from "@/pages/docket/docket-stage-sheet";
import { DocketMatterCard, DocketMatterCardSkeleton } from "@/pages/docket/docket-matter-card";
import { DocketToolbar } from "@/pages/docket/docket-toolbar";
import { DocketCapacitySettingsDialog } from "@/pages/docket/docket-capacity-settings-dialog";
import { DocketCapacityStrip } from "@/pages/docket/docket-capacity-strip";
import { DailyProgressReportButton } from "@/pages/docket/daily-progress-report-button";
import { useSignedUrls } from "@/hooks/use-signed-urls";
import { ROUTES } from "@/routes/paths";
import {
  canBulkAdjourn,
  pruneSelection,
  selectAll,
  selectableIds,
  toggleSelection,
} from "@/lib/docket-selection";
import { DocketBulkAdjournDialog } from "@/pages/docket/docket-bulk-adjourn-dialog";
import { DocketCloseoutPanel } from "@/pages/docket/docket-closeout-panel";
import { formatDate, getLocalDateOnly, toTitleCase } from "@/lib/utils";
import {
  EMPTY_PROCEDURE_FILTERS,
  hasActiveProcedureFilters,
  type ProcedureFilters,
} from "@/lib/docket-procedure";
import {
  boardParamsFromSearchParams,
  boardParamsToSearchParams,
  clearBoardParams,
} from "@/lib/docket-board-params";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { shouldShowDocketTourExample } from "@/lib/docket-tour-example";
import { useUiStore } from "@/store/ui-store";
import { isBrowseView } from "@/lib/browse-prefs";
import { Skeleton } from "@/components/ui/skeleton";
import { ALL_COURTS_PARAM, docketScopeTitle, resolveDocketScope } from "@/lib/docket-scope";
import { useTour } from "@/components/tour/use-tour";
import { DocketTourExample } from "@/pages/docket/docket-tour-example";

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
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
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

  const [createOpen, setCreateOpen] = useState(false);
  const [capacityOpen, setCapacityOpen] = useState(false);
  const [logAppearance, setLogAppearance] = useState<LogAppearanceRequest | null>(null);

  // --- Board controls live in the URL, alongside ?court= ---
  // Search text, stage filters, and the selected date are all derived from
  // the URL rather than component state, so opening a matter and pressing
  // Back returns to the exact view that was left, a refresh survives, and
  // a filtered day-list can be handed to a clerk as a link. Parsing
  // re-validates every value (docket-board-params.ts), so a hand-edited or
  // stale URL degrades to a narrower valid view rather than reaching the
  // RPC with a filter that doesn't exist.
  //
  // The calendar strip can still filter the table to one date. Opening
  // Docket defaults to All Matters — most files have no appearance today,
  // so defaulting to today made the list look empty until the user clicked
  // a matter from Home (which is unfiltered) or pressed All Matters.
  const boardParams = boardParamsFromSearchParams(searchParams);
  const { filters, exactDate: selectedDate } = boardParams;

  // Every board write is `replace`, never `push`: refining a view is not a
  // navigation, and pushing would make Back walk keystroke-by-keystroke
  // back through the filters instead of returning to wherever the user
  // actually came from. The functional updater reads the freshest params,
  // so a board write can never clobber the scope redirect above.
  const commitBoardParams = useCallback(
    (next: Partial<typeof boardParams>) => {
      setSearchParams(
        (prev) =>
          boardParamsToSearchParams({ ...boardParamsFromSearchParams(prev), ...next }, prev),
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setFilters = useCallback(
    (value: ProcedureFilters) => commitBoardParams({ filters: value }),
    [commitBoardParams],
  );
  const setSelectedDate = useCallback(
    (value: string | null) => {
      setSearchParams(
        (prev) => {
          const next = boardParamsToSearchParams(
            {
              ...boardParamsFromSearchParams(prev),
              exactDate: value,
              filters: { ...boardParamsFromSearchParams(prev).filters, nextDate: [] },
            },
            prev,
          );
          // Tiles count every court you sit. Clicking a day therefore
          // switches the board to All My Courts so the list can show that
          // file. Clearing the date (All Matters) leaves the heading court.
          if (value) next.set("court", ALL_COURTS_PARAM);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Search is the one control that keeps local state: the input must stay
  // instantly responsive while typing, so only the settled value reaches
  // the URL and the query. Without this, every keystroke was its own
  // React Query key — one full-text RPC per character, each one blanking
  // the whole table to a skeleton because a brand-new key has no cached
  // data to show.
  const [search, setSearch] = useState(boardParams.query);
  const debouncedSearch = useDebouncedValue(search);

  useEffect(() => {
    // Only commit once the debounce has actually caught up with the live
    // input. Without this guard, clearing the input (notably the court
    // switch below, which resets it) would see the still-stale debounced
    // value and write the OLD search term straight back into the URL for
    // one cycle before settling — the search would visibly come back.
    if (debouncedSearch !== search) return;
    if (debouncedSearch.trim() === boardParams.query) return;
    commitBoardParams({ query: debouncedSearch });
  }, [debouncedSearch, search, boardParams.query, commitBoardParams]);

  // Drops both refinements at once, and resets the input immediately
  // rather than waiting out the debounce. Leaves the selected date alone —
  // that has its own "All Matters" control.
  const clearRefinements = useCallback(() => {
    setSearch("");
    commitBoardParams({ query: "", filters: EMPTY_PROCEDURE_FILTERS });
  }, [commitBoardParams]);

  const isDesktop = useIsDesktop();
  const { isActive: tourActive } = useTour();
  const docketBrowseView = useUiStore((s) => s.docketBrowseView);
  const setDocketBrowseView = useUiStore((s) => s.setDocketBrowseView);
  const urlView = searchParams.get("view");
  const effectiveBrowseView = isBrowseView(urlView) ? urlView : docketBrowseView;
  // Queries the settled, URL-backed query text — never the raw input — so
  // the query key always matches the URL the user could share, and the
  // empty-state wording below always describes the search that actually ran.
  const { data, isPending, isFetching, isError, error, refetch } = useDocketMatterBoard(
    boardParams.query,
    filters,
    selectedDate,
    courtId,
    { enabled: scopeReady },
  );
  const patch = usePatchDocketProcedure();
  const navigate = useNavigate();
  const offlineBoard = useTakeBoardOffline(selectedDate, courtId);
  // Bulk adjourn only for a specific day at or after today: the RPC
  // supersedes the earliest appearance on or after today regardless of
  // which day's list it was invoked from, so a past-date list would
  // cancel a FUTURE appearance. See src/lib/docket-selection.ts.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const bulkAllowed = canBulkAdjourn(selectedDate, getLocalDateOnly());
  const selectableRows = useMemo(
    () =>
      (data ?? []).map((row) => ({
        id: row.id,
        can_edit: row.can_edit,
        category_id: row.category_id,
      })),
    [data],
  );
  // The list re-queries on every change of date, court, search or filter,
  // so anything no longer on screen leaves the selection with it.
  useEffect(() => {
    setSelected((current) => pruneSelection(current, selectableRows));
  }, [selectableRows]);
  useEffect(() => {
    if (!bulkAllowed) setSelected(new Set());
  }, [bulkAllowed]);
  const { data: coverUrls } = useSignedUrls((data ?? []).map((m) => m.cover_image_path));
  const noCourts = !courtsPending && (myCourts?.length ?? 0) === 0;

  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    if (noCourts) return;
    setCreateOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    setSearchParams(next, { replace: true });
  }, [noCourts, searchParams, setSearchParams]);
  const filtersOn = hasActiveProcedureFilters(filters);
  const searchOn = boardParams.query.length > 0;
  const emptyBecauseFilters =
    !isPending && !isError && (data?.length ?? 0) === 0 && (searchOn || filtersOn);
  const emptyBecauseDate =
    !isPending &&
    !isError &&
    (data?.length ?? 0) === 0 &&
    !!selectedDate &&
    !searchOn &&
    !filtersOn;
  const emptyBecauseDateAndFilters =
    !isPending &&
    !isError &&
    (data?.length ?? 0) === 0 &&
    !!selectedDate &&
    (searchOn || filtersOn);
  const courtScopeLabel = selectedCourt?.court_name ?? "All My Courts";
  const showTourExample = shouldShowDocketTourExample({
    tourActive,
    matterCount: data?.length ?? 0,
    emptyBecauseFilters,
    emptyBecauseDate,
  });

  return (
    <BrowsePage>
      <BrowseHeader
        title={docketScopeTitle(selectedCourt?.court_name ?? null)}
        tone="docket"
        description="Your court's matters, and where each one stands."
        details={
          <>
            <p>
              List is the working sheet: record stages and next dates without opening each file.
            </p>
            <p>Tiles show cover photos. On a phone, each file shows as a card with its stages.</p>
          </>
        }
        showViewSelect
        viewSelectValue={effectiveBrowseView}
        onViewSelectChange={(view) => {
          setDocketBrowseView(view);
          const next = new URLSearchParams(searchParams);
          if (view === "list") next.set("view", "list");
          else next.delete("view");
          setSearchParams(next, { replace: true });
        }}
      />

      <DocketToolbar
        noCourts={noCourts}
        onOpenCapacity={() => setCapacityOpen(true)}
        onNewMatter={() => setCreateOpen(true)}
        offlineReadyAt={offlineBoard.savedAt}
        onTakeOffline={offlineBoard.takeOffline}
        takingOffline={offlineBoard.isSaving}
      />

      {noCourts ? (
        // Only an administrator actually reaches this: the Docket route
        // requires an approved seating for magistrates and clerks alike
        // (requireApprovedMagistrateCourt / requireApprovedClerkCourt,
        // router.tsx), so both are redirected to their own request page
        // before this page renders. Telling that audience to "contact an
        // administrator" was telling them to contact themselves — point
        // them at the self-seating card in Settings instead.
        <p className="mb-6 text-sm text-muted-foreground">
          You don&apos;t have a court seat, so you can&apos;t add matters. You can still work on
          files retained or shared with you.{" "}
          {isAdmin ? (
            <>
              Seat yourself at a court under{" "}
              <Link to={ROUTES.settings} className="underline hover:text-foreground">
                Settings
              </Link>
              , or manage the full roster under{" "}
              <Link to={ROUTES.adminCourtAssignments} className="underline hover:text-foreground">
                Court Assignments
              </Link>
              .
            </>
          ) : (
            <>
              Request a court under{" "}
              <Link to={ROUTES.courtAssignments} className="underline hover:text-foreground">
                Court Assignments
              </Link>
              .
            </>
          )}
        </p>
      ) : (
        scopeReady &&
        (myCourts?.length ?? 0) > 1 && (
          <div className="mb-6 flex items-center gap-2">
            <Landmark className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Select
              className="max-w-xs"
              aria-label="Docket scope: choose a court"
              value={courtId ?? ALL_COURTS_PARAM}
              onChange={(e) => {
                // Dropdown switches wipe search/filters/date. Day-click
                // switching to All My Courts must not go through this path,
                // or the date just written would vanish.
                setSearch("");
                setSearchParams(
                  (prev) => {
                    const next = clearBoardParams(prev);
                    next.set("court", e.target.value);
                    return next;
                  },
                  { replace: true },
                );
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
        courtLabel={courtScopeLabel}
        onEditLimits={() => setCapacityOpen(true)}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">
          {selectedDate
            ? `Appearances on ${formatDate(selectedDate)} at ${courtScopeLabel}`
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

      {/* Only for a specific day, and only once the rows are in: this is
          a reconciliation of what was listed, not a general view. */}
      {selectedDate && !isPending && !isError && (data?.length ?? 0) > 0 && (
        <DocketCloseoutPanel
          rows={data ?? []}
          closingDate={selectedDate}
          onOpenMatter={(id) => navigate(ROUTES.docketMatter(id))}
        />
      )}

      <DocketStageFilters filters={filters} onChange={setFilters} />

      {bulkAllowed && selected.size > 0 && (
        <div className="browse-bleed sticky bottom-0 z-30 mb-3 flex flex-wrap items-center justify-between gap-3 border-t border-hairline bg-background/90 py-3 backdrop-blur-md hc:border-border hc:bg-background">
          <p className="text-sm text-foreground">
            {selected.size === 1 ? "1 file selected" : `${selected.size} files selected`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button size="sm" onClick={() => setBulkOpen(true)}>
              Adjourn to…
            </Button>
          </div>
        </div>
      )}

      {isPending ? (
        effectiveBrowseView === "list" ? (
          isDesktop ? (
            <Skeleton className="h-64 w-full rounded-sm" />
          ) : (
            <div className="flex flex-col gap-3">
              <DocketMatterCardSkeleton />
              <DocketMatterCardSkeleton />
              <DocketMatterCardSkeleton />
            </div>
          )
        ) : (
          <TitleCardSkeletonGallery />
        )
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} className="border-0" />
      ) : !data || data.length === 0 ? (
        <div className="space-y-4">
          {/* During the walkthrough the example sheet IS the empty state:
              it carries the docket-board tour target and its own caption
              says there is nothing on the docket yet, so the generic
              "No docket matters yet" panel above it only doubled up. */}
          {showTourExample ? null : (
            <div data-tour="docket-board">
              <EmptyState
                tone="docket"
                icon={ClipboardList}
                title={
                  emptyBecauseDateAndFilters
                    ? `No appearances on ${formatDate(selectedDate as string)} match these filters`
                    : emptyBecauseFilters
                      ? "No matters at this stage"
                      : emptyBecauseDate
                        ? `No appearances on ${formatDate(selectedDate as string)} at ${courtScopeLabel}`
                        : "No docket matters yet"
                }
                description={
                  emptyBecauseDateAndFilters
                    ? `Nothing on this day matches your search or filters. Clear them, or switch to All Matters.`
                    : emptyBecauseFilters
                      ? "Nothing matches these filters. Clear them to see the rest of the list."
                      : emptyBecauseDate
                        ? "Nothing is listed at this court on this day. Switch to All Matters to see everything."
                        : "Matters you create, are assigned, or are shared on will appear here."
                }
                action={
                  emptyBecauseDateAndFilters ? (
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <Button variant="secondary" size="sm" onClick={clearRefinements}>
                        {searchOn && filtersOn
                          ? "Clear search and filters"
                          : searchOn
                            ? "Clear search"
                            : "Clear filters"}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedDate(null)}>
                        All Matters
                      </Button>
                    </div>
                  ) : emptyBecauseFilters ? (
                    // Clears the search text as well as the stage filters:
                    // this branch fires for either, so clearing only the
                    // filters left the button doing visibly nothing when a
                    // search term was the thing narrowing the list.
                    <Button variant="secondary" size="sm" onClick={clearRefinements}>
                      {searchOn && filtersOn
                        ? "Clear search and filters"
                        : searchOn
                          ? "Clear search"
                          : "Clear filters"}
                    </Button>
                  ) : emptyBecauseDate ? (
                    <Button variant="secondary" size="sm" onClick={() => setSelectedDate(null)}>
                      All Matters
                    </Button>
                  ) : (
                    !searchOn &&
                    !noCourts && (
                      <Button size="sm" onClick={() => setCreateOpen(true)}>
                        <Plus className="h-4 w-4" />
                        Create the first matter
                      </Button>
                    )
                  )
                }
              />
            </div>
          )}
          {showTourExample && <DocketTourExample />}
        </div>
      ) : (
        // Refining a view that already has results dims the existing list
        // instead of replacing it with a skeleton — the magistrate keeps
        // their place and can see what is being narrowed. The skeleton
        // above is reserved for a genuinely cold load (including a court
        // switch, where showing another court's matters would be wrong).
        <div
          className={`transition-opacity duration-150 ${isFetching ? "opacity-60" : ""}`}
          aria-busy={isFetching}
        >
          {effectiveBrowseView === "list" ? (
            isDesktop ? (
              <DocketStageSheet
                selection={
                  bulkAllowed
                    ? {
                        selected,
                        onToggle: (id) => setSelected((cur) => toggleSelection(cur, id)),
                        onToggleAll: () =>
                          setSelected((cur) =>
                            cur.size === selectableIds(selectableRows).length
                              ? new Set()
                              : selectAll(selectableRows),
                          ),
                        allSelected:
                          selectableIds(selectableRows).length > 0 &&
                          selected.size === selectableIds(selectableRows).length,
                      }
                    : undefined
                }
                rows={data}
                showCourt={courtId === null}
                onPatch={(id, values, expectedUpdatedAt) =>
                  patch.mutateAsync({ id, values, expectedUpdatedAt })
                }
                onLogAppearance={setLogAppearance}
              />
            ) : (
              <div className="flex flex-col gap-3" data-tour="docket-board">
                {data.map((row, index) => (
                  <DocketMatterCard
                    key={row.id}
                    row={row}
                    showCourt={courtId === null}
                    isTourNextDate={index === 0}
                    isTourOutcome={index === 0}
                    isTourFirstMatter={index === 0}
                    onPatch={(id, values, expectedUpdatedAt) =>
                      patch.mutateAsync({ id, values, expectedUpdatedAt })
                    }
                    onLogAppearance={setLogAppearance}
                  />
                ))}
              </div>
            )
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.map((matter, index) => (
                <TitleCard
                  key={matter.id}
                  layout="tiles"
                  tone="docket"
                  href={ROUTES.docketMatter(matter.id)}
                  dataTour={index === 0 ? "docket-first-matter" : undefined}
                  imageUrl={
                    matter.cover_image_path ? coverUrls?.[matter.cover_image_path] : undefined
                  }
                  {...docketCover(matter)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <CreateDocketMatterDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultCourtId={courtId}
      />
      <DocketCapacitySettingsDialog open={capacityOpen} onOpenChange={setCapacityOpen} />
      {bulkOpen && (
        <DocketBulkAdjournDialog
          rows={selectableRows}
          selected={selected}
          courtId={courtId}
          districtId={selectedCourt?.district_id ?? null}
          onClose={() => setBulkOpen(false)}
          onDone={(remaining) => setSelected(remaining)}
        />
      )}
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
