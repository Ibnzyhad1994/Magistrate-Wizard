/**
 * Harvest the official Laws of Guyana catalog from MoLA's AJAX endpoint.
 * The public HTML page is a shell; chapters load from:
 *   https://www.mola.gov.gy/ajax-search-law?page=N
 *
 *   node scripts/seed-legal-library/harvest-mola-ajax.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = join(ROOT, "scripts/seed-legal-library/raw");
mkdirSync(OUT_DIR, { recursive: true });

const UA = "MagistrateWizardLegalSeed/1.0 (local library seeding; official public law)";

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/g, " ")
    .trim();
}

function parseCards(html) {
  const items = [];
  const re =
    /href="(https:\/\/www\.mola\.gov\.gy\/laws\/[^"]+\.pdf)"[^>]*>\s*<h6[^>]*>([\s\S]*?)<\/h6>/gi;
  let match;
  while ((match = re.exec(html))) {
    const source_url = decodeEntities(match[1]);
    const titleRaw = decodeEntities(match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
    const cap = titleRaw.match(/Chapter\s+(\d+:\d+)/i)?.[1];
    const title = titleRaw.replace(/^Chapter\s+\d+:\d+\s*/i, "").trim();
    items.push({
      kind: "legislation",
      title: title || titleRaw,
      code: cap ? `Cap. ${cap}` : titleRaw.slice(0, 80),
      short_title: title || null,
      jurisdiction: "Guyana",
      source_url,
      original_filename: decodeURIComponent(source_url.split("/").pop() ?? ""),
      full_text: "",
      harvest_error: "Index catalog only — PDF body not extracted in this pass.",
    });
  }
  return items;
}

async function fetchPage(page) {
  const url = `https://www.mola.gov.gy/ajax-search-law?page=${page}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,*/*",
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

const seen = new Set();
const items = [];
let emptyStreak = 0;

for (let page = 1; page <= 80; page++) {
  let html;
  try {
    html = await fetchPage(page);
  } catch (err) {
    console.warn(`page ${page} failed: ${err.message}`);
    emptyStreak += 1;
    if (emptyStreak >= 3) break;
    continue;
  }
  const parsed = parseCards(html);
  let added = 0;
  for (const item of parsed) {
    const key = `${item.code}|${item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    added += 1;
  }
  console.log(`MoLA ajax page ${page}: parsed=${parsed.length} new=${added} total=${items.length} html=${html.length}`);
  if (parsed.length === 0) {
    emptyStreak += 1;
    if (emptyStreak >= 2) break;
  } else {
    emptyStreak = 0;
  }
  await new Promise((r) => setTimeout(r, 200));
}

const payload = {
  harvested_at: new Date().toISOString(),
  source: {
    name: "Ministry of Legal Affairs — Laws of Guyana",
    base_url: "https://www.mola.gov.gy/laws-of-guyana",
    source_type: "legislation",
    jurisdiction: "Guyana",
    connector_type: "index_page",
  },
  items,
};

writeFileSync(join(OUT_DIR, "01-mola-laws.json"), JSON.stringify(payload, null, 2));
console.log(`Wrote ${items.length} MoLA chapters to 01-mola-laws.json`);
