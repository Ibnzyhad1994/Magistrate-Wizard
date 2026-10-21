import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  decideSignOut,
  syncThenDecide,
  type SignOutStep,
  type UnsyncedWork,
} from "@/lib/offline/sign-out-guard";

/**
 * Sign-out that never deletes unsynced work without asking. Signing out
 * wipes this profile's outbox and judgment drafts from the device, so when
 * any are held, `requestSignOut` opens the dialog instead: Sync now (sign
 * out once everything has gone), or Sign out and discard.
 *
 * Every sign-out control uses this; `useAuth().signOut` is the bare wipe.
 */
export function useGuardedSignOut() {
  const { user, isLocked, signOut, isSigningOut } = useAuth();
  const [work, setWork] = useState<UnsyncedWork | null>(null);
  const [checking, setChecking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  /** A Sync now has run and something is still left. */
  const [syncFellShort, setSyncFellShort] = useState(false);

  const finishSignOut = async () => {
    try {
      await signOut();
    } catch {
      // Mutation cache toast already surfaced the error.
    } finally {
      setWork(null);
    }
  };

  const follow = async (step: SignOutStep) => {
    if (step.kind === "signOut") {
      await finishSignOut();
      return;
    }
    setSyncFellShort(step.syncFellShort);
    setWork(step.work);
  };

  const requestSignOut = async () => {
    setChecking(true);
    try {
      await follow(await decideSignOut(user?.id));
    } finally {
      setChecking(false);
    }
  };

  const syncNow = async () => {
    if (!user?.id) return;
    setSyncing(true);
    try {
      await follow(await syncThenDecide(user.id));
    } finally {
      setSyncing(false);
    }
  };

  return {
    requestSignOut,
    isSigningOut: isSigningOut || checking,
    dialog: {
      open: work !== null,
      work,
      locked: isLocked,
      syncing,
      syncFellShort,
      signingOut: isSigningOut,
      onSyncNow: () => void syncNow(),
      onDiscard: () => void finishSignOut(),
      onCancel: () => setWork(null),
    },
  };
}
