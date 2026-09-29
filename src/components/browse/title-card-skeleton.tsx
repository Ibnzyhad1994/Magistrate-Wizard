import { Skeleton } from "@/components/ui/skeleton";
import type { BrowseView } from "@/lib/browse-prefs";
import { useUiStore } from "@/store/ui-store";
import { TitleGallery } from "@/components/browse/title-gallery";

export function TitleCardSkeleton({ layout }: { layout?: BrowseView }) {
  const storedView = useUiStore((s) => s.browseView);
  const view = layout ?? storedView;

  if (view === "list") {
    return <Skeleton className="h-[4.5rem] w-full rounded-sm bg-foreground/10" />;
  }

  // The still's shape: 16:9 art, then case number, two title lines and meta.
  return (
    <div
      aria-hidden="true"
      className="flex snap-start flex-col overflow-hidden rounded-lg border border-hairline bg-card hc:border-border"
    >
      <Skeleton className="aspect-video w-full rounded-none bg-foreground/10" />
      <div className="space-y-2 px-[11px] pb-3 pt-2.5">
        <Skeleton className="h-2.5 w-2/3 bg-foreground/10" />
        <Skeleton className="h-3.5 w-full bg-foreground/10" />
        <Skeleton className="h-3.5 w-4/5 bg-foreground/10" />
        <Skeleton className="h-2.5 w-1/2 bg-foreground/10" />
      </div>
    </div>
  );
}

export function TitleCardSkeletonGallery({
  count = 8,
  layout,
}: {
  count?: number;
  layout?: BrowseView;
}) {
  return (
    <TitleGallery layout={layout}>
      {Array.from({ length: count }).map((_, i) => (
        <TitleCardSkeleton key={i} layout={layout} />
      ))}
    </TitleGallery>
  );
}
