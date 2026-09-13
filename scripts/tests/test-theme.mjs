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
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
  const escaped = selector.replace(/\./g, "\\.");
  const re = new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{([\\s\\S]*?)\\n  \\}`, "m");
  const m = re.exec(css);
  return m ? m[2] : null;
};
const rootBlock = blockFor(":root");
const darkBlock = blockFor(".dark");
const hcLightBlock = blockFor(".theme-high-contrast");
const hcDarkBlock = blockFor(".dark.theme-high-contrast");
const cbLightBlock = blockFor(".theme-colourblind");
const cbDarkBlock = blockFor(".dark.theme-colourblind");

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

for (const [label, block] of [
  ["high-contrast light", hcLightBlock],
  ["high-contrast dark", hcDarkBlock],
  ["colourblind-safe light", cbLightBlock],
  ["colourblind-safe dark", cbDarkBlock],
]) {
  check(`index.css defines a ${label} palette`, block !== null, true);
  check(
    `every token is defined in ${label}`,
    TOKENS.filter((t) => tokenValue(block, t) === null),
    [],
  );
}

check("high-contrast light canvas is white", lightness(tokenValue(hcLightBlock, "background")) > 95, true);
check("high-contrast light ink is black", lightness(tokenValue(hcLightBlock, "foreground")) < 5, true);
check("high-contrast dark canvas is black", lightness(tokenValue(hcDarkBlock, "background")) < 5, true);
check("high-contrast dark muted ink stays bright", lightness(tokenValue(hcDarkBlock, "muted-foreground")) >= 90, true);
check(
  "colourblind-safe does not use green for dismissed",
  tokenValue(cbDarkBlock, "stage-dismissed") !== tokenValue(darkBlock, "stage-dismissed"),
  true,
);

// --- components go through tokens, not literals -----------------------------
// Modal scrims (bg-black/80) are intentionally dark in both themes and
// are not matched here. A PDF page is real paper, so that viewer may
// keep literal black.

const LITERAL = /(bg|text|border|ring|divide)-white|bg-\[#(181818|141414|333)\]|rgba\(255,\s*255,\s*255,/;

function tsxFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(path));
    else if (entry.name.endsWith(".tsx")) out.push(path.replaceAll("\\", "/"));
  }
  return out;
}

const offenders = tsxFiles("src").filter((file) => LITERAL.test(readFileSync(file, "utf8")));

const ALLOWED = [
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
check(
  "missing or invalid storage defaults to dark, not the OS",
  html.includes('var palette = "dark"'),
  true,
);
check(
  "the bootstrap still follows the OS when the stored value is system",
  html.includes('stored === "system"'),
  true,
);
check("the bootstrap maps high-contrast storage values", html.includes('stored === "high-contrast"'), true);
check("the bootstrap maps colourblind-safe storage values", html.includes('stored === "colourblind"'), true);
check("the bootstrap honours prefers-contrast for System", html.includes("prefers-contrast: more"), true);
check(
  "the bootstrap toggles accessible modifier classes",
  html.includes('classList.toggle("theme-high-contrast"') && html.includes('classList.toggle("theme-colourblind"'),
  true,
);

// --- default + reachability -------------------------------------------------
const themeLib = readFileSync("src/lib/theme.ts", "utf8");
const provider = readFileSync("src/providers/theme-provider.tsx", "utf8");
const userMenu = readFileSync("src/components/layout/user-menu.tsx", "utf8");
const authLayout = readFileSync("src/layouts/auth-layout.tsx", "utf8");
const settings = readFileSync("src/pages/settings/settings-page.tsx", "utf8");

check("product default theme is dark", themeLib.includes('DEFAULT_THEME: Theme = "dark"'), true);
check("theme options list Dark first", /THEMES = \[\s*"dark"/.test(themeLib), true);
check("theme options include high-contrast and colourblind-safe", themeLib.includes('"high-contrast"') && themeLib.includes('"colourblind"'), true);
check("ThemeProvider defaults to DEFAULT_THEME", provider.includes("defaultTheme = DEFAULT_THEME"), true);
check("ThemeProvider listens for prefers-contrast", provider.includes("prefers-contrast: more"), true);
check("account menu includes the theme picker", userMenu.includes("ThemeMenuSub"), true);
check("sign-in shell has no theme select", authLayout.includes("ThemeSelect"), false);
check("settings uses the shared ThemeSelect", settings.includes("<ThemeSelect"), true);
check("sign-in and sign-up play a brand splash", authLayout.includes("AuthSplash") && authLayout.includes("ROUTES.login") && authLayout.includes("ROUTES.register"), true);
check("password recovery skips the brand splash", authLayout.includes("ROUTES.forgotPassword"), false);

const topNav = readFileSync("src/components/layout/top-nav.tsx", "utf8");
const titleCard = readFileSync("src/components/browse/title-card.tsx", "utf8");
const calendar = readFileSync("src/pages/calendar/calendar-page.tsx", "utf8");
const navSearch = readFileSync("src/components/layout/nav-search.tsx", "utf8");
const billboard = readFileSync("src/components/browse/billboard.tsx", "utf8");
const dashboard = readFileSync("src/pages/dashboard-page.tsx", "utf8");
check("hero overlay nav uses a black fade over dark art", topNav.includes("from-black/80"), true);
check("hero overlay nav is only used on dark-family palettes", topNav.includes("isDarkPalette(resolvedTheme)"), true);
check("billboard cinematic chrome follows dark-family palettes", billboard.includes("isDarkPalette(resolvedTheme)"), true);
check("paper and scrolled nav use the canvas token", topNav.includes("bg-background"), true);
check("billboard registers cinematic chrome for the overlay nav", billboard.includes("useRegisterCinematicNav"), true);
check("light hero uses paper ink", billboard.includes("text-foreground dark:text-primary-foreground"), true);
check("light hero is not a black wash", billboard.includes("from-background via-background/75"), true);
check("sitting caption lives on the hero, not the paper fade", dashboard.includes("caption="), true);
check("desktop search input is tokenized", topNav.includes("bg-black/70"), false);
check("poster tiles use always-white ink on cinematic art", titleCard.includes("text-primary-foreground"), true);
check("calendar out-of-month cells are not a black wash", calendar.includes("bg-black/20"), false);
check("header search field is not dark glass", navSearch.includes("bg-black/45"), false);
check("header search field uses canvas tokens", navSearch.includes("bg-secondary"), true);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
