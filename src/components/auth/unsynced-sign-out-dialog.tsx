import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import {
  describeUnsyncedWork,
  hasSyncableWork,
  unsyncedSummary,
  type UnsyncedWork,
} from "@/lib/offline/sign-out-guard";

interface UnsyncedSignOutDialogProps {
  open: boolean;
  work: UnsyncedWork | null;
  /** Session locked: nothing can sync until the person unlocks. */
  locked: boolean;
  syncing: boolean;
  syncFellShort: boolean;
  signingOut: boolean;
  onSyncNow: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

/**
 * Asked before a sign-out that would delete work saved on this device and
 * not yet on the server. Opened by useGuardedSignOut.
 */
export function UnsyncedSignOutDialog({
  open,
  work,
  locked,
  syncing,
  syncFellShort,
  signingOut,
  onSyncNow,
  onDiscard,
  onCancel,
}: UnsyncedSignOutDialogProps) {
  if (!work) return null;
  const canSync = !locked && hasSyncableWork(work);
  const busy = syncing || signingOut;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      {/* From the lock dialog it has to sit above that dialog's z-lock layer. */}
      <DialogContent
        overlayClassName={locked ? "z-lock" : undefined}
        className={locked ? "z-lock sm:max-w-md" : "sm:max-w-md"}
      >
        <DialogHeader>
          <DialogTitle>Unsynced work on this device</DialogTitle>
          <DialogDescription>{unsyncedSummary(work)}</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
          {describeUnsyncedWork(work).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {locked ? (
          <p className="text-sm text-muted-foreground">
            Unlock with your password to sync before you sign out.
          </p>
        ) : !canSync ? (
          <p className="text-sm text-muted-foreground">
            The server did not accept this work. Review it from the sync banner before you sign out.
          </p>
        ) : syncFellShort ? (
          <p role="status" className="text-sm text-muted-foreground">
            Not everything synced. Check your connection and try again.
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onDiscard} disabled={busy}>
            {signingOut && <LoadingSpinner className="text-current" size={16} />}
            Sign out and discard
          </Button>
          {canSync && (
            <Button type="button" onClick={onSyncNow} disabled={busy}>
              {syncing && <LoadingSpinner className="text-current" size={16} />}
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
