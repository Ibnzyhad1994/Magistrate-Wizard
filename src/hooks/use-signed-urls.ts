import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const DOCUMENTS_BUCKET = "documents";

/**
 * Load private-bucket images as blob: object URLs.
 * Blobs are cached; object URLs are created per subscriber so unmount
 * cannot revoke a URL still shown by another component.
 */
export function useSignedUrls(paths: (string | null | undefined)[]) {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))].sort();

  const query = useQuery({
    queryKey: ["signed-urls", unique],
    queryFn: async () => {
      const blobs: Record<string, Blob> = {};
      if (unique.length === 0) return blobs;
      await Promise.all(
        unique.map(async (path) => {
          const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).download(path);
          if (error || !data) return;
          blobs[path] = data;
        }),
      );
      return blobs;
    },
    enabled: unique.length > 0,
    staleTime: 60_000,
  });

  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const blobs = query.data;
    if (!blobs) {
      setUrls({});
      return;
    }
    const next: Record<string, string> = {};
    for (const [path, blob] of Object.entries(blobs)) {
      next[path] = URL.createObjectURL(blob);
    }
    setUrls(next);
    return () => {
      for (const url of Object.values(next)) URL.revokeObjectURL(url);
    };
  }, [query.data]);

  return { ...query, data: urls };
}
