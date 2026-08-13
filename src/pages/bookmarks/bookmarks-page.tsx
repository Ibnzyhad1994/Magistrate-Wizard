import { useNavigate } from "react-router-dom";
import { Bookmark as BookmarkIcon, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { BrowseHeader, BrowsePage, TitleCard, TitleGallery } from "@/components/browse";
import { useBookmarks, useRemoveBookmark } from "@/hooks/bookmarks/use-bookmarks";
import { useBookmarkLabels } from "@/hooks/bookmarks/use-bookmark-labels";
import { ROUTES } from "@/routes/paths";
import { formatDate } from "@/lib/utils";
import type { TitleCardTone } from "@/lib/browse-tones";
import type { BookmarkEntityType } from "@/hooks/bookmarks/use-bookmarks";

const TYPE_LABELS: Record<BookmarkEntityType, string> = {
  case: "Case",
  bench_note: "Bench Note",
  statute: "Legislation",
  statute_provision: "Legislation Provision",
  case_law: "Case Law",
  docket_matter: "Docket Matter",
  judgment: "Judgment",
  quick_code: "Quick Code",
};

const TYPE_ROUTE: Partial<Record<BookmarkEntityType, (id: string) => string>> = {
  docket_matter: ROUTES.docketMatter,
  judgment: ROUTES.judgmentDetail,
  case_law: ROUTES.caseLawDetail,
  bench_note: ROUTES.benchNoteDetail,
  statute: ROUTES.legislationDetail,
  // Quick Codes have no standalone detail route — they live in a table on
  // the shared list page. Rather than dropping the user into the generic
  // list with no indication of which one they bookmarked, pass the id as
  // a query param; the list page scrolls to and highlights that row (see
  // the `qc` search param handling in quick-codes-page.tsx).
  quick_code: (id) => `${ROUTES.quickCodes}?qc=${id}`,
};

const TYPE_TONE: Record<BookmarkEntityType, TitleCardTone> = {
  case: "bookmark",
  bench_note: "note",
  statute: "legislation",
  statute_provision: "legislation",
  case_law: "case-law",
  docket_matter: "docket",
  judgment: "judgment",
  quick_code: "code",
};

export default function BookmarksPage() {
  const navigate = useNavigate();
  const { data, isPending, isError, error, refetch } = useBookmarks();
  const { data: labels, isPending: labelsPending } = useBookmarkLabels(data);
  const removeBookmark = useRemoveBookmark();
  const waitingForLabels = Boolean(data && data.length > 0 && labelsPending);

  return (
    <BrowsePage>
      <BrowseHeader
        title="Bookmarks"
        description="Quick links to matters, judgments, research, and more you've saved."
      />

      {isPending || waitingForLabels ? (
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton
              key={i}
              className="aspect-[2/3] w-[42vw] min-w-[9.5rem] max-w-[13.5rem] rounded-sm bg-white/10 sm:w-[28vw] md:w-[18vw] lg:w-[14vw] xl:w-[12vw]"
            />
          ))}
        </div>
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={BookmarkIcon}
          title="No bookmarks yet"
          description="Bookmark a Docket Matter, Judgment, Case Law entry, Quick Code, or Bench Note to see it here."
        />
      ) : (
        <TitleGallery>
          {data.map((b) => {
            const resolved = labels?.get(`${b.entity_type}:${b.entity_id}`);
            const route =
              b.entity_type === "statute_provision"
                ? resolved?.parentId
                  ? ROUTES.legislationProvision(resolved.parentId, b.entity_id)
                  : undefined
                : TYPE_ROUTE[b.entity_type]?.(b.entity_id);
            const canOpen = Boolean(resolved && route);
            return (
              <div key={b.id} className="relative">
                <TitleCard
                  tone={TYPE_TONE[b.entity_type] ?? "bookmark"}
                  eyebrow={TYPE_LABELS[b.entity_type]}
                  title={resolved?.label ?? "Unavailable"}
                  subtitle={resolved?.subtitle ?? undefined}
                  meta={[`Saved ${formatDate(b.created_at)}`]}
                  badge={resolved ? undefined : "Unavailable"}
                  onClick={
                    canOpen
                      ? () =>
                          navigate(route!, {
                            state: { backTo: ROUTES.bookmarks, backLabel: "Back to Bookmarks" },
                          })
                      : undefined
                  }
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute right-1 top-1 z-10 h-8 w-8 bg-black/60 hover:bg-black/80"
                  aria-label="Remove bookmark"
                  disabled={removeBookmark.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeBookmark.mutate({
                      id: b.id,
                      entityType: b.entity_type,
                      entityId: b.entity_id,
                    });
                  }}
                >
                  <Trash2 className="h-4 w-4 text-white" />
                </Button>
              </div>
            );
          })}
        </TitleGallery>
      )}
    </BrowsePage>
  );
}
