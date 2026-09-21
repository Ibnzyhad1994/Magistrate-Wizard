import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  googleCalendarConnected,
  useConnectGoogleCalendar,
  useDisconnectGoogleCalendar,
  useGoogleCalendarOAuthReturn,
  useGoogleCalendarState,
  useSyncGoogleCalendarNow,
} from "@/hooks/google-calendar/use-google-calendar";
import { formatDateTime } from "@/lib/utils";

export function GoogleCalendarCard() {
  useGoogleCalendarOAuthReturn();
  const { data: state } = useGoogleCalendarState();
  const connect = useConnectGoogleCalendar();
  const disconnect = useDisconnectGoogleCalendar();
  const syncNow = useSyncGoogleCalendarNow();
  const connected = googleCalendarConnected(state);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Google Calendar</CardTitle>
        <CardDescription>
          Syncs hearing dates, times and places with a “Magistrate Wizard” calendar. The Docket
          stays the official record.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {connected
            ? state?.lastSyncedAt
              ? `Last synced ${formatDateTime(state.lastSyncedAt)}.`
              : "Connected. Run Sync now to push hearings."
            : "Not connected on this device. Tokens stay on this device, not in the database."}
        </p>
        <div className="flex flex-wrap gap-2">
          {connected ? (
            <>
              <Button type="button" onClick={() => syncNow.mutate()} disabled={syncNow.isPending}>
                {syncNow.isPending ? "Syncing…" : "Sync now"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
              >
                Disconnect
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => connect.mutate()} disabled={connect.isPending}>
              {connect.isPending ? "Connecting…" : "Connect Google Calendar"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
