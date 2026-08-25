/**
 * Device-local string/JSON storage. Capacitor Preferences on native;
 * localStorage on web/Electron; in-memory when both are unavailable.
 */

const memory = new Map<string, string | null>()

type DevicePreferences = {
  get: (options: { key: string }) => Promise<{ value: string | null }>
  set: (options: { key: string; value: string }) => Promise<void>
  remove: (options: { key: string }) => Promise<void>
}

const preferencesAdapter = async (): Promise<DevicePreferences | null> => {
  try {
    const native = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    if (!native?.isNativePlatform?.()) return null
    const { Preferences } = await import("@capacitor/preferences")
    // Wrap plugin methods. Returning the plugin object from an async function
    // calls Preferences.then() (Capacitor thenable trap) and throws on Android.
    return {
      get: (options) => Preferences.get(options),
      set: (options) => Preferences.set(options),
      remove: (options) => Preferences.remove(options),
    }
  } catch {
    return null
  }
}

export const loadDeviceValue = async (key: string): Promise<string | null> => {
  const prefs = await preferencesAdapter()
  if (prefs) {
    const { value } = await prefs.get({ key })
    return value ?? null
  }
  try {
    if (typeof localStorage === "undefined") return memory.get(key) ?? null
    return localStorage.getItem(key)
  } catch {
    return memory.get(key) ?? null
  }
}

export const saveDeviceValue = async (key: string, value: string): Promise<void> => {
  memory.set(key, value)
  const prefs = await preferencesAdapter()
  if (prefs) {
    await prefs.set({ key, value })
    return
  }
  try {
    if (typeof localStorage === "undefined") return
    localStorage.setItem(key, value)
  } catch {
    /* private mode */
  }
}

export const removeDeviceValue = async (key: string): Promise<void> => {
  memory.set(key, null)
  const prefs = await preferencesAdapter()
  if (prefs) {
    await prefs.remove({ key })
    return
  }
  try {
    if (typeof localStorage === "undefined") return
    localStorage.removeItem(key)
  } catch {
    /* private mode */
  }
}

export const loadDeviceJson = async <T>(key: string): Promise<T | null> => {
  const raw = await loadDeviceValue(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export const saveDeviceJson = async (key: string, value: unknown): Promise<void> => {
  await saveDeviceValue(key, JSON.stringify(value))
}
