import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const DOCUMENTS_BUCKET = "documents";

/**
 * Batch-mint short-lived signed URLs for private documents-bucket objects.
 * Storage SELECT still requires a matching `public.documents` row, so a
 * path the caller cannot already read will simply be omitted.
 */
export function useSignedUrls(paths: (string | null | undefined)[]) {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))].sort();

  return useQuery({
    queryKey: ["signed-urls", unique],
    queryFn: async () => {
      const map: Record<string, string> = {};
      if (unique.length === 0) return map;
      const { data, error } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .createSignedUrls(unique, 300);
      if (error) throw error;
      for (const row of data ?? []) {
        if (row.path && row.signedUrl) map[row.path] = row.signedUrl;
      }
      return map;
    },
    enabled: unique.length > 0,
    staleTime: 60_000,
  });
}
