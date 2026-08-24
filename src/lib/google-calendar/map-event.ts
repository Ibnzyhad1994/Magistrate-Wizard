/** Court sittings are recorded in Guyana local time (no DST). */
export const COURT_TIME_ZONE = "America/Guyana";
export const COURT_UTC_OFFSET = "-04:00";
export const DEDICATED_CALENDAR_NAME = "Magistrate Wizard";
export const GOOGLE_PROVIDER = "google";

export type DocketLogistics = {
  id: string;
  docket_matter_id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  location: string | null;
  event_type: string | null;
  event_status: string;
  case_number: string;
  matter_title: string;
  appOrigin: string;
};

export type GoogleDateOrDateTime = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

export type GoogleEventLike = {
  id?: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string | null;
  start?: GoogleDateOrDateTime;
  end?: GoogleDateOrDateTime;
  attendees?: unknown;
};

export type GoogleEventPayload = {
  summary: string;
  location?: string;
  description: string;
  status: "confirmed" | "cancelled";
  start: GoogleDateOrDateTime;
  end: GoogleDateOrDateTime;
};

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/;

export const isInactiveEventStatus = (status: string) =>
  status === "cancelled" || status === "entered_in_error";

export const pad2 = (n: number) => String(n).padStart(2, "0");

export const addCalendarDays = (dateOnly: string, days: number): string => {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const next = new Date(y as number, (m as number) - 1, (d as number) + days);
  return `${next.getFullYear()}-${pad2(next.getMonth() + 1)}-${pad2(next.getDate())}`;
};

const normalizeTime = (value: string): string => {
  const match = TIME_RE.exec(value.trim());
  if (!match) return "00:00:00";
  return `${pad2(Number(match[1]))}:${match[2]}:${match[3] ?? "00"}`;
};

const addOneHour = (timeHms: string): { dateOffset: number; time: string } => {
  const [h, m, s] = timeHms.split(":").map(Number);
  const total = (h as number) * 60 + (m as number) + 60;
  const dateOffset = Math.floor(total / (24 * 60));
  const mins = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(mins / 60);
  const minute = mins % 60;
  return { dateOffset, time: `${pad2(hour)}:${pad2(minute)}:${pad2(s ?? 0)}` };
};

export const docketMatterDeepLink = (appOrigin: string, matterId: string) =>
  `${appOrigin.replace(/\/$/, "")}/docket/${matterId}?tab=events`;

export const toGoogleEvent = (row: DocketLogistics): GoogleEventPayload => {
  const summary = `${row.case_number} — ${row.matter_title}`.trim();
  const typeLabel = row.event_type?.trim() || "Hearing";
  const description = `${typeLabel}\n${docketMatterDeepLink(row.appOrigin, row.docket_matter_id)}`;
  const cancelled = isInactiveEventStatus(row.event_status);
  const payload: GoogleEventPayload = {
    summary,
    description,
    status: cancelled ? "cancelled" : "confirmed",
    start: {},
    end: {},
  };
  if (row.location?.trim()) payload.location = row.location.trim();

  if (!row.scheduled_time) {
    payload.start = { date: row.scheduled_date };
    payload.end = { date: addCalendarDays(row.scheduled_date, 1) };
    return payload;
  }

  const startTime = normalizeTime(row.scheduled_time);
  const end = addOneHour(startTime);
  const endDate = end.dateOffset ? addCalendarDays(row.scheduled_date, end.dateOffset) : row.scheduled_date;
  payload.start = {
    dateTime: `${row.scheduled_date}T${startTime}${COURT_UTC_OFFSET}`,
    timeZone: COURT_TIME_ZONE,
  };
  payload.end = {
    dateTime: `${endDate}T${end.time}${COURT_UTC_OFFSET}`,
    timeZone: COURT_TIME_ZONE,
  };
  return payload;
};

export type PulledLogistics = {
  scheduled_date: string;
  scheduled_time: string | null;
  location: string | null;
};

/**
 * Google description, attendees, and summary are ignored. Only start and
 * location become docket logistics. Never invent a time for all-day events.
 */
export const logisticsFromGoogle = (event: GoogleEventLike): PulledLogistics | null => {
  const location = event.location?.trim() ? event.location.trim() : null;
  if (event.start?.date && DATE_ONLY_RE.test(event.start.date)) {
    return {
      scheduled_date: event.start.date,
      scheduled_time: null,
      location,
    };
  }
  const dateTime = event.start?.dateTime;
  if (!dateTime) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?/.exec(dateTime);
  if (!match) return null;
  return {
    scheduled_date: match[1] as string,
    scheduled_time: `${match[2]}:${match[3] ?? "00"}`,
    location,
  };
};

export const logisticsDiffer = (
  local: Pick<DocketLogistics, "scheduled_date" | "scheduled_time" | "location">,
  pulled: PulledLogistics,
) => {
  const localTime = local.scheduled_time ? normalizeTime(local.scheduled_time) : null;
  const pulledTime = pulled.scheduled_time ? normalizeTime(pulled.scheduled_time) : null;
  const localLoc = local.location?.trim() || null;
  const pulledLoc = pulled.location?.trim() || null;
  return (
    local.scheduled_date !== pulled.scheduled_date ||
    localTime !== pulledTime ||
    localLoc !== pulledLoc
  );
};

export const shouldIgnoreUnlinkedGoogleEvent = (hasLink: boolean) => !hasLink;
