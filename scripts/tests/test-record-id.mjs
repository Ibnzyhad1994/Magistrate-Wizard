/**
 * A detail URL that cannot name a record is "not found", never an error.
 *
 *  - `recordIdOrUndefined` passes a UUID through and turns anything else
 *    into `undefined`, which leaves every id-keyed query idle, so
 *    `/docket/not-a-uuid` sends no request at all.
 *  - `isNotFoundError` reads `22P02` (invalid UUID syntax) and `PGRST116`
 *    (no row) as "not found", and nothing else.
 *  - Every detail page guards its id, maps a not-found error to the
 *    not-found state, and that state carries a Back link instead of Retry.
 *
 *   npm run test:record-id
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isNotFoundError, recordIdOrUndefined } from "@/lib/record-id";

const UUID = "aad4d231-784a-49e6-86ed-992ffb81d9fd";

assert.equal(recordIdOrUndefined(UUID), UUID, "a UUID is kept");
assert.equal(recordIdOrUndefined(UUID.toUpperCase()), UUID.toUpperCase(), "case does not matter");
assert.equal(
  recordIdOrUndefined("00000000-0000-4000-8000-000000000000"),
  "00000000-0000-4000-8000-000000000000",
  "a well-formed id that matches no row still reaches the query",
);
for (const bad of ["not-a-uuid", "", " ", `${UUID} `, `${UUID}x`, UUID.slice(1), "<script>"]) {
  assert.equal(recordIdOrUndefined(bad), undefined, `${JSON.stringify(bad)} names nothing`);
}
assert.equal(recordIdOrUndefined(undefined), undefined);

assert.equal(
  isNotFoundError({ code: "22P02", message: 'invalid input syntax for type uuid: "not-a-uuid"' }),
  true,
  "22P02 is not found",
);
assert.equal(isNotFoundError({ code: "PGRST116" }), true, "PGRST116 is not found");
for (const other of [{ code: "42501" }, { code: "23505" }, { code: 400 }, { message: "x" }]) {
  assert.equal(isNotFoundError(other), false, `${JSON.stringify(other)} stays an error`);
}
assert.equal(isNotFoundError(null), false);
assert.equal(isNotFoundError(new TypeError("Failed to fetch")), false, "offline stays an error");

const DETAIL_PAGES = [
  "src/pages/docket/docket-matter-detail-page.tsx",
  "src/pages/docket/callover/callover-detail-page.tsx",
  "src/pages/judgments/judgment-detail-page.tsx",
  "src/pages/case-law/case-law-detail-page.tsx",
  "src/pages/legislation/legislation-viewer-page.tsx",
  "src/pages/bench-notes/bench-note-detail-page.tsx",
];
for (const path of DETAIL_PAGES) {
  const text = readFileSync(path, "utf8");
  assert.match(text, /recordIdOrUndefined\(/, `${path} guards its id before querying`);
  assert.doesNotMatch(
    text,
    /const \{ id(, provisionId)? \} = useParams/,
    `${path} never queries with the raw path segment`,
  );
  assert.match(
    text,
    /isNotFoundError\(error\)\) return notFound/,
    `${path} maps 22P02 to not found`,
  );
  assert.match(text, /<PageNotFound[\s\S]*?back=/, `${path} offers a way back`);
  assert.doesNotMatch(
    text,
    /<PageError\s+error=\{new Error\(/,
    `${path} no longer renders "not found" as an error`,
  );
}

const pageError = readFileSync("src/components/browse/page-error.tsx", "utf8");
const notFoundComponent = pageError.slice(pageError.indexOf("export function PageNotFound"));
assert.match(notFoundComponent, /<Link to=\{back\.to\}>/, "the not-found state links back");
assert.doesNotMatch(notFoundComponent, /onRetry|Retry/, "the not-found state has no Retry");

console.log("ALL PASS");
