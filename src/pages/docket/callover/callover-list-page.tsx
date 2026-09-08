import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Gavel, Landmark, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { DateOnlyInput } from "@/components/common/date-only-input";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BrowseHeader, BrowsePage } from "@/components/browse";
import { useMyCurrentCourts } from "@/hooks/docket/use-lookups";
import { useCallovers, useCreateCallover } from "@/hooks/docket/use-callovers";
import {
  CALLOVER_STATUS_LABELS,
  calloverProgress,
  defaultCalloverTitle,
  isCalloverStatus,
} from "@/lib/callover";
import { ROUTES } from "@/routes/paths";
import { formatDate, getLocalDateOnly } from "@/lib/utils";

/**
 * Callover sittings. A callover is a record of a sitting, so this list is
 * history as much as it is a worklist — completed sittings stay visible
 * and reopenable rather than disappearing once the day is done.
 */
export default function CalloverListPage() {
  const navigate = useNavigate();
  const { data: myCourts, isPending: courtsPending } = useMyCurrentCourts();
  const [courtFilter, setCourtFilter] = useState<string | null>(null);
  const { data, isPending, isFetching, isError, error, refetch } = useCallovers(courtFilter);
  const createCallover = useCreateCallover();

  const [createOpen, setCreateOpen] = useState(false);
  const [newDate, setNewDate] = useState(getLocalDateOnly());
  const [newCourtId, setNewCourtId] = useState("");

  const noCourts = !courtsPending && (myCourts?.length ?? 0) === 0;
  // With exactly one court there is no choice to make — pre-select it so
  // the dialog is a date and a button.
  const effectiveNewCourtId =
    newCourtId || (myCourts?.length === 1 ? (myCourts[0]?.court_id ?? "") : "");

  async function handleCreate() {
    if (!effectiveNewCourtId || !newDate) return;
    try {
      const created = await createCallover.mutateAsync({
        court_id: effectiveNewCourtId,
        callover_date: newDate,
        title: defaultCalloverTitle(newDate),
      });
      setCreateOpen(false);
      setNewCourtId("");
      navigate(ROUTES.callover(created.id));
    } catch {
      // Surfaced by the hook's own onError toast.
    }
  }

  return (
    <BrowsePage>
      <BrowseHeader
        title="Callovers"
        description="Run a list of matters in one sitting: record an outcome and a next date for each without opening every file. Matters that pre-date this docket can be entered here at their true stage."
        action={
          <Button variant="play" onClick={() => setCreateOpen(true)} disabled={noCourts}>
            <Plus className="h-4 w-4" />
            New callover
          </Button>
        }
      />

      {noCourts && (
        <p className="mb-6 text-sm text-muted-foreground">
          You have no current Court seating, so there is no docket to call over.
        </p>
      )}

      {(myCourts?.length ?? 0) > 1 && (
        <div className="mb-6 flex items-center gap-2">
          <Landmark className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Select
            className="max-w-xs"
            aria-label="Filter callovers by court"
            value={courtFilter ?? ""}
            onChange={(e) => setCourtFilter(e.target.value || null)}
          >
            <option value="">All my courts</option>
            {myCourts?.map((c) => (
              <option key={c.court_id} value={c.court_id}>
                {c.court_name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full rounded-sm" />
          <Skeleton className="h-20 w-full rounded-sm" />
        </div>
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={Gavel}
          title="No callovers yet"
          description="Create one for a sitting date and fill it from that day's list."
          action={
            !noCourts && (
              <Button variant="play" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                New callover
              </Button>
            )
          }
        />
      ) : (
        <div
          className={`flex flex-col gap-3 transition-opacity duration-150 ${isFetching ? "opacity-60" : ""}`}
          aria-busy={isFetching}
        >
          {data.map((co) => {
            const items = co.docket_callover_items ?? [];
            const progress = calloverProgress(
              items.map((i) => ({
                id: i.id,
                sort_order: 0,
                called_at: i.called_at,
                outcome: null,
                next_date: null,
              })),
            );
            const status = isCalloverStatus(co.status) ? co.status : "draft";
            return (
              <button
                key={co.id}
                type="button"
                onClick={() => navigate(ROUTES.callover(co.id))}
                className="flex flex-col gap-1 rounded-sm border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition-colors hover:bg-white/[0.06]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {co.title || defaultCalloverTitle(co.callover_date)}
                  </span>
                  <Badge variant={status === "completed" ? "outline" : "default"}>
                    {CALLOVER_STATUS_LABELS[status]}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDate(co.callover_date)}
                  {co.courts?.name ? ` · ${co.courts.name}` : ""}
                  {progress.total > 0
                    ? ` · ${progress.called} of ${progress.total} called`
                    : " · no matters yet"}
                </p>
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New callover</DialogTitle>
            <DialogDescription>
              Pick the sitting date. You can fill the list from that day&apos;s
              matters once it is created.
            </DialogDescription>
          </DialogHeader>

          {(myCourts?.length ?? 0) > 1 && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">Court</label>
              <Select
                value={effectiveNewCourtId}
                onChange={(e) => setNewCourtId(e.target.value)}
                aria-label="Court"
              >
                <option value="">Select a court…</option>
                {myCourts?.map((c) => (
                  <option key={c.court_id} value={c.court_id}>
                    {c.court_name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Sitting date</label>
            <DateOnlyInput value={newDate} onChange={setNewDate} aria-label="Sitting date" />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={createCallover.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleCreate()}
              disabled={createCallover.isPending || !effectiveNewCourtId || !newDate}
            >
              {createCallover.isPending && <LoadingSpinner className="text-current" size={16} />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BrowsePage>
  );
}
