import type { Json } from "@/types";
import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/query-client";
import { useAuthStore } from "@/store/auth-store";
import { toast } from "sonner";
import { openKv } from "@/lib/offline/kv";
import { isKnownOffline } from "@/lib/offline/is-queueable-error";
import { lockCurrentSession, notifyAuthExpiredSave } from "@/lib/auth/session-lock";
import {
  afterDraftSaved,
  contentFingerprint,
  createJudgmentDraftStore,
  draftAfterFailedSave,
  saveDraftContent,
  type DraftPersistence,
  type DraftSaveDeps,
  type DraftSaveOutcome,
  type JudgmentDraft,
  type JudgmentDraftStore,
} from "@/lib/offline/judgment-drafts";

let storePromise: Promise<JudgmentDraftStore> | null = null;

const draftStore = () => {
  storePromise ??= openKv().then((kv) =>
    createJudgmentDraftStore({ kv, crypto: globalThis.crypto }),
  );
  return storePromise;
};

// --- summary for the sync banner -------------------------------------------------

export type JudgmentDraftSummary = {
  /** Saved on this device, waiting for the server. */
  queued: string[];
  /** Could not be applied; the person has to choose. */
  needsAttention: string[];
};

const EMPTY_SUMMARY: JudgmentDraftSummary = { queued: [], needsAttention: [] };
let summary = EMPTY_SUMMARY;
const listeners = new Set<() => void>();

export const subscribeJudgmentDrafts = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getJudgmentDraftSummary = () => summary;

const profileId = () => useAuthStore.getState().user?.id ?? null;

/** Re-reads the drafts and tells the banner. Cheap: a handful of records at most. */
export const refreshJudgmentDraftSummary = async () => {
  const id = profileId();
  const drafts = id ? await (await draftStore()).list(id) : [];
  summary = {
    queued: drafts.filter((d) => d.queued && !d.problem).map((d) => d.judgmentId),
    needsAttention: drafts.filter((d) => d.problem).map((d) => d.judgmentId),
  };
  for (const listener of listeners) listener();
};

// --- store access for the editor --------------------------------------------------

export const loadJudgmentDraft = async (judgmentId: string) => {
  const id = profileId();
  if (!id) return null;
  return (await draftStore()).load(id, judgmentId);
};

export const saveJudgmentDraft = async (draft: JudgmentDraft): Promise<DraftPersistence> => {
  const id = profileId();
  if (!id) return "session";
  const kept = await (await draftStore()).save(id, draft);
  if (draft.queued || draft.problem) void refreshJudgmentDraftSummary();
  return kept;
};

export const discardJudgmentDraft = async (judgmentId: string) => {
  const id = profileId();
  if (!id) return;
  await (await draftStore()).remove(id, judgmentId);
  void refreshJudgmentDraftSummary();
};

/** Explicit sign-out only. A lock keeps drafts, as it keeps the docket outbox. */
export const clearJudgmentDraftsForProfile = async (id: string) => {
  await (await draftStore()).clearProfile(id);
  summary = EMPTY_SUMMARY;
  for (const listener of listeners) listener();
};

// --- sending ---------------------------------------------------------------------

const liveDeps = (): DraftSaveDeps => ({
  saveGuarded: async (judgmentId, content, contentText, baseUpdatedAt) => {
    // Same optimistic guard the docket uses. RLS (owner only) and the
    // lifecycle trigger (draft only) still decide; this only stops a
    // silent overwrite of text changed elsewhere.
    let query = supabase
      .from("judgments")
      .update({ content: content as Json, content_text: contentText })
      .eq("id", judgmentId);
    if (baseUpdatedAt) query = query.eq("updated_at", baseUpdatedAt);
    const { data, error } = await query.select("updated_at");
    if (error) throw error;
    const row = (data ?? [])[0];
    if (!row) return { conflict: true };
    return { updatedAt: row.updated_at };
  },
  fetchCurrent: async (judgmentId) => {
    const { data, error } = await supabase
      .from("judgments")
      .select("content, updated_at, status, owner_id")
      .eq("id", judgmentId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  fingerprint: (content) => contentFingerprint(content),
});

// The keys of judgmentsKeys / judgmentVersionsKeys in the judgments hooks,
// written out because src/lib does not import from src/hooks.
const invalidateJudgment = (judgmentId: string) => {
  void queryClient.invalidateQueries({ queryKey: ["judgments"] });
  void queryClient.invalidateQueries({ queryKey: ["judgment-versions", judgmentId] });
};

const inFlight = new Set<string>();

export type SendResult = DraftSaveOutcome | { kind: "busy" } | { kind: "missing" };

/**
 * Sends the stored draft for one judgment, the one path for both the Save
 * button and the reconnect replay. The draft on the device is the source:
 * the caller persists it (queued) first, so a tab closed mid-request still
 * has it to replay.
 */
export const sendJudgmentDraft = async (judgmentId: string): Promise<SendResult> => {
  const id = profileId();
  if (!id) return { kind: "missing" };
  if (inFlight.has(judgmentId)) return { kind: "busy" };
  inFlight.add(judgmentId);
  try {
    const store = await draftStore();
    const draft = await store.load(id, judgmentId);
    if (!draft) return { kind: "missing" };
    if (isKnownOffline()) return { kind: "offline" };

    const outcome = await saveDraftContent(draft, id, liveDeps());
    if (outcome.kind === "saved") {
      const next = afterDraftSaved(await store.load(id, judgmentId), draft, {
        fingerprint: outcome.fingerprint,
        updatedAt: outcome.updatedAt,
      });
      if (next === "remove") await store.remove(id, judgmentId);
      else await store.save(id, next);
      invalidateJudgment(judgmentId);
    } else {
      const next = draftAfterFailedSave(draft, outcome);
      if (next) {
        // Keep anything typed while this was in flight.
        const latest = await store.load(id, judgmentId);
        const merged =
          latest && latest.revision > draft.revision
            ? { ...latest, queued: next.queued, attempts: next.attempts, problem: next.problem }
            : next;
        await store.save(id, merged);
      }
      if (outcome.kind === "authExpired") {
        void lockCurrentSession();
        notifyAuthExpiredSave();
      }
    }
    return outcome;
  } finally {
    inFlight.delete(judgmentId);
    void refreshJudgmentDraftSummary();
  }
};

let flushing = false;

/** Replays every queued judgment draft. Triggered with the docket outbox. */
export const flushQueuedJudgmentDrafts = async () => {
  if (flushing) return;
  if (useAuthStore.getState().status === "locked") return;
  const id = profileId();
  if (!id || isKnownOffline()) return;
  flushing = true;
  let saved = 0;
  let problems = 0;
  try {
    const drafts = (await (await draftStore()).list(id)).filter((d) => d.queued && !d.problem);
    for (const draft of drafts) {
      const outcome = await sendJudgmentDraft(draft.judgmentId);
      if (outcome.kind === "saved") saved += 1;
      else if (outcome.kind === "conflict" || outcome.kind === "refused") problems += 1;
      else if (outcome.kind === "offline" || outcome.kind === "authExpired") break;
    }
  } finally {
    flushing = false;
    await refreshJudgmentDraftSummary();
  }
  if (saved > 0) {
    toast.success(saved === 1 ? "Judgment text synced." : `${saved} judgments synced.`);
  }
  if (problems > 0) {
    toast.error(
      problems === 1
        ? "A judgment saved on this device could not be applied. Open it to choose what to keep."
        : `${problems} judgments saved on this device could not be applied. Open them to choose what to keep.`,
    );
  }
};

/**
 * Makes the draft the one to save over whatever the server has now.
 * Explicit choice only, after a conflict. It removes the version check,
 * not the access check: RLS and the lifecycle trigger still apply.
 */
export const rebaseJudgmentDraft = async (judgmentId: string) => {
  const id = profileId();
  if (!id) return null;
  const store = await draftStore();
  const draft = await store.load(id, judgmentId);
  if (!draft) return null;
  const current = await liveDeps().fetchCurrent(judgmentId);
  if (!current) return null;
  const next: JudgmentDraft = {
    ...draft,
    baseFingerprint: await contentFingerprint(current.content),
    baseUpdatedAt: current.updated_at,
    problem: null,
    attempts: 0,
  };
  await store.save(id, next);
  void refreshJudgmentDraftSummary();
  return next;
};
