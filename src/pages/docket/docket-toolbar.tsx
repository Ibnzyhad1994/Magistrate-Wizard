import { Link } from "react-router-dom";
import { Plus, Gauge, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HintTooltip } from "@/components/ui/tooltip";
import { ROUTES } from "@/routes/paths";

export function DocketToolbar({
  noCourts,
  onOpenCapacity,
  onNewMatter,
}: {
  noCourts: boolean;
  onOpenCapacity: () => void;
  onNewMatter: () => void;
}) {
  const handleOpenCapacity = () => onOpenCapacity();
  const handleNewMatter = () => onNewMatter();

  return (
    <div className="sticky top-[calc(68px+env(safe-area-inset-top))] z-40 -mx-1 mb-4 bg-[#141414] px-1 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" className="min-h-11 lg:min-h-9" asChild>
          <Link to={ROUTES.docketBin}>
            <Trash2 className="h-4 w-4" />
            Bin
          </Link>
        </Button>
        <Button
          variant="outline"
          className="min-h-11 lg:min-h-9"
          onClick={handleOpenCapacity}
        >
          <Gauge className="h-4 w-4" />
          Docket Capacity
        </Button>
        {noCourts ? (
          <HintTooltip label="You have no current Court assignment.">
            <span className="inline-flex">
              <Button
                variant="play"
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
            variant="play"
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
