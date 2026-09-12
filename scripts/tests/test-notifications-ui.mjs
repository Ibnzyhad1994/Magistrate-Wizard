/**
 * Notification list presentation: relative timestamps and the tone that
 * drives colour. Both are pure functions so the rules are pinned here
 * rather than eyeballed in the browser.
 *
 *   npm run test:notifications-ui
 */
import { formatRelativeTime } from "../../src/lib/utils.ts";
import {
  NOTIFICATION_TYPES,
  notificationTone,
  notificationTypeLabel,
} from "../../src/lib/notifications.ts";
import {
  isNotificationFilterActive,
  notificationFilterKey,
} from "../../src/lib/notification-filter.ts";
import {
  NOTIFICATION_TONE_ACCENT,
  NOTIFICATION_TONE_BADGE,
} from "../../src/lib/notification-tone-classes.ts";

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

// --- relative time ----------------------------------------------------------

const now = new Date("2026-09-11T12:00:00.000Z");
const ago = (ms) => new Date(now.getTime() - ms).toISOString();
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

check("a few seconds reads as just now", formatRelativeTime(ago(5 * SEC), now), "just now");
check("44s is still just now", formatRelativeTime(ago(44 * SEC), now), "just now");
check("90s rounds to 2 minutes", formatRelativeTime(ago(90 * SEC), now), "2 minutes ago");
check("one minute is singular", formatRelativeTime(ago(60 * SEC), now), "1 minute ago");
check("59 minutes stays in minutes", formatRelativeTime(ago(59 * MIN), now), "59 minutes ago");
check("the case the user asked for", formatRelativeTime(ago(5 * HOUR), now), "5 hours ago");
check("one hour is singular", formatRelativeTime(ago(HOUR), now), "1 hour ago");
check("a day back reads as yesterday, not '1 days ago'", formatRelativeTime(ago(DAY), now), "yesterday");
check("three days", formatRelativeTime(ago(3 * DAY), now), "3 days ago");

// Past a week, relative stops helping — "23 days ago" is harder to place
// than a date, so it falls back to the absolute (en-GB, day-first) form.
// "Sept", not "Sep" — en-GB abbreviates September to four letters in
// modern ICU, unlike every other month. Asserting the real output rather
// than the one that looks tidier.
check("eight days falls back to an absolute date", formatRelativeTime(ago(8 * DAY), now), "3 Sept 2026");
check(
  "the fallback is day-first (Commonwealth), never month-first",
  formatRelativeTime("2026-08-19T09:00:00.000Z", now),
  "19 Aug 2026",
);

// A client clock a little ahead of the server must not print a future time.
check("a slightly future timestamp degrades to just now", formatRelativeTime(new Date(now.getTime() + 20 * SEC), now), "just now");
check("an unparseable date yields empty, never 'Invalid Date'", formatRelativeTime("not-a-date", now), "");

// --- tone -------------------------------------------------------------------

check("a clerk request is waiting on you", notificationTone("clerk_request"), "action");
check("a court request is waiting on you", notificationTone("court_request"), "action");
check("tomorrow's hearing is waiting on you", notificationTone("hearing_tomorrow"), "action");
check("a share you gained reads as granted", notificationTone("share_granted"), "granted");
check("a court assignment reads as granted", notificationTone("court_assigned"), "granted");
check("a revoked share reads as revoked", notificationTone("share_revoked"), "revoked");

// "Decided" covers both approval and refusal, so it must stay neutral —
// colouring it green or red would assert a result the type doesn't carry.
check("a decided clerk request stays neutral", notificationTone("clerk_request_decided"), "outcome");
check("a decided court request stays neutral", notificationTone("court_request_decided"), "outcome");

check(
  "an unknown type falls back to neutral rather than throwing",
  notificationTone("something_new_we_added_later"),
  "outcome",
);

// Every declared type must resolve to one of the four tones, so adding a
// type to NOTIFICATION_TYPES can't silently land without a colour.
const TONES = ["action", "granted", "revoked", "outcome"];
check(
  "every notification type maps to a known tone",
  NOTIFICATION_TYPES.filter((t) => !TONES.includes(notificationTone(t))),
  [],
);
check(
  "every notification type has a real label, not the generic fallback",
  NOTIFICATION_TYPES.filter((t) => notificationTypeLabel(t) === "Notice"),
  [],
);


// --- filter cache keys ------------------------------------------------------
// Two chip orders that select the same notices must share one cache entry,
// or toggling chips off and on in a different order silently refetches rows
// already in hand.

check(
  "type order does not change the key",
  notificationFilterKey({ types: ["court_request", "clerk_request"] }),
  notificationFilterKey({ types: ["clerk_request", "court_request"] }),
);
check(
  "an omitted filter and an explicitly empty one are the same key",
  notificationFilterKey(undefined),
  notificationFilterKey({ types: [] }),
);
check(
  "unreadOnly defaults to false rather than undefined, so the key is stable",
  notificationFilterKey(undefined),
  { unreadOnly: false, types: [] },
);
check(
  "unreadOnly genuinely changes the key",
  notificationFilterKey({ unreadOnly: true }).unreadOnly !==
    notificationFilterKey({ unreadOnly: false }).unreadOnly,
  true,
);
check(
  "the key does not alias different type sets together",
  notificationFilterKey({ types: ["clerk_request"] }).types,
  ["clerk_request"],
);
// Callers pass state arrays straight in; normalizing must not sort in place.
{
  const caller = ["court_request", "clerk_request"];
  notificationFilterKey({ types: caller });
  check("normalizing does not mutate the caller's array", caller, ["court_request", "clerk_request"]);
}

check("no filter is not active", isNotificationFilterActive(undefined), false);
check("unread-only is active", isNotificationFilterActive({ unreadOnly: true }), true);
check("a chosen type is active", isNotificationFilterActive({ types: ["clerk_request"] }), true);
check("an empty type list is not active", isNotificationFilterActive({ types: [] }), false);

// --- tone classes -----------------------------------------------------------
// The bell peek and the full list read from these same maps, so a tone
// without an entry renders with no colour in one place and not the other.
// Reuses the TONES list declared above, so the two sections cannot disagree
// about what the full set of tones is.

check(
  "every tone has an accent class",
  TONES.filter((t) => !NOTIFICATION_TONE_ACCENT[t]),
  [],
);
check(
  "every tone has a badge class",
  TONES.filter((t) => !NOTIFICATION_TONE_BADGE[t]),
  [],
);
check(
  "tone classes go through theme tokens, not literal colours",
  TONES.filter(
    (t) =>
      !NOTIFICATION_TONE_ACCENT[t].includes("var(--notice-") ||
      !NOTIFICATION_TONE_BADGE[t].includes("var(--notice-"),
  ),
  [],
);
check(
  "every notification type resolves to a tone that has classes",
  NOTIFICATION_TYPES.filter((type) => !NOTIFICATION_TONE_ACCENT[notificationTone(type)]),
  [],
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
