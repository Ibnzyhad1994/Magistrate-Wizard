import { useState } from "react";
import { Search, Plus, Gavel } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { BrowsePage, BrowseHeader, TitleCard, TitleCardSkeletonGallery, TitleGallery } from "@/components/browse";
import { useDocketMatters } from "@/hooks/docket/use-docket-matters";
import { useMyCurrentCourts } from "@/hooks/docket/use-lookups";
import { CreateDocketMatterDialog } from "@/pages/docket/create-docket-matter-dialog";
import { useSignedUrls } from "@/hooks/use-signed-urls";
import { ROUTES } from "@/routes/paths";
import { formatDate, toTitleCase } from "@/lib/utils";

function nestedName(value: { name: string } | { name: string }[] | null | undefined) {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0]?.name : value.name;
}

function docketCover(matter: {
  case_number: string;
  matter_title: string;
  status?: string | null;
  charge_or_issue?: string | null;
  headline?: string | null;
  updated_at?: string | null;
  cover_image_path?: string | null;
  courts?: { name: string } | { name: string }[] | null;
}) {
  const charge =
    matter.charge_or_issue ??
    (matter.headline ? matter.headline.replace(/<\/?b>/gi, "") : undefined);
  const court = nestedName(matter.courts);
  return {
    eyebrow: matter.case_number,
    title: matter.matter_title,
    subtitle: charge || undefined,
    badge: matter.status ? toTitleCase(matter.status) : undefined,
    meta: [court, matter.updated_at ? formatDate(matter.updated_at) : null].filter(
      (v): v is string => Boolean(v),
    ),
  };
}

export default function DocketListPage() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isPending, isError, error, refetch } = useDocketMatters(search);
  const { data: coverUrls } = useSignedUrls(
    (data ?? []).map((m) => ("cover_image_path" in m ? m.cover_image_path : null)),
  );
  const { data: myCourts, isPending: courtsPending } = useMyCurrentCourts();
  const noCourts = !courtsPending && (myCourts?.length ?? 0) === 0;

  return (
    <BrowsePage>
      <BrowseHeader
        title="Docket"
        description="Matters currently assigned to your Court, retained from a prior sitting, or shared with you."
        showViewSelect
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
        <TitleCardSkeletonGallery />
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
        <TitleGallery>
          {data.map((matter) => (
            <TitleCard
              key={matter.id}
              tone="docket"
              href={ROUTES.docketMatter(matter.id)}
              imageUrl={
                "cover_image_path" in matter && matter.cover_image_path
                  ? coverUrls?.[matter.cover_image_path]
                  : undefined
              }
              {...docketCover(matter)}
            />
          ))}
        </TitleGallery>
      )}

      <CreateDocketMatterDialog open={createOpen} onOpenChange={setCreateOpen} />
    </BrowsePage>
  );
}
