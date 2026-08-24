import {
  loadDeviceJson,
  removeDeviceValue,
  saveDeviceJson,
} from "@/lib/device-storage"

export type GoogleAuthTokens = {
  access_token: string
  refresh_token?: string
  expiry: number
  token_type?: string
  scope?: string
}

export type GoogleCalendarLocalState = {
  tokens: GoogleAuthTokens | null
  calendarId: string | null
  syncToken: string | null
  lastSyncedAt: string | null
  pkceVerifier?: string
  oauthClientId?: string
  oauthRedirectUri?: string
}

const STORAGE_KEY = "mw.google-calendar.v1"

const emptyState = (): GoogleCalendarLocalState => ({
  tokens: null,
  calendarId: null,
  syncToken: null,
  lastSyncedAt: null,
})

export const loadGoogleCalendarState = async (): Promise<GoogleCalendarLocalState> => {
  return (await loadDeviceJson<GoogleCalendarLocalState>(STORAGE_KEY)) ?? emptyState()
}

export const saveGoogleCalendarState = async (state: GoogleCalendarLocalState) => {
  await saveDeviceJson(STORAGE_KEY, state)
}

export const clearGoogleCalendarState = async () => {
  await removeDeviceValue(STORAGE_KEY)
}

export const isGoogleConnected = (state: GoogleCalendarLocalState) =>
  Boolean(state.tokens?.refresh_token || state.tokens?.access_token)
