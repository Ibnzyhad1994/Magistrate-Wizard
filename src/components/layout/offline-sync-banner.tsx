import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  useDeviceStorageFull,
  useFailedHearings,
  usePendingHearings,
} from "@/hooks/offline/use-pending-hearings";
import {
  discardFailedHearing,
  flushPendingHearings,
  startOfflineFlushListeners,
} from "@/lib/offline/runtime";
import { describeFailedJob } from "@/lib/offline/outbox";

export function OfflineSyncBanner() {
  const { count } = usePendingHearings();
  const failed = useFailedHearings();
  const storageFull = useDeviceStorageFull();
  const [syncing, setSyncing] = useState(false);
  const [showFailed, setShowFailed] = useState(false);

  useEffect(() => {
    startOfflineFlushListeners();
  }, []);

  if (count === 0 && failed.length === 0 && !storageFull) return null;

  const handleSync = async () => {
    setSyncing(true);
    try {
      await flushPendingHearings();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div
      className="fixed inset-x-0 top-[calc(68px+env(safe-area-inset-top,0px))] z-40 border-b border-amber-500/30 bg-amber-950/80 px-4 py-2 text-sm text-amber-50 backdrop-blur-sm max-md:text-xs"
      role="status"
    >
      {storageFull && (
        <p className="mb-1 font-medium">
          This device&apos;s storage is full, so queued work is only held in memory. Sync now, or it
          will be lost if you close or reload the app.
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <p>
          {count > 0 && (
            <>
              Saved on this device. Will sync when online.
              {count > 1 ? ` ${count} pending.` : " 1 pending."}
            </>
          )}
          {failed.length > 0 && (
            <>
              {count > 0 ? " " : ""}
              {failed.length === 1
                ? "1 hearing could not be applied."
                : `${failed.length} hearings could not be applied.`}{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => setShowFailed((open) => !open)}
                aria-expanded={showFailed}
              >
                {showFailed ? "Hide details" : "Show details"}
              </button>
            </>
          )}
        </p>
        {count > 0 && (
          <Button
            type="button"
            size="sm"
            variant="onDark"
            onClick={() => void handleSync()}
            disabled={syncing}
            aria-label="Sync pending hearings"
          >
            {syncing ? "Syncing…" : "Sync pending"}
          </Button>
        )}
      </div>
      {showFailed && failed.length > 0 && (
        // Dead-letter list: each entry says which hearing, why the server
        // would not take it, and lets the person discard it deliberately.
        // Nothing here is retried automatically -- a permission refusal or
        // a conflict will not resolve itself.
        <ul className="mt-2 space-y-1.5 border-t border-amber-500/30 pt-2">
          {failed.map((item) => (
            <li
              key={`${item.job.kind}-${item.job.id}`}
              className="flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="font-medium">{describeFailedJob(item).title}</p>
                <p className="text-amber-100/80">
                  {item.reason === "conflict"
                    ? "Changed elsewhere: "
                    : item.reason === "stalled"
                      ? "Kept failing, so it was set aside to let the rest sync: "
                      : item.reason === "capacity"
                        ? "Your court was full: "
                        : "Not accepted: "}
                  {describeFailedJob(item).detail}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="onDark"
                onClick={() => void discardFailedHearing(item.job.id)}
                aria-label={`Discard failed save for ${item.job.caseNumber}`}
              >
                Discard
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
