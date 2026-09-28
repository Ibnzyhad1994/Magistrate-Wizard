/**
 * Case numbers, citations and codes are identifiers, not labels.
 *
 *  - One utility, `.identifier` in src/index.css: IBM Plex Mono, normal
 *    tracking, the text's own case and tabular figures, so a case number
 *    reads as a reference, never wraps mid-number and digits line up down
 *    a column.
 *  - Plex Mono ships self-hosted as the Latin 400 and 500 faces only, and
 *    the utility never synthesises a bolder weight; Cinzel ships only the
 *    600 face the wordmark uses.
 *  - No identifier reaches the wide-tracked uppercase eyebrow: TitleCard
 *    and Billboard take it through their `identifier` prop, never
 *    `eyebrow`.
 *  - No element that renders only an identifier keeps wide tracking or an
 *    uppercase transform, and each one carries the utility.
 *
 *   npm run test:identifiers
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const IDENTIFIER_FIELDS = "case_number|citation|code_word|code";

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const files = walk("src").map((path) => ({ path, text: readFileSync(path, "utf8") }));
const lineOf = (text, index) => text.slice(0, index).split("\n").length;
let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

check(
  ".identifier utility sets the mono face, normal tracking, no case change and tabular figures",
  () => {
    const css = readFileSync("src/index.css", "utf8");
    const block = css.match(/\n\s*\.identifier \{([^}]*)\}/);
    assert.ok(block, "no .identifier rule in src/index.css");
    assert.match(block[1], /font-family:\s*theme\("fontFamily\.mono"\);/);
    assert.match(block[1], /font-synthesis:\s*none;/);
    assert.match(block[1], /letter-spacing:\s*normal;/);
    assert.match(block[1], /text-transform:\s*none;/);
    assert.match(block[1], /font-variant-numeric:\s*tabular-nums;/);
  },
);

check("the mono family leads with IBM Plex Mono", () => {
  const config = readFileSync("tailwind.config.ts", "utf8");
  assert.match(config, /\bmono: \["IBM Plex Mono",/);
});

check("fonts: Plex Mono Latin 400 and 500, Cinzel 600 only", () => {
  const main = readFileSync("src/main.tsx", "utf8");
  const imports = [...main.matchAll(/import "@fontsource\/([^"]+)";/g)].map((m) => m[1]);
  const plex = imports.filter((i) => i.startsWith("ibm-plex-mono/"));
  const cinzel = imports.filter((i) => i.startsWith("cinzel/"));
  assert.deepEqual(plex, ["ibm-plex-mono/latin-400.css", "ibm-plex-mono/latin-500.css"]);
  assert.deepEqual(cinzel, ["cinzel/600.css"]);
  // The wordmark is the only Cinzel text; any other weight would synthesise.
  const brandWeights = files.flatMap(({ path, text }) =>
    [...text.matchAll(/className=[^>]*\bfont-brand\b[^>]*/g)]
      .filter(
        (m) => !/\bfont-semibold\b/.test(m[0]) || /\bfont-(bold|medium|extrabold)\b/.test(m[0]),
      )
      .map((m) => `${path}:${lineOf(text, m.index)}`),
  );
  assert.deepEqual(
    brandWeights,
    [],
    `font-brand outside Cinzel 600:\n       ${brandWeights.join("\n       ")}`,
  );
});

check("no identifier is passed as an eyebrow", () => {
  const re = new RegExp(`\\beyebrow\\s*[=:]\\s*\\{?\\s*[\\w?.]*\\.(${IDENTIFIER_FIELDS})\\b`, "g");
  const hits = files.flatMap(({ path, text }) =>
    [...text.matchAll(re)].map((m) => `${path}:${lineOf(text, m.index)} ${m[0]}`),
  );
  assert.deepEqual(hits, [], `use the identifier prop instead:\n       ${hits.join("\n       ")}`);
});

check("TitleCard and Billboard render the identifier prop with the utility", () => {
  for (const path of [
    "src/components/browse/title-card.tsx",
    "src/components/browse/billboard.tsx",
  ]) {
    const text = readFileSync(path, "utf8");
    assert.match(text, /identifier\?: string;/, `${path} has no identifier prop`);
    assert.match(text, /identifier \? "identifier"/, `${path} does not style it as an identifier`);
  }
});

check("elements that render only an identifier use it and drop wide tracking", () => {
  // className="..." on the element whose only child is {x.case_number ...}.
  const re = new RegExp(
    `className="([^"]*)"[^<>]*>\\s*\\{[\\w?.]+\\.(${IDENTIFIER_FIELDS})\\b[^}]*\\}\\s*</`,
    "g",
  );
  const bad = [];
  let seen = 0;
  for (const { path, text } of files) {
    for (const m of text.matchAll(re)) {
      seen += 1;
      const classes = m[1].split(/\s+/);
      const where = `${path}:${lineOf(text, m.index)}`;
      if (classes.some((c) => /^tracking-\[|^uppercase$/.test(c))) {
        bad.push(`${where} keeps wide tracking or uppercase: ${m[1]}`);
      }
      // Quick-code words already render in the mono face as a code.
      if (!classes.includes("identifier") && !classes.includes("font-mono")) {
        bad.push(`${where} lacks the identifier utility: ${m[1]}`);
      }
    }
  }
  assert.ok(seen >= 8, `expected at least 8 identifier-only elements, found ${seen}`);
  assert.deepEqual(bad, [], bad.join("\n       "));
});

if (failures > 0) {
  console.error(`\n${failures} identifier check(s) failed`);
  process.exit(1);
}
console.log("\nidentifier checks passed");
