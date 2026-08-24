import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/query-client";
import {
  logisticsDiffer,
  logisticsFromGoogle,
  shouldIgnoreUnlinkedGoogleEvent,
  toGoogleEvent,
  type DocketLogistics,
  type GoogleEventLike,
} from "@/lib/google-calendar/map-event";
import {
  createGoogleEvent,
  ensureDedicatedCalendarId,
  listGoogleChanges,
  updateGoogleEvent,
} from "@/lib/google-calendar/api";
import { appOrigin } from "@/lib/google-calendar/platform";
import {
  clearGoogleCalendarState,
  isGoogleConnected,
  loadGoogleCalendarState,
  saveGoogleCalendarState,
} from "@/lib/google-calendar/storage";

export type CalendarLinkRow = {
  docket_event_id: string;
  profile_id: string;
  provider: string;
  external_calendar_id: string;
  external_event_id: string;
  etag: string | null;
  synced_at: string | null;
};

export type CalendarSyncDeps = {
  google: {
    ensureCalendar: (existingId: string | null) => Promise<string>;
    createEvent: (
      calendarId: string,
      body: ReturnType<typeof toGoogleEvent>,
    ) => Promise<{ id: string; etag?: string }>;
    updateEvent: (
      calendarId: string,
      eventId: string,
      body: ReturnType<typeof toGoogleEvent>,
    ) => Promise<{ id: string; etag?: string }>;
    listChanges: (
      calendarId: string,
      syncToken?: string | null,
    ) => Promise<{ items?: GoogleEventLike[]; nextSyncToken?: string }>;
  };
  links: {
    get: (profileId: string, eventId: string) => Promise<CalendarLinkRow | null>;
    getByExternal: (externalEventId: string) => Promise<CalendarLinkRow | null>;
    upsert: (row: Omit<CalendarLinkRow, "synced_at"> & { synced_at?: string | null }) => Promise<void>;
  };
  docket: {
    loadLogistics: (eventId: string, origin: string) => Promise<DocketLogistics | null>;
    listWindow: (from: string, to: string, origin: string) => Promise<DocketLogistics[]>;
    updateLogistics: (
      eventId: string,
      values: { scheduled_date: string; scheduled_time: string | null; location: string | null },
    ) => Promise<void>;
  };
  now?: () => string;
};

export const uniqueLinkKey = (profileId: string, eventId: string, provider: string) =>
  `${profileId}::${eventId}::${provider}`;

export const assertUniqueLinkRows = (rows: Array<{ profile_id: string; docket_event_id: string; provider: string }>) => {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = uniqueLinkKey(row.profile_id, row.docket_event_id, row.provider);
    if (seen.has(key)) {
      throw new Error(`Duplicate calendar link for ${key}`);
    }
    seen.add(key);
  }
};

export const pushOneEvent = async (
  deps: CalendarSyncDeps,
  input: { profileId: string; eventId: string; calendarId: string; origin: string },
) => {
  const row = await deps.docket.loadLogistics(input.eventId, input.origin);
  if (!row) return { skipped: true as const };
  const body = toGoogleEvent(row);
  const existing = await deps.links.get(input.profileId, input.eventId);
  const syncedAt = (deps.now ?? (() => new Date().toISOString()))();
  if (!existing) {
    const created = await deps.google.createEvent(input.calendarId, body);
    await deps.links.upsert({
      docket_event_id: input.eventId,
      profile_id: input.profileId,
      provider: "google",
      external_calendar_id: input.calendarId,
      external_event_id: created.id,
      etag: created.etag ?? null,
      synced_at: syncedAt,
    });
    return { created: true as const, externalEventId: created.id };
  }
  const updated = await deps.google.updateEvent(input.calendarId, existing.external_event_id, body);
  await deps.links.upsert({
    ...existing,
    etag: updated.etag ?? existing.etag,
    synced_at: syncedAt,
  });
  return { updated: true as const, externalEventId: existing.external_event_id };
};

export const applyGooglePullItem = async (
  deps: CalendarSyncDeps,
  item: GoogleEventLike,
) => {
  if (!item.id) return { ignored: true as const, reason: "no-id" };
  const link = await deps.links.getByExternal(item.id);
  if (shouldIgnoreUnlinkedGoogleEvent(Boolean(link)) || !link) {
    return { ignored: true as const, reason: "unlinked" };
  }
  const pulled = logisticsFromGoogle(item);
  if (!pulled) return { ignored: true as const, reason: "no-start" };
  const local = await deps.docket.loadLogistics(link.docket_event_id, "");
  if (!local) return { ignored: true as const, reason: "missing-local" };
  if (!logisticsDiffer(local, pulled)) return { unchanged: true as const };
  await deps.docket.updateLogistics(link.docket_event_id, pulled);
  return { updated: true as const, eventId: link.docket_event_id };
};

export const pullChanges = async (deps: CalendarSyncDeps, calendarId: string, syncToken: string | null) => {
  const page = await deps.google.listChanges(calendarId, syncToken);
  const results = [];
  for (const item of page.items ?? []) {
    results.push(await applyGooglePullItem(deps, item));
  }
  return { results, nextSyncToken: page.nextSyncToken ?? syncToken };
};

export const runFullSync = async (
  deps: CalendarSyncDeps,
  input: {
    profileId: string;
    origin: string;
    calendarId: string | null;
    syncToken: string | null;
    from: string;
    to: string;
  },
) => {
  const calendarId = await deps.google.ensureCalendar(input.calendarId);
  const pulled = await pullChanges(deps, calendarId, input.syncToken);
  const windowEvents = await deps.docket.listWindow(input.from, input.to, input.origin);
  for (const event of windowEvents) {
    await pushOneEvent(deps, {
      profileId: input.profileId,
      eventId: event.id,
      calendarId,
      origin: input.origin,
    });
  }
  return { calendarId, nextSyncToken: pulled.nextSyncToken };
};

/**
 * Docket insert/update already succeeded. Google failures must not
 * surface as a failed legal-record save.
 */
export const pushAfterLocalSave = async <T>(saved: T, push: (row: T) => Promise<unknown>) => {
  try {
    await push(saved);
    return { saved, synced: true as const };
  } catch {
    return { saved, synced: false as const };
  }
};

const currentUserId = async () => {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
};

const asMatter = (value: unknown): { case_number: string; matter_title: string } | null => {
  if (!value || typeof value !== "object") return null;
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const rec = row as { case_number?: string; matter_title?: string };
  if (!rec.case_number || !rec.matter_title) return null;
  return { case_number: rec.case_number, matter_title: rec.matter_title };
};

const liveDeps = (): CalendarSyncDeps => ({
  google: {
    ensureCalendar: ensureDedicatedCalendarId,
    createEvent: createGoogleEvent,
    updateEvent: updateGoogleEvent,
    listChanges: listGoogleChanges,
  },
  links: {
    get: async (profileId, eventId) => {
      const { data, error } = await supabase
        .from("docket_event_calendar_links")
        .select("*")
        .eq("profile_id", profileId)
        .eq("docket_event_id", eventId)
        .eq("provider", "google")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    getByExternal: async (externalEventId) => {
      const { data, error } = await supabase
        .from("docket_event_calendar_links")
        .select("*")
        .eq("provider", "google")
        .eq("external_event_id", externalEventId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    upsert: async (row) => {
      const { error } = await supabase.from("docket_event_calendar_links").upsert(
        {
          docket_event_id: row.docket_event_id,
          profile_id: row.profile_id,
          provider: "google",
          external_calendar_id: row.external_calendar_id,
          external_event_id: row.external_event_id,
          etag: row.etag,
          synced_at: row.synced_at ?? new Date().toISOString(),
        },
        { onConflict: "profile_id,docket_event_id,provider" },
      );
      if (error) throw error;
    },
  },
  docket: {
    loadLogistics: async (eventId, origin) => {
      const { data, error } = await supabase
        .from("docket_events")
        .select(
          "id, docket_matter_id, scheduled_date, scheduled_time, location, event_type, event_status, docket_matters(case_number, matter_title)",
        )
        .eq("id", eventId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const matter = asMatter(data.docket_matters);
      return {
        id: data.id,
        docket_matter_id: data.docket_matter_id,
        scheduled_date: data.scheduled_date,
        scheduled_time: data.scheduled_time,
        location: data.location,
        event_type: data.event_type,
        event_status: data.event_status,
        case_number: matter?.case_number ?? "Matter",
        matter_title: matter?.matter_title ?? "Hearing",
        appOrigin: origin,
      };
    },
    listWindow: async (from, to, origin) => {
      const { data, error } = await supabase
        .from("docket_events")
        .select(
          "id, docket_matter_id, scheduled_date, scheduled_time, location, event_type, event_status, docket_matters(case_number, matter_title)",
        )
        .gte("scheduled_date", from)
        .lte("scheduled_date", to);
      if (error) throw error;
      return (data ?? []).map((row) => {
        const matter = asMatter(row.docket_matters);
        return {
          id: row.id,
          docket_matter_id: row.docket_matter_id,
          scheduled_date: row.scheduled_date,
          scheduled_time: row.scheduled_time,
          location: row.location,
          event_type: row.event_type,
          event_status: row.event_status,
          case_number: matter?.case_number ?? "Matter",
          matter_title: matter?.matter_title ?? "Hearing",
          appOrigin: origin,
        };
      });
    },
    updateLogistics: async (eventId, values) => {
      const { error } = await supabase
        .from("docket_events")
        .update({
          scheduled_date: values.scheduled_date,
          scheduled_time: values.scheduled_time,
          location: values.location,
        })
        .eq("id", eventId);
      if (error) throw error;
    },
  },
});

const windowBounds = () => {
  const now = new Date();
  const from = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const to = new Date(now.getFullYear() + 2, now.getMonth() + 1, 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: iso(from), to: iso(to) };
};

export const isCalendarSyncConfigured = async () => {
  const state = await loadGoogleCalendarState();
  return isGoogleConnected(state);
};

export const syncDocketEventToGoogle = async (eventId: string) => {
  const state = await loadGoogleCalendarState();
  if (!isGoogleConnected(state)) return { skipped: true as const };
  const profileId = await currentUserId();
  if (!profileId) return { skipped: true as const };
  const deps = liveDeps();
  const calendarId = await deps.google.ensureCalendar(state.calendarId);
  if (calendarId !== state.calendarId) {
    await saveGoogleCalendarState({ ...state, calendarId });
  }
  try {
    await pushOneEvent(deps, {
      profileId,
      eventId,
      calendarId,
      origin: appOrigin(),
    });
    return { synced: true as const };
  } catch (error) {
    console.warn("Google Calendar push failed", error);
    throw error;
  }
};

export const runGoogleCalendarSyncNow = async () => {
  const state = await loadGoogleCalendarState();
  if (!isGoogleConnected(state)) throw new Error("Google Calendar is not connected.");
  const profileId = await currentUserId();
  if (!profileId) throw new Error("You need to be signed in to sync.");
  const bounds = windowBounds();
  const result = await runFullSync(liveDeps(), {
    profileId,
    origin: appOrigin(),
    calendarId: state.calendarId,
    syncToken: state.syncToken,
    from: bounds.from,
    to: bounds.to,
  });
  await saveGoogleCalendarState({
    ...state,
    calendarId: result.calendarId,
    syncToken: result.nextSyncToken,
    lastSyncedAt: new Date().toISOString(),
  });
  void queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
  void queryClient.invalidateQueries({ queryKey: ["docket-events"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard", "upcoming-appearances"] });
  return result;
};

export const disconnectGoogleCalendar = async () => {
  await clearGoogleCalendarState();
};
