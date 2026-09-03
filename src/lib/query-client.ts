import { QueryClient } from "@tanstack/react-query";
import { QUERY_GC_TIME_MS, QUERY_STALE_TIME_MS } from "@/lib/constants";
import { getErrorMessage } from "@/lib/utils";
import { toast } from "sonner";
import { isAuthExpiredError } from "@/lib/offline/is-queueable-error";
import { lockCurrentSession, notifyAuthExpiredSave } from "@/lib/auth/session-lock";

/**
 * Shared TanStack Query client. Query errors surface as toasts by default;
 * individual `useQuery`/`useMutation` calls can opt out via `meta.silent`.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QUERY_STALE_TIME_MS,
      gcTime: QUERY_GC_TIME_MS,
      retry: (failureCount, error) => {
        if (isAuthExpiredError(error)) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

const handleAuthExpired = (error: unknown): boolean => {
  if (!isAuthExpiredError(error)) return false;
  void lockCurrentSession();
  notifyAuthExpiredSave();
  return true;
};

// Global error surfacing for queries/mutations that don't handle their own
// errors. Attach `meta: { silent: true }` to suppress the toast for a
// specific query or mutation.
queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== "updated" || event.action.type !== "error") return;
  const { query } = event;
  if (query.meta?.silent) return;
  if (handleAuthExpired(event.action.error)) return;
  toast.error(getErrorMessage(event.action.error));
});

queryClient.getMutationCache().subscribe((event) => {
  if (event.type !== "updated" || event.action.type !== "error") return;
  const { mutation } = event;
  if (mutation.meta?.silent) return;
  if (handleAuthExpired(event.action.error)) return;
  toast.error(getErrorMessage(event.action.error));
});
