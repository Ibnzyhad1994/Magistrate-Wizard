// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * A deactivated account has no access (0200, 0201), on a real database.
 *
 *   BE-09  an administrator deactivates a fixture magistrate, a fixture
 *          administrator and a fixture clerk with set_profile_active. Each
 *          one's existing access token can no longer read the Docket,
 *          insert a matter, pass is_admin() or my_court_id(), or write its
 *          own profile, but still reads its own profile (is_active false);
 *          its refresh token is dead and signing in again is refused as
 *          user_banned. Their court assignments stay open and come back in
 *          the result. Reactivating restores access with a fresh sign-in.
 *          Only an active administrator may call it; deactivating needs a
 *          reason; the last active administrator cannot deactivate
 *          themselves; a direct is_active write is refused, admins
 *          included; repeating a call is a no-op that keeps the ban; the
 *          change is audited with its reason. Every public table with RLS,
 *          and storage.objects, carries the restrictive policy, so a new
 *          table cannot miss it.
 *
 * The seeded administrator acts. The last-administrator check runs inside
 * one psql transaction that is rolled back.
 *
 *   npm run db:start && npm run test:account-deactivation
 */
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";
import { runSql, sections } from "../test-support/psql.mjs";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
assertLocalSupabase(URL, "test-account-deactivation");
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

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const service = createClient(URL, SERVICE, noSession);
const stamp = Date.now();
const PASSWORD = "Test-Password-123!";
const fixtureEmail = (name) => `deactivation-${name}-${stamp}@example.test`;

/** Signs in and returns a client pinned to that one access token. */
async function signIn(email, password = PASSWORD) {
  const { data, error } = await createClient(URL, ANON, noSession).auth.signInWithPassword({
    email,
    password,
  });
  if (error) return { error };
  return {
    id: data.user.id,
    refreshToken: data.session.refresh_token,
    client: createClient(URL, ANON, {
      ...noSession,
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    }),
  };
}

async function signInOrThrow(email, password) {
  const session = await signIn(email, password);
  if (session.error) throw new Error(`Could not sign in ${email}: ${session.error.message}`);
  return session;
}

const created = { users: [], courtId: null, districtId: null };

async function createFixtureUser(name, role) {
  const { data, error } = await service.auth.admin.createUser({
    email: fixtureEmail(name),
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  created.users.push(data.user.id);
  const { error: roleErr } = await service
    .from("profiles")
    .update({ role, full_name: `Deactivation ${name}` })
    .eq("id", data.user.id);
  if (roleErr) throw roleErr;
  return data.user;
}

/** The rows and the ban an account holds, read as the database sees them. */
function authState(userId) {
  const out = sections(
    runSql(
      `\\echo @@state
       select json_build_object(
         'banned', u.banned_until is not null and u.banned_until > now(),
         'sessions', (select count(*) from auth.sessions s where s.user_id = u.id)
       )
       from auth.users u where u.id = '${userId}';`,
      "test-account-deactivation",
    ),
  );
  return JSON.parse(out.state);
}

/** What a signed-in client can still do: the BE-09 lock-out surface. */
async function reach(session, matterId, courtId) {
  const docket = await session.client.from("docket_matters").select("id").eq("id", matterId);
  const insert = await session.client
    .from("docket_matters")
    .insert({
      court_id: courtId,
      case_number: `DEACT-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
      matter_title: "Deactivation probe",
    })
    .select("id")
    .single();
  const isAdmin = await session.client.rpc("is_admin");
  const courtIdNow = await session.client.rpc("my_court_id");
  const active = await session.client.rpc("is_active_account");
  const profile = await session.client.from("profiles").select("id, is_active");
  return {
    readsDocket: (docket.data ?? []).length === 1,
    insertsMatter: !insert.error && !!insert.data,
    isAdmin: isAdmin.data === true,
    hasCourt: courtIdNow.data !== null && courtIdNow.data !== undefined,
    isActiveAccount: active.data === true,
    profiles: (profile.data ?? []).map((p) => ({ own: p.id === session.id, active: p.is_active })),
  };
}

async function main() {
  const actor = await signInOrThrow("admin@magistrate-wizard.local", "password123");

  const { data: district, error: districtErr } = await service
    .from("magisterial_districts")
    .insert({ name: `TEST Deactivation District ${stamp}` })
    .select()
    .single();
  if (districtErr) throw districtErr;
  created.districtId = district.id;
  const { data: court, error: courtErr } = await service
    .from("courts")
    .insert({
      name: `TEST Deactivation Court ${stamp}`,
      jurisdiction: "Test",
      district_id: district.id,
      is_active: true,
    })
    .select()
    .single();
  if (courtErr) throw courtErr;
  created.courtId = court.id;

  const magistrateUser = await createFixtureUser("magistrate", "magistrate");
  const adminUser = await createFixtureUser("admin", "admin");
  const clerkUser = await createFixtureUser("clerk", "clerk");
  const now = new Date().toISOString();
  for (const row of [
    { profile_id: magistrateUser.id, assignment_type: "regular" },
    { profile_id: adminUser.id, assignment_type: "acting" },
  ]) {
    const { error } = await service
      .from("magistrate_courts")
      .insert({ ...row, court_id: court.id, started_at: now });
    if (error) throw error;
  }
  {
    const { error } = await service.from("clerk_courts").insert({
      profile_id: clerkUser.id,
      court_id: court.id,
      approved_by: magistrateUser.id,
      started_at: now,
    });
    if (error) throw error;
  }
  for (const id of [magistrateUser.id, adminUser.id, clerkUser.id]) {
    const { error } = await service.from("profiles").update({ court_id: court.id }).eq("id", id);
    if (error) throw error;
  }

  const magistrate = await signInOrThrow(magistrateUser.email);
  const fixtureAdmin = await signInOrThrow(adminUser.email);
  const clerk = await signInOrThrow(clerkUser.email);

  const { data: matter, error: matterErr } = await magistrate.client
    .from("docket_matters")
    .insert({ court_id: court.id, case_number: `DEACT-${stamp}`, matter_title: "Deactivation" })
    .select("id")
    .single();
  if (matterErr) throw matterErr;

  // ---------- before: every fixture has its normal access ----------
  check(
    "BE-09 before: the magistrate reaches the Docket and its court",
    await reach(magistrate, matter.id, court.id),
    {
      readsDocket: true,
      insertsMatter: true,
      isAdmin: false,
      hasCourt: true,
      isActiveAccount: true,
      profiles: [{ own: true, active: true }],
    },
  );
  {
    const r = await reach(fixtureAdmin, matter.id, court.id);
    check(
      "BE-09 before: the fixture administrator passes is_admin() and reaches the Docket",
      [r.isAdmin, r.readsDocket, r.insertsMatter],
      [true, true, true],
    );
  }
  {
    const r = await reach(clerk, matter.id, court.id);
    check(
      "BE-09 before: the clerk reads the Docket of their court",
      [r.readsDocket, r.hasCourt],
      [true, true],
    );
  }

  // ---------- who may call it, and with what ----------
  {
    const { error } = await createClient(URL, ANON, noSession).rpc("set_profile_active", {
      p_profile_id: clerkUser.id,
      p_active: false,
      p_reason: "anon",
    });
    check("BE-09 anon cannot call set_profile_active", !!error, true);
  }
  {
    const { error } = await magistrate.client.rpc("set_profile_active", {
      p_profile_id: clerkUser.id,
      p_active: false,
      p_reason: "not an admin",
    });
    check("BE-09 a magistrate cannot deactivate anyone", error?.code, "42501");
  }
  {
    const { error } = await actor.client.rpc("set_profile_active", {
      p_profile_id: clerkUser.id,
      p_active: false,
      p_reason: "   ",
    });
    check("BE-09 deactivating needs a reason", error?.code, "22023");
  }
  {
    const { error } = await actor.client
      .from("profiles")
      .update({ is_active: false })
      .eq("id", clerkUser.id);
    const { data } = await service
      .from("profiles")
      .select("is_active")
      .eq("id", clerkUser.id)
      .single();
    check(
      "BE-09 an administrator cannot write is_active directly",
      [error?.code, data?.is_active],
      ["42501", true],
    );
  }

  // ---------- deactivate ----------
  const results = {};
  for (const [name, user] of [
    ["magistrate", magistrateUser],
    ["admin", adminUser],
    ["clerk", clerkUser],
  ]) {
    const { data, error } = await actor.client.rpc("set_profile_active", {
      p_profile_id: user.id,
      p_active: false,
      p_reason: `BE-09 test: ${name} left the bench`,
    });
    check(`BE-09 the administrator deactivates the ${name}`, error, null);
    results[name] = data;
    check(
      `BE-09 the ${name}'s deactivation changed the account`,
      [data?.is_active, data?.changed],
      [false, true],
    );
    check(
      `BE-09 the ${name}'s sign-in session was revoked`,
      (data?.sessions_revoked ?? 0) >= 1,
      true,
    );
    check(`BE-09 the ${name} is banned and has no session left`, authState(user.id), {
      banned: true,
      sessions: 0,
    });
  }

  check(
    "BE-09 the magistrate's open court assignment comes back to reassign",
    (results.magistrate?.court_assignments ?? []).map((a) => [
      a.kind,
      a.court_id,
      a.court_name,
      a.assignment_type,
    ]),
    [["magistrate", court.id, court.name, "regular"]],
  );
  check(
    "BE-09 the administrator's acting assignment comes back to reassign",
    (results.admin?.court_assignments ?? []).map((a) => [a.kind, a.court_id, a.assignment_type]),
    [["magistrate", court.id, "acting"]],
  );
  check(
    "BE-09 the clerk's court assignment comes back to reassign",
    (results.clerk?.court_assignments ?? []).map((a) => [a.kind, a.court_id]),
    [["clerk", court.id]],
  );
  {
    const { data: mc } = await service
      .from("magistrate_courts")
      .select("profile_id")
      .eq("court_id", court.id)
      .is("ended_at", null);
    const { data: cc } = await service
      .from("clerk_courts")
      .select("profile_id")
      .eq("court_id", court.id)
      .is("ended_at", null);
    check(
      "BE-09 deactivation ends no court assignment",
      [(mc ?? []).length, (cc ?? []).length],
      [2, 1],
    );
  }

  // ---------- after: the existing access tokens are locked out ----------
  const lockedOut = {
    readsDocket: false,
    insertsMatter: false,
    isAdmin: false,
    hasCourt: false,
    isActiveAccount: false,
    profiles: [{ own: true, active: false }],
  };
  check(
    "BE-09 the magistrate's existing token is locked out, seeing only its own profile",
    await reach(magistrate, matter.id, court.id),
    lockedOut,
  );
  check(
    "BE-09 the administrator's existing token no longer passes is_admin() or reaches anything",
    await reach(fixtureAdmin, matter.id, court.id),
    lockedOut,
  );
  check(
    "BE-09 the clerk's existing token is locked out",
    await reach(clerk, matter.id, court.id),
    lockedOut,
  );
  {
    const { data } = await magistrate.client.from("notifications").select("id");
    check("BE-09 ownership-only tables are closed too (notifications)", (data ?? []).length, 0);
  }
  {
    await magistrate.client
      .from("profiles")
      .update({ full_name: "Renamed" })
      .eq("id", magistrate.id);
    const { data } = await service
      .from("profiles")
      .select("full_name")
      .eq("id", magistrate.id)
      .single();
    check(
      "BE-09 a deactivated account cannot write its own profile",
      data?.full_name,
      "Deactivation magistrate",
    );
  }
  {
    const { error } = await fixtureAdmin.client.rpc("set_profile_active", {
      p_profile_id: clerkUser.id,
      p_active: true,
    });
    check("BE-09 a deactivated administrator cannot reactivate anyone", error?.code, "42501");
  }
  {
    const { error } = await createClient(URL, ANON, noSession).auth.refreshSession({
      refresh_token: magistrate.refreshToken,
    });
    check("BE-09 the deactivated magistrate's refresh token no longer works", !!error, true);
  }
  {
    const again = await signIn(magistrateUser.email);
    check("BE-09 signing in again is refused as user_banned", again.error?.code, "user_banned");
  }

  // ---------- idempotent, and audited ----------
  {
    const { data, error } = await actor.client.rpc("set_profile_active", {
      p_profile_id: magistrateUser.id,
      p_active: false,
      p_reason: "again",
    });
    check(
      "BE-09 deactivating again is a no-op that keeps the ban",
      [error, data?.changed, data?.sessions_revoked],
      [null, false, 0],
    );
    check("BE-09 still banned with no session", authState(magistrateUser.id), {
      banned: true,
      sessions: 0,
    });
  }
  {
    const { data } = await service
      .from("audit_log")
      .select("actor_id, new_data")
      .eq("table_name", "profiles")
      .eq("record_id", magistrateUser.id)
      .eq("new_data->>event", "account_deactivated");
    check(
      "BE-09 one deactivation event names the administrator and the reason",
      (data ?? []).map((a) => [a.actor_id, a.new_data.reason]),
      [[actor.id, "BE-09 test: magistrate left the bench"]],
    );
  }

  // ---------- the last active administrator ----------
  {
    const out = sections(
      runSql(
        `begin;
         update public.profiles set is_active = false
         where role = 'admin' and is_active and id <> '${actor.id}';
         select set_config(
           'request.jwt.claims',
           json_build_object('sub', '${actor.id}', 'role', 'authenticated')::text,
           true
         );
         set local role authenticated;
         do $$
         begin
           perform public.set_profile_active('${actor.id}', false, 'leaving');
           perform set_config('be09.result', 'allowed', true);
         exception when others then
           perform set_config('be09.result', sqlstate || ' ' || sqlerrm, true);
         end;
         $$;
         \\echo @@result
         select current_setting('be09.result', true);
         rollback;`,
        "test-account-deactivation",
      ),
    );
    check(
      "BE-09 the last active administrator cannot deactivate themselves",
      out.result.startsWith("P0001 This is the last active administrator"),
      true,
    );
  }

  // ---------- every table carries the restrictive policy ----------
  {
    const out = sections(
      runSql(
        `\\echo @@missing
         select coalesce(json_agg(c.relname order by c.relname), '[]')
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind in ('r', 'p')
           and c.relrowsecurity
           and c.relname <> 'profiles'
           and not exists (
             select 1 from pg_policies p
             where p.schemaname = 'public'
               and p.tablename = c.relname
               and p.permissive = 'RESTRICTIVE'
               and p.cmd = 'ALL'
               and p.roles = array['authenticated']::name[]
               and p.qual like '%is_active_account()%'
               and p.with_check like '%is_active_account()%'
           );
         \\echo @@profiles
         select coalesce(json_agg(p.cmd order by p.cmd), '[]')
         from pg_policies p
         where p.schemaname = 'public' and p.tablename = 'profiles'
           and p.permissive = 'RESTRICTIVE'
           and coalesce(p.qual, p.with_check) like '%is_active_account()%';
         \\echo @@storage
         select count(*) from pg_policies p
         where p.schemaname = 'storage' and p.tablename = 'objects'
           and p.permissive = 'RESTRICTIVE' and p.cmd = 'ALL'
           and p.qual like '%is_active_account()%';`,
        "test-account-deactivation",
      ),
    );
    check(
      "BE-09 every public table with RLS has the restrictive policy",
      JSON.parse(out.missing),
      [],
    );
    check("BE-09 profiles restricts every command", JSON.parse(out.profiles), [
      "DELETE",
      "INSERT",
      "SELECT",
      "UPDATE",
    ]);
    check("BE-09 storage.objects has the restrictive policy", out.storage, "1");
  }

  // ---------- reactivate ----------
  for (const [name, user] of [
    ["magistrate", magistrateUser],
    ["admin", adminUser],
  ]) {
    const { data, error } = await actor.client.rpc("set_profile_active", {
      p_profile_id: user.id,
      p_active: true,
    });
    check(
      `BE-09 the administrator reactivates the ${name}`,
      [error, data?.is_active, data?.changed],
      [null, true, true],
    );
    check(`BE-09 the ${name}'s ban is lifted`, authState(user.id).banned, false);
  }
  {
    const back = await signInOrThrow(magistrateUser.email);
    check(
      "BE-09 the reactivated magistrate signs in and reaches the Docket again",
      await reach(back, matter.id, court.id),
      {
        readsDocket: true,
        insertsMatter: true,
        isAdmin: false,
        hasCourt: true,
        isActiveAccount: true,
        profiles: [{ own: true, active: true }],
      },
    );
  }
  {
    const back = await signInOrThrow(adminUser.email);
    const r = await reach(back, matter.id, court.id);
    check(
      "BE-09 the reactivated administrator passes is_admin() again",
      [r.isAdmin, r.readsDocket],
      [true, true],
    );
  }
}

async function cleanup() {
  try {
    if (created.courtId) {
      await service.from("docket_matters").delete().eq("court_id", created.courtId);
      await service.from("clerk_courts").delete().eq("court_id", created.courtId);
      await service.from("magistrate_courts").delete().eq("court_id", created.courtId);
      await service.from("courts").delete().eq("id", created.courtId);
    }
    if (created.districtId) {
      await service.from("magisterial_districts").delete().eq("id", created.districtId);
    }
    // A fixture that wrote audited rows cannot be deleted (audit_log is
    // append-only); it is left deactivated, as an offboarded account is.
    let kept = 0;
    for (const userId of created.users) {
      const { error } = await service.auth.admin.deleteUser(userId);
      if (error) {
        kept += 1;
        await service.from("profiles").update({ is_active: false }).eq("id", userId);
      }
    }
    console.log(
      kept === 0
        ? "Cleanup complete."
        : `Cleanup complete; ${kept} fixture user(s) referenced by audit_log were deactivated.`,
    );
  } catch (err) {
    console.error("Cleanup error (some fixtures may need manual removal):", err);
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
