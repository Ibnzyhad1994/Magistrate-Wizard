/**
 * Device-local string/JSON storage. Capacitor Preferences on native;
 * localStorage on web/Electron; in-memory when both are unavailable.
 */

const memory = new Map<string, string | null>();

/**
 * A write that did not persist because the device store is full.
 *
 * Distinguished from "storage is unavailable" (private mode, blocked
 * cookies) because the consequences differ: unavailable has always been
 * expected and the in-memory map is the whole story, whereas full means
 * the caller believed it saved something it did not. Queued offline work
 * survives the current session either way, but not a reload.
 */
export class DeviceStorageQuotaError extends Error {
  // Declared and assigned rather than a constructor parameter property:
  // the test scripts run through Node's strip-only type removal, which
  // rejects `constructor(readonly key: string)`.
  key: string;

  constructor(key: string) {
    super(`Device storage is full; "${key}" was not persisted.`);
    this.name = "DeviceStorageQuotaError";
    this.key = key;
  }
}

/**
 * Browsers disagree on how a full store is reported: a modern
 * `QuotaExceededError`, Firefox's legacy `NS_ERROR_DOM_QUOTA_REACHED`, or
 * only a numeric code (22 standard, 1014 Firefox).
 */
const isQuotaExceeded = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
  return code === 22 || code === 1014;
};

type DevicePreferences = {
  get: (options: { key: string }) => Promise<{ value: string | null }>;
  set: (options: { key: string; value: string }) => Promise<void>;
  remove: (options: { key: string }) => Promise<void>;
};

const preferencesAdapter = async (): Promise<DevicePreferences | null> => {
  try {
    const native = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (!native?.isNativePlatform?.()) return null;
    const { Preferences } = await import("@capacitor/preferences");
    // Wrap plugin methods. Returning the plugin object from an async function
    // calls Preferences.then() (Capacitor thenable trap) and throws on Android.
    return {
      get: (options) => Preferences.get(options),
      set: (options) => Preferences.set(options),
      remove: (options) => Preferences.remove(options),
    };
  } catch {
    return null;
  }
};

export const loadDeviceValue = async (key: string): Promise<string | null> => {
  const prefs = await preferencesAdapter();
  if (prefs) {
    const { value } = await prefs.get({ key });
    return value ?? null;
  }
  try {
    if (typeof localStorage === "undefined") return memory.get(key) ?? null;
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
};

export const saveDeviceValue = async (key: string, value: string): Promise<void> => {
  memory.set(key, value);
  const prefs = await preferencesAdapter();
  if (prefs) {
    await prefs.set({ key, value });
    return;
  }
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch (error) {
    // A full store is a real failure the caller has to know about: it
    // believed this was saved. Anything else (private mode, blocked
    // storage) keeps the long-standing silent fall back to `memory`.
    if (isQuotaExceeded(error)) throw new DeviceStorageQuotaError(key);
  }
};

export const removeDeviceValue = async (key: string): Promise<void> => {
  memory.set(key, null);
  const prefs = await preferencesAdapter();
  if (prefs) {
    await prefs.remove({ key });
    return;
  }
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(key);
  } catch {
    /* private mode */
  }
};

export const loadDeviceJson = async <T>(key: string): Promise<T | null> => {
  const raw = await loadDeviceValue(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const saveDeviceJson = async (key: string, value: unknown): Promise<void> => {
  await saveDeviceValue(key, JSON.stringify(value));
};
