import { useMemo } from "react";
import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";
import { type KeysetCursor, type KeysetPage, nextKeysetCursor } from "@/lib/keyset-pagination";

/**
 * A keyset-paged list (BE-15) behind the same surface a plain list query
 * had: `data` is every row loaded so far, in order, so a caller written
 * for one capped fetch keeps working on the first page unchanged.
 *
 * On top of that: `totalCount` (every row the list holds for this caller),
 * and TanStack's `fetchNextPage`, `hasNextPage` and `isFetchingNextPage`
 * for a "load more" control or infinite scroll.
 */
export function useKeysetList<T>(options: {
  queryKey: QueryKey;
  fetchPage: (cursor: KeysetCursor | null) => Promise<KeysetPage<T>>;
  enabled?: boolean;
}) {
  const query = useInfiniteQuery({
    queryKey: options.queryKey,
    queryFn: ({ pageParam }) => options.fetchPage(pageParam),
    initialPageParam: null as KeysetCursor | null,
    getNextPageParam: (_lastPage, pages) => nextKeysetCursor(pages),
    enabled: options.enabled,
  });
  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.rows), [query.data]);
  return { ...query, data: rows, totalCount: query.data?.pages[0]?.totalCount ?? undefined };
}
