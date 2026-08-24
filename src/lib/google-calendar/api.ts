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

export const getCalendar = (calendarId: string) =>
  googleApi<{ id: string; summary?: string }>(`/calendars/${encodeURIComponent(calendarId)}`);

export const createCalendar = (summary: string) =>
  googleApi<{ id: string }>("/calendars", {
    method: "POST",
    body: JSON.stringify({ summary, timeZone: "America/Guyana" }),
  });

/**
 * Do not call calendarList. That API needs calendar.calendarlist, which we
 * do not request. calendar.calendars covers get-by-id and create.
 */
export const reuseOrCreateCalendarId = async (input: {
  existingId: string | null;
  getById: (id: string) => Promise<string | null>;
  create: () => Promise<string>;
}) => {
  if (input.existingId) {
    const id = await input.getById(input.existingId);
    if (id) return id;
  }
  return input.create();
};

export const ensureDedicatedCalendarId = async (existingId: string | null) =>
  reuseOrCreateCalendarId({
    existingId,
    getById: async (id) => {
      try {
        const calendar = await getCalendar(id);
        return calendar.id ?? null;
      } catch (error) {
        if (error instanceof GoogleCalendarHttpError && (error.status === 404 || error.status === 410)) {
          return null;
        }
        throw error;
      }
    },
    create: async () => {
      const created = await createCalendar(DEDICATED_CALENDAR_NAME);
      return created.id;
    },
  });

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
