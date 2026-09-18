// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * Global search must look inside a statute's sections (0158).
 *
 * statute_provisions has carried a generated, GIN-indexed search_vector
 * since 0055, and global_search never referenced it, so a phrase living
 * only in the body of one section was unfindable from the search box.
 *
 * Asserted here against the real database, as a signed-in magistrate, so
 * RLS is genuinely exercised rather than assumed:
 *
 *   1. a phrase present ONLY in a section body finds its Act;
 *   2. the result names the section rather than the Act's code;
 *   3. an Act whose many sections match still yields ONE row, so it
 *      cannot crowd other entity types out of the shared LIMIT;
 *   4. an ordinary Act-level match is unchanged.
 *
 * Fixtures are disposable and removed in a finally block; no real profile
 * is modified.
 *
 *   npm run db:start && npm run test:global-search-provisions
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const STATUTE_ID = "aaaaaaaa-0000-4000-8000-000000000158";
// Deliberately not a word: it must not collide with seeded library text.
const PHRASE = "zzqqxxtest0158";

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

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const user = createClient(URL, ANON, { auth: { persistSession: false } });

const cleanup = async () => {
  await admin.from("statute_provisions").delete().eq("statute_id", STATUTE_ID);
  await admin.from("statutes").delete().eq("id", STATUTE_ID);
};

try {
  await cleanup();

  const { error: statuteError } = await admin.from("statutes").insert({
    id: STATUTE_ID,
    code: "TEST-0158",
    title: "Fixture Act 0158",
    jurisdiction: "Guyana",
    review_status: "published",
  });
  if (statuteError) throw new Error(`fixture Act: ${statuteError.message}`);

  const { error: provisionError } = await admin.from("statute_provisions").insert([
    {
      statute_id: STATUTE_ID,
      level: "section",
      number: "12",
      heading: "Assault",
      body_text: `A person who commits ${PHRASE} upon another is liable.`,
      sort_order: 1,
    },
    {
      statute_id: STATUTE_ID,
      level: "section",
      number: "13",
      heading: "Aggravated assault",
      body_text: `A further ${PHRASE} provision.`,
      sort_order: 2,
    },
  ]);
  if (provisionError) throw new Error(`fixture provisions: ${provisionError.message}`);

  // The phrase must exist nowhere in the Act's own search vector, or the
  // test would pass without the provision join doing any work at all.
  const { data: actLevel } = await admin
    .from("statutes")
    .select("id")
    .textSearch("search_vector", PHRASE, { type: "websearch" });
  check("the phrase is in no Act-level search vector", (actLevel ?? []).length, 0);

  const { error: signInError } = await user.auth.signInWithPassword({
    email: "magistrate@magistrate-wizard.local",
    password: "password123",
  });
  if (signInError) throw new Error(`sign in: ${signInError.message}`);

  const { data: hits, error: searchError } = await user.rpc("global_search", {
    p_query: PHRASE,
    p_limit: 20,
  });
  if (searchError) throw new Error(`global_search: ${searchError.message}`);

  const forFixture = (hits ?? []).filter((row) => row.id === STATUTE_ID);
  check("a section-only phrase finds its Act", forFixture.length, 1);
  check("it is returned as a statute", forFixture[0]?.entity_type, "statute");
  check("the Act is named", forFixture[0]?.title, "Fixture Act 0158");
  check(
    "the subtitle names the section, not the Act code",
    forFixture[0]?.subtitle,
    "Section 12 - Assault",
  );
  check(
    "the headline is drawn from the provision text",
    (forFixture[0]?.headline ?? "").includes(PHRASE),
    true,
  );
  check(
    "two matching sections still yield one row for the Act",
    (hits ?? []).filter((row) => row.id === STATUTE_ID).length,
    1,
  );

  // An Act-level match must be untouched by the change.
  const { data: byTitle, error: titleError } = await user.rpc("global_search", {
    p_query: "Fixture Act 0158",
    p_limit: 20,
  });
  if (titleError) throw new Error(`global_search by title: ${titleError.message}`);
  const titleHit = (byTitle ?? []).find((row) => row.id === STATUTE_ID);
  check("an ordinary Act-level match still returns the Act", Boolean(titleHit), true);
  check("and still shows the Act code as its subtitle", titleHit?.subtitle, "TEST-0158");

  await user.auth.signOut();
} finally {
  await cleanup();
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
