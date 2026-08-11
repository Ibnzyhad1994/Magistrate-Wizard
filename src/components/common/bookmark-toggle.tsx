import { Bookmark, BookmarkCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import {
  type BookmarkEntityType,
  useAddBookmark,
  useIsBookmarked,
  useRemoveBookmark,
} from "@/hooks/bookmarks/use-bookmarks";

interface BookmarkToggleProps {
  entityType: BookmarkEntityType;
  entityId: string;
}

/**
 * Shared bookmark toggle for the entity types this frontend has detail
 * pages for (Docket Matter, Judgment, Case Law, Legislation/Statute,
 * Bench Note, Quick Code) — `case` is the one remaining valid
 * `bookmark_entity_type` with no UI surface here to bookmark from; the
 * Bookmarks list still displays any existing bookmark of that type.
 */
export function BookmarkToggle({ entityType, entityId }: BookmarkToggleProps) {
  const { data: existing, isPending } = useIsBookmarked(entityType, entityId);
  const addBookmark = useAddBookmark();
  const removeBookmark = useRemoveBookmark();
  const isMutating = addBookmark.isPending || removeBookmark.isPending;

  if (isPending) {
    return (
      <Button size="sm" variant="outline" disabled>
        <LoadingSpinner size={14} />
        Bookmark
      </Button>
    );
  }

  if (existing) {
    return (
      <Button
        size="sm"
        variant="secondary"
        disabled={isMutating}
        onClick={() => removeBookmark.mutate({ id: existing.id, entityType, entityId })}
      >
        <BookmarkCheck className="h-4 w-4" />
        Bookmarked
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={isMutating}
      onClick={() => addBookmark.mutate({ entityType, entityId })}
    >
      <Bookmark className="h-4 w-4" />
      Bookmark
    </Button>
  );
}
