/**
 * Catalog official Guyana legislation indexes (MoLA Laws of Guyana +
 * Parliament Acts). Writes JSON harvest files for ingest-harvest.mjs.
 *
 *   node scripts/seed-legal-library/harvest-official-indexes.mjs
 *
 * Does not invent statute text. PDF bodies are left empty unless a later
 * pass extracts them; every item keeps a real official source_url.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "scripts/seed-legal-library/raw");
const UA = "MagistrateWizardLegalSeed/1.0 (local library seeding; official public law)";

mkdirSync(OUT, { recursive: true });

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

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

async function harvestMola() {
  const items = [];
  const seen = new Set();
  let lastPage = 1;
  for (let page = 1; page <= 60; page++) {
    const url = page === 1 ? "https://www.mola.gov.gy/laws-of-guyana" : `https://www.mola.gov.gy/laws-of-guyana?page=${page}`;
    let html;
    try {
      html = await fetchText(url);
    } catch (err) {
      console.warn(`MoLA page ${page} failed: ${err.message}`);
      break;
    }
    const pageNums = [...html.matchAll(/laws-of-guyana\?page=(\d+)/g)].map((m) => Number(m[1]));
    if (pageNums.length) lastPage = Math.max(lastPage, ...pageNums);

    const re =
      /href="(https:\/\/www\.mola\.gov\.gy\/laws\/[^"]+\.pdf)"[^>]*>\s*<h6[^>]*>([\s\S]*?)<\/h6>/gi;
    let match;
    let found = 0;
    while ((match = re.exec(html))) {
      const source_url = decodeEntities(match[1].replace(/ /g, "%20"));
      const titleRaw = decodeEntities(match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
      const cap = titleRaw.match(/Chapter\s+(\d+:\d+)/i)?.[1] ?? titleRaw.match(/Cap\.?\s*(\d+:\d+)/i)?.[1];
      const title = titleRaw.replace(/^Chapter\s+\d+:\d+\s*-\s*/i, "").trim();
      const key = `${cap ?? ""}|${title}|${source_url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found += 1;
      items.push({
        kind: "legislation",
        title: title || titleRaw,
        code: cap ? `Cap. ${cap}` : titleRaw.slice(0, 80),
        short_title: null,
        jurisdiction: "Guyana",
        source_url,
        original_filename: decodeURIComponent(source_url.split("/").pop() ?? ""),
        full_text: "",
        harvest_error: "Index catalog only — PDF body not extracted in this pass.",
      });
    }
    console.log(`MoLA page ${page}: ${found} new (total ${items.length})`);
    if (page >= lastPage && page > 1) break;
    await new Promise((r) => setTimeout(r, 250));
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
  writeFileSync(join(OUT, "01-mola-laws.json"), JSON.stringify(payload, null, 2));
  return items.length;
}

function isBudgetAct(title) {
  return /appropriation|fiscal enactments|estimates of (the )?public sector/i.test(title);
}

async function harvestParliament() {
  const items = [];
  const seen = new Set();
  // Parliament uses /P20, /P40 … (20 items per page) and also a 185-page pager.
  for (let offset = 0; offset <= 184 * 20; offset += 20) {
    const url =
      offset === 0
        ? "https://www.parliament.gov.gy/publications/acts-of-parliament"
        : `https://www.parliament.gov.gy/publications/acts-of-parliament/P${offset}`;
    let html;
    try {
      html = await fetchText(url);
    } catch (err) {
      console.warn(`Parliament offset ${offset} failed: ${err.message}`);
      break;
    }
    const rowRe =
      /href="(https:\/\/www\.parliament\.gov\.gy\/publications\/acts-of-parliament\/[^"]+)"[^>]*>\s*([\s\S]*?)<\/a>/gi;
    let match;
    let found = 0;
    while ((match = rowRe.exec(html))) {
      const pageUrl = decodeEntities(match[1]).split("?")[0];
      if (pageUrl.endsWith("/acts-of-parliament") || /\/P\d+$/.test(pageUrl)) continue;
      const title = decodeEntities(match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
      if (!title || title.length < 8) continue;
      if (isBudgetAct(title)) continue;
      if (seen.has(pageUrl)) continue;
      seen.add(pageUrl);
      found += 1;
      const code = title.match(/(\d+\s+of\s+20\d{2})/i)?.[1] ?? title.slice(0, 60);
      items.push({
        kind: "legislation",
        title,
        code,
        short_title: null,
        jurisdiction: "Guyana",
        source_url: pageUrl,
        original_filename: null,
        full_text: "",
        harvest_error: "Index catalog only — Act PDF not extracted in this pass.",
      });
    }
    console.log(`Parliament offset ${offset}: ${found} new (total ${items.length})`);
    if (found === 0 && offset > 0) break;
    await new Promise((r) => setTimeout(r, 200));
    if (items.length >= 400) break;
  }
  const payload = {
    harvested_at: new Date().toISOString(),
    source: {
      name: "Parliament of Guyana — Acts of Parliament",
      base_url: "https://www.parliament.gov.gy/publications/acts-of-parliament",
      source_type: "legislation",
      jurisdiction: "Guyana",
      connector_type: "index_page",
    },
    items,
  };
  writeFileSync(join(OUT, "02-parliament-acts.json"), JSON.stringify(payload, null, 2));
  return items.length;
}

const molaCount = await harvestMola();
const parlCount = await harvestParliament();
console.log(`Wrote catalogs: MoLA ${molaCount} chapters, Parliament ${parlCount} acts (budget acts skipped).`);
