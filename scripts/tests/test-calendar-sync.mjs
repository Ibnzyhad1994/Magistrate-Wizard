import {
  applyGooglePullItem,
  assertUniqueLinkRows,
  pushAfterLocalSave,
  pushOneEvent,
  uniqueLinkKey,
} from "../../src/lib/google-calendar/sync.ts";
import { toGoogleEvent } from "../../src/lib/google-calendar/map-event.ts";

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
}

const hearing = {
  id: "evt-1",
  docket_matter_id: "mat-1",
  scheduled_date: "2026-08-24",
  scheduled_time: "10:00:00",
  location: "Court 1",
  event_type: "mention",
  event_status: "scheduled",
  case_number: "2026/MAG/1",
  matter_title: "Police v. Test",
  appOrigin: "http://127.0.0.1:5373",
};

const makeDeps = ({ googleDown = false, existingLink = null } = {}) => {
  const created = [];
  const updated = [];
  const logisticsUpdates = [];
  const links = existingLink ? [existingLink] : [];
  return {
    created,
    updated,
    logisticsUpdates,
    links,
    deps: {
      google: {
        ensureCalendar: async () => "cal-mw",
        createEvent: async (_calendarId, body) => {
          if (googleDown) throw new Error("Google unreachable");
          created.push(body);
          return { id: "gcal-1", etag: "etag-1" };
        },
        updateEvent: async (_calendarId, eventId, body) => {
          if (googleDown) throw new Error("Google unreachable");
          updated.push({ eventId, body });
          return { id: eventId, etag: "etag-2" };
        },
        listChanges: async () => ({ items: [], nextSyncToken: "tok-2" }),
      },
      links: {
        get: async (profileId, eventId) =>
          links.find((row) => row.profile_id === profileId && row.docket_event_id === eventId) ?? null,
        getByExternal: async (externalEventId) =>
          links.find((row) => row.external_event_id === externalEventId) ?? null,
        upsert: async (row) => {
          const idx = links.findIndex(
            (item) =>
              item.profile_id === row.profile_id &&
              item.docket_event_id === row.docket_event_id &&
              item.provider === row.provider,
          );
          if (idx >= 0) links[idx] = { ...links[idx], ...row };
          else links.push({ ...row });
        },
      },
      docket: {
        loadLogistics: async (eventId) => (eventId === hearing.id ? hearing : null),
        listWindow: async () => [hearing],
        updateLogistics: async (eventId, values) => {
          logisticsUpdates.push({ eventId, values });
        },
      },
      now: () => "2026-08-24T14:00:00.000Z",
    },
  };
};

const createdRun = makeDeps();
const createdResult = await pushOneEvent(createdRun.deps, {
  profileId: "user-1",
  eventId: hearing.id,
  calendarId: "cal-mw",
  origin: hearing.appOrigin,
});
check("push create returns Google id", createdResult.externalEventId, "gcal-1");
check("push create wrote one Google event", createdRun.created.length, 1);
check("push title is case number + matter", createdRun.created[0].summary, "2026/MAG/1 — Police v. Test");
check("unique link row stored", createdRun.links.length, 1);
check(
  "link unique key",
  uniqueLinkKey(createdRun.links[0].profile_id, createdRun.links[0].docket_event_id, createdRun.links[0].provider),
  "user-1::evt-1::google",
);

const updateRun = makeDeps({
  existingLink: {
    docket_event_id: "evt-1",
    profile_id: "user-1",
    provider: "google",
    external_calendar_id: "cal-mw",
    external_event_id: "gcal-1",
    etag: "etag-1",
    synced_at: "2026-08-01T00:00:00.000Z",
  },
});
const updatedResult = await pushOneEvent(updateRun.deps, {
  profileId: "user-1",
  eventId: hearing.id,
  calendarId: "cal-mw",
  origin: hearing.appOrigin,
});
check("push update patches existing Google event", updatedResult.updated, true);
check("push update did not create a second Google event", updateRun.created.length, 0);
check("push update called Google once", updateRun.updated.length, 1);

assertUniqueLinkRows(createdRun.links);
try {
  assertUniqueLinkRows([createdRun.links[0], createdRun.links[0]]);
  check("duplicate link rows are rejected", true, false);
} catch {
  check("duplicate link rows are rejected", true, true);
}

const pullRun = makeDeps({
  existingLink: {
    docket_event_id: "evt-1",
    profile_id: "user-1",
    provider: "google",
    external_calendar_id: "cal-mw",
    external_event_id: "gcal-1",
    etag: "etag-1",
    synced_at: null,
  },
});
const pulled = await applyGooglePullItem(pullRun.deps, {
  id: "gcal-1",
  start: { dateTime: "2026-08-25T11:00:00-04:00" },
  location: "Court 3",
  description: "Do not copy notes or orders into Docket",
  attendees: [{ email: "witness@example.com" }],
});
check("pull reschedule updates logistics", pulled.updated, true);
check("pull writes only date/time/location", pullRun.logisticsUpdates, [
  {
    eventId: "evt-1",
    values: { scheduled_date: "2026-08-25", scheduled_time: "11:00:00", location: "Court 3" },
  },
]);

const ignored = await applyGooglePullItem(pullRun.deps, {
  id: "random-google-event",
  start: { date: "2026-09-01" },
  summary: "Birthday",
});
check("random Google events never become docket_events", ignored.reason, "unlinked");
check("random Google events do not write Docket", pullRun.logisticsUpdates.length, 1);

const down = makeDeps({ googleDown: true });
const localInsert = { id: "evt-1" };
const result = await pushAfterLocalSave(localInsert, async () => {
  await down.deps.google.createEvent("cal-mw", toGoogleEvent(hearing));
});
check("Google down does not block docket insert", result.saved, localInsert);
check("Google down reports unsynced", result.synced, false);

if (failures > 0) {
  console.error(`${failures} calendar sync checks failed`);
  process.exit(1);
}
console.log("All calendar sync checks passed");
