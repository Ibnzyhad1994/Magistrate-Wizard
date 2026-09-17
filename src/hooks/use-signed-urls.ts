import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const DOCUMENTS_BUCKET = "documents";

/**
 * Comfortably longer than the query stays cached, so a URL handed to an
 * <img> never expires while React Query still considers it fresh.
 */
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const SIGNED_URL_STALE_MS = 15 * 60_000;
/** Re-sign well inside the TTL for a board that stays open all sitting. */
const SIGNED_URL_REFRESH_MS = 45 * 60_000;

/**
 * Signed URLs for private-bucket images, resolved in ONE storage call per
 * distinct set of paths. The previous version downloaded every image as a
 * full Blob (`storage.download()` per path, in parallel) just to build
 * object URLs — on the docket board that was up to 100 image bodies on
 * every render of the list. The browser now fetches each image itself,
 * on demand, and lazily where the consumer sets `loading="lazy"`.
 *
 * Returns `data` as `{ [path]: url }`. Paths that could not be signed are
 * simply absent, so consumers keep their existing fallback artwork.
 */
export function useSignedUrls(paths: (string | null | undefined)[]) {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))].sort();

  return useQuery({
    queryKey: ["signed-urls", unique],
    queryFn: async (): Promise<Record<string, string>> => {
      const urls: Record<string, string> = {};
      if (unique.length === 0) return urls;
      const { data, error } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);
      if (error) throw error;
      for (const row of data ?? []) {
        if (row.path && row.signedUrl && !row.error) urls[row.path] = row.signedUrl;
      }
      return urls;
    },
    enabled: unique.length > 0,
    staleTime: SIGNED_URL_STALE_MS,
    refetchInterval: SIGNED_URL_REFRESH_MS,
    // Cover art is decoration; a failed signing must not toast over the page.
    meta: { silent: true },
  });
}
