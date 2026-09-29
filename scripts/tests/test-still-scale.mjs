/**
 * Browse tiles are 16:9 stills whose column count comes from one table
 * (TILE_COLUMNS in src/lib/browse-prefs.ts), keyed by screen width and the
 * Compact / Regular / Large tile size. The containers pass that table to
 * the CSS as custom properties, and index.css switches columns at the
 * breakpoints below. This walks every width from 360 to 1920 through the
 * same arithmetic the CSS does and checks that the setting keeps its
 * meaning and that a case number is never cut:
 *
 * - Compact never shows fewer columns than Regular, nor Regular than Large;
 * - no size's still is narrower than the size before it;
 * - no still, in a gallery or on a Home rail, is narrower than 136px;
 * - a 16-character case number fits on one line inside that floor, and
 *   the still's own case number fits on one line at every width;
 * - a title clamped at four lines keeps the parties before the colon.
 *
 *   npm run test:still-scale
 */
import { readFileSync } from "node:fs";
import {
  DEFAULT_TILE_SIZE,
  RAIL_STILL_SHARE,
  STILL_BREAKPOINTS,
  STILL_GAP_PX,
  STILL_MIN_WIDTH_PX,
  TILE_COLUMNS,
  TILE_SIZES,
  stillColumnVars,
} from "@/lib/browse-prefs";

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

// --- the preference itself is unchanged ------------------------------------

check("tile sizes keep their three steps", TILE_SIZES, ["compact", "regular", "large"]);
check("Compact stays the default", DEFAULT_TILE_SIZE, "compact");
check(
  "the table has one column count per breakpoint for every size",
  TILE_SIZES.map((s) => TILE_COLUMNS[s].length),
  TILE_SIZES.map(() => STILL_BREAKPOINTS.length),
);

// --- the CSS reads this table ----------------------------------------------

const css = readFileSync("src/index.css", "utf8");
const stillCss = css.slice(css.indexOf(".still-grid,"), css.indexOf(".still-rail > *"));
check(
  "index.css switches still columns at the table's breakpoints",
  [
    ...stillCss.matchAll(
      /@media \(min-width: (\d+)px\)[^{]*\{\s*\.still-grid,\s*\.still-rail\s*\{\s*--still-cols: var\(--still-cols-([\w-]+)\)/g,
    ),
  ].map((m) => [m[2], Number(m[1])]),
  STILL_BREAKPOINTS.slice(1).map(([name, px]) => [name, px]),
);
check(
  "below the first breakpoint the CSS uses the base column",
  /\.still-rail\s*\{\s*--still-cols: var\(--still-cols-base\)/.test(stillCss),
  true,
);
check(
  "stillColumnVars hands the CSS every column count, the gap, the floor and the rail share",
  stillColumnVars("regular"),
  {
    "--still-gap": `${STILL_GAP_PX}px`,
    "--still-min": `${STILL_MIN_WIDTH_PX}px`,
    "--still-rail-share": String(RAIL_STILL_SHARE),
    ...Object.fromEntries(
      STILL_BREAKPOINTS.map(([name], i) => [
        `--still-cols-${name}`,
        String(TILE_COLUMNS.regular[i]),
      ]),
    ),
  },
);

// --- the arithmetic the CSS does -------------------------------------------

// `.browse-gutter` is 4vw each side, so a gallery column is 92% of the width.
const content = (w) => w * 0.92;
const columns = (w, size) => {
  let i = 0;
  STILL_BREAKPOINTS.forEach(([, min], j) => {
    if (w >= min) i = j;
  });
  return TILE_COLUMNS[size][i];
};
const galleryStill = (w, size) => {
  const n = columns(w, size);
  return (content(w) - (n - 1) * STILL_GAP_PX) / n;
};
// The rail's CSS floors this at the minimum; the table must never need it.
const railStill = (w, size) => galleryStill(w, size) * RAIL_STILL_SHARE;

// A 16-character case number (the length the floor is sized for) inside the
// still's 12px edge inset. Case numbers are identifiers, set in IBM Plex Mono
// at normal tracking, a fixed 0.6em advance. The floor is sized for the
// board's planned 11.5px (110.4px); the still's kicker is 10px (96px, as
// measured in Chromium), so a case number sits on one line in every gallery
// and rail still. It never truncates at any width.
const CASE_NUMBER_CHARS = 16;
const IDENTIFIER_ADVANCE_PX = 0.6 * 11.5;
const STILL_CASE_NUMBER_PX = CASE_NUMBER_CHARS * 0.6 * 10;
// Text sits 12px in from the still's outer edge (1px border, 11px padding).
const STILL_PADDING_PX = 12;
check(
  "a 16-character case number fits on one line in a still at the 136px floor",
  CASE_NUMBER_CHARS * IDENTIFIER_ADVANCE_PX + 2 * STILL_PADDING_PX <= STILL_MIN_WIDTH_PX,
  true,
);

const inverted = [];
const narrower = [];
const underFloor = [];
for (let w = 360; w <= 1920; w++) {
  const [c, r, l] = TILE_SIZES.map((s) => columns(w, s));
  if (!(c >= r && r >= l)) inverted.push(`${w}px: ${c}/${r}/${l}`);
  const [cw, rw, lw] = TILE_SIZES.map((s) => galleryStill(w, s));
  if (!(cw <= rw && rw <= lw))
    narrower.push(`${w}px: ${cw.toFixed(1)}/${rw.toFixed(1)}/${lw.toFixed(1)}`);
  for (const s of TILE_SIZES) {
    const narrowest = Math.min(galleryStill(w, s), railStill(w, s));
    if (narrowest < STILL_MIN_WIDTH_PX) underFloor.push(`${w}px ${s}: ${narrowest.toFixed(1)}px`);
  }
}
check("360-1920px: Compact >= Regular >= Large columns at every width", inverted, []);
check("360-1920px: no size's still is narrower than the size before it", narrower, []);
const wraps = [];
for (let w = 360; w <= 1920; w++) {
  for (const s of TILE_SIZES) {
    const narrowest = Math.min(galleryStill(w, s), railStill(w, s));
    if (narrowest - 2 * STILL_PADDING_PX < STILL_CASE_NUMBER_PX) wraps.push(`${w}px ${s}`);
  }
}
check("the still's case number fits on one line in every gallery and rail still", wraps, []);
check(`360-1920px: no gallery or rail still under ${STILL_MIN_WIDTH_PX}px`, underFloor, []);

// The widths the design was approved at (board round 1), to the pixel.
const at = (w) => TILE_SIZES.map((s) => `${columns(w, s)} x ${Math.round(galleryStill(w, s))}`);
check("390px phone: 2 x 173 / 2 x 173 / 1 x 359", at(390), ["2 x 173", "2 x 173", "1 x 359"]);
check("768px tablet: 4 x 168 / 3 x 228 / 2 x 347", at(768), ["4 x 168", "3 x 228", "2 x 347"]);
check("1440px desktop: 5 x 255 / 4 x 322 / 3 x 434", at(1440), ["5 x 255", "4 x 322", "3 x 434"]);
check("1920px desktop: 6 x 284 / 5 x 344 / 4 x 433", at(1920), ["6 x 284", "5 x 344", "4 x 433"]);
check(
  "the narrowest real still is a Compact rail still on a 360px phone, 143.6px",
  +Math.min(...TILE_SIZES.map((s) => railStill(360, s))).toFixed(1),
  143.6,
);

// --- titles: a four-line clamp never cuts the parties -----------------------

// Estimate: Inter 600 at 14px averages about 0.55em a character in mixed
// case, inside the still's padding. Long real titles lose the end of the
// description after the colon, never the parties before it.
const TITLE_ADVANCE_PX = 0.55 * 14;
const TITLE_LINES = 4;
const wrapLines = (text, perLine) => {
  let lines = 1;
  let used = 0;
  for (const word of text.split(" ")) {
    if (used && used + 1 + word.length > perLine) {
      lines += 1;
      used = word.length;
    } else used += (used ? 1 : 0) + word.length;
  }
  return lines;
};
const LONG_TITLES = [
  "Police v. Leon Example: reasons for conviction on a charge of dangerous driving",
  "In the matter of a protection order: reasons for granting an interim order",
  "Sample Hardware Ltd v. Placeholder: ruling on a preliminary objection",
];
const cutParties = [];
for (let w = 360; w <= 1920; w++) {
  for (const s of TILE_SIZES) {
    const perLine = Math.floor(
      (Math.min(galleryStill(w, s), railStill(w, s)) - 2 * STILL_PADDING_PX) / TITLE_ADVANCE_PX,
    );
    for (const t of LONG_TITLES) {
      if (wrapLines(t.split(":")[0], perLine) > TITLE_LINES) cutParties.push(`${w}px ${s}: ${t}`);
    }
  }
}
check("360-1920px: the parties before the colon fit inside four title lines", cutParties, []);

if (failures) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll still-scale checks passed.");
