import { DeviceStorageQuotaError, loadDeviceJson, saveDeviceJson } from "@/lib/device-storage";
import type { Profile } from "@/types";
import { emptyProfileCache, type ProfileDocketCache } from "@/lib/offline/docket-cache";
import type { FailedOutboxJob, OutboxJob } from "@/lib/offline/outbox";

const EMPTY_JOBS: OutboxJob[] = [];
const EMPTY_FAILED: FailedOutboxJob[] = [];

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

export const hydrateOfflineStore = async () => {
  const [outbox, failed, cache, profiles] = await Promise.all([
    loadDeviceJson<OutboxFile>(OUTBOX_KEY),
    loadDeviceJson<FailedFile>(FAILED_KEY),
    loadDeviceJson<CacheFile>(CACHE_KEY),
    loadDeviceJson<ProfileFile>(PROFILE_KEY),
  ]);
  memory.outbox = outbox ?? {};
  memory.failed = failed ?? {};
  memory.cache = cache ?? {};
  memory.profiles = profiles ?? {};
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

const persistOutbox = () => persist(OUTBOX_KEY, memory.outbox);

const persistFailed = () => persist(FAILED_KEY, memory.failed);

const persistCache = () => persist(CACHE_KEY, memory.cache);

const persistProfiles = () => persist(PROFILE_KEY, memory.profiles);

/** True when queued work is held in memory only — see `memory.storageFull`. */
export const isDeviceStorageFull = () => memory.storageFull;

export const getOutboxJobs = (profileId: string | undefined): OutboxJob[] => {
  if (!profileId) return EMPTY_JOBS;
  return memory.outbox[profileId] ?? EMPTY_JOBS;
};

export const setOutboxJobs = async (profileId: string, jobs: OutboxJob[]) => {
  memory.outbox = { ...memory.outbox, [profileId]: jobs };
  emit();
  await persistOutbox();
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
  await persistFailed();
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
  await persistCache();
};

export const getCachedProfile = (userId: string | undefined): Profile | null => {
  if (!userId) return null;
  return memory.profiles[userId] ?? null;
};

export const setCachedProfile = async (userId: string, profile: Profile) => {
  memory.profiles = { ...memory.profiles, [userId]: profile };
  await persistProfiles();
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
  const writes = [persistCache(), persistProfiles()];
  if (!opts.keepOutbox) {
    const nextOutbox = { ...memory.outbox };
    const nextFailed = { ...memory.failed };
    delete nextOutbox[profileId];
    delete nextFailed[profileId];
    memory.outbox = nextOutbox;
    memory.failed = nextFailed;
    writes.push(persistOutbox(), persistFailed());
  }
  emit();
  await Promise.all(writes);
};

/** Lock-time wipe: cache and profile only; the outbox and failed list stay. */
export const clearOfflineCacheForProfile = async (profileId: string) =>
  clearOfflineForProfile(profileId, { keepOutbox: true });

export const isOfflineStoreHydrated = () => memory.hydrated;
