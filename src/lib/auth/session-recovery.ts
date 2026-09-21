import { queryClient } from "@/lib/query-client";
import { isAuthExpiredError } from "@/lib/offline/is-queueable-error";
import { flushPendingHearings } from "@/lib/offline/runtime";
import { flushQueuedJudgmentDrafts } from "@/lib/offline/judgment-drafts-runtime";
import { bumpRememberUntil } from "@/lib/auth/session-storage";

type ExecutableMutation = {
  execute: () => Promise<unknown>;
  state: { status: string; error: unknown };
  options: { mutationKey?: readonly unknown[] };
};

export const POST_UNLOCK_RELOAD_KEY = "mw.post-unlock-reload";

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

const browserStorage = (): StorageLike | null => {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
};

/**
 * After password unlock: wait for the save that 401'd, flush the hearing
 * outbox, then refetch. Does not wipe the in-memory query cache — completeSessionUnlock
 * reloads the tab afterward so a stale JS bundle and schema cache are dropped.
 */
export async function recoverSessionWork(): Promise<void> {
  bumpRememberUntil();
  const mutations = queryClient.getMutationCache().getAll() as unknown as ExecutableMutation[];
  const retries: Promise<unknown>[] = [];
  for (const mutation of mutations) {
    if (mutation.options.mutationKey?.[0] === "auth") continue;
    if (mutation.state.status !== "error") continue;
    if (!isAuthExpiredError(mutation.state.error)) continue;
    if (typeof mutation.execute !== "function") continue;
    retries.push(mutation.execute().catch(() => undefined));
  }
  await Promise.all(retries);
  await flushPendingHearings();
  await flushQueuedJudgmentDrafts();
  await queryClient.invalidateQueries();
}

const defaultReload = () => {
  window.location.reload();
};

/**
 * Save queued work, then hard-reload once so the next paint is a fresh
 * bundle. A second call on the reloaded tab only finishes the save/refetch
 * and does not reload again.
 */
export async function completeSessionUnlock(options?: {
  reloadPage?: () => void;
  storage?: StorageLike | null;
}): Promise<void> {
  const storage = options?.storage === undefined ? browserStorage() : options.storage;
  const reloadPage = options?.reloadPage ?? defaultReload;
  await recoverSessionWork();
  if (storage?.getItem(POST_UNLOCK_RELOAD_KEY) === "pending") {
    storage.removeItem(POST_UNLOCK_RELOAD_KEY);
    return;
  }
  storage?.setItem(POST_UNLOCK_RELOAD_KEY, "pending");
  reloadPage();
}

/** After a post-unlock reload, finish queued work without reloading again. */
export async function finishPostUnlockReloadIfNeeded(options?: {
  storage?: StorageLike | null;
}): Promise<boolean> {
  const storage = options?.storage === undefined ? browserStorage() : options.storage;
  if (storage?.getItem(POST_UNLOCK_RELOAD_KEY) !== "pending") return false;
  storage.removeItem(POST_UNLOCK_RELOAD_KEY);
  await recoverSessionWork();
  return true;
}
