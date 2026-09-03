import {
  isRememberExpired,
  rememberUntilFrom,
  REMEMBER_MS,
} from "@/lib/auth/session-policy"

export const AUTH_STORAGE_KEY = "magistrate-wizard-auth"
export const REMEMBER_PREFERENCE_KEY = "magistrate-wizard-remember-me"

export type SyncStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export type RememberPreference = {
  rememberMe: boolean
  rememberUntil: number | null
}

export const EMPTY_REMEMBER_PREFERENCE: RememberPreference = {
  rememberMe: false,
  rememberUntil: null,
}

export function createMemoryStorage(): SyncStorage {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
  }
}

function browserLocal(): SyncStorage | null {
  try {
    if (typeof localStorage === "undefined") return null
    return localStorage
  } catch {
    return null
  }
}

function browserSession(): SyncStorage | null {
  try {
    if (typeof sessionStorage === "undefined") return null
    return sessionStorage
  } catch {
    return null
  }
}

export function readRememberPreference(local: SyncStorage): RememberPreference {
  const raw = local.getItem(REMEMBER_PREFERENCE_KEY)
  if (!raw) return { ...EMPTY_REMEMBER_PREFERENCE }
  try {
    const parsed = JSON.parse(raw) as Partial<RememberPreference>
    return {
      rememberMe: parsed.rememberMe === true,
      rememberUntil:
        typeof parsed.rememberUntil === "number" ? parsed.rememberUntil : null,
    }
  } catch {
    return { ...EMPTY_REMEMBER_PREFERENCE }
  }
}

export function writeRememberPreference(
  local: SyncStorage,
  pref: RememberPreference,
): void {
  local.setItem(REMEMBER_PREFERENCE_KEY, JSON.stringify(pref))
}

export function setRememberMeFlag(
  rememberMe: boolean,
  options?: { local?: SyncStorage; now?: number; rememberMs?: number },
): void {
  const local = options?.local ?? browserLocal()
  if (!local) return
  const now = options?.now ?? Date.now()
  writeRememberPreference(local, {
    rememberMe,
    rememberUntil: rememberMe
      ? rememberUntilFrom(now, options?.rememberMs ?? REMEMBER_MS)
      : null,
  })
}

export function bumpRememberUntil(options?: {
  local?: SyncStorage
  now?: number
  rememberMs?: number
}): void {
  const local = options?.local ?? browserLocal()
  if (!local) return
  const pref = readRememberPreference(local)
  if (!pref.rememberMe) return
  writeRememberPreference(local, {
    rememberMe: true,
    rememberUntil: rememberUntilFrom(
      options?.now ?? Date.now(),
      options?.rememberMs ?? REMEMBER_MS,
    ),
  })
}

/**
 * Legacy sessions lived forever in localStorage with no Remember-me flag.
 * Move the auth blob to sessionStorage so this tab keeps working, then
 * browser close requires a fresh sign-in unless they check Remember me.
 *
 * Remember-me past `rememberUntil` drops the auth blob entirely.
 */
export function prepareAuthStorage(options: {
  local: SyncStorage
  session: SyncStorage
  now?: number
}): void {
  const now = options.now ?? Date.now()
  const prefRaw = options.local.getItem(REMEMBER_PREFERENCE_KEY)
  if (!prefRaw) {
    const auth = options.local.getItem(AUTH_STORAGE_KEY)
    if (auth && !options.session.getItem(AUTH_STORAGE_KEY)) {
      options.session.setItem(AUTH_STORAGE_KEY, auth)
    }
    options.local.removeItem(AUTH_STORAGE_KEY)
    writeRememberPreference(options.local, EMPTY_REMEMBER_PREFERENCE)
    return
  }

  const pref = readRememberPreference(options.local)
  if (pref.rememberMe && isRememberExpired(pref.rememberUntil, now)) {
    options.local.removeItem(AUTH_STORAGE_KEY)
    options.session.removeItem(AUTH_STORAGE_KEY)
    writeRememberPreference(options.local, EMPTY_REMEMBER_PREFERENCE)
  }
}

export function createAuthStorage(options?: {
  local?: SyncStorage
  session?: SyncStorage
  now?: () => number
}): {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
} {
  const local = options?.local ?? browserLocal() ?? createMemoryStorage()
  const session = options?.session ?? browserSession() ?? createMemoryStorage()
  prepareAuthStorage({
    local,
    session,
    now: options?.now?.() ?? Date.now(),
  })

  return {
    getItem: (key) => {
      const pref = readRememberPreference(local)
      if (pref.rememberMe) return local.getItem(key)
      return session.getItem(key)
    },
    setItem: (key, value) => {
      const pref = readRememberPreference(local)
      if (pref.rememberMe) {
        local.setItem(key, value)
        session.removeItem(key)
      } else {
        session.setItem(key, value)
        local.removeItem(key)
      }
    },
    removeItem: (key) => {
      local.removeItem(key)
      session.removeItem(key)
    },
  }
}
