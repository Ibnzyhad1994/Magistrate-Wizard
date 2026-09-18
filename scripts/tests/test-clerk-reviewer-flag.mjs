// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * The clerk-access deadlock, and the one control that clears it (G1).
 *
 * docs/daylife-30-findings.md recorded this as its only hard "break": a
 * court with more than one seated magistrate froze clerk approval, and
 * the only key -- magistrate_courts.can_manage_clerks -- had no UI, so an
 * administrator could not clear it without SQL.
 *
 * A later fix (99b628b) widened can_manage_clerk_access() to include the
 * SOLE REGULAR magistrate, which covers the reported case of a covering
 * or acting magistrate sitting alongside a regular. What it does NOT
 * cover is two REGULARS at one court, which is still reachable. This
 * pins both halves: that the common case no longer deadlocks, and that
 * the flag clears the remaining one.
 *
 *   npm run db:start && npm run test:clerk-reviewer-flag
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

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

const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

/** Fixture setup runs with the service role; the ACT runs as a real admin. */
const db = createClient(URL, SERVICE, { auth: { persistSession: false } });
const asAdmin = createClient(URL, ANON, { auth: { persistSession: false } });
const created = [];

try {
  const { data: court } = await db.from("courts").select("id").limit(1).single();
  const { data: mags } = await db.from("profiles").select("id").eq("role", "magistrate").limit(2);
  if (!mags || mags.length < 2) throw new Error("need two magistrate profiles");
  const [a, b] = mags;

  // Clear the decks for this court so the fixture is the only seating.
  const { data: existing } = await db
    .from("magistrate_courts")
    .select("id")
    .eq("court_id", court.id)
    .is("ended_at", null);
  for (const row of existing ?? []) {
    await db
      .from("magistrate_courts")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", row.id);
  }

  const seat = async (profileId, type) => {
    const { data, error } = await db
      .from("magistrate_courts")
      .insert({ profile_id: profileId, court_id: court.id, assignment_type: type })
      .select("id")
      .single();
    if (error) throw new Error(`seat: ${error.message}`);
    created.push(data.id);
    return data.id;
  };

  // 1. One regular plus one ACTING: the reported break. Must NOT deadlock.
  const aSeat = await seat(a.id, "regular");
  await seat(b.id, "acting");
  const reviewers = async () => {
    const { data } = await db
      .from("magistrate_courts")
      .select("profile_id, assignment_type, can_manage_clerks")
      .eq("court_id", court.id)
      .is("ended_at", null);
    return data ?? [];
  };

  let rows = await reviewers();
  check("a regular and an acting magistrate are both seated", rows.length, 2);
  check(
    "the regular is the only regular, which is what unblocks review",
    rows.filter((r) => r.assignment_type === "regular").length,
    1,
  );

  // 2. Two REGULARS: the case still reachable, where neither is sole.
  // Seated directly rather than by converting the acting row -- the
  // exclusivity trigger rightly refuses that conversion, so the reachable
  // route is a second regular seating.
  await db
    .from("magistrate_courts")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", created[1]);
  await seat(b.id, "regular");
  rows = await reviewers();
  check(
    "two regulars can be current at one court",
    rows.filter((r) => r.assignment_type === "regular").length,
    2,
  );
  check(
    "and neither is flagged as a reviewer",
    rows.every((r) => r.can_manage_clerks === false),
    true,
  );

  // 3. The control an administrator now has.
  // The flag is admin-only by policy (0052) AND by trigger (0152), so it
  // must be exercised as a signed-in administrator: the service role has
  // no JWT, so is_admin() is false for it and the trigger refuses.
  const { error: signInError } = await asAdmin.auth.signInWithPassword({
    email: "admin@magistrate-wizard.local",
    password: "password123",
  });
  if (signInError) throw new Error(`admin sign in: ${signInError.message}`);

  const { error: flagError } = await asAdmin
    .from("magistrate_courts")
    .update({ can_manage_clerks: true })
    .eq("id", aSeat)
    .is("ended_at", null);
  check("an administrator can name a reviewer", flagError, null);
  rows = await reviewers();
  check(
    "exactly one magistrate now carries the flag",
    rows.filter((r) => r.can_manage_clerks).length,
    1,
  );

  // 4. And can take it away again.
  const { error: clearError } = await asAdmin
    .from("magistrate_courts")
    .update({ can_manage_clerks: false })
    .eq("id", aSeat);
  check("it can be withdrawn", clearError, null);
  rows = await reviewers();
  check(
    "and nobody carries it afterwards",
    rows.every((r) => r.can_manage_clerks === false),
    true,
  );

  // A magistrate must not be able to grant it to themselves.
  const asMagistrate = createClient(URL, ANON, { auth: { persistSession: false } });
  await asMagistrate.auth.signInWithPassword({
    email: "magistrate@magistrate-wizard.local",
    password: "password123",
  });
  await asMagistrate.from("magistrate_courts").update({ can_manage_clerks: true }).eq("id", aSeat);
  // An RLS-filtered UPDATE matches no row and returns NO error, so the
  // absence of an error proves nothing. Read the value back instead.
  rows = await reviewers();
  check(
    "a magistrate cannot grant it to themselves",
    rows.every((r) => r.can_manage_clerks === false),
    true,
  );
  await asMagistrate.auth.signOut();
  await asAdmin.auth.signOut();
} finally {
  for (const id of created) {
    await db.from("magistrate_courts").delete().eq("id", id);
  }
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
