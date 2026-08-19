import { useState } from "react";
import { Search, Plus, Gavel } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { useSignedUrls } from "@/hooks/use-signed-urls";
import { ROUTES } from "@/routes/paths";
import { formatDate, toTitleCase } from "@/lib/utils";
import { EMPTY_PROCEDURE_FILTERS, hasActiveProcedureFilters, type ProcedureFilters } from "@/lib/docket-procedure";
import { useUiStore } from "@/store/ui-store";
import { Skeleton } from "@/components/ui/skeleton";

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
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ProcedureFilters>(EMPTY_PROCEDURE_FILTERS);
  const [createOpen, setCreateOpen] = useState(false);
  const [logAppearance, setLogAppearance] = useState<LogAppearanceRequest | null>(null);
  const docketBrowseView = useUiStore((s) => s.docketBrowseView);
  const setDocketBrowseView = useUiStore((s) => s.setDocketBrowseView);
  const { data, isPending, isError, error, refetch } = useDocketMatterBoard(search, filters);
  const patch = usePatchDocketProcedure();
  const { data: coverUrls } = useSignedUrls(
    (data ?? []).map((m) => m.cover_image_path),
  );
  const { data: myCourts, isPending: courtsPending } = useMyCurrentCourts();
  const noCourts = !courtsPending && (myCourts?.length ?? 0) === 0;
  const filtersOn = hasActiveProcedureFilters(filters);
  const emptyBecauseFilters = !isPending && !isError && (data?.length ?? 0) === 0 && (search || filtersOn);

  return (
    <BrowsePage>
      <BrowseHeader
        title="Docket"
        description="List view is the working sheet — stage columns you can edit. Tiles stay for cover-photo browse. Events still hold the dates."
        showViewSelect
        viewSelectValue={docketBrowseView}
        onViewSelectChange={setDocketBrowseView}
        action={
          <Button
            variant="play"
            onClick={() => setCreateOpen(true)}
            disabled={noCourts}
            title={noCourts ? "You have no current Court assignment." : undefined}
          >
            <Plus className="h-4 w-4" />
            New matter
          </Button>
        }
      />

      {noCourts && (
        <p className="mb-6 text-sm text-muted-foreground">
          You have no current Court assignment, so you can&apos;t create a new
          matter. You can still view and act on matters retained or shared
          with you below. Contact an administrator for a Court assignment.
        </p>
      )}

      <div className="relative mb-4 max-w-sm">
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
          title={emptyBecauseFilters ? "No matters at this stage" : "No docket matters yet"}
          description={
            emptyBecauseFilters
              ? "Nothing matches these filters. Clear them to see the rest of the list."
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
          onPatch={(id, values) => patch.mutateAsync({ id, values })}
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

      <CreateDocketMatterDialog open={createOpen} onOpenChange={setCreateOpen} />
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
