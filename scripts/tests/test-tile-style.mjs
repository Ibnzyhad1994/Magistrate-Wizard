/**
 * Settings' Tile style: wide 16:9 stills (the default) or the earlier 2:3
 * posters. This checks the preference, that it survives a reload, and that
 * the posters are a maintained presentation, not a leftover path:
 *
 * - the preference has two values, stills by default, and junk or a
 *   preference saved before the setting existed falls back to stills;
 * - a chosen style is written to the saved browse preferences and read back
 *   on rehydration, as a reload does;
 * - the poster column table keeps the size setting's meaning (Compact >=
 *   Regular >= Large), never shows fewer posters than stills at a size, is
 *   two to a row on phones, and no poster, in a gallery or on a rail, is
 *   under the 136px floor;
 * - a 16-character case number fits on one line in the narrowest poster, and
 *   a three-line title keeps the parties before the colon;
 * - every word on a poster clears 4.5:1 on its scrim over any art, even pure
 *   white, in every palette;
 * - a cover photo on a poster is a small inset, never the art.
 *
 *   npm run test:tile-style
 */
import { readFileSync } from "node:fs";
import {
  COLUMNS_BY_STYLE,
  DEFAULT_TILE_STYLE,
  POSTER_COLUMNS,
  RAIL_STILL_SHARE,
  STILL_BREAKPOINTS,
  STILL_GAP_PX,
  STILL_MIN_WIDTH_PX,
  TILE_COLUMNS,
  TILE_SIZES,
  TILE_STYLES,
  TILE_STYLE_LABELS,
  isTileStyle,
  stillColumnVars,
} from "@/lib/browse-prefs";
import { POSTER_INK, POSTER_SCRIM_CLASS, POSTER_SCRIM_FADE_CLASS } from "@/lib/browse-tones";
import { LOCAL_STORAGE_KEYS } from "@/lib/constants";

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

// --- the preference ---------------------------------------------------------

check("two tile styles, stills first", TILE_STYLES, ["stills", "posters"]);
check("wide stills stay the default", DEFAULT_TILE_STYLE, "stills");
check("labels say what each style is", TILE_STYLE_LABELS, {
  stills: "Wide stills",
  posters: "Posters",
});
check(
  "only the two styles are accepted",
  ["stills", "posters", "poster", "tiles", "", null, undefined, 1].map(isTileStyle),
  [true, true, false, false, false, false, false, false],
);

// --- it survives a reload ---------------------------------------------------

// The browse preferences persist to this device's localStorage; Node has none,
// so give the store a plain one before it loads.
const saved = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key) => (saved.has(key) ? saved.get(key) : null),
    setItem: (key, value) => saved.set(key, String(value)),
    removeItem: (key) => saved.delete(key),
  },
});
globalThis.window ??= globalThis;
const { useUiStore } = await import("@/store/ui-store");
const KEY = LOCAL_STORAGE_KEYS.sidebarCollapsed;
const savedStyle = () => JSON.parse(saved.get(KEY) ?? "{}").state?.tileStyle;
// A reload: the in-memory store is back at its defaults (setState also saves,
// so it goes first), then the saved preferences are read back.
const reloadWith = async (state) => {
  useUiStore.setState({ tileStyle: DEFAULT_TILE_STYLE });
  saved.set(KEY, JSON.stringify({ state, version: 0 }));
  await useUiStore.persist.rehydrate();
  return useUiStore.getState().tileStyle;
};

check("a fresh device starts on wide stills", useUiStore.getState().tileStyle, "stills");
useUiStore.getState().setTileStyle("posters");
check("choosing Posters saves it with the browse preferences", savedStyle(), "posters");
const reloadedStyle = await reloadWith({ tileStyle: "posters", tileSize: "large" });
check(
  "a reload reads Posters back, next to the tile size",
  [reloadedStyle, useUiStore.getState().tileSize],
  ["posters", "large"],
);
check(
  "a reload with a junk style falls back to wide stills",
  await reloadWith({ tileStyle: "billboard" }),
  "stills",
);
check(
  "preferences saved before the setting existed load as wide stills",
  await reloadWith({ tileSize: "regular", browseView: "tiles" }),
  "stills",
);

// --- the poster column table ------------------------------------------------

check(
  "the poster table has one column count per breakpoint for every size",
  TILE_SIZES.map((s) => POSTER_COLUMNS[s].length),
  TILE_SIZES.map(() => STILL_BREAKPOINTS.length),
);
check("each style reads its own table", COLUMNS_BY_STYLE, {
  stills: TILE_COLUMNS,
  posters: POSTER_COLUMNS,
});
check(
  "stillColumnVars hands the CSS the poster table when posters are chosen",
  STILL_BREAKPOINTS.map(([name]) => stillColumnVars("compact", "posters")[`--still-cols-${name}`]),
  POSTER_COLUMNS.compact.map(String),
);
check(
  "stillColumnVars defaults to the stills table",
  stillColumnVars("compact"),
  stillColumnVars("compact", "stills"),
);

// The same arithmetic as test-still-scale: `.browse-gutter` is 4vw a side.
const content = (w) => w * 0.92;
const columnIndex = (w) => {
  let i = 0;
  STILL_BREAKPOINTS.forEach(([, min], j) => {
    if (w >= min) i = j;
  });
  return i;
};
const galleryTile = (w, table) => {
  const n = table[columnIndex(w)];
  return (content(w) - (n - 1) * STILL_GAP_PX) / n;
};
const railTile = (w, table) => galleryTile(w, table) * RAIL_STILL_SHARE;

const inverted = [];
const fewerThanStills = [];
const underFloor = [];
for (let w = 360; w <= 1920; w++) {
  const i = columnIndex(w);
  const [c, r, l] = TILE_SIZES.map((s) => POSTER_COLUMNS[s][i]);
  if (!(c >= r && r >= l)) inverted.push(`${w}px: ${c}/${r}/${l}`);
  for (const s of TILE_SIZES) {
    if (POSTER_COLUMNS[s][i] < TILE_COLUMNS[s][i]) fewerThanStills.push(`${w}px ${s}`);
    const narrowest = Math.min(galleryTile(w, POSTER_COLUMNS[s]), railTile(w, POSTER_COLUMNS[s]));
    if (narrowest < STILL_MIN_WIDTH_PX) underFloor.push(`${w}px ${s}: ${narrowest.toFixed(1)}px`);
  }
}
check("360-1920px: Compact >= Regular >= Large posters at every width", inverted, []);
check("360-1920px: never fewer posters than stills at a size", fewerThanStills, []);
check(`360-1920px: no gallery or rail poster under ${STILL_MIN_WIDTH_PX}px`, underFloor, []);
check(
  "phones (under 640px): posters two to a row at every size",
  TILE_SIZES.map((s) => POSTER_COLUMNS[s][0]),
  [2, 2, 2],
);
const at = (w) =>
  TILE_SIZES.map((s) => {
    const table = POSTER_COLUMNS[s];
    return `${table[columnIndex(w)]} x ${Math.round(galleryTile(w, table))}`;
  });
check("390px phone: 2 x 173 / 2 x 173 / 2 x 173", at(390), ["2 x 173", "2 x 173", "2 x 173"]);
check("1440px desktop: 7 x 179 / 6 x 211 / 5 x 255", at(1440), ["7 x 179", "6 x 211", "5 x 255"]);

// --- words fit on the narrowest poster --------------------------------------

// The case number is Plex Mono 10px (0.6em advance) inside the poster's 8px
// sides; the title is 13px semibold, about 0.55em a character, three lines.
const POSTER_SIDE_PX = 8;
const narrowestPoster = Math.min(
  ...Array.from({ length: 1561 }, (_, k) => 360 + k).flatMap((w) =>
    TILE_SIZES.map((s) =>
      Math.min(galleryTile(w, POSTER_COLUMNS[s]), railTile(w, POSTER_COLUMNS[s])),
    ),
  ),
);
check(
  "a 16-character case number fits on one line in the narrowest poster",
  16 * 0.6 * 10 + 2 * POSTER_SIDE_PX <= narrowestPoster,
  true,
);
const perLine = Math.floor((narrowestPoster - 2 * POSTER_SIDE_PX) / (0.55 * 13));
const wrapLines = (text) => {
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
check(
  "the parties before the colon fit inside three poster title lines",
  [
    "Police v. Leon Example: reasons for conviction on a charge of dangerous driving",
    "In the matter of a protection order: reasons for granting an interim order",
    "Sample Hardware Ltd v. Placeholder: ruling on a preliminary objection",
  ].filter((t) => wrapLines(t.split(":")[0]) > 3),
  [],
);

// --- the scrim keeps every word legible -------------------------------------

const alphaOf = (cls, prefix) => {
  const m = cls.match(new RegExp(`${prefix}-black/(\\d+)`));
  return m ? Number(m[1]) / 100 : 0;
};
// Under the text the scrim runs from its `from` to its `to` stop; the fade
// above the text carries no words.
const scrimFloor = Math.min(alphaOf(POSTER_SCRIM_CLASS, "from"), alphaOf(POSTER_SCRIM_CLASS, "to"));
check("the scrim under the words is at least 80% black", scrimFloor >= 0.8, true);
check(
  "the fade above the words meets the scrim at the same darkness",
  alphaOf(POSTER_SCRIM_FADE_CLASS, "from"),
  alphaOf(POSTER_SCRIM_CLASS, "to"),
);

const css = readFileSync("src/index.css", "utf8");
const hsl = (value) => {
  const [h, s, l] = value.replace(/%/g, "").split(/\s+/).map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
};
const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (fg, alpha, bg) => fg.map((v, i) => alpha * v + (1 - alpha) * bg[i]);
// The worst art under the scrim is pure white: brighter than any tone stop,
// the tone icon or a cover inset.
const scrimOnWhite = over([0, 0, 0], scrimFloor, [1, 1, 1]);
const inks = Object.entries(POSTER_INK).map(([name, cls]) => {
  const m = cls.match(/^text-primary-foreground(?:\/(\d+))?$/);
  return [name, m ? (m[1] ? Number(m[1]) / 100 : 1) : null];
});
check(
  "every poster ink is primary-foreground",
  inks.filter(([, a]) => a === null).map(([n]) => n),
  [],
);
const primaryForegrounds = [...css.matchAll(/\n\s*--primary-foreground:\s*([^;]+);/g)].map(
  (m) => m[1],
);
check("every palette sets primary-foreground", primaryForegrounds.length >= 6, true);
const weak = [];
for (const value of primaryForegrounds) {
  for (const [name, alpha] of inks) {
    const ink = over(hsl(value), alpha, scrimOnWhite);
    const r = ratio(ink, scrimOnWhite);
    if (r < 4.5) weak.push(`${name} (${value} at ${alpha}): ${r.toFixed(2)}`);
  }
}
check("every poster ink clears 4.5:1 on the scrim over white art, in every palette", weak, []);

// --- the component uses these, and a cover is never the art -----------------

const card = readFileSync("src/components/browse/title-card.tsx", "utf8");
const posterStart = card.indexOf('tileStyle === "posters" ? (');
const poster = card.slice(posterStart, card.indexOf(") : (", posterStart));
check(
  "TitleCard's poster uses the tested scrim and inks",
  [
    "POSTER_SCRIM_CLASS",
    "POSTER_SCRIM_FADE_CLASS",
    "POSTER_INK.kicker",
    "POSTER_INK.title",
    "POSTER_INK.subtitle",
    "POSTER_INK.meta",
    "aspect-[2/3]",
    "StatusFlag",
  ].filter((token) => !poster.includes(token)),
  [],
);
const posterImages = [...poster.matchAll(/<img[\s\S]*?\/>/g)].map((m) => m[0]);
check(
  "a cover on a poster is one small inset, never full-bleed art",
  posterImages.map((img) => /\binset-0\b|\bh-full\b|\bw-full\b/.test(img)),
  [false],
);

if (failures) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll tile-style checks passed.");
