export type GoogleAuthTokens = {
  access_token: string;
  refresh_token?: string;
  expiry: number;
  token_type?: string;
  scope?: string;
};

export type GoogleCalendarLocalState = {
  tokens: GoogleAuthTokens | null;
  calendarId: string | null;
  syncToken: string | null;
  lastSyncedAt: string | null;
  pkceVerifier?: string;
};

const STORAGE_KEY = "mw.google-calendar.v1";

const emptyState = (): GoogleCalendarLocalState => ({
  tokens: null,
  calendarId: null,
  syncToken: null,
  lastSyncedAt: null,
});

const memoryFallback: { current: GoogleCalendarLocalState | null } = { current: null };

const readLocalStorage = (): GoogleCalendarLocalState | null => {
  try {
    if (typeof localStorage === "undefined") return memoryFallback.current;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as GoogleCalendarLocalState;
  } catch {
    return null;
  }
};

const writeLocalStorage = (state: GoogleCalendarLocalState | null) => {
  memoryFallback.current = state;
  try {
    if (typeof localStorage === "undefined") return;
    if (!state) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode */
  }
};

const preferencesAdapter = async () => {
  try {
    const native = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (!native?.isNativePlatform?.()) return null;
    const { Preferences } = await import("@capacitor/preferences");
    return Preferences;
  } catch {
    return null;
  }
};

export const loadGoogleCalendarState = async (): Promise<GoogleCalendarLocalState> => {
  const prefs = await preferencesAdapter();
  if (prefs) {
    const { value } = await prefs.get({ key: STORAGE_KEY });
    if (!value) return emptyState();
    try {
      return JSON.parse(value) as GoogleCalendarLocalState;
    } catch {
      return emptyState();
    }
  }
  return readLocalStorage() ?? emptyState();
};

export const saveGoogleCalendarState = async (state: GoogleCalendarLocalState) => {
  const prefs = await preferencesAdapter();
  if (prefs) {
    await prefs.set({ key: STORAGE_KEY, value: JSON.stringify(state) });
    return;
  }
  writeLocalStorage(state);
};

export const clearGoogleCalendarState = async () => {
  const prefs = await preferencesAdapter();
  if (prefs) {
    await prefs.remove({ key: STORAGE_KEY });
    return;
  }
  writeLocalStorage(null);
};

export const isGoogleConnected = (state: GoogleCalendarLocalState) =>
  Boolean(state.tokens?.refresh_token || state.tokens?.access_token);
