import { useNavigate } from "react-router-dom";
import { Bookmark as BookmarkIcon, FileQuestion, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { useBookmarks, useRemoveBookmark } from "@/hooks/bookmarks/use-bookmarks";
import { useBookmarkLabels } from "@/hooks/bookmarks/use-bookmark-labels";
import { ROUTES } from "@/routes/paths";
import { formatDate } from "@/lib/utils";
import type { BookmarkEntityType } from "@/hooks/bookmarks/use-bookmarks";

const TYPE_LABELS: Record<BookmarkEntityType, string> = {
  case: "Case",
  bench_note: "Bench Note",
  statute: "Statute",
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
  quick_code: () => ROUTES.quickCodes,
};

export default function BookmarksPage() {
  const navigate = useNavigate();
  const { data, isPending, isError, error, refetch } = useBookmarks();
  const { data: labels } = useBookmarkLabels(data);
  const removeBookmark = useRemoveBookmark();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Bookmarks</h1>
        <p className="text-sm text-muted-foreground">
          Quick links to matters, judgments, research, and more you've saved.
        </p>
      </div>

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={BookmarkIcon}
              className="border-0"
              title="No bookmarks yet"
              description="Bookmark a Docket Matter, Judgment, Case Law entry, Quick Code, or Bench Note to see it here."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.map((b) => {
            const resolved = labels?.get(`${b.entity_type}:${b.entity_id}`);
            const route = TYPE_ROUTE[b.entity_type]?.(b.entity_id);
            return (
              <Card key={b.id}>
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <button
                    type="button"
                    className="flex-1 text-left disabled:cursor-default"
                    disabled={!resolved || !route}
                    onClick={() => route && navigate(route)}
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{TYPE_LABELS[b.entity_type]}</Badge>
                      {resolved ? (
                        <span className="font-medium text-foreground hover:underline">
                          {resolved.label}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 italic text-muted-foreground">
                          <FileQuestion className="h-3.5 w-3.5" />
                          Unavailable
                        </span>
                      )}
                    </div>
                    {resolved?.subtitle && (
                      <p className="mt-0.5 text-sm text-muted-foreground">{resolved.subtitle}</p>
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Saved {formatDate(b.created_at)}
                    </p>
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remove bookmark"
                    disabled={removeBookmark.isPending}
                    onClick={() =>
                      removeBookmark.mutate({
                        id: b.id,
                        entityType: b.entity_type,
                        entityId: b.entity_id,
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
