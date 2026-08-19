/**
 * Copy harvest JSON from raw/ into catalogs/, keeping only items that pass
 * seed-heuristics. Scratch files (_inspect, _tmp) are ignored.
 *
 *   node scripts/seed-legal-library/prepare-catalogs.mjs
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateSeedItem, isCatalogFilename } from "./seed-heuristics.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const RAW = join(ROOT, "raw");
const OUT = join(ROOT, "catalogs");

mkdirSync(OUT, { recursive: true });

const files = readdirSync(RAW, { withFileTypes: true })
  .filter((d) => d.isFile() && isCatalogFilename(d.name))
  .map((d) => d.name);

if (files.length === 0) {
  console.log("No numbered harvest JSON in raw/. Run a harvest script first.");
  process.exit(0);
}

for (const file of files) {
  const harvest = JSON.parse(readFileSync(join(RAW, file), "utf8"));
  const items = Array.isArray(harvest.items) ? harvest.items : [];
  const kept = [];
  const rejected = [];
  for (const item of items) {
    const verdict = evaluateSeedItem(item, harvest);
    if (verdict.eligible) kept.push(item);
    else rejected.push({ title: item.title, citation: item.citation, reasons: verdict.reasons });
  }
  const payload = {
    ...harvest,
    harvested_at: harvest.harvested_at ?? new Date().toISOString(),
    seed_prepared_at: new Date().toISOString(),
    seed_counts: { harvested: items.length, eligible: kept.length, rejected: rejected.length },
    items: kept,
  };
  writeFileSync(
    join(OUT, file.replace(/\.json$/, ".rejected.json")),
    JSON.stringify({ file, rejected }, null, 2),
  );
  if (kept.length === 0) {
    console.log(`${file}: kept 0 / ${items.length} — not writing an empty catalog`);
    continue;
  }
  writeFileSync(join(OUT, file), JSON.stringify(payload, null, 2));
  console.log(`${file}: kept ${kept.length} / ${items.length} (rejected ${rejected.length})`);
}
