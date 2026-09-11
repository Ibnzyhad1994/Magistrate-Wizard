/**
 * Light/dark theming. The toggle existed and persisted a choice, but
 * `:root` and `.dark` were defined as one selector holding a single dark
 * palette, so choosing Light changed nothing. On top of that, ~440 colours
 * across 62 files were hardcoded (`text-white`, `bg-[#181818]`), so even a
 * correct palette would only have repainted a minority of the product.
 *
 * These assertions are structural — they read the real index.css and the
 * real component tree — because the failure mode is silent: nothing throws,
 * the app just stays dark, which is exactly how this shipped before.
 *
 *   npm run test:theme
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

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

const css = readFileSync("src/index.css", "utf8");

// --- the two palettes are genuinely separate --------------------------------

const blockFor = (selector) => {
  const re = new RegExp(`(^|\\n)\\s*${selector.replace(".", "\\.")}\\s*\\{([\\s\\S]*?)\\n  \\}`, "m");
  const m = re.exec(css);
  return m ? m[2] : null;
};
const rootBlock = blockFor(":root");
const darkBlock = blockFor(".dark");

check("index.css defines a :root (light) palette", rootBlock !== null, true);
check("index.css defines a .dark palette", darkBlock !== null, true);
check(
  ":root and .dark are no longer one shared selector (the original bug)",
  /:root\s*,\s*\.dark\s*\{/.test(css),
  false,
);

const tokenValue = (block, name) => {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(block ?? "");
  return m ? m[1].trim() : null;
};

// Light must actually be light and dark actually dark. Comparing the
// lightness component catches a palette pasted into the wrong block.
const lightness = (hsl) => Number(/\S+\s+\S+\s+([\d.]+)%/.exec(hsl ?? "")?.[1] ?? NaN);

check("light background is light", lightness(tokenValue(rootBlock, "background")) > 80, true);
check("light foreground is dark ink", lightness(tokenValue(rootBlock, "foreground")) < 30, true);
check("dark background is dark", lightness(tokenValue(darkBlock, "background")) < 20, true);
check("dark foreground is light ink", lightness(tokenValue(darkBlock, "foreground")) > 80, true);

// The dark palette must keep its exact original values — the retrofit was
// supposed to be invisible in dark mode, not a redesign of it.
check("dark canvas is still #141414", tokenValue(darkBlock, "background"), "0 0% 8%");
check("dark tile is still #181818", tokenValue(darkBlock, "card"), "0 0% 9.4%");
check("dark foreground is still pure white", tokenValue(darkBlock, "foreground"), "0 0% 100%");

// Every token the light palette needs must exist in both, or a component
// styled through it renders with an empty custom property in one theme.
const TOKENS = [
  "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
  "primary", "primary-foreground", "secondary", "secondary-foreground",
  "muted", "muted-foreground", "accent", "accent-foreground",
  "destructive", "destructive-foreground", "border", "input", "ring",
  "brass", "brass-foreground", "match",
  "stage-progress", "stage-done", "stage-remand", "stage-dismissed", "stage-outcome-complete",
  "notice-action", "notice-granted", "notice-revoked", "notice-outcome",
  "capacity-available", "capacity-filling", "capacity-full", "capacity-over",
  "sidebar-background", "sidebar-foreground", "sidebar-border",
];
check(
  "every token defined in dark is also defined in light",
  TOKENS.filter((t) => tokenValue(darkBlock, t) !== null && tokenValue(rootBlock, t) === null),
  [],
);
check(
  "every token defined in light is also defined in dark",
  TOKENS.filter((t) => tokenValue(rootBlock, t) !== null && tokenValue(darkBlock, t) === null),
  [],
);

// --- components go through tokens, not literals -----------------------------
// One deliberate exception: the auth shell is a committed single-theme
// cinematic surface, like a marketing hero. Modal scrims (bg-black/80) are
// intentionally dark in both themes and are not matched here.

const LITERAL = String.raw`(bg|text|border|ring|divide)-white|bg-\[#(181818|141414|333)\]|rgba\(255,\s*255,\s*255,`;
const offenders = execSync(
  `grep -rlE "${LITERAL}" src --include="*.tsx" || true`,
  { encoding: "utf8" },
).trim().split("\n").filter(Boolean);

const ALLOWED = [
  "src/layouts/auth-layout.tsx",             // deliberate single-theme shell
  "src/components/legislation/pdf-viewer-page.tsx", // a PDF page is real paper
];
check(
  "no component hardcodes a theme colour outside the documented exceptions",
  offenders.filter((f) => !ALLOWED.includes(f)),
  [],
);

// --- pre-paint bootstrap ----------------------------------------------------
// Without this the document ships class="dark" and React only corrects it
// after the bundle boots, so a Light user sees a full dark flash every load.

const html = readFileSync("index.html", "utf8");
check("index.html resolves the theme before paint", html.includes("prefers-color-scheme: dark"), true);
check(
  "the bootstrap reads the same storage key the ThemeProvider writes",
  html.includes("magistrate-wizard-theme"),
  true,
);
check(
  "the bootstrap sets both classes, so neither can be left stale",
  html.includes('classList.toggle("dark"') && html.includes('classList.toggle("light"'),
  true,
);
check(
  "the bootstrap runs before the module bundle",
  html.indexOf("magistrate-wizard-theme") < html.indexOf('type="module"'),
  true,
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
