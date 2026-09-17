import { QueryClient } from "@tanstack/react-query";
import { QUERY_GC_TIME_MS, QUERY_STALE_TIME_MS } from "@/lib/constants";
import { getErrorMessage } from "@/lib/utils";
import { reportError } from "@/lib/sentry";
import { toast } from "sonner";
import { isAuthExpiredError } from "@/lib/offline/is-queueable-error";
import { lockCurrentSession, notifyAuthExpiredSave } from "@/lib/auth/session-lock";
import { playCue } from "@/lib/sound-cues";

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
// errors. This is THE default layer: a hook that toasts in its own
// `onError` must also set `meta: { silent: true }`, otherwise the user
// sees the same failure twice.
// The error cue rides along with the toast rather than being wired at
// call sites: this is already the one place every unhandled failure in
// the application passes through, so a cue here covers all of them and
// stays silent for anything explicitly marked `meta.silent`.
// Every failure, silent or not, is still reported — silence is about what
// the user sees, not about what engineering hears.
queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== "updated" || event.action.type !== "error") return;
  const { query } = event;
  if (handleAuthExpired(event.action.error)) return;
  reportError(event.action.error, { source: "query", key: query.queryKey });
  if (query.meta?.silent) return;
  toast.error(getErrorMessage(event.action.error));
  playCue("error");
});

queryClient.getMutationCache().subscribe((event) => {
  if (event.type !== "updated" || event.action.type !== "error") return;
  const { mutation } = event;
  if (handleAuthExpired(event.action.error)) return;
  reportError(event.action.error, { source: "mutation", key: mutation.options.mutationKey });
  if (mutation.meta?.silent) return;
  toast.error(getErrorMessage(event.action.error));
  playCue("error");
});
