/**
 * House style for words people read in the app.
 *
 *  - No em dashes, and no " -- " standing in for one. Use a full stop, a
 *    comma or a colon. (An en dash inside a range such as "Word 97–2003"
 *    is fine: that is a range, not a dash.)
 *  - Visible copy stays short. Anything longer than the limit below
 *    belongs behind a DetailsHint ("?") or a LearnMore disclosure.
 *
 * Walks the real TypeScript AST, so code comments are never counted and a
 * comment explaining a design decision can be as long as it needs to be.
 *
 *   npm run test:copy-style
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

const ROOT = "src";
/** Visible copy longer than this is a paragraph, not a label. */
const MAX_VISIBLE = 160;
/** Tooltip and "Learn more" text may run longer, but not without limit. */
const MAX_DETAIL = 320;
/** Props whose text is shown behind a tap, not on the page. */
const DETAIL_PROPS = new Set(["details", "label", "title"]);
/** Props that are not copy at all. */
const CODE_PROPS = new Set([
  "className",
  "key",
  "href",
  "to",
  "id",
  "htmlFor",
  "type",
  "variant",
  "size",
  "name",
  "role",
  "value",
  "defaultValue",
  "accept",
  "autoComplete",
  "inputMode",
  "data-tour",
  "data-tour-focus",
  "rel",
  "target",
  "src",
  "tone",
  "icon",
  "align",
]);
// Files whose strings are not UI copy: generated types, text extraction
// heuristics, PDF layout, sanitiser patterns and machine-readable errors.
const SKIP = [
  /database\.types\.ts$/,
  /^lib[\\/](extraction|ingest-document|html-sanitize|legal-|ai-proposal|ocr[\\/]|pdf-text)/,
];

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(tsx|ts)$/.test(entry.name)) files.push(path);
  }
})(ROOT);

const looksLikeCode = (text) => {
  const tokens = text.trim().split(/\s+/);
  const codey = tokens.filter(
    (t) => /[-:_[\]()!*{}$=]/.test(t) && !/^[A-Za-z]+[,.]?$/.test(t),
  ).length;
  return codey / tokens.length > 0.45;
};

const dashes = [];
const longVisible = [];
const longDetail = [];

for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join("/");
  if (SKIP.some((re) => re.test(rel))) continue;
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const visit = (node) => {
    let text = null;
    if (ts.isJsxText(node)) text = node.getText().replace(/\s+/g, " ").trim();
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateExpression(node)) {
      // Count what a reader sees: each substitution is a short value, not its code.
      text = node.head.text + node.templateSpans.map((span) => "{}" + span.literal.text).join("");
    }
    if (text && /[A-Za-z]/.test(text) && text.includes(" ") && !looksLikeCode(text)) {
      const parent = node.parent;
      const isImport = parent && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent));
      const attr = ts.isJsxAttribute(parent)
        ? parent.name.getText()
        : parent && ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)
          ? parent.parent.name.getText()
          : null;
      if (!isImport && !(attr && CODE_PROPS.has(attr))) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        const where = `${rel}:${line + 1}`;
        // A dash in copy: an em dash, or a double hyphen used as one.
        if (/—/.test(text) || / -- /.test(text)) dashes.push(`${where}  ${text.slice(0, 90)}`);
        const limit = attr && DETAIL_PROPS.has(attr) ? MAX_DETAIL : MAX_VISIBLE;
        if (text.length > limit) {
          (limit === MAX_DETAIL ? longDetail : longVisible).push(
            `${where}  (${text.length})  ${text.slice(0, 80)}…`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

let failures = 0;
const report = (label, list) => {
  const pass = list.length === 0;
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`);
  if (!pass) {
    for (const item of list) console.log(`  ${item}`);
    failures += 1;
  }
};

report("no em dash (or ' -- ') in user-facing copy", dashes);
report(`visible copy is at most ${MAX_VISIBLE} characters`, longVisible);
report(`tooltip and detail copy is at most ${MAX_DETAIL} characters`, longDetail);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
