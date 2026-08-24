import {
  addCalendarDays,
  logisticsFromGoogle,
  shouldIgnoreUnlinkedGoogleEvent,
  toGoogleEvent,
} from "../../src/lib/google-calendar/map-event.ts";

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

const base = {
  id: "evt-1",
  docket_matter_id: "mat-1",
  scheduled_date: "2026-08-24",
  scheduled_time: null,
  location: "Georgetown Court 1",
  event_type: "trial",
  event_status: "scheduled",
  case_number: "2026/MAG/12",
  matter_title: "Police v. Doe",
  appOrigin: "http://127.0.0.1:5373",
};

const allDay = toGoogleEvent(base);
check("all-day start is date-only", allDay.start, { date: "2026-08-24" });
check("all-day end is next calendar day", allDay.end, { date: "2026-08-25" });
check("all-day does not invent a time", allDay.start.dateTime, undefined);

const timed = toGoogleEvent({ ...base, scheduled_time: "14:30" });
check(
  "timed start uses Guyana offset, not UTC",
  timed.start,
  { dateTime: "2026-08-24T14:30:00-04:00", timeZone: "America/Guyana" },
);
check(
  "timed end is one hour later in Guyana",
  timed.end,
  { dateTime: "2026-08-24T15:30:00-04:00", timeZone: "America/Guyana" },
);

const late = toGoogleEvent({ ...base, scheduled_time: "23:30:00" });
check(
  "late sitting does not roll the calendar date via UTC",
  late.start.dateTime.startsWith("2026-08-24T23:30:00"),
  true,
);
check("late sitting end is next local day", late.end.dateTime, "2026-08-25T00:30:00-04:00");

check("cancelled maps to Google cancelled", toGoogleEvent({ ...base, event_status: "cancelled" }).status, "cancelled");
check(
  "entered_in_error maps to Google cancelled",
  toGoogleEvent({ ...base, event_status: "entered_in_error" }).status,
  "cancelled",
);

check("description has type and deep link, not notes", allDay.description.includes("trial"), true);
check("description has matter deep link", allDay.description.includes("/docket/mat-1?tab=events"), true);
check("description omits orders/PII notes", allDay.description.includes("secret"), false);

const pulledAllDay = logisticsFromGoogle({
  start: { date: "2026-08-26" },
  location: "Court 2",
  description: "IGNORE THIS — contains orders and notes",
  attendees: [{ email: "party@example.com" }],
  summary: "Should not become the matter title",
});
check("pull all-day keeps date-only and null time", pulledAllDay, {
  scheduled_date: "2026-08-26",
  scheduled_time: null,
  location: "Court 2",
});

const pulledTimed = logisticsFromGoogle({
  start: { dateTime: "2026-08-24T09:15:00-04:00", timeZone: "America/Guyana" },
  description: "orders made: ignore",
});
check("pull timed uses the clock in the string, not UTC conversion", pulledTimed, {
  scheduled_date: "2026-08-24",
  scheduled_time: "09:15:00",
  location: null,
});

const eveningUtcTrap = logisticsFromGoogle({
  start: { dateTime: "2026-08-24T22:00:00-04:00" },
});
check(
  "Guyana evening does not become the next UTC date",
  eveningUtcTrap.scheduled_date,
  "2026-08-24",
);

check("unlinked Google events are ignored", shouldIgnoreUnlinkedGoogleEvent(false), true);
check("linked Google events are eligible", shouldIgnoreUnlinkedGoogleEvent(true), false);
check("addCalendarDays stays local", addCalendarDays("2026-08-31", 1), "2026-09-01");

if (failures > 0) {
  console.error(`${failures} calendar map checks failed`);
  process.exit(1);
}
console.log("All calendar map checks passed");
