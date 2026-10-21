import { clearOfflineForProfile, getFailedJobs, getOutboxJobs } from "@/lib/offline/store";
import {
  clearJudgmentDraftsForProfile,
  getJudgmentDraftSummary,
  readJudgmentDraftSummary,
} from "@/lib/offline/judgment-drafts-runtime";
import { syncOfflineWorkNow } from "@/lib/offline/runtime";

/**
 * What an explicit sign-out would delete from this device. Sign-out wipes
 * the docket outbox, its failed list and the judgment drafts for the
 * profile (a shared terminal must not keep them), so it first checks
 * this and asks before anything is lost.
 */
export type UnsyncedWork = {
  /** Queued docket changes (hearings, next dates, board edits) a sync can still send. */
  docketWaiting: number;
  /** Docket changes the server did not accept, kept so the person can review them. */
  docketNotApplied: number;
  /** Judgment text saved here and not yet confirmed by the server. */
  judgmentsWaiting: number;
  /** Judgment text that could not be applied; the person has to choose what to keep. */
  judgmentsNeedChoice: number;
};

export const unsyncedTotal = (work: UnsyncedWork) =>
  work.docketWaiting + work.docketNotApplied + work.judgmentsWaiting + work.judgmentsNeedChoice;

/** True when "Sync now" could send at least part of it. */
export const hasSyncableWork = (work: UnsyncedWork) =>
  work.docketWaiting + work.judgmentsWaiting > 0;

export const readUnsyncedWork = async (profileId: string): Promise<UnsyncedWork> => {
  let judgments: { queued: string[]; needsAttention: string[] };
  try {
    judgments = await readJudgmentDraftSummary(profileId);
  } catch {
    // Unreadable store: the banner's last summary is the best evidence left.
    judgments = getJudgmentDraftSummary();
  }
  return {
    docketWaiting: getOutboxJobs(profileId).length,
    docketNotApplied: getFailedJobs(profileId).length,
    judgmentsWaiting: judgments.queued.length,
    judgmentsNeedChoice: judgments.needsAttention.length,
  };
};

/** What a sign-out request leads to: straight out, or the unsynced-work dialog. */
export type SignOutStep =
  { kind: "signOut" } | { kind: "ask"; work: UnsyncedWork; syncFellShort: boolean };

const stepFor = (work: UnsyncedWork, syncFellShort: boolean): SignOutStep =>
  unsyncedTotal(work) === 0 ? { kind: "signOut" } : { kind: "ask", work, syncFellShort };

/** Sign out pressed: straight out when nothing would be lost, otherwise ask. */
export const decideSignOut = async (
  profileId: string | undefined,
  read: (profileId: string) => Promise<UnsyncedWork> = readUnsyncedWork,
): Promise<SignOutStep> => {
  if (!profileId) return { kind: "signOut" };
  return stepFor(await read(profileId), false);
};

/**
 * "Sync now" in the dialog: send what can be sent, then sign out only if
 * nothing is left; otherwise ask again with what remains.
 */
export const syncThenDecide = async (
  profileId: string,
  deps: {
    sync: () => Promise<void>;
    read: (profileId: string) => Promise<UnsyncedWork>;
  } = { sync: syncOfflineWorkNow, read: readUnsyncedWork },
): Promise<SignOutStep> => {
  await deps.sync();
  return stepFor(await deps.read(profileId), true);
};

/**
 * The sign-out wipe, awaited: it resolves once the outbox, the failed list,
 * the cached matters and profile and the judgment drafts are gone from
 * storage, not merely queued for deletion, so the next sign-in on this
 * device can never race it.
 */
export const clearDeviceWorkForProfile = async (profileId: string) => {
  await Promise.all([clearOfflineForProfile(profileId), clearJudgmentDraftsForProfile(profileId)]);
};

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One line per kind of work at risk, for the sign-out dialog. Empty kinds are left out. */
export const describeUnsyncedWork = (work: UnsyncedWork): string[] =>
  [
    work.docketWaiting > 0 &&
      `${count(work.docketWaiting, "docket change", "docket changes")} waiting to sync`,
    work.docketNotApplied > 0 &&
      `${count(work.docketNotApplied, "docket change", "docket changes")} the server did not accept`,
    work.judgmentsWaiting > 0 &&
      `${count(work.judgmentsWaiting, "judgment", "judgments")} waiting to sync`,
    work.judgmentsNeedChoice > 0 &&
      `${count(work.judgmentsNeedChoice, "judgment", "judgments")} needing you to choose what to keep`,
  ].filter((line): line is string => typeof line === "string");

export const unsyncedSummary = (work: UnsyncedWork) => {
  const total = unsyncedTotal(work);
  return total === 1
    ? "1 save on this device has not reached the server. Signing out deletes it."
    : `${total} saves on this device have not reached the server. Signing out deletes them.`;
};
