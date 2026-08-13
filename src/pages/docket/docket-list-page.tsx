import { useState } from "react";
import { Search, Plus, Gavel } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { BrowsePage, BrowseHeader, TitleCard } from "@/components/browse";
import { useDocketMatters } from "@/hooks/docket/use-docket-matters";
import { useMyCurrentCourts } from "@/hooks/docket/use-lookups";
import { CreateDocketMatterDialog } from "@/pages/docket/create-docket-matter-dialog";
import { ROUTES } from "@/routes/paths";
import { formatDate, toTitleCase } from "@/lib/utils";

export default function DocketListPage() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isPending, isError, error, refetch } = useDocketMatters(search);
  const { data: myCourts, isPending: courtsPending } = useMyCurrentCourts();
  const noCourts = !courtsPending && (myCourts?.length ?? 0) === 0;

  return (
    <BrowsePage>
      <BrowseHeader
        title="Docket"
        description="Matters currently assigned to your Court, retained from a prior sitting, or shared with you."
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

      <div className="relative mb-8 max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search case number, title, or issue…"
          className="pl-8"
          aria-label="Search docket matters"
        />
      </div>

      {isPending ? (
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton
              key={i}
              className="aspect-[2/3] w-[42vw] min-w-[9.5rem] max-w-[13.5rem] rounded-sm bg-white/10 sm:w-[28vw] md:w-[18vw] lg:w-[14vw] xl:w-[12vw]"
            />
          ))}
        </div>
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} className="border-0" />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={Gavel}
          title={search ? "No matching matters" : "No docket matters yet"}
          description={
            search
              ? "Try a different case number, title, or issue."
              : "Matters you create, are assigned, or are shared on will appear here."
          }
          action={
            !search &&
            !noCourts && (
              <Button variant="play" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                Create the first matter
              </Button>
            )
          }
        />
      ) : (
        <div className="flex flex-wrap gap-3">
          {data.map((matter) => (
            <TitleCard
              key={matter.id}
              tone="docket"
              title={matter.matter_title}
              eyebrow={matter.case_number}
              badge={matter.status ? toTitleCase(matter.status) : undefined}
              meta={
                "updated_at" in matter && matter.updated_at
                  ? [formatDate(matter.updated_at)]
                  : undefined
              }
              href={ROUTES.docketMatter(matter.id)}
            />
          ))}
        </div>
      )}

      <CreateDocketMatterDialog open={createOpen} onOpenChange={setCreateOpen} />
    </BrowsePage>
  );
}
