import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { googleClientIdFor } from "@/lib/google-calendar/platform";
import { beginGoogleOAuth, completeGoogleOAuthFromCallback } from "@/lib/google-calendar/oauth";
import {
  disconnectGoogleCalendar,
  runGoogleCalendarSyncNow,
} from "@/lib/google-calendar/sync";
import {
  isGoogleConnected,
  loadGoogleCalendarState,
  type GoogleCalendarLocalState,
} from "@/lib/google-calendar/storage";

const STATE_KEY = ["google-calendar", "state"] as const;

export function useGoogleCalendarState() {
  return useQuery({
    queryKey: STATE_KEY,
    queryFn: loadGoogleCalendarState,
    staleTime: 5_000,
  });
}

export function useGoogleCalendarOAuthReturn() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("code")) return;
    void (async () => {
      try {
        const done = await completeGoogleOAuthFromCallback(params);
        if (done) {
          toast.success("Google Calendar connected.");
          void queryClient.invalidateQueries({ queryKey: STATE_KEY });
          window.history.replaceState({}, "", window.location.pathname);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Google sign-in failed.");
      }
    })();
  }, [queryClient]);
}

export function useConnectGoogleCalendar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!googleClientIdFor()) {
        throw new Error(
          "Add a Google OAuth client ID to .env.local (see .env.example) before connecting.",
        );
      }
      const result = await beginGoogleOAuth();
      if (result.connected) {
        await runGoogleCalendarSyncNow();
      }
      return result;
    },
    onSuccess: (result) => {
      if (result.connected) {
        toast.success("Google Calendar connected.");
        void queryClient.invalidateQueries({ queryKey: STATE_KEY });
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Google sign-in failed.");
    },
    meta: { silent: true },
  });
}

export function useDisconnectGoogleCalendar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: disconnectGoogleCalendar,
    onSuccess: () => {
      toast.success("Google Calendar disconnected. Existing Google events were left in place.");
      void queryClient.invalidateQueries({ queryKey: STATE_KEY });
    },
  });
}

export function useSyncGoogleCalendarNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: runGoogleCalendarSyncNow,
    onSuccess: () => {
      toast.success("Google Calendar synced.");
      void queryClient.invalidateQueries({ queryKey: STATE_KEY });
    },
  });
}

export const googleCalendarConnected = (state: GoogleCalendarLocalState | undefined) =>
  Boolean(state && isGoogleConnected(state));
