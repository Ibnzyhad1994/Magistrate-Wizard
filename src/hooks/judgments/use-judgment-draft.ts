import { useCallback, useEffect, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { judgmentsKeys } from "@/hooks/judgments/use-judgments";
import {
  contentFingerprint,
  decideDraftRestore,
  type DraftPersistence,
  type JudgmentDraft,
} from "@/lib/offline/judgment-drafts";
import {
  discardJudgmentDraft,
  loadJudgmentDraft,
  rebaseJudgmentDraft,
  saveJudgmentDraft,
  sendJudgmentDraft,
} from "@/lib/offline/judgment-drafts-runtime";

/** How long typing settles before the text is written to the device. */
const PERSIST_DELAY_MS = 300;

/**
 * Judgments edited in this tab. A draft restored for one of these is the
 * person's own text coming back after the editor remounted (a refetch
 * changes the card's key), so it is restored without a notice.
 */
const editedThisSession = new Set<string>();

export type DraftNotice =
  | { kind: "restored"; editedAt: string }
  /** The server's text moved on. The editor shows this device's text, read-only, until they choose. */
  | { kind: "changed"; message: string }
  /** The judgment cannot be edited now; the text is offered to copy. */
  | { kind: "readOnly"; draft: JudgmentDraft }
  /** Refused or kept failing while still editable. */
  | { kind: "problem"; message: string };

type ServerJudgment = { id: string; content: unknown; updated_at: string };

/**
 * The Content card's editing state, backed by the encrypted draft store:
 * text is kept on the device as it is typed, restored after a reload or a
 * lock, and a Save made offline is sent when the connection returns.
 */
export function useJudgmentDraft(judgment: ServerJudgment, editable: boolean) {
  const [ready, setReady] = useState(false);
  const [initial, setInitial] = useState<JSONContent | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [queued, setQueued] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<DraftNotice | null>(null);
  const [kept, setKept] = useState<DraftPersistence>("device");

  const draftRef = useRef<JudgmentDraft | null>(null);
  const baseRef = useRef<{ fingerprint: string; updatedAt: string | null } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useQueryClient();

  const showServer = useCallback(() => {
    setInitial((judgment.content as JSONContent | null) ?? null);
    setEditorKey((key) => key + 1);
  }, [judgment.content]);

  const showDraft = useCallback((draft: JudgmentDraft) => {
    setInitial(draft.content as JSONContent);
    setEditorKey((key) => key + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const serverFingerprint = await contentFingerprint(judgment.content ?? null);
      baseRef.current = { fingerprint: serverFingerprint, updatedAt: judgment.updated_at };
      const draft = await loadJudgmentDraft(judgment.id);
      const draftFingerprint = draft ? await contentFingerprint(draft.content) : "";
      if (cancelled) return;
      const decision = decideDraftRestore(
        draft,
        { fingerprint: serverFingerprint, editable },
        draftFingerprint,
      );
      if (decision === "none" || decision === "same" || !draft) {
        if (decision === "same") void discardJudgmentDraft(judgment.id);
        showServer();
      } else if (decision === "restore") {
        // Started from the text the server still has, so it is safe to
        // carry on from; re-base the guard on the row as it is now.
        const rebased: JudgmentDraft = {
          ...draft,
          baseFingerprint: serverFingerprint,
          baseUpdatedAt: judgment.updated_at,
        };
        draftRef.current = rebased;
        void saveJudgmentDraft(rebased).then(setKept);
        showDraft(rebased);
        setDirty(true);
        setQueued(rebased.queued);
        if (rebased.problem) setNotice({ kind: "problem", message: rebased.problem.message });
        else if (!editedThisSession.has(judgment.id)) {
          setNotice({ kind: "restored", editedAt: rebased.editedAt });
        }
      } else if (decision === "changed") {
        draftRef.current = draft;
        showDraft(draft);
        setDirty(true);
        setNotice({
          kind: "changed",
          message:
            draft.problem?.message ??
            "This judgment was changed elsewhere after you edited it on this device.",
        });
      } else {
        showServer();
        setNotice({ kind: "readOnly", draft });
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // Mount-time only: the Content card is keyed on id and updated_at, so
    // a changed judgment remounts this rather than re-running it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistNow = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const draft = draftRef.current;
    if (!draft) return Promise.resolve<DraftPersistence>("device");
    return saveJudgmentDraft(draft).then((result) => {
      setKept(result);
      return result;
    });
  }, []);

  // Write anything still waiting when the card goes or the page is hidden.
  useEffect(() => {
    const onHide = () => {
      if (timerRef.current) void persistNow();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      if (timerRef.current) void persistNow();
    };
  }, [persistNow]);

  const onChange = useCallback(
    (json: JSONContent, text: string) => {
      const previous = draftRef.current;
      const base = baseRef.current;
      editedThisSession.add(judgment.id);
      draftRef.current = {
        judgmentId: judgment.id,
        content: json,
        contentText: text,
        baseFingerprint: previous?.baseFingerprint ?? base?.fingerprint ?? "",
        baseUpdatedAt: previous ? previous.baseUpdatedAt : (base?.updatedAt ?? null),
        revision: Math.max((previous?.revision ?? 0) + 1, Date.now()),
        editedAt: new Date().toISOString(),
        // Typing after an offline Save keeps it queued: the latest text is
        // what syncs, as if Save were pressed again.
        queued: previous?.queued ?? false,
        attempts: previous?.attempts ?? 0,
        problem: previous?.problem ?? null,
      };
      setDirty(true);
      setNotice((current) => (current?.kind === "restored" ? null : current));
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void persistNow(), PERSIST_DELAY_MS);
    },
    [judgment.id, persistNow],
  );

  const afterSend = useCallback(async () => {
    const outcome = await sendJudgmentDraft(judgment.id);
    switch (outcome.kind) {
      case "saved": {
        // Text typed while the save was in flight is still on the device.
        const left = await loadJudgmentDraft(judgment.id);
        draftRef.current = left;
        setDirty(!!left);
        setQueued(false);
        setNotice(null);
        return;
      }
      case "offline":
      case "busy":
        setQueued(true);
        if (outcome.kind === "offline") {
          toast.message("Saved on this device. It will sync when you are back online.");
        }
        return;
      case "authExpired":
        // The session lock is already up; the unlock replays this.
        setQueued(true);
        return;
      case "conflict":
        setQueued(false);
        setNotice({
          kind: "changed",
          message: "This judgment was changed elsewhere after you started editing here.",
        });
        return;
      case "refused":
        setQueued(false);
        setNotice({ kind: "problem", message: outcome.message });
        toast.error(outcome.message);
        return;
      case "failed": {
        const left = await loadJudgmentDraft(judgment.id);
        setQueued(!!left?.queued);
        if (left?.problem) setNotice({ kind: "problem", message: left.problem.message });
        toast.error(outcome.message);
        return;
      }
      case "missing":
        return;
    }
  }, [judgment.id]);

  const save = useCallback(async () => {
    const draft = draftRef.current;
    if (!draft) return;
    setIsSaving(true);
    try {
      // On the device, marked queued, BEFORE the request: a tab closed or
      // a signal lost mid-save still has it to replay.
      draftRef.current = { ...draft, queued: true, problem: null };
      await persistNow();
      await afterSend();
    } finally {
      setIsSaving(false);
    }
  }, [afterSend, persistNow]);

  /** After a conflict: save this device's text over what is there now. */
  const keepMine = useCallback(async () => {
    setIsSaving(true);
    try {
      await persistNow();
      const rebased = await rebaseJudgmentDraft(judgment.id);
      if (!rebased) {
        toast.error("Could not reach the server. Try again when you are online.");
        return;
      }
      draftRef.current = { ...rebased, queued: true };
      await persistNow();
      setNotice(null);
      await afterSend();
    } catch {
      toast.error("Could not reach the server. Try again when you are online.");
    } finally {
      setIsSaving(false);
    }
  }, [afterSend, judgment.id, persistNow]);

  /** Drops this device's text and shows what the server has. */
  const discard = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    draftRef.current = null;
    editedThisSession.delete(judgment.id);
    await discardJudgmentDraft(judgment.id);
    setDirty(false);
    setQueued(false);
    setNotice(null);
    showServer();
    // After a conflict the copy on screen is older than the server's; the
    // refetch remounts the card with the current text.
    void queryClient.invalidateQueries({ queryKey: judgmentsKeys.detail(judgment.id) });
  }, [judgment.id, queryClient, showServer]);

  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied.");
    } catch {
      toast.error("Could not copy. Select the text and copy it yourself.");
    }
  }, []);

  return {
    ready,
    initial,
    editorKey,
    /** Not yet confirmed by the server, including a queued save. */
    dirty,
    queued,
    isSaving,
    notice,
    dismissNotice: () => setNotice(null),
    /** Where the text is held: on the device, or only in this session. */
    kept,
    /** Changed elsewhere: the editor stays read-only until they choose. */
    locked: notice?.kind === "changed",
    currentText: () => draftRef.current?.contentText ?? "",
    onChange,
    save,
    keepMine,
    discard,
    copyText,
  };
}
