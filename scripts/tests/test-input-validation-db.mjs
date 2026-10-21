// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * Input validation and search behave (0166), on a real database.
 *
 * Replays the 2026-10-15 audit's theme T7 repros through the same clients
 * the app uses, signed in as disposable magistrates so RLS is exercised:
 *
 *   B-14  a case number is unique per district whatever its letter case or
 *         surrounding spaces; a blank case number or title, and a title,
 *         number or charge over the form's limit, is refused; values are
 *         stored trimmed;
 *   C-10  "%" and "_" in a search are literal characters, and a blank
 *         global search returns nothing;
 *   C-12  global_search clamps p_limit and refuses an over-long query;
 *         judgment titles and Quick Code content are capped; the finalised
 *         notice is spelt "finalised".
 *
 * Controls show the ordinary paths still work: normal and boundary-length
 * values are stored, the same number is free in another district, a matter
 * may correct the case of its own number, and ordinary searches (including
 * for text that really contains % or _) still find their rows.
 *
 * Creates its own districts, courts, users and rows (all carrying the
 * fixture mark) and removes them afterwards, pass or fail. An account whose
 * writes are in the append-only audit log cannot be deleted (audit_log_
 * immutable refuses the FK's SET NULL), so it is left signed out and named.
 *
 *   npm run db:start && npm run test:input-validation-db
 */
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
assertLocalSupabase(URL, "test-input-validation-db");
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
}
const must = ({ data, error }, label) => {
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
};
/** "created", or the SQLSTATE and constraint a refusal names. */
const outcome = ({ error }) => {
  if (!error) return "created";
  const constraint = /constraint "([^"]+)"/.exec(error.message)?.[1];
  return constraint ? `${error.code} ${constraint}` : `${error.code} ${error.message}`;
};
const DUPLICATE = "23505 docket_matters_district_case_number_unique";

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(URL, SERVICE, noSession);
const MARK = `T7-FIX-${Date.now() % 1_000_000}`;
// A word that is in no seeded row, so searches for it see only fixtures.
const WORD = `zqt7${Date.now() % 1_000_000}`;
const PASSWORD = "T7-fixture-pass-123!";
const email = (name) => `${MARK.toLowerCase()}-${name}@example.test`;

const created = { users: [], courts: [], districts: [], caseLaw: [] };

async function createUser(name, role = "magistrate") {
  const user = must(
    await admin.auth.admin.createUser({
      email: email(name),
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: `${MARK} ${name}` },
    }),
    `create ${name}`,
  ).user;
  created.users.push(user.id);
  if (role !== "magistrate") {
    must(await admin.from("profiles").update({ role }).eq("id", user.id), `role ${name}`);
  }
  return user;
}

async function signIn(user) {
  const client = createClient(URL, ANON, noSession);
  must(await client.auth.signInWithPassword({ email: user.email, password: PASSWORD }), "sign in");
  return client;
}

async function main() {
  // ---------- fixtures ----------
  const district = async (suffix) => {
    const row = must(
      await admin
        .from("magisterial_districts")
        .insert({ name: `${MARK} District ${suffix}` })
        .select()
        .single(),
      `district ${suffix}`,
    );
    created.districts.push(row.id);
    return row.id;
  };
  const court = async (districtId, suffix) => {
    const row = must(
      await admin
        .from("courts")
        .insert({
          name: `${MARK} ${suffix}`,
          jurisdiction: "Test",
          district_id: districtId,
          is_active: true,
        })
        .select()
        .single(),
      `court ${suffix}`,
    );
    created.courts.push(row.id);
    return row.id;
  };
  const districtOne = await district("One");
  const districtTwo = await district("Two");
  const courtA = await court(districtOne, "Court A");
  const courtB = await court(districtOne, "Court B");
  const courtC = await court(districtTwo, "Court C");

  const m1 = await createUser("m1");
  const m2 = await createUser("m2");
  const m3 = await createUser("m3");
  // Canonical Case Law is created by an administrator, as in the app.
  const a1 = await createUser("a1", "admin");
  must(
    await admin.from("magistrate_courts").insert([
      { profile_id: m1.id, court_id: courtA },
      { profile_id: m2.id, court_id: courtB },
      { profile_id: m3.id, court_id: courtC },
    ]),
    "seat magistrates",
  );
  const M1 = await signIn(m1);
  const M2 = await signIn(m2);
  const M3 = await signIn(m3);
  const A1 = await signIn(a1);

  const createMatter = (client, courtId, fields) =>
    client
      .from("docket_matters")
      .insert({
        court_id: courtId,
        case_number: `${MARK}-${Math.random().toString(36).slice(2, 8)}`,
        matter_title: `Police v. ${MARK} accused`,
        charge_or_issue: "Larceny",
        ...fields,
      })
      .select("id, case_number, matter_title, charge_or_issue")
      .single();

  // ================= B-14: one number per district, whatever its case =================
  const base = `${MARK}-DUP`;
  check(
    "control: a new case number is created",
    outcome(await createMatter(M1, courtA, { case_number: base })),
    "created",
  );
  check(
    "the same number again is refused",
    outcome(await createMatter(M1, courtA, { case_number: base })),
    DUPLICATE,
  );
  for (const variant of [`${base} `, ` ${base}`, `\t${base} `, base.toLowerCase()]) {
    check(
      `B-14 the variant ${JSON.stringify(variant)} is the same number`,
      outcome(await createMatter(M1, courtA, { case_number: variant })),
      DUPLICATE,
    );
  }
  check(
    "B-14 the variant is refused at another court of the same district too",
    outcome(await createMatter(M2, courtB, { case_number: base.toLowerCase() })),
    DUPLICATE,
  );
  check(
    "control: the same number is free in another district",
    outcome(await createMatter(M3, courtC, { case_number: base.toLowerCase() })),
    "created",
  );

  {
    const padded = must(
      await createMatter(M1, courtA, {
        case_number: `  ${MARK}-PAD 7 `,
        matter_title: "  Police v. Padded  ",
        charge_or_issue: "   ",
      }),
      "padded matter",
    );
    check(
      "B-14 the case number is stored trimmed, its inside untouched",
      padded.case_number,
      `${MARK}-PAD 7`,
    );
    check("B-14 the title is stored trimmed", padded.matter_title, "Police v. Padded");
    check("B-14 a blank charge is stored as no charge", padded.charge_or_issue, null);

    const renamed = await M1.from("docket_matters")
      .update({ case_number: `${MARK}-pad 7` })
      .eq("id", padded.id)
      .select("case_number")
      .single();
    check(
      "control: a matter may correct the letter case of its own number",
      renamed.data?.case_number ?? outcome(renamed),
      `${MARK}-pad 7`,
    );
    const stolen = await M1.from("docket_matters")
      .update({ case_number: `  ${base.toLowerCase()}` })
      .eq("id", padded.id)
      .select("case_number");
    check(
      "B-14 an edit cannot take another matter's number in other letters",
      outcome(stolen),
      DUPLICATE,
    );
    const blanked = await M1.from("docket_matters")
      .update({ matter_title: "   " })
      .eq("id", padded.id)
      .select("matter_title");
    check(
      "B-14 an edit cannot blank the title",
      outcome(blanked),
      "23514 docket_matters_matter_title_not_blank",
    );
  }

  check(
    "B-14 a case number of spaces is refused",
    outcome(
      await createMatter(M1, courtA, { case_number: " ".repeat(127), matter_title: "Real title" }),
    ),
    "23514 docket_matters_case_number_not_blank",
  );
  check(
    "B-14 a title of three spaces is refused",
    outcome(await createMatter(M1, courtA, { matter_title: "   " })),
    "23514 docket_matters_matter_title_not_blank",
  );
  check(
    "B-14 an empty title is refused",
    outcome(await createMatter(M1, courtA, { matter_title: "" })),
    "23514 docket_matters_matter_title_not_blank",
  );
  check(
    "B-14 a 1,000,000-character title is refused",
    outcome(await createMatter(M1, courtA, { matter_title: "z".repeat(1_000_000) })),
    "23514 docket_matters_matter_title_length",
  );
  check(
    "B-14 a 101-character case number is refused",
    outcome(await createMatter(M1, courtA, { case_number: `${MARK}-${"9".repeat(101)}` })),
    "23514 docket_matters_case_number_length",
  );
  check(
    "B-14 a 10,000-character charge is refused",
    outcome(await createMatter(M1, courtA, { charge_or_issue: "c".repeat(10_000) })),
    "23514 docket_matters_charge_or_issue_length",
  );
  check(
    "control: the form's limits themselves are accepted (100 / 300 / 2000)",
    outcome(
      await createMatter(M1, courtA, {
        case_number: `${MARK}-`.padEnd(100, "9"),
        matter_title: "t".repeat(300),
        charge_or_issue: "c".repeat(2000),
      }),
    ),
    "created",
  );

  // ================= C-12: judgment titles and Quick Code content =================
  const judgment = (title) => M1.from("judgments").insert({ title }).select("id").single();
  check(
    "C-12 a 10,000-character judgment title is refused",
    outcome(await judgment("j".repeat(10_000))),
    "23514 judgments_title_length",
  );
  check(
    "C-12 a 301-character judgment title is refused",
    outcome(await judgment("j".repeat(301))),
    "23514 judgments_title_length",
  );
  check(
    "control: a 300-character judgment title is accepted",
    outcome(await judgment("j".repeat(300))),
    "created",
  );
  const quickCode = (content) =>
    M1.from("quick_codes")
      .insert({ code_word: `${WORD}${Math.random().toString(36).slice(2, 6)}`, content })
      .select("id")
      .single();
  check(
    "C-12 100,000 characters of Quick Code content is refused",
    outcome(await quickCode("q".repeat(100_000))),
    "23514 quick_codes_content_length",
  );
  check(
    "C-12 20,001 characters is refused",
    outcome(await quickCode("q".repeat(20_001))),
    "23514 quick_codes_content_length",
  );
  check(
    "control: 20,000 characters is accepted",
    outcome(await quickCode("q".repeat(20_000))),
    "created",
  );

  // ================= C-10: % and _ are literal =================
  const caseLaw = async (caseName, citation) => {
    const row = must(
      await A1.from("case_law")
        .insert({ case_name: caseName, citation, court: "CCJ", jurisdiction: "Guyana" })
        .select("id")
        .single(),
      `case law ${caseName}`,
    );
    created.caseLaw.push(row.id);
    return row.id;
  };
  const percentCase = await caseLaw(`${WORD} Holdings 100% Ltd v State`, `[2026] T7 ${WORD} 1`);
  const underscoreCase = await caseLaw(`${WORD} Q_R Trading v State`, `[2026] T7_${WORD} 2`);
  const lookalikeCase = await caseLaw(`${WORD} QXR Trading v State`, `[2026] T7 ${WORD} 3`);
  const plainCase = await caseLaw(`${WORD} Plain v Ordinary`, `[2026] T7 ${WORD} 4`);
  const percentMatter = must(
    await createMatter(M1, courtA, { matter_title: `Police v. ${WORD} 50% Partner` }),
    "percent matter",
  );

  const global = async (client, query, limit = 100) => {
    const { data, error } = await client.rpc("global_search", { p_query: query, p_limit: limit });
    return error ? { error } : { rows: data ?? [] };
  };
  const scoped = async (client, query) => {
    const { data, error } = await client.rpc("search_case_law_scoped", {
      p_query: query,
      p_limit: 500,
    });
    if (error) throw new Error(`search_case_law_scoped: ${error.message}`);
    return data ?? [];
  };
  const ids = (rows) => rows.map((r) => r.id);
  const contains = (char) => (r) =>
    `${r.title ?? r.case_name ?? ""} ${r.subtitle ?? r.citation ?? ""}`.includes(char);

  for (const char of ["%", "_"]) {
    const g = (await global(M1, char)).rows;
    const caseLawHits = g.filter((r) => r.entity_type === "case_law");
    check(
      `C-10 global "${char}" returns only Case Law that really contains it`,
      caseLawHits.filter((r) => !contains(char)(r)).map((r) => r.title),
      [],
    );
    const s = await scoped(M1, char);
    check(
      `C-10 scoped "${char}" returns only Case Law that really contains it`,
      s.filter((r) => !contains(char)(r)).map((r) => r.case_name),
      [],
    );
    check(
      `C-10 scoped "${char}" no longer returns the plain fixture`,
      ids(s).includes(plainCase),
      false,
    );
  }
  {
    const g = (await global(M1, "%")).rows;
    check('control: global "%" finds the case that contains %', ids(g).includes(percentCase), true);
    check(
      'control: global "%" finds the matter whose title contains %',
      ids(g).includes(percentMatter.id),
      true,
    );
    const s = await scoped(M1, "_");
    check(
      'control: scoped "_" finds the case whose citation contains _',
      ids(s).includes(underscoreCase),
      true,
    );
  }
  {
    // Only the escaped pattern tells these apart: "Q_R" as a LIKE pattern
    // also matched "QXR", and neither is fuzzy-similar to the bare query.
    const s = await scoped(M1, "Q_R");
    check(
      "control: a search containing _ finds the case that has it",
      ids(s).includes(underscoreCase),
      true,
    );
    check("C-10 and _ no longer matches any one character", ids(s).includes(lookalikeCase), false);
    const pct = await scoped(M1, "100%");
    check('control: "100%" finds its case', ids(pct).includes(percentCase), true);
  }
  {
    const g = (await global(M1, WORD)).rows;
    check(
      "control: an ordinary global search finds every fixture",
      [percentCase, underscoreCase, lookalikeCase, plainCase, percentMatter.id].every((id) =>
        ids(g).includes(id),
      ),
      true,
    );
    const padded = (await global(M1, `   ${WORD}  `)).rows;
    check(
      "control: surrounding spaces do not change a global search",
      ids(padded).sort(),
      ids(g).sort(),
    );
    const s = await scoped(M1, `  ${WORD} plain `);
    check("control: a padded scoped search still finds its case", ids(s).includes(plainCase), true);
    const byNumber = (await global(M1, `${MARK}-PAD`)).rows;
    check(
      "control: a matter is still found by part of its case number",
      byNumber.some((r) => r.entity_type === "docket_matter"),
      true,
    );
  }
  for (const blank of ["   ", "\t  ", ""]) {
    check(
      `C-10 global search for ${JSON.stringify(blank)} returns nothing`,
      (await global(M1, blank)).rows,
      [],
    );
  }
  check("C-10 scoped search for spaces returns nothing", await scoped(M1, "   "), []);
  {
    const browse = await scoped(M1, null);
    check(
      "control: a scoped search with no query is still the browse listing",
      ids(browse).includes(plainCase),
      true,
    );
  }

  // ================= C-12: limit and query length =================
  {
    const negative = await global(M1, WORD, -1);
    check("C-12 p_limit -1 is no longer a raw error", negative.error?.message ?? "ok", "ok");
    check("C-12 p_limit -1 is clamped to one row", negative.rows?.length, 1);
    check("C-12 p_limit 0 is clamped to one row", (await global(M1, WORD, 0)).rows?.length, 1);
    const huge = await global(M1, "police", 100_000);
    check("C-12 p_limit 100000 is clamped to at most 100", (huge.rows?.length ?? 999) <= 100, true);
    const { data: unlimited, error } = await M1.rpc("global_search", {
      p_query: WORD,
      p_limit: null,
    });
    check(
      "C-12 p_limit null falls back to the default",
      error?.message ?? (unlimited ?? []).length > 0,
      true,
    );
    const long = await global(M1, "a".repeat(501));
    check(
      "C-12 a 501-character query is refused with a sentence",
      long.error?.message,
      "Search terms must be 500 characters or fewer.",
    );
    check(
      "control: a 500-character query runs",
      (await global(M1, "a".repeat(500))).error?.message ?? "ok",
      "ok",
    );
  }

  // ================= C-12: "finalised" =================
  {
    const j = must(await judgment(`${MARK} R v Notice`), "judgment to finalise");
    must(
      await M1.from("shares")
        .insert({ item_type: "judgment", item_id: j.id, recipient_id: m2.id, permission: "view" })
        .select("id")
        .single(),
      "share judgment",
    );
    must(await M1.from("judgments").update({ status: "final" }).eq("id", j.id), "finalise");
    const notices = must(
      await admin
        .from("notifications")
        .select("title")
        .eq("user_id", m2.id)
        .eq("type", "judgment_final")
        .eq("link", `/judgments/${j.id}`),
      "read notices",
    );
    check(
      "C-12 the notice says finalised",
      notices.map((n) => n.title),
      ["A judgment was finalised"],
    );
  }

  for (const client of [M1, M2, M3, A1]) await client.auth.signOut();
}

async function cleanup() {
  try {
    if (created.users.length > 0) {
      await admin.from("notifications").delete().in("user_id", created.users);
      await admin.from("shares").delete().in("granted_by", created.users);
      await admin.from("shares").delete().in("recipient_id", created.users);
      await admin.from("quick_codes").delete().in("owner_id", created.users);
      await admin.from("judgments").delete().in("owner_id", created.users);
    }
    if (created.caseLaw.length > 0) await admin.from("case_law").delete().in("id", created.caseLaw);
    for (const courtId of created.courts) {
      await admin.from("docket_matters").delete().eq("court_id", courtId);
      await admin.from("magistrate_courts").delete().eq("court_id", courtId);
      await admin.from("courts").delete().eq("id", courtId);
    }
    for (const districtId of created.districts) {
      await admin.from("magisterial_districts").delete().eq("id", districtId);
    }
    const kept = [];
    for (const userId of created.users) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) kept.push(userId);
    }
    console.log(
      kept.length === 0
        ? "Cleanup complete."
        : `Cleanup complete; ${kept.length} audited fixture account(s) kept: ${kept.join(", ")}`,
    );
  } catch (err) {
    console.error("Cleanup encountered an error (some fixtures may need manual removal):", err);
  }
}

try {
  await main();
} catch (err) {
  console.error("Test run threw:", err);
  failures += 1;
} finally {
  await cleanup();
}

process.exit(failures > 0 ? 1 : 0);
