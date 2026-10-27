/**
 * A matter page states its status once.
 *
 * It used to say it three times: an ACTIVE badge in the header, an Active
 * pill in the action row and the Active select on Overview. The one that
 * stays is the Overview status row: the editable select where the user can
 * edit, otherwise a single read-only badge.
 *
 *   npm run test:matter-status
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/pages/docket/docket-matter-detail-page.tsx", "utf8");
assert.doesNotMatch(page, /matter\.status/, "the page chrome does not render the status");
assert.doesNotMatch(page, /statusBadgeVariant/, "no status badge in the header or action row");
assert.match(
  page,
  /badges=\{isBinned \? \["In the bin"\] : undefined\}/,
  'the header keeps only "In the bin"',
);

const overview = readFileSync("src/pages/docket/sections/overview-section.tsx", "utf8");
const count = (re) => (overview.match(re) ?? []).length;
assert.equal(count(/aria-label="Matter status"/g), 1, "one editable status select");
assert.equal(
  count(/<Badge variant=\{statusBadgeVariant\(matter\.status\)\}>/g),
  1,
  "one read-only status badge",
);
assert.match(
  overview,
  /\{liveEdit \? \(\s*<Select\s+value=\{matter\.status\}[\s\S]*?<\/Select>\s*\) : \(\s*<Badge variant=\{statusBadgeVariant\(matter\.status\)\}>/,
  "the select and the badge are alternatives, never both",
);

console.log("ALL PASS");
