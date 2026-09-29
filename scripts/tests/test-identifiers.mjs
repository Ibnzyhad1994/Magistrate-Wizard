/**
 * Case numbers, citations and codes are identifiers, not labels.
 *
 *  - One utility, `.identifier` in src/index.css: normal tracking, the
 *    text's own case and tabular figures, so a case number never wraps
 *    mid-number and digits line up down a column.
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

check(".identifier utility sets normal tracking, no case change and tabular figures", () => {
  const css = readFileSync("src/index.css", "utf8");
  const block = css.match(/\n\s*\.identifier \{([^}]*)\}/);
  assert.ok(block, "no .identifier rule in src/index.css");
  assert.match(block[1], /letter-spacing:\s*normal;/);
  assert.match(block[1], /text-transform:\s*none;/);
  assert.match(block[1], /font-variant-numeric:\s*tabular-nums;/);
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
    // Every component in the file that takes an eyebrow (the hero and the
    // detail header are separate functions) must render the identifier too.
    const components = text
      .split(/\n(?=(?:export )?function \w+\()/)
      .filter((c) => /\n\s+eyebrow,/.test(c));
    assert.ok(components.length > 0, `${path} has no component taking an eyebrow`);
    for (const c of components) {
      const name = c.match(/function (\w+)/)?.[1];
      assert.match(c, /\n\s+identifier,/, `${path} ${name} ignores the identifier prop`);
      assert.match(
        c,
        /identifier \? "identifier"/,
        `${path} ${name} does not style it as an identifier`,
      );
    }
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
