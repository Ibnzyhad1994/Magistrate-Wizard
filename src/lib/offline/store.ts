import { DeviceStorageQuotaError, loadDeviceJson, saveDeviceJson } from "@/lib/device-storage";
import { openKv, type KvAdapter } from "@/lib/offline/kv";
import type { Profile } from "@/types";
import { emptyProfileCache, type ProfileDocketCache } from "@/lib/offline/docket-cache";
import type { FailedOutboxJob, OutboxJob } from "@/lib/offline/outbox";

const EMPTY_JOBS: OutboxJob[] = [];
const EMPTY_FAILED: FailedOutboxJob[] = [];

/**
 * IndexedDB, when the device has it. Each slice is written under its own
 * key, so queuing a hearing no longer re-serialises every profile's
 * cached matters as well. `null` means IndexedDB was unavailable or
 * refused to open, and the original localStorage path is used unchanged.
 */
let kv: KvAdapter | null = null;

/** Marks that the pre-IndexedDB blobs have been imported for this device. */
const MIGRATED_KEY = "mw.kv-migrated.v1";

const kvKey = (kind: "outbox" | "failed" | "cache" | "profiles", profileId: string) =>
  `${kind}:${profileId}`;

const OUTBOX_KEY = "mw.offline-outbox.v1";
const FAILED_KEY = "mw.offline-failed.v1";
const CACHE_KEY = "mw.offline-docket-cache.v1";
const PROFILE_KEY = "mw.offline-profile.v1";

type OutboxFile = Record<string, OutboxJob[]>;
type FailedFile = Record<string, FailedOutboxJob[]>;
type CacheFile = Record<string, ProfileDocketCache>;
type ProfileFile = Record<string, Profile>;

const memory = {
  outbox: {} as OutboxFile,
  failed: {} as FailedFile,
  cache: {} as CacheFile,
  profiles: {} as ProfileFile,
  hydrated: false,
  /**
   * True once a write did not persist because the device store is full.
   * Queued work is still in `memory` and still flushes this session; what
   * it will not survive is a reload. Surfaced in the offline banner rather
   * than thrown, because the enqueue that triggered it did succeed.
   */
  storageFull: false,
};

const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export const subscribeOfflineStore = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Reads the four legacy whole-file blobs written before IndexedDB. */
const loadLegacyBlobs = async () => {
  const [outbox, failed, cache, profiles] = await Promise.all([
    loadDeviceJson<OutboxFile>(OUTBOX_KEY),
    loadDeviceJson<FailedFile>(FAILED_KEY),
    loadDeviceJson<CacheFile>(CACHE_KEY),
    loadDeviceJson<ProfileFile>(PROFILE_KEY),
  ]);
  return {
    outbox: outbox ?? {},
    failed: failed ?? {},
    cache: cache ?? {},
    profiles: profiles ?? {},
  };
};

/** Rebuilds the in-memory files from the per-profile IndexedDB records. */
const loadFromKv = async (adapter: KvAdapter) => {
  const keys = await adapter.keys();
  const out = {
    outbox: {} as OutboxFile,
    failed: {} as FailedFile,
    cache: {} as CacheFile,
    profiles: {} as ProfileFile,
  };
  await Promise.all(
    keys.map(async (key) => {
      const separator = key.indexOf(":");
      if (separator === -1) return;
      const kind = key.slice(0, separator);
      const profileId = key.slice(separator + 1);
      if (!profileId) return;
      const value = await adapter.get<unknown>(key);
      if (value == null) return;
      if (kind === "outbox") out.outbox[profileId] = value as OutboxJob[];
      else if (kind === "failed") out.failed[profileId] = value as FailedOutboxJob[];
      else if (kind === "cache") out.cache[profileId] = value as ProfileDocketCache;
      else if (kind === "profiles") out.profiles[profileId] = value as Profile;
    }),
  );
  return out;
};

/**
 * `adapter` is the test seam: pass a plain in-memory KvAdapter to drive
 * the migration and slice-write paths from a Node script, which has no
 * IndexedDB. Production calls this with no argument.
 */
export const hydrateOfflineStore = async (adapter?: KvAdapter | null) => {
  kv = adapter === undefined ? await openKv() : adapter;

  if (!kv) {
    const legacy = await loadLegacyBlobs();
    memory.outbox = legacy.outbox;
    memory.failed = legacy.failed;
    memory.cache = legacy.cache;
    memory.profiles = legacy.profiles;
    memory.hydrated = true;
    emit();
    return;
  }

  const migrated = await kv.get<boolean>(MIGRATED_KEY);
  if (!migrated) {
    // One-time import of the pre-IndexedDB blobs. Read-only: the legacy
    // keys are left in place for this release so a rollback still finds
    // queued work rather than an empty queue.
    const legacy = await loadLegacyBlobs();
    memory.outbox = legacy.outbox;
    memory.failed = legacy.failed;
    memory.cache = legacy.cache;
    memory.profiles = legacy.profiles;
    await Promise.all([
      ...Object.entries(legacy.outbox).map(([id, jobs]) => kv!.set(kvKey("outbox", id), jobs)),
      ...Object.entries(legacy.failed).map(([id, jobs]) => kv!.set(kvKey("failed", id), jobs)),
      ...Object.entries(legacy.cache).map(([id, value]) => kv!.set(kvKey("cache", id), value)),
      ...Object.entries(legacy.profiles).map(([id, value]) =>
        kv!.set(kvKey("profiles", id), value),
      ),
    ]);
    await kv.set(MIGRATED_KEY, true);
    memory.hydrated = true;
    emit();
    return;
  }

  const loaded = await loadFromKv(kv);
  memory.outbox = loaded.outbox;
  memory.failed = loaded.failed;
  memory.cache = loaded.cache;
  memory.profiles = loaded.profiles;
  memory.hydrated = true;
  emit();
};

/**
 * Persist one slice, recording a full device store rather than letting it
 * reject. The caller's write already landed in `memory`, so failing the
 * mutation here would report a loss that has not happened yet; the banner
 * tells the user their queued work will not survive a reload.
 */
const persist = async (key: string, value: unknown) => {
  try {
    await saveDeviceJson(key, value);
    if (memory.storageFull) {
      memory.storageFull = false;
      emit();
    }
  } catch (error) {
    if (!(error instanceof DeviceStorageQuotaError)) throw error;
    if (!memory.storageFull) {
      memory.storageFull = true;
      emit();
    }
  }
};

/**
 * Writes one profile's slice. On IndexedDB that is a single record, so
 * queueing a hearing no longer re-serialises every cached matter as
 * well; without it, the original whole-file write is used unchanged.
 */
const persistSlice = async (
  kind: "outbox" | "failed" | "cache" | "profiles",
  profileId: string | null,
  legacyKey: string,
  whole: unknown,
  slice: unknown,
) => {
  if (!kv || !profileId) {
    await persist(legacyKey, whole);
    return;
  }
  try {
    if (slice === undefined) await kv.remove(kvKey(kind, profileId));
    else await kv.set(kvKey(kind, profileId), slice);
    if (memory.storageFull) {
      memory.storageFull = false;
      emit();
    }
  } catch (error) {
    // IndexedDB reports a full store the same way localStorage does.
    if (!isQuotaError(error)) throw error;
    if (!memory.storageFull) {
      memory.storageFull = true;
      emit();
    }
  }
};

const isQuotaError = (error: unknown): boolean => {
  if (error instanceof DeviceStorageQuotaError) return true;
  if (!error || typeof error !== "object") return false;
  const { name } = error as { name?: unknown };
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED";
};

const persistOutbox = (profileId: string | null = null) =>
  persistSlice(
    "outbox",
    profileId,
    OUTBOX_KEY,
    memory.outbox,
    profileId ? memory.outbox[profileId] : undefined,
  );

const persistFailed = (profileId: string | null = null) =>
  persistSlice(
    "failed",
    profileId,
    FAILED_KEY,
    memory.failed,
    profileId ? memory.failed[profileId] : undefined,
  );

const persistCache = (profileId: string | null = null) =>
  persistSlice(
    "cache",
    profileId,
    CACHE_KEY,
    memory.cache,
    profileId ? memory.cache[profileId] : undefined,
  );

const persistProfiles = (profileId: string | null = null) =>
  persistSlice(
    "profiles",
    profileId,
    PROFILE_KEY,
    memory.profiles,
    profileId ? memory.profiles[profileId] : undefined,
  );

/** True when queued work is held in memory only — see `memory.storageFull`. */
export const isDeviceStorageFull = () => memory.storageFull;

export const getOutboxJobs = (profileId: string | undefined): OutboxJob[] => {
  if (!profileId) return EMPTY_JOBS;
  return memory.outbox[profileId] ?? EMPTY_JOBS;
};

export const setOutboxJobs = async (profileId: string, jobs: OutboxJob[]) => {
  memory.outbox = { ...memory.outbox, [profileId]: jobs };
  emit();
  await persistOutbox(profileId);
};

/**
 * Dead-letter list: queued hearings the flush could not replay and will
 * not retry (permission/validation refusal, or an updated_at conflict).
 * Persisted like the outbox so the user can see and discard them after a
 * reload; never silently dropped.
 */
export const getFailedJobs = (profileId: string | undefined): FailedOutboxJob[] => {
  if (!profileId) return EMPTY_FAILED;
  return memory.failed[profileId] ?? EMPTY_FAILED;
};

export const setFailedJobs = async (profileId: string, jobs: FailedOutboxJob[]) => {
  memory.failed = { ...memory.failed, [profileId]: jobs };
  emit();
  await persistFailed(profileId);
};

export const appendFailedJobs = async (profileId: string, jobs: FailedOutboxJob[]) => {
  if (jobs.length === 0) return;
  await setFailedJobs(profileId, [...getFailedJobs(profileId), ...jobs]);
};

export const discardFailedJob = async (profileId: string, jobId: string) => {
  await setFailedJobs(
    profileId,
    getFailedJobs(profileId).filter((item) => item.job.id !== jobId),
  );
};

export const getProfileCache = (profileId: string | undefined): ProfileDocketCache => {
  if (!profileId) return emptyProfileCache();
  return memory.cache[profileId] ?? emptyProfileCache();
};

export const setProfileCache = async (profileId: string, cache: ProfileDocketCache) => {
  memory.cache = { ...memory.cache, [profileId]: cache };
  emit();
  await persistCache(profileId);
};

export const getCachedProfile = (userId: string | undefined): Profile | null => {
  if (!userId) return null;
  return memory.profiles[userId] ?? null;
};

export const setCachedProfile = async (userId: string, profile: Profile) => {
  memory.profiles = { ...memory.profiles, [userId]: profile };
  await persistProfiles(userId);
};

/**
 * Full wipe for an explicit sign-out: cache, profile, outbox and the
 * failed list. Pass `keepOutbox` (or use clearOfflineCacheForProfile) for
 * an idle/auth-expiry lock, where the person is expected back: cached
 * case data must not stay readable on a shared terminal, but the hearings
 * they saved offline are their work and must survive until they unlock.
 */
export const clearOfflineForProfile = async (
  profileId: string,
  opts: { keepOutbox?: boolean } = {},
) => {
  const nextCache = { ...memory.cache };
  const nextProfiles = { ...memory.profiles };
  delete nextCache[profileId];
  delete nextProfiles[profileId];
  memory.cache = nextCache;
  memory.profiles = nextProfiles;
  const writes = [persistCache(profileId), persistProfiles(profileId)];
  if (!opts.keepOutbox) {
    const nextOutbox = { ...memory.outbox };
    const nextFailed = { ...memory.failed };
    delete nextOutbox[profileId];
    delete nextFailed[profileId];
    memory.outbox = nextOutbox;
    memory.failed = nextFailed;
    writes.push(persistOutbox(profileId), persistFailed(profileId));
  }
  emit();
  await Promise.all(writes);
};

/** Lock-time wipe: cache and profile only; the outbox and failed list stay. */
export const clearOfflineCacheForProfile = async (profileId: string) =>
  clearOfflineForProfile(profileId, { keepOutbox: true });

export const isOfflineStoreHydrated = () => memory.hydrated;
