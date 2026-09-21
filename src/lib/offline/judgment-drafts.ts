import type { KvAdapter } from "@/lib/offline/kv";
import {
  isAuthExpiredError,
  isPermissionOrValidationError,
  isQueueableError,
} from "@/lib/offline/is-queueable-error";

/**
 * Judgment text kept on this device until the server has it.
 *
 * The docket outbox covers hearings and the board. Judgment content never
 * had anything: the text lived in the editor's React state, so a reload,
 * a lost signal, or the post-unlock reload after an expired session
 * discarded whatever had not been saved. This keeps a copy of the text
 * the moment it is typed and replays it once the person has asked to save.
 *
 * Two rules that are easy to get wrong and silent when wrong:
 *
 *  - Typed text is restored into the editor but NEVER sent on its own. Only
 *    a draft the person pressed Save on (`queued`) is replayed. A judgment
 *    is a formal document; the server should hold what they chose to save.
 *  - A replay never overwrites a judgment that changed elsewhere. The
 *    UPDATE is guarded on `updated_at`; when that misses, the current row
 *    is fetched and its CONTENT compared with the version this draft
 *    started from. A category or tag change bumps `updated_at` too and is
 *    not a conflict; different content is.
 *
 * At rest each draft is AES-GCM encrypted with a per-profile key that is
 * generated non-extractable and kept in IndexedDB. The profile and
 * judgment ids are bound in as additional data, so a record copied to
 * another judgment or profile fails to decrypt rather than restoring into
 * the wrong document. This stops the text being read from exported or
 * inspected storage. It does not protect against someone who can run code
 * in the app on an unlocked device; RLS and the lifecycle trigger still
 * decide every write.
 */

export type DraftProblem = {
  /**
   * `conflict` = the content changed elsewhere; `refused` = the server will
   * not take it (final, no longer the owner); `stalled` = it kept failing
   * on an error we cannot classify.
   */
  reason: "conflict" | "refused" | "stalled";
  message: string;
};

export type JudgmentDraft = {
  judgmentId: string;
  /** Tiptap JSON, exactly as the editor produced it. */
  content: unknown;
  contentText: string;
  /** Fingerprint of the server content this draft was started from. */
  baseFingerprint: string;
  /** The row's `updated_at` when this draft was started. Guards the replay. */
  baseUpdatedAt: string | null;
  /** Increases with every change; lets a finished save tell if more was typed meanwhile. */
  revision: number;
  editedAt: string;
  /** True once the person pressed Save and the server has not confirmed it. */
  queued: boolean;
  /** Failed replays on an unrecognised error. */
  attempts?: number;
  problem?: DraftProblem | null;
};

/** Same bound as the docket outbox: an unknown error must not block the queue forever. */
export const MAX_DRAFT_ATTEMPTS = 5;

// --- fingerprints -----------------------------------------------------------

/**
 * JSON with object keys sorted. Postgres jsonb reorders keys, so the
 * fingerprint of what the server returns has to be independent of order
 * or every restored draft would look like a conflict.
 */
export const stableStringify = (value: unknown): string => {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
};

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** SHA-256 of the stable JSON, or the JSON itself where WebCrypto is missing (`null`). */
export const contentFingerprint = async (
  content: unknown,
  subtle: SubtleCrypto | null = globalThis.crypto?.subtle ?? null,
): Promise<string> => {
  const text = stableStringify(content ?? null);
  if (!subtle) return `raw:${text}`;
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `sha256:${toHex(digest)}`;
};

// --- restore ----------------------------------------------------------------

export type DraftRestore =
  /** Nothing on this device for this judgment. */
  | "none"
  /** The server already has exactly this text: drop the draft. */
  | "same"
  /** Started from what the server still has: put it back in the editor. */
  | "restore"
  /** The server's content moved on since this draft began: ask. */
  | "changed"
  /** The judgment cannot be edited now (final, or not the owner's): offer copy or discard. */
  | "readOnly";

export const decideDraftRestore = (
  draft: JudgmentDraft | null,
  server: { fingerprint: string; editable: boolean },
  draftFingerprint: string,
): DraftRestore => {
  if (!draft) return "none";
  if (draftFingerprint === server.fingerprint) return "same";
  if (!server.editable) return "readOnly";
  if (draft.problem?.reason === "conflict") return "changed";
  return draft.baseFingerprint === server.fingerprint ? "restore" : "changed";
};

/**
 * What to keep after a save landed. If nothing was typed while it was in
 * flight the draft goes; otherwise the newer text stays, re-based on the
 * version the server now holds so it restores without a false conflict.
 */
export const afterDraftSaved = (
  current: JudgmentDraft | null,
  sent: JudgmentDraft,
  saved: { fingerprint: string; updatedAt: string | null },
): JudgmentDraft | "remove" => {
  if (!current || current.revision <= sent.revision) return "remove";
  return {
    ...current,
    baseFingerprint: saved.fingerprint,
    baseUpdatedAt: saved.updatedAt,
    queued: false,
    attempts: 0,
    problem: null,
  };
};

// --- save / replay ------------------------------------------------------------

export type DraftSaveDeps = {
  /**
   * UPDATE content guarded on `updated_at` (unguarded when `baseUpdatedAt`
   * is null). `conflict` = zero rows matched.
   */
  saveGuarded: (
    judgmentId: string,
    content: unknown,
    contentText: string,
    baseUpdatedAt: string | null,
  ) => Promise<{ conflict: true } | { conflict?: false; updatedAt: string | null }>;
  /** The row as the server has it now, or null when it is not visible. */
  fetchCurrent: (judgmentId: string) => Promise<{
    content: unknown;
    updated_at: string;
    status: string;
    owner_id: string;
  } | null>;
  fingerprint: (content: unknown) => Promise<string>;
  /** Defaults to `navigator.onLine`; injectable for tests. */
  online?: boolean;
};

export type DraftSaveOutcome =
  | { kind: "saved"; updatedAt: string | null; fingerprint: string }
  | { kind: "conflict" }
  | { kind: "refused"; message: string }
  | { kind: "authExpired" }
  | { kind: "offline" }
  | { kind: "failed"; message: string };

export const DRAFT_MESSAGES = {
  conflict: "This judgment was changed elsewhere after you started editing here.",
  noAccess: "You can no longer edit this judgment.",
  final: "This judgment is final now, so your text was not saved. Unlock it to add your changes.",
} as const;

const messageOf = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "The server refused this save.";
};

/**
 * One save of one draft. Used for the Save button AND the reconnect
 * replay, so both go through the same guard and the same classification.
 */
export const saveDraftContent = async (
  draft: JudgmentDraft,
  profileId: string,
  deps: DraftSaveDeps,
): Promise<DraftSaveOutcome> => {
  try {
    const first = await deps.saveGuarded(
      draft.judgmentId,
      draft.content,
      draft.contentText,
      draft.baseUpdatedAt,
    );
    const mine = await deps.fingerprint(draft.content);
    if (!first.conflict) return { kind: "saved", updatedAt: first.updatedAt, fingerprint: mine };

    // The guard missed. Find out why before calling it a conflict.
    const current = await deps.fetchCurrent(draft.judgmentId);
    if (!current || current.owner_id !== profileId) {
      return { kind: "refused", message: DRAFT_MESSAGES.noAccess };
    }
    const theirs = await deps.fingerprint(current.content);
    // Already there: a second tab, or an earlier replay whose reply was lost.
    if (theirs === mine) return { kind: "saved", updatedAt: current.updated_at, fingerprint: mine };
    if (current.status !== "draft") return { kind: "refused", message: DRAFT_MESSAGES.final };
    if (theirs !== draft.baseFingerprint) return { kind: "conflict" };

    // Only non-content columns moved (category, discoverable, tags touch
    // updated_at too). The text this draft was written against is still
    // what is there, so saving over it loses nothing. Still guarded.
    const retry = await deps.saveGuarded(
      draft.judgmentId,
      draft.content,
      draft.contentText,
      current.updated_at,
    );
    if (retry.conflict) return { kind: "conflict" };
    return { kind: "saved", updatedAt: retry.updatedAt, fingerprint: mine };
  } catch (error) {
    if (isAuthExpiredError(error)) return { kind: "authExpired" };
    // P0001 from the lifecycle trigger (final) lands here.
    if (isPermissionOrValidationError(error)) return { kind: "refused", message: messageOf(error) };
    if (isQueueableError(error, deps.online)) return { kind: "offline" };
    return { kind: "failed", message: messageOf(error) };
  }
};

/**
 * The draft to store after a save that did NOT land. `null` means leave it
 * as it is (still queued, try again later).
 */
export const draftAfterFailedSave = (
  draft: JudgmentDraft,
  outcome: Exclude<DraftSaveOutcome, { kind: "saved" }>,
): JudgmentDraft | null => {
  switch (outcome.kind) {
    case "offline":
    case "authExpired":
      return null;
    case "conflict":
      return {
        ...draft,
        queued: false,
        problem: { reason: "conflict", message: DRAFT_MESSAGES.conflict },
      };
    case "refused":
      return { ...draft, queued: false, problem: { reason: "refused", message: outcome.message } };
    case "failed": {
      const attempts = (draft.attempts ?? 0) + 1;
      if (attempts >= MAX_DRAFT_ATTEMPTS) {
        return {
          ...draft,
          queued: false,
          attempts,
          problem: { reason: "stalled", message: outcome.message },
        };
      }
      return { ...draft, attempts };
    }
  }
};

// --- encrypted store ------------------------------------------------------------

export type DraftPersistence = "device" | "session";

export type JudgmentDraftStore = {
  load: (profileId: string, judgmentId: string) => Promise<JudgmentDraft | null>;
  /** `session` = held in memory only (no IndexedDB, no WebCrypto, or storage full). */
  save: (profileId: string, draft: JudgmentDraft) => Promise<DraftPersistence>;
  remove: (profileId: string, judgmentId: string) => Promise<void>;
  list: (profileId: string) => Promise<JudgmentDraft[]>;
  /** Drafts and the key. For an explicit sign-out. */
  clearProfile: (profileId: string) => Promise<void>;
};

type EncryptedRecord = { v: 1; iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer };

const recordPrefix = (profileId: string) => `jdraft:${profileId}:`;
const recordKey = (profileId: string, judgmentId: string) =>
  `${recordPrefix(profileId)}${judgmentId}`;
const cryptoKeyKey = (profileId: string) => `jdraft-key:${profileId}`;
const additionalData = (profileId: string, judgmentId: string) =>
  new TextEncoder().encode(`mw.judgment-draft.v1|${profileId}|${judgmentId}`);

const isEncryptedRecord = (value: unknown): value is EncryptedRecord =>
  !!value &&
  typeof value === "object" &&
  (value as { v?: unknown }).v === 1 &&
  (value as { iv?: unknown }).iv instanceof Uint8Array &&
  (value as { data?: unknown }).data instanceof ArrayBuffer;

/**
 * `kv` and `crypto` are the test seams, as with the docket store: a plain
 * in-memory KvAdapter and Node's WebCrypto drive every path from a script.
 * Either one missing means drafts are held in memory for this session.
 */
export const createJudgmentDraftStore = (deps: {
  kv: KvAdapter | null;
  crypto: Crypto | undefined;
}): JudgmentDraftStore => {
  const { kv } = deps;
  const subtle = deps.crypto?.subtle;
  const memory = new Map<string, JudgmentDraft>();
  const keys = new Map<string, CryptoKey>();
  // Encryption is async, so two quick saves could otherwise land out of
  // order and leave the older text on disk.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = chain.then(run, run);
    chain = next.catch(() => undefined);
    return next;
  };

  const encrypted = !!kv && !!subtle && !!deps.crypto;

  const getKey = async (profileId: string, create: boolean): Promise<CryptoKey | null> => {
    const cached = keys.get(profileId);
    if (cached) return cached;
    const stored = await kv!.get<CryptoKey>(cryptoKeyKey(profileId));
    if (stored) {
      keys.set(profileId, stored);
      return stored;
    }
    if (!create) return null;
    const key = await subtle!.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await kv!.set(cryptoKeyKey(profileId), key);
    keys.set(profileId, key);
    return key;
  };

  const decrypt = async (
    profileId: string,
    judgmentId: string,
    record: unknown,
  ): Promise<JudgmentDraft | null> => {
    if (!isEncryptedRecord(record)) return null;
    const key = await getKey(profileId, false);
    if (!key) return null;
    try {
      const plain = await subtle!.decrypt(
        { name: "AES-GCM", iv: record.iv, additionalData: additionalData(profileId, judgmentId) },
        key,
        record.data,
      );
      const draft = JSON.parse(new TextDecoder().decode(plain)) as JudgmentDraft;
      return draft.judgmentId === judgmentId ? draft : null;
    } catch {
      // Tampered, moved from another judgment, or the key is gone.
      return null;
    }
  };

  const memoryKey = (profileId: string, judgmentId: string) => `${profileId}:${judgmentId}`;

  return {
    load: async (profileId, judgmentId) => {
      const held = memory.get(memoryKey(profileId, judgmentId));
      if (held) return held;
      if (!encrypted) return null;
      const record = await kv!.get<unknown>(recordKey(profileId, judgmentId));
      if (record == null) return null;
      const draft = await decrypt(profileId, judgmentId, record);
      if (!draft) await kv!.remove(recordKey(profileId, judgmentId));
      return draft;
    },

    save: (profileId, draft) =>
      serial(async () => {
        const id = memoryKey(profileId, draft.judgmentId);
        if (!encrypted) {
          memory.set(id, draft);
          return "session" as const;
        }
        try {
          const key = await getKey(profileId, true);
          const iv = deps.crypto!.getRandomValues(new Uint8Array(12));
          const data = await subtle!.encrypt(
            { name: "AES-GCM", iv, additionalData: additionalData(profileId, draft.judgmentId) },
            key!,
            new TextEncoder().encode(JSON.stringify(draft)),
          );
          const record: EncryptedRecord = { v: 1, iv, data };
          await kv!.set(recordKey(profileId, draft.judgmentId), record);
          memory.delete(id);
          return "device" as const;
        } catch {
          // Full store, or a WebView that cannot clone a CryptoKey. The
          // text is not lost this session; the editor says it will not
          // survive a reload.
          memory.set(id, draft);
          return "session" as const;
        }
      }),

    remove: (profileId, judgmentId) =>
      serial(async () => {
        memory.delete(memoryKey(profileId, judgmentId));
        if (encrypted) await kv!.remove(recordKey(profileId, judgmentId));
      }),

    list: async (profileId) => {
      const found = new Map<string, JudgmentDraft>();
      if (encrypted) {
        const prefix = recordPrefix(profileId);
        for (const key of await kv!.keys()) {
          if (!key.startsWith(prefix)) continue;
          const judgmentId = key.slice(prefix.length);
          const draft = await decrypt(profileId, judgmentId, await kv!.get<unknown>(key));
          if (draft) found.set(judgmentId, draft);
        }
      }
      for (const [id, draft] of memory) {
        if (id.startsWith(`${profileId}:`)) found.set(draft.judgmentId, draft);
      }
      return [...found.values()];
    },

    clearProfile: (profileId) =>
      serial(async () => {
        for (const id of [...memory.keys()]) {
          if (id.startsWith(`${profileId}:`)) memory.delete(id);
        }
        keys.delete(profileId);
        if (!encrypted) return;
        const prefix = recordPrefix(profileId);
        for (const key of await kv!.keys()) {
          if (key.startsWith(prefix)) await kv!.remove(key);
        }
        await kv!.remove(cryptoKeyKey(profileId));
      }),
  };
};
