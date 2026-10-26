/**
 * The offline sync banner reserves its own height (U-04).
 *
 * It is fixed under the nav, so on its own it covered the top of the page:
 * on a matter page, the case number and the top of the title. While it
 * shows, its height is published as --offline-banner-h, and every page top
 * offset and sticky bar adds it.
 *
 *   npm run test:offline-banner-offset
 */
import { readFileSync } from "node:fs";
import { OFFLINE_BANNER_HEIGHT_VAR, reserveBannerHeight } from "@/lib/reserve-banner-height";

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

// --- the reservation itself ---------------------------------------------------------

{
  const props = new Map();
  const root = {
    style: {
      setProperty: (name, value) => props.set(name, value),
      removeProperty: (name) => props.delete(name),
    },
  };
  let height = 40.4;
  const node = { getBoundingClientRect: () => ({ height }) };
  let onResize = null;
  let observed = null;
  let disconnected = false;
  class FakeObserver {
    constructor(callback) {
      onResize = callback;
    }
    observe(target) {
      observed = target;
    }
    disconnect() {
      disconnected = true;
    }
  }

  const release = reserveBannerHeight(node, root, FakeObserver);
  check("the variable is the one the CSS reads", OFFLINE_BANNER_HEIGHT_VAR, "--offline-banner-h");
  check("its height is published at once, rounded up", props.get("--offline-banner-h"), "41px");
  check("and the banner is watched for resizes", observed, node);

  // A phone wraps the text onto three lines, or the failed list opens.
  height = 92;
  onResize();
  check("a taller banner pushes the page further down", props.get("--offline-banner-h"), "92px");

  release();
  check("hiding the banner gives the space back", props.has("--offline-banner-h"), false);
  check("and stops watching it", disconnected, true);
}

// --- every offset reads it ------------------------------------------------------------

const read = (file) => readFileSync(file, "utf8");

check(
  "index.css declares the 0px default",
  /--offline-banner-h:\s*0px;/.test(read("src/index.css")),
  true,
);

const banner = read("src/components/layout/offline-sync-banner.tsx");
check(
  "the banner reserves its height",
  banner.includes("reserveBannerHeight(bannerRef.current)"),
  true,
);
check("measured on the banner element", banner.includes("ref={bannerRef}"), true);
check(
  "in a layout effect, so the offset lands with the first paint",
  banner.includes("useLayoutEffect"),
  true,
);

// Page tops: every page clears the nav through one of these.
for (const file of [
  "src/components/browse/browse-page.tsx",
  "src/components/browse/browse-header.tsx",
  "src/components/browse/billboard.tsx",
]) {
  const offsets = read(file).match(/(?:-mt|pt)-\[calc\(6rem[^\]]*\]/g) ?? [];
  check(`${file} has a nav offset`, offsets.length > 0, true);
  check(
    `${file}: every nav offset adds the banner height`,
    offsets.filter((offset) => !offset.includes("var(--offline-banner-h)")),
    [],
  );
}

// Sticky bars pinned under the nav must sit under the banner too, or they
// slide beneath it on scroll.
const stickyUnderNav = [
  "src/pages/docket/docket-toolbar.tsx",
  "src/pages/docket/docket-matter-detail-page.tsx",
  "src/pages/judgments/judgment-detail-page.tsx",
  "src/pages/settings/settings-page.tsx",
];
for (const file of stickyUnderNav) {
  const tops = read(file).match(/(?:top|scroll-mt)-\[calc\(68px[^\]]*\]/g) ?? [];
  check(`${file} has a sticky offset under the nav`, tops.length > 0, true);
  check(
    `${file}: it adds the banner height`,
    tops.filter((top) => !top.includes("var(--offline-banner-h)")),
    [],
  );
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
