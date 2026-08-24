import { DEDICATED_CALENDAR_NAME, type GoogleEventLike, type GoogleEventPayload } from "@/lib/google-calendar/map-event";
import { getValidAccessToken } from "@/lib/google-calendar/oauth";

const CAL_API = "https://www.googleapis.com/calendar/v3";

export class GoogleCalendarHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const googleApi = async <T>(
  path: string,
  init: RequestInit = {},
): Promise<T> => {
  const token = await getValidAccessToken();
  if (!token) throw new Error("Google Calendar is not connected.");
  const res = await fetch(`${CAL_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new GoogleCalendarHttpError(
      res.status,
      json.error?.message ?? `Google Calendar request failed (${res.status})`,
    );
  }
  return json;
};

export const listCalendars = () =>
  googleApi<{ items?: Array<{ id: string; summary?: string }> }>("/users/me/calendarList");

export const createCalendar = (summary: string) =>
  googleApi<{ id: string }>("/calendars", {
    method: "POST",
    body: JSON.stringify({ summary, timeZone: "America/Guyana" }),
  });

export const ensureDedicatedCalendarId = async (existingId: string | null) => {
  if (existingId) return existingId;
  const list = await listCalendars();
  const found = list.items?.find((item) => item.summary === DEDICATED_CALENDAR_NAME);
  if (found?.id) return found.id;
  const created = await createCalendar(DEDICATED_CALENDAR_NAME);
  return created.id;
};

export const createGoogleEvent = (calendarId: string, body: GoogleEventPayload) =>
  googleApi<{ id: string; etag?: string; status?: string }>(
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: "POST", body: JSON.stringify(body) },
  );

export const updateGoogleEvent = (calendarId: string, eventId: string, body: GoogleEventPayload) =>
  googleApi<{ id: string; etag?: string; status?: string }>(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );

export type GoogleSyncPage = {
  items?: GoogleEventLike[];
  nextSyncToken?: string;
  nextPageToken?: string;
};

export const listGoogleChanges = (calendarId: string, syncToken?: string | null, pageToken?: string) => {
  const params = new URLSearchParams({ showDeleted: "true" });
  if (syncToken) params.set("syncToken", syncToken);
  else params.set("maxResults", "250");
  if (pageToken) params.set("pageToken", pageToken);
  return googleApi<GoogleSyncPage>(
    `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
  );
};
