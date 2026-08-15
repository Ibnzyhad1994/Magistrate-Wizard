import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { TILE_WIDTH_CLASS } from "@/lib/browse-prefs";
import { useUiStore } from "@/store/ui-store";
import { TitleGallery } from "@/components/browse/title-gallery";

export function TitleCardSkeleton({ layout }: { layout?: "tiles" | "list" }) {
  const storedView = useUiStore((s) => s.browseView);
  const tileSize = useUiStore((s) => s.tileSize);
  const view = layout ?? storedView;

  if (view === "list") {
    return <Skeleton className="h-[4.5rem] w-full rounded-sm bg-white/10" />;
  }

  return (
    <Skeleton
      className={cn(
        "aspect-[2/3] shrink-0 snap-start rounded-sm bg-white/10",
        TILE_WIDTH_CLASS[tileSize],
      )}
    />
  );
}

export function TitleCardSkeletonGallery({ count = 8 }: { count?: number }) {
  return (
    <TitleGallery>
      {Array.from({ length: count }).map((_, i) => (
        <TitleCardSkeleton key={i} />
      ))}
    </TitleGallery>
  );
}
