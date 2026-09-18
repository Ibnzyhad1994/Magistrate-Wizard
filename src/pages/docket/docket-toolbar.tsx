import { Link } from "react-router-dom";
import { Plus, Gauge, Trash2, CloudDownload } from "lucide-react";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { formatTimeOnly } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { HintTooltip } from "@/components/ui/tooltip";
import { ROUTES } from "@/routes/paths";

export function DocketToolbar({
  noCourts,
  onOpenCapacity,
  onNewMatter,
  offlineReadyAt,
  onTakeOffline,
  takingOffline = false,
}: {
  noCourts: boolean;
  onOpenCapacity: () => void;
  onNewMatter: () => void;
  /** When this exact list was last saved for offline use, if ever. */
  offlineReadyAt?: string | null;
  onTakeOffline?: () => void;
  takingOffline?: boolean;
}) {
  const handleOpenCapacity = () => onOpenCapacity();
  const handleNewMatter = () => onNewMatter();

  return (
    <div className="browse-bleed sticky top-[calc(68px+env(safe-area-inset-top))] z-40 mb-4 bg-background/85 py-2 backdrop-blur-md hc:bg-background">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" className="min-h-11 lg:min-h-9" asChild>
          <Link to={ROUTES.docketBin}>
            <Trash2 className="h-4 w-4" />
            Bin
          </Link>
        </Button>
        <Button variant="secondary" className="min-h-11 lg:min-h-9" onClick={handleOpenCapacity}>
          <Gauge className="h-4 w-4" />
          Docket Capacity
        </Button>
        {onTakeOffline && (
          // Deliberately explicit rather than automatic: on a metered
          // Guyanese mobile connection, downloading a day's list is the
          // magistrate's decision to make, not a background surprise.
          <HintTooltip
            label={
              offlineReadyAt
                ? `Saved for offline use at ${formatTimeOnly(offlineReadyAt)}. Save again to refresh it.`
                : "Save this list so you can work it without a signal."
            }
          >
            <Button
              variant="secondary"
              className="min-h-11 lg:min-h-9"
              onClick={onTakeOffline}
              disabled={takingOffline}
            >
              {takingOffline ? (
                <LoadingSpinner className="text-current" size={14} />
              ) : offlineReadyAt ? (
                <CloudDownload className="h-4 w-4" />
              ) : (
                <CloudDownload className="h-4 w-4" />
              )}
              {offlineReadyAt ? "Offline ready" : "Take offline"}
            </Button>
          </HintTooltip>
        )}
        {noCourts ? (
          <HintTooltip label="You have no current Court assignment.">
            <span className="inline-flex">
              <Button
                disabled
                className="min-h-11 lg:min-h-9"
                data-tour="docket-new-matter"
                aria-label="New matter"
              >
                <Plus className="h-4 w-4" />
                New matter
              </Button>
            </span>
          </HintTooltip>
        ) : (
          <Button
            className="min-h-11 lg:min-h-9"
            onClick={handleNewMatter}
            data-tour="docket-new-matter"
            aria-label="New matter"
          >
            <Plus className="h-4 w-4" />
            New matter
          </Button>
        )}
      </div>
    </div>
  );
}
