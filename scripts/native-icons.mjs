/**
 * Draw the native shells' launch identity from the seal (`public/favicon.svg`)
 * on the dark canvas: Android launcher icons (legacy, round and the adaptive
 * foreground) and splash screens, the iOS app icon and launch image, and the
 * web's apple-touch-icon.
 * Rasterised by the Playwright Chromium the e2e suite already uses, so the
 * seal is drawn exactly as a browser draws the favicon.
 *
 *   npm run native:icons
 *
 * Run it again whenever the seal's artwork or the dark canvas changes.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// The dark canvas (`--background` in .dark, THEME_COLOR.dark).
const CANVAS = "#0d0e11";
const seal = readFileSync(join(root, "public/favicon.svg"), "utf8");
const sealUrl = `data:image/svg+xml;base64,${Buffer.from(seal).toString("base64")}`;

const ANDROID_RES = "android/app/src/main/res";
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const SPLASH = {
  "drawable/splash.png": [480, 320],
  "drawable-land-mdpi/splash.png": [480, 320],
  "drawable-land-hdpi/splash.png": [800, 480],
  "drawable-land-xhdpi/splash.png": [1280, 720],
  "drawable-land-xxhdpi/splash.png": [1600, 960],
  "drawable-land-xxxhdpi/splash.png": [1920, 1280],
  "drawable-port-mdpi/splash.png": [320, 480],
  "drawable-port-hdpi/splash.png": [480, 800],
  "drawable-port-xhdpi/splash.png": [720, 1280],
  "drawable-port-xxhdpi/splash.png": [960, 1600],
  "drawable-port-xxxhdpi/splash.png": [1280, 1920],
};

/**
 * One image: a `width` x `height` box, `background` (a colour or
 * "transparent"), an optional `shape` ("circle" or a corner radius as a
 * fraction of the side) for that background, and the seal centred at
 * `sealFraction` of the shorter side.
 */
const jobs = [];
const add = (path, width, height, { background, shape, sealFraction }) =>
  jobs.push({ path, width, height, background, shape, sealFraction });

for (const [density, scale] of Object.entries(DENSITIES)) {
  const icon = Math.round(48 * scale);
  // Legacy launchers (before Android 8) draw the PNG as is.
  add(`${ANDROID_RES}/mipmap-${density}/ic_launcher.png`, icon, icon, {
    background: CANVAS,
    shape: 0.2,
    sealFraction: 0.66,
  });
  add(`${ANDROID_RES}/mipmap-${density}/ic_launcher_round.png`, icon, icon, {
    background: CANVAS,
    shape: "circle",
    sealFraction: 0.6,
  });
  // Adaptive foreground: a 108dp layer whose middle 66dp survives any
  // launcher mask; a 52dp seal keeps its rounded corners inside that circle.
  const fg = Math.round(108 * scale);
  add(`${ANDROID_RES}/mipmap-${density}/ic_launcher_foreground.png`, fg, fg, {
    background: "transparent",
    sealFraction: 52 / 108,
  });
}
for (const [path, [w, h]] of Object.entries(SPLASH)) {
  add(`${ANDROID_RES}/${path}`, w, h, { background: CANVAS, sealFraction: 0.22 });
}

// iOS masks the icon itself and refuses transparency, so the canvas is square.
add("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", 1024, 1024, {
  background: CANVAS,
  sealFraction: 0.62,
});
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  add(`ios/App/App/Assets.xcassets/Splash.imageset/${name}`, 2732, 2732, {
    background: CANVAS,
    sealFraction: 0.11,
  });
}

// iOS ignores an SVG apple-touch-icon; it rounds the corners itself.
add("public/apple-touch-icon.png", 180, 180, { background: CANVAS, sealFraction: 0.66 });

const html = ({ width, height, background, shape, sealFraction }) => {
  const side = Math.round(Math.min(width, height) * sealFraction);
  const radius =
    shape === "circle" ? "50%" : typeof shape === "number" ? `${shape * 100}%` : "0";
  return `<!doctype html><html><head><style>
    html, body { margin: 0; width: ${width}px; height: ${height}px; background: transparent; }
    .bg { position: absolute; inset: 0; background: ${background}; border-radius: ${radius}; }
    img { position: absolute; left: ${(width - side) / 2}px; top: ${(height - side) / 2}px;
          width: ${side}px; height: ${side}px; }
  </style></head><body><div class="bg"></div><img src="${sealUrl}" alt=""></body></html>`;
};

const browser = await chromium.launch();
try {
  for (const job of jobs) {
    const page = await browser.newPage({
      viewport: { width: job.width, height: job.height },
      deviceScaleFactor: 1,
    });
    await page.setContent(html(job));
    await page.locator("img").evaluate((img) => img.decode());
    const out = join(root, job.path);
    mkdirSync(dirname(out), { recursive: true });
    await page.screenshot({ path: out, omitBackground: true });
    await page.close();
    console.log(`${job.width}x${job.height}  ${job.path}`);
  }
} finally {
  await browser.close();
}
