import { loadDeviceJson, saveDeviceJson } from "@/lib/device-storage"
import type { Profile } from "@/types/database.types"
import {
  emptyProfileCache,
  type ProfileDocketCache,
} from "@/lib/offline/docket-cache"
import type { OutboxJob } from "@/lib/offline/outbox"

const EMPTY_JOBS: OutboxJob[] = []

const OUTBOX_KEY = "mw.offline-outbox.v1"
const CACHE_KEY = "mw.offline-docket-cache.v1"
const PROFILE_KEY = "mw.offline-profile.v1"

type OutboxFile = Record<string, OutboxJob[]>
type CacheFile = Record<string, ProfileDocketCache>
type ProfileFile = Record<string, Profile>

const memory = {
  outbox: {} as OutboxFile,
  cache: {} as CacheFile,
  profiles: {} as ProfileFile,
  hydrated: false,
}

const listeners = new Set<() => void>()

const emit = () => {
  for (const listener of listeners) listener()
}

export const subscribeOfflineStore = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const hydrateOfflineStore = async () => {
  const [outbox, cache, profiles] = await Promise.all([
    loadDeviceJson<OutboxFile>(OUTBOX_KEY),
    loadDeviceJson<CacheFile>(CACHE_KEY),
    loadDeviceJson<ProfileFile>(PROFILE_KEY),
  ])
  memory.outbox = outbox ?? {}
  memory.cache = cache ?? {}
  memory.profiles = profiles ?? {}
  memory.hydrated = true
  emit()
}

const persistOutbox = async () => {
  await saveDeviceJson(OUTBOX_KEY, memory.outbox)
}

const persistCache = async () => {
  await saveDeviceJson(CACHE_KEY, memory.cache)
}

const persistProfiles = async () => {
  await saveDeviceJson(PROFILE_KEY, memory.profiles)
}

export const getOutboxJobs = (profileId: string | undefined): OutboxJob[] => {
  if (!profileId) return EMPTY_JOBS
  return memory.outbox[profileId] ?? EMPTY_JOBS
}

export const setOutboxJobs = async (profileId: string, jobs: OutboxJob[]) => {
  memory.outbox = { ...memory.outbox, [profileId]: jobs }
  emit()
  await persistOutbox()
}

export const getProfileCache = (profileId: string | undefined): ProfileDocketCache => {
  if (!profileId) return emptyProfileCache()
  return memory.cache[profileId] ?? emptyProfileCache()
}

export const setProfileCache = async (profileId: string, cache: ProfileDocketCache) => {
  memory.cache = { ...memory.cache, [profileId]: cache }
  emit()
  await persistCache()
}

export const getCachedProfile = (userId: string | undefined): Profile | null => {
  if (!userId) return null
  return memory.profiles[userId] ?? null
}

export const setCachedProfile = async (userId: string, profile: Profile) => {
  memory.profiles = { ...memory.profiles, [userId]: profile }
  await persistProfiles()
}

export const clearOfflineForProfile = async (profileId: string) => {
  const nextOutbox = { ...memory.outbox }
  const nextCache = { ...memory.cache }
  const nextProfiles = { ...memory.profiles }
  delete nextOutbox[profileId]
  delete nextCache[profileId]
  delete nextProfiles[profileId]
  memory.outbox = nextOutbox
  memory.cache = nextCache
  memory.profiles = nextProfiles
  emit()
  await Promise.all([persistOutbox(), persistCache(), persistProfiles()])
}

export const isOfflineStoreHydrated = () => memory.hydrated
