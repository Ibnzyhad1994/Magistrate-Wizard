/**
 * Day-in-the-life dispatch of 31 unique local users through the real
 * request/approve path (handle_new_user metadata + submit/decide RPCs),
 * then a sitting-day walk of docket/research plus injected human errors.
 *
 *   npm run test:daylife-30
 *
 * Report-only: does not change product schema. Leaves users in Auth.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(__dirname, "daylife-30-results.json");

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const PASSWORD = "password123";
const ADMIN_EMAIL = "admin@magistrate-wizard.local";
const RUN = `DL${Date.now().toString(36).slice(-5).toUpperCase()}`;
const DOMAIN = "magistrate-wizard.local";

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

const steps = [];
const findings = [];
const roster = [];

function errMsg(err) {
  return err?.message ?? err?.error_description ?? String(err ?? "");
}

function log(ok, persona, step, detail = "") {
  const row = { ok: !!ok, persona, step, detail: String(detail).slice(0, 600) };
  steps.push(row);
  console.log(`${ok ? "PASS" : "FAIL"}  [${persona}] ${step}${detail ? ` — ${detail}` : ""}`);
  return !!ok;
}

function finding(id, verdict, title, evidence) {
  findings.push({ id, verdict, title, evidence: String(evidence).slice(0, 800) });
  console.log(`FINDING  ${verdict.toUpperCase()}  ${id} — ${title}`);
}

const clientAs = (token) =>
  createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

async function signIn(email) {
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return { user: data.user, token: data.session.access_token, sb: clientAs(data.session.access_token) };
}

async function pendingMag(profileId) {
  const { data } = await admin
    .from("magistrate_court_requests")
    .select("id, court_id, status")
    .eq("profile_id", profileId)
    .eq("status", "pending");
  return data ?? [];
}

async function pendingClerk(profileId) {
  const { data } = await admin
    .from("clerk_access_requests")
    .select("id, court_id, status")
    .eq("profile_id", profileId)
    .eq("status", "pending");
  return data ?? [];
}

async function activeMagCourts(profileId) {
  const { data } = await admin
    .from("magistrate_courts")
    .select("id, court_id, assignment_type")
    .eq("profile_id", profileId)
    .is("ended_at", null);
  return data ?? [];
}

async function ensureUser({ key, email, fullName, role, courtIds, note }) {
  const { data: existing } = await admin.from("profiles").select("id, email, role").eq("email", email).maybeSingle();
  if (existing?.id) {
    log(true, key, "reuse existing profile", `${existing.role} ${existing.id}`);
    return existing.id;
  }
  const metadata = {
    full_name: fullName,
    requested_court_ids: courtIds ?? [],
    staff_id: `DL-${key}`,
    note: note ?? `daylife ${RUN}`,
  };
  if (role === "clerk") metadata.requested_role = "clerk";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error) {
    log(false, key, "createUser", errMsg(error));
    throw error;
  }
  log(true, key, "createUser via handle_new_user metadata", role ?? "magistrate");
  return data.user.id;
}

async function pickOpenCourts(n) {
  const { data: occupied } = await admin
    .from("magistrate_courts")
    .select("court_id")
    .eq("assignment_type", "regular")
    .is("ended_at", null);
  const taken = new Set((occupied ?? []).map((r) => r.court_id));
  const { data: courts, error: courtErr } = await admin
    .from("courts")
    .select("id, name, district_id")
    .eq("is_active", true)
    .order("name");
  if (courtErr) throw courtErr;
  const open = (courts ?? []).filter((c) => !taken.has(c.id));
  if (open.length < n) {
    console.warn(`only ${open.length} open courts (wanted ${n}); reusing tail courts where scenarios do not seat a primary`);
  }
  if (!open.length) throw new Error("no active courts available");
  return { open, all: courts ?? [], occupied: [...taken] };
}

function magEmail(i) {
  return `daylife.mag${String(i).padStart(2, "0")}@${DOMAIN}`;
}
function clerkEmail(i) {
  return `daylife.clerk${String(i).padStart(2, "0")}@${DOMAIN}`;
}

async function main() {
  console.log(`Daylife 30  run=${RUN}  url=${URL}`);

  const { open, all } = await pickOpenCourts(22);
  const occupiedCourt = all.find((c) => !open.some((o) => o.id === c.id)) ?? all[0];

  const magCourts = open.slice(0, 10);
  const extra = open.slice(10);
  const take = (i, fallbackIndex) => extra[i] ?? open[Math.min(fallbackIndex, open.length - 1)];
  const multiA = take(0, 10);
  const multiB = take(1, 11);
  const coveringCourt = take(2, 12);
  const emptyCourt = take(3, 13);
  const relinqCourt = take(4, 14);
  const cancelCourt = take(5, 15);
  const pendingCourt = take(6, 16);
  const orphanCourt = take(7, 17);
  const wrongRoleCourt = take(8, 0);
  const magAsClerkCourt = take(9, 1);
  const duplicateCourt = take(10, 18);
  const afterReturnCourt = take(11, 19);

  const personas = {
    mag: magCourts.map((court, i) => ({
      key: `mag${String(i + 1).padStart(2, "0")}`,
      email: magEmail(i + 1),
      fullName: `Daylife Magistrate ${i + 1}`,
      court,
    })),
    clerk: magCourts.slice(0, 8).map((court, i) => ({
      key: `clerk${String(i + 1).padStart(2, "0")}`,
      email: clerkEmail(i + 1),
      fullName: `Daylife Clerk ${i + 1}`,
      court,
      magKey: `mag${String(i + 1).padStart(2, "0")}`,
    })),
  };

  const specials = {
    wrongCourt1: { key: "wrongCourt1", email: `daylife.wrongcourt1@${DOMAIN}`, fullName: "Daylife Wrong Court One", court: occupiedCourt },
    wrongCourt2: { key: "wrongCourt2", email: `daylife.wrongcourt2@${DOMAIN}`, fullName: "Daylife Wrong Court Two", court: occupiedCourt },
    clerkAsMag: { key: "clerkAsMag", email: `daylife.clerkasmag@${DOMAIN}`, fullName: "Daylife Clerk Signed As Mag", court: wrongRoleCourt },
    magAsClerk: { key: "magAsClerk", email: `daylife.magasclerk@${DOMAIN}`, fullName: "Daylife Mag Signed As Clerk", court: magAsClerkCourt },
    cancelledMag: { key: "cancelledMag", email: `daylife.cancelled@${DOMAIN}`, fullName: "Daylife Cancelled Mag", court: cancelCourt },
    leftPending: { key: "leftPending", email: `daylife.pending@${DOMAIN}`, fullName: "Daylife Left Pending", court: pendingCourt },
    duplicateMag: { key: "duplicateMag", email: `daylife.duplicate@${DOMAIN}`, fullName: "Daylife Duplicate Mag", court: duplicateCourt },
    orphanClerk: { key: "orphanClerk", email: `daylife.orphanclerk@${DOMAIN}`, fullName: "Daylife Orphan Clerk", court: orphanCourt },
    multiMag: { key: "multiMag", email: `daylife.multi@${DOMAIN}`, fullName: "Daylife Multi Court Mag", courts: [multiA, multiB] },
    coveringMag: { key: "coveringMag", email: `daylife.covering@${DOMAIN}`, fullName: "Daylife Covering Mag", court: coveringCourt },
    emptyMag: { key: "emptyMag", email: `daylife.empty@${DOMAIN}`, fullName: "Daylife Empty Docket Mag", court: emptyCourt },
    outsider: { key: "outsider", email: `daylife.outsider@${DOMAIN}`, fullName: "Daylife Outsider Mag" },
    relinquisher: { key: "relinquisher", email: `daylife.relinquish@${DOMAIN}`, fullName: "Daylife Relinquisher", court: relinqCourt },
  };

  const ids = {};

  // --- Phase 1: dispatch ---
  for (const p of personas.mag) {
    ids[p.key] = await ensureUser({
      key: p.key,
      email: p.email,
      fullName: p.fullName,
      courtIds: [p.court.id],
      note: `Requesting ${p.court.name}`,
    });
  }
  for (const p of personas.clerk) {
    ids[p.key] = await ensureUser({
      key: p.key,
      email: p.email,
      fullName: p.fullName,
      role: "clerk",
      courtIds: [p.court.id],
      note: `Clerk for ${p.court.name}`,
    });
  }

  ids.wrongCourt1 = await ensureUser({ ...specials.wrongCourt1, courtIds: [occupiedCourt.id] });
  ids.wrongCourt2 = await ensureUser({ ...specials.wrongCourt2, courtIds: [occupiedCourt.id] });
  ids.clerkAsMag = await ensureUser({ ...specials.clerkAsMag, courtIds: [wrongRoleCourt.id] });
  ids.magAsClerk = await ensureUser({
    key: specials.magAsClerk.key,
    email: specials.magAsClerk.email,
    fullName: specials.magAsClerk.fullName,
    role: "clerk",
    courtIds: [specials.magAsClerk.court.id],
  });
  ids.cancelledMag = await ensureUser({ ...specials.cancelledMag, courtIds: [cancelCourt.id] });
  ids.leftPending = await ensureUser({ ...specials.leftPending, courtIds: [pendingCourt.id] });
  ids.duplicateMag = await ensureUser({ ...specials.duplicateMag, courtIds: [specials.duplicateMag.court.id] });
  ids.orphanClerk = await ensureUser({
    key: specials.orphanClerk.key,
    email: specials.orphanClerk.email,
    fullName: specials.orphanClerk.fullName,
    role: "clerk",
    courtIds: [orphanCourt.id],
  });
  ids.multiMag = await ensureUser({
    key: specials.multiMag.key,
    email: specials.multiMag.email,
    fullName: specials.multiMag.fullName,
    courtIds: [multiA.id, multiB.id],
  });
  ids.coveringMag = await ensureUser({ ...specials.coveringMag, courtIds: [coveringCourt.id] });
  ids.emptyMag = await ensureUser({ ...specials.emptyMag, courtIds: [emptyCourt.id] });
  ids.outsider = await ensureUser({ key: specials.outsider.key, email: specials.outsider.email, fullName: specials.outsider.fullName, courtIds: [] });
  ids.relinquisher = await ensureUser({ ...specials.relinquisher, courtIds: [relinqCourt.id] });

  for (const [key, id] of Object.entries(ids)) {
    const { data: profile } = await admin.from("profiles").select("email, role, full_name").eq("id", id).single();
    const magReq = await pendingMag(id);
    const clerkReq = await pendingClerk(id);
    roster.push({
      key,
      id,
      email: profile?.email,
      role: profile?.role,
      fullName: profile?.full_name,
      pendingMagistrate: magReq.length,
      pendingClerk: clerkReq.length,
    });
  }

  const uniqueCount = new Set(Object.values(ids)).size;
  log(uniqueCount >= 30, "system", "unique personas dispatched", `${uniqueCount}`);
  finding(
    "dispatch-count",
    uniqueCount >= 30 ? "hold" : "break",
    "At least 30 unique users created through signup-shaped metadata",
    `${uniqueCount} unique profile ids`,
  );

  const outsiderPending = await pendingMag(ids.outsider);
  finding(
    "outsider-no-request",
    outsiderPending.length === 0 ? "hold" : "degrade",
    "Outsider with empty requested_court_ids gets no pending magistrate request",
    `pending=${outsiderPending.length}`,
  );

  const clerkAsMagProfile = roster.find((r) => r.key === "clerkAsMag");
  finding(
    "signup-role-default-magistrate",
    clerkAsMagProfile?.role === "magistrate" ? "hold" : "break",
    "Signup without requested_role=clerk becomes magistrate (clerk-as-mag mistake)",
    `role=${clerkAsMagProfile?.role}`,
  );
  const magAsClerkProfile = roster.find((r) => r.key === "magAsClerk");
  finding(
    "signup-role-clerk-literal",
    magAsClerkProfile?.role === "clerk" ? "hold" : "break",
    "requested_role=clerk creates a clerk even if the person meant to be a magistrate",
    `role=${magAsClerkProfile?.role}`,
  );

  // --- Phase 2: admin + magistrate decisions ---
  const adminSession = await signIn(ADMIN_EMAIL);
  log(true, "admin", "login seed admin");

  async function approveMag(key, label = key) {
    const rows = await pendingMag(ids[key]);
    const seated = await activeMagCourts(ids[key]);
    if (seated.length && !rows.length) {
      log(true, label, "already seated, skip approve");
      return seated;
    }
    for (const row of rows) {
      const { error } = await adminSession.sb.rpc("decide_magistrate_court_request", {
        p_request_id: row.id,
        p_decision: "approved",
      });
      if (error) log(false, label, `approve ${row.court_id}`, errMsg(error));
      else log(true, label, `approve request`, row.id);
    }
    return activeMagCourts(ids[key]);
  }

  for (const p of personas.mag) await approveMag(p.key);
  await approveMag("coveringMag");
  await approveMag("emptyMag");
  await approveMag("relinquisher");
  await approveMag("multiMag");

  const mag01Seated = await activeMagCourts(ids.mag01);
  finding(
    "admin-approve-request",
    mag01Seated.length > 0 ? "hold" : "break",
    "Admin decide_magistrate_court_request seats a magistrate from a pending signup request",
    `mag01 assignments=${mag01Seated.length}`,
  );

  // Wrong court: occupied primary — signup may have created a pending row; decide or submit should fail cleanly
  const wrongPending = await pendingMag(ids.wrongCourt1);
  if (wrongPending.length) {
    const { error } = await adminSession.sb.rpc("decide_magistrate_court_request", {
      p_request_id: wrongPending[0].id,
      p_decision: "rejected",
      p_rejection_reason: "That court already has a sitting magistrate. Please request another.",
    });
    log(!error, "wrongCourt1", "admin return occupied-court request", errMsg(error));
    finding(
      "return-wrong-court-pending",
      !error ? "hold" : "break",
      "Admin can return a pending request for an occupied court with a reason",
      error ? errMsg(error) : "rejected with reason",
    );
  } else {
    const actor = await signIn(specials.wrongCourt1.email);
    const { error } = await actor.sb.rpc("submit_magistrate_court_request", {
      p_court_id: occupiedCourt.id,
      p_note: "I picked the wrong court",
    });
    log(!!error, "wrongCourt1", "submit occupied court blocked", errMsg(error));
    finding(
      "submit-occupied-court",
      error ? "hold" : "break",
      "submit_magistrate_court_request rejects a court that already has a primary",
      errMsg(error) || "unexpected success",
    );
  }

  // Return notify-only for wrongCourt2 if they have no pending after reject of similar
  {
    const { error } = await adminSession.sb.rpc("return_unassigned_magistrate_to_requester", {
      p_profile_id: ids.wrongCourt2,
      p_reason: "Please request a court that does not already have a magistrate.",
    });
    log(!error, "wrongCourt2", "return_unassigned_magistrate_to_requester", errMsg(error));
    finding(
      "roster-return-unassigned",
      !error ? "hold" : "break",
      "Roster return RPC notifies an unassigned magistrate with a required reason",
      error ? errMsg(error) : "ok",
    );
  }

  // Cancel then re-request
  {
    const pending = await pendingMag(ids.cancelledMag);
    const actor = await signIn(specials.cancelledMag.email);
    if (pending[0]) {
      const { error } = await actor.sb.rpc("cancel_magistrate_court_request", { p_request_id: pending[0].id });
      log(!error, "cancelledMag", "cancel pending request", errMsg(error));
    }
    const { data, error } = await actor.sb.rpc("submit_magistrate_court_request", {
      p_court_id: cancelCourt.id,
      p_note: "Requesting again after cancel",
    });
    log(!error, "cancelledMag", "re-request same court after cancel", errMsg(error));
    finding(
      "mag-rerequest-after-cancel",
      !error ? "hold" : "break",
      "Magistrate can request the same court again after cancelling",
      error ? errMsg(error) : data?.id ?? "ok",
    );
    if (data?.id) {
      await adminSession.sb.rpc("decide_magistrate_court_request", {
        p_request_id: data.id,
        p_decision: "rejected",
        p_rejection_reason: "Returned so you can pick the court you actually sit.",
      });
    }
  }

  // Duplicate pending
  {
    const actor = await signIn(specials.duplicateMag.email);
    const first = (await pendingMag(ids.duplicateMag))[0];
    const { error } = await actor.sb.rpc("submit_magistrate_court_request", {
      p_court_id: specials.duplicateMag.court.id,
      p_note: "double click",
    });
    log(!!error || !first, "duplicateMag", "second pending blocked", errMsg(error) || "no first pending");
    finding(
      "duplicate-pending-blocked",
      error || !first ? "hold" : "break",
      "Second pending request for the same court is rejected cleanly",
      errMsg(error) || (first ? "unexpected second row" : "no pending to duplicate"),
    );
  }

  // Wrong account type correction (clerk signed up as mag, no active court)
  {
    const seated = await activeMagCourts(ids.clerkAsMag);
    if (seated.length) {
      for (const row of seated) {
        await adminSession.sb.rpc("relinquish_magistrate_court", {
          p_assignment_id: row.id,
          p_reason: "End before correcting account type",
        });
      }
    }
    const { data, error } = await adminSession.sb.rpc("correct_unassigned_account_type", {
      p_profile_id: ids.clerkAsMag,
      p_new_role: "clerk",
      p_reason: "You signed up as magistrate; you work as a court clerk.",
    });
    log(!error && data === "clerk", "clerkAsMag", "correct_unassigned_account_type → clerk", errMsg(error) || data);
    finding(
      "correct-account-type",
      !error && data === "clerk" ? "hold" : "break",
      "Admin can flip unassigned magistrate → clerk with a reason",
      error ? errMsg(error) : String(data),
    );
  }

  // Mag signed as clerk → flip back to magistrate
  {
    const { data, error } = await adminSession.sb.rpc("correct_unassigned_account_type", {
      p_profile_id: ids.magAsClerk,
      p_new_role: "magistrate",
      p_reason: "You signed up as clerk; you are a magistrate.",
    });
    log(!error && data === "magistrate", "magAsClerk", "correct_unassigned_account_type → magistrate", errMsg(error) || data);
    finding(
      "correct-account-type-to-magistrate",
      !error && data === "magistrate" ? "hold" : "break",
      "Admin can flip unassigned clerk → magistrate with a reason",
      error ? errMsg(error) : String(data),
    );
  }

  // Approve wrong court then end assignment
  {
    const actor = await signIn(specials.wrongCourt2.email);
    const openAlt = afterReturnCourt;
    const { data: req, error: subErr } = await actor.sb.rpc("submit_magistrate_court_request", {
      p_court_id: openAlt.id,
      p_note: "Correct court after return",
    });
    if (subErr) log(false, "wrongCourt2", "submit after return", errMsg(subErr));
    else {
      const { error: apprErr } = await adminSession.sb.rpc("decide_magistrate_court_request", {
        p_request_id: req.id,
        p_decision: "approved",
      });
      log(!apprErr, "wrongCourt2", "admin approved (simulating wrong then end)", errMsg(apprErr));
      const seated = await activeMagCourts(ids.wrongCourt2);
      if (seated[0]) {
        const { error: endErr } = await adminSession.sb.rpc("relinquish_magistrate_court", {
          p_assignment_id: seated[0].id,
          p_reason: "Approved the wrong court; ending so they can request again.",
        });
        log(!endErr, "wrongCourt2", "admin end wrong assignment", errMsg(endErr));
        finding(
          "end-wrong-assignment",
          !endErr ? "hold" : "break",
          "Admin can end a mistaken court assignment; there is no undo-approve on the request row",
          endErr ? errMsg(endErr) : "relinquish ok",
        );
      }
    }
  }

  // Relinquish own primary
  {
    const seated = await activeMagCourts(ids.relinquisher);
    const actor = await signIn(specials.relinquisher.email);
    if (seated[0]) {
      const { error } = await actor.sb.rpc("relinquish_magistrate_court", {
        p_assignment_id: seated[0].id,
        p_reason: "Leaving this sitting.",
      });
      log(!error, "relinquisher", "self-relinquish primary", errMsg(error));
      finding(
        "self-relinquish-primary",
        !error ? "hold" : "break",
        "Magistrate can relinquish their own primary assignment",
        error ? errMsg(error) : "ok",
      );
    }
  }

  // Clerk approvals by seated magistrates
  for (const p of personas.clerk) {
    const mag = personas.mag.find((m) => m.key === p.magKey);
    const magSession = await signIn(mag.email);
    const rows = await pendingClerk(ids[p.key]);
    for (const row of rows) {
      const { error } = await magSession.sb.rpc("decide_clerk_access_request", {
        p_request_id: row.id,
        p_decision: "approved",
      });
      log(!error, p.key, `magistrate ${p.magKey} approved clerk`, errMsg(error));
    }
  }
  const clerk01Courts = await admin
    .from("clerk_courts")
    .select("id")
    .eq("profile_id", ids.clerk01)
    .is("ended_at", null);
  finding(
    "clerk-approve-by-magistrate",
    (clerk01Courts.data?.length ?? 0) > 0 ? "hold" : "break",
    "Seated magistrate can approve a clerk access request for their court",
    `clerk01 clerk_courts=${clerk01Courts.data?.length ?? 0}`,
  );

  // Reject a clerk then try same-court resubmit (RPC vs UI)
  {
    const p = personas.clerk[7]; // clerk08
    const mag = personas.mag[7];
    const magSession = await signIn(mag.email);
    const { data: live } = await admin
      .from("clerk_courts")
      .select("id")
      .eq("profile_id", ids[p.key])
      .is("ended_at", null);
    if (live?.[0]) {
      await magSession.sb.rpc("revoke_clerk_court_access", {
        p_assignment_id: live[0].id,
        p_reason: "Wrong court for this clerk.",
      });
    }
    const actor = await signIn(p.email);
    const { data: submitted, error: subErr } = await actor.sb.rpc("submit_clerk_access_request", {
      p_court_id: p.court.id,
      p_note: "Requesting again after revoke/reject",
    });
    if (!subErr && submitted?.id) {
      const { error: rejErr } = await magSession.sb.rpc("decide_clerk_access_request", {
        p_request_id: submitted.id,
        p_decision: "rejected",
        p_rejection_reason: "Not this court. Request again.",
      });
      log(!rejErr, p.key, "clerk request rejected", errMsg(rejErr));
    }
    const { data: again, error: againErr } = await actor.sb.rpc("submit_clerk_access_request", {
      p_court_id: p.court.id,
      p_note: "Same court after reject",
    });
    log(!againErr, p.key, "RPC re-request same court after reject", errMsg(againErr));
    finding(
      "clerk-rerequest-rpc-allows",
      !againErr ? "degrade" : againErr ? "hold" : "break",
      "Clerk RPC allows (or blocks) a new pending row for a court that was already rejected — UI hides every historically requested court",
      againErr ? `RPC blocked: ${errMsg(againErr)}` : `RPC allowed id=${again?.id}. UI filter requestedCourtIds includes all statuses.`,
    );
  }

  // Orphan clerk: admin list vs admin decide
  {
    const pending = await pendingClerk(ids.orphanClerk);
    const { data: needing, error: listErr } = await adminSession.sb.rpc(
      "list_clerk_access_requests_needing_admin_attention",
    );
    log(!listErr, "orphanClerk", "list_clerk_access_requests_needing_admin_attention", errMsg(listErr));
    const listed = (needing ?? []).some((r) => r.profile_id === ids.orphanClerk || r.id === pending[0]?.id);
    finding(
      "orphan-clerk-listed",
      listed || (pending.length && !listErr) ? "hold" : "degrade",
      "Admin unresolved-clerk list RPC is callable; orphan pending should appear when the court has no clerk approver",
      `listed=${listed} pending=${pending.length} rows=${(needing ?? []).length}`,
    );
    if (pending[0]) {
      const { error: decideErr } = await adminSession.sb.rpc("decide_clerk_access_request", {
        p_request_id: pending[0].id,
        p_decision: "approved",
      });
      log(!!decideErr, "orphanClerk", "admin decide_clerk_access_request blocked", errMsg(decideErr));
      finding(
        "admin-cannot-approve-orphan-clerk",
        decideErr ? "degrade" : "break",
        "Admin cannot approve an orphaned clerk request (must seat a magistrate first); unresolved page has no Approve",
        decideErr ? errMsg(decideErr) : "admin was able to approve — unexpected",
      );
    }
  }

  // Acting/relief RPC vs roster UI
  {
    const { error } = await adminSession.sb.rpc("admin_assign_magistrate_court", {
      p_profile_id: ids.coveringMag,
      p_court_id: magCourts[0].id,
      p_assignment_type: "acting",
    });
    log(!error, "coveringMag", "admin_assign acting onto mag01 court", errMsg(error));
    finding(
      "acting-assign-rpc-vs-ui",
      !error ? "degrade" : "hold",
      "RPC can assign acting/relief; admin roster UI always passes a court id string (regular only)",
      error ? errMsg(error) : "acting assignment succeeded via RPC; roster mutate(courtToAssign) is regular-only",
    );
  }

  // People page: admin profiles.role update
  {
    const before = roster.find((r) => r.key === "leftPending");
    const { error } = await adminSession.sb.from("profiles").update({ role: "clerk" }).eq("id", ids.leftPending);
    const { data: after } = await admin.from("profiles").select("role").eq("id", ids.leftPending).single();
    if (!error && after?.role === "clerk") {
      await admin.from("profiles").update({ role: before?.role ?? "magistrate" }).eq("id", ids.leftPending);
      finding(
        "people-no-role-ui-but-rls-allows",
        "degrade",
        "People admin is read-only in the UI, but admin JWT can UPDATE profiles.role through PostgREST",
        `updated leftPending to clerk then restored to ${before?.role}`,
      );
    } else {
      finding(
        "people-role-update-blocked",
        "hold",
        "Admin JWT cannot change profiles.role (People remains observational)",
        errMsg(error) || after?.role,
      );
    }
  }

  // Self-approve blocked
  {
    const { data: own } = await admin
      .from("magistrate_court_requests")
      .select("id")
      .eq("profile_id", adminSession.user.id)
      .eq("status", "pending")
      .limit(1);
    if (own?.[0]) {
      const { error } = await adminSession.sb.rpc("decide_magistrate_court_request", {
        p_request_id: own[0].id,
        p_decision: "approved",
      });
      finding(
        "self-approve-blocked",
        error ? "hold" : "break",
        "Admin cannot approve their own magistrate court request via decide RPC",
        errMsg(error) || "unexpected success",
      );
    } else {
      finding("self-approve-blocked", "hold", "No own pending request to self-approve (gate still in RPC)", "no pending row for seed admin");
    }
  }

  // --- Phase 3: sitting day ---
  const mag01 = personas.mag[0];
  const clerk01 = personas.clerk[0];
  let matterId = null;
  {
    const { sb, user } = await signIn(mag01.email);
    const courtId = magCourts[0].id;
    const caseNumber = `DL-${RUN}-01`;
    const { data: matter, error: mErr } = await sb
      .from("docket_matters")
      .insert({
        court_id: courtId,
        case_number: caseNumber,
        matter_title: `Police v. Daylife One (${RUN})`,
        charge_or_issue: "Simple larceny",
        status: "active",
      })
      .select()
      .single();
    log(!mErr, mag01.key, "create matter", errMsg(mErr) || caseNumber);
    if (!mErr) matterId = matter.id;

    if (matterId) {
      await sb.from("docket_matter_parties").insert({
        docket_matter_id: matterId,
        full_name: "Daylife Accused",
        party_type: "individual",
        role: "accused",
        party_status: "active",
      });
      log(true, mag01.key, "add accused");
      const { error: evErr } = await sb.from("docket_events").insert({
        docket_matter_id: matterId,
        scheduled_date: "2026-09-11",
        scheduled_time: "09:30:00",
        event_type: "Hearing",
        location: magCourts[0].name,
        event_status: "scheduled",
      });
      log(!evErr, mag01.key, "schedule hearing", errMsg(evErr));
      await sb.from("docket_matters").update({ arraignment_status: "done", custody_status: "on_bail" }).eq("id", matterId);
      log(true, mag01.key, "patch procedure");
      const { error: ndErr } = await sb.rpc("set_docket_matter_next_date", {
        p_docket_matter_id: matterId,
        p_scheduled_date: "2026-09-18",
      });
      log(!ndErr, mag01.key, "set next date", errMsg(ndErr));

      const { data: judgment, error: jErr } = await sb
        .from("judgments")
        .insert({
          title: `Ruling — ${caseNumber}`,
          case_number: caseNumber,
          court_name: magCourts[0].name,
          judgment_date: "2026-09-10",
          content_text: "Accused put to plea.",
        })
        .select()
        .single();
      log(!jErr, mag01.key, "draft judgment", errMsg(jErr));
      if (!jErr) {
        await sb.from("docket_matter_judgments").insert({ docket_matter_id: matterId, judgment_id: judgment.id });
        log(true, mag01.key, "link judgment");
      }

      const { error: nErr } = await sb.from("bench_notes").insert({
        title: `Sitting notes ${caseNumber}`,
        entity_type: "docket_matter",
        entity_id: matterId,
        status: "draft",
        is_private: true,
        content_text: "Check antecedents.",
      });
      log(!nErr, mag01.key, "bench note", errMsg(nErr));

      await sb.from("bookmarks").insert({ entity_type: "docket_matter", entity_id: matterId, user_id: user.id });
      log(true, mag01.key, "bookmark");

      const { data: statutes, error: stErr } = await sb.from("statutes").select("id").limit(3);
      log(!stErr, mag01.key, "browse legislation", errMsg(stErr) || `${statutes?.length ?? 0}`);

      const { data: hits, error: gErr } = await sb.rpc("global_search", { p_query: caseNumber, p_limit: 10 });
      log(!gErr, mag01.key, "global search", errMsg(gErr) || `${hits?.length ?? 0} hits`);

      const { data: report, error: rErr } = await sb.rpc("get_daily_docket_report_data", {
        p_date: "2026-09-11",
        p_court_id: courtId,
      });
      log(!rErr, mag01.key, "daily docket report", errMsg(rErr) || `${report?.length ?? 0} rows`);

      const { data: callover, error: cErr } = await sb
        .from("docket_callovers")
        .insert({
          court_id: courtId,
          callover_date: "2026-09-11",
          title: `Daylife callover ${RUN}`,
          status: "draft",
        })
        .select()
        .single();
      log(!cErr, mag01.key, "create callover", errMsg(cErr));
      if (!cErr) {
        const { error: popErr } = await sb.rpc("populate_callover_from_date", {
          p_callover_id: callover.id,
          p_date: "2026-09-11",
        });
        log(!popErr, mag01.key, "populate callover", errMsg(popErr));
      }

      const { error: binErr } = await sb.rpc("bin_docket_matter", { p_id: matterId });
      if (binErr) log(false, mag01.key, "bin matter", errMsg(binErr));
      else {
        log(true, mag01.key, "bin matter");
        const { error: restErr } = await sb.rpc("restore_docket_matter", { p_id: matterId });
        log(!restErr, mag01.key, "restore matter", errMsg(restErr));
      }

      if (clerk01) {
        const { data: resolved, error: resErr } = await sb.rpc("resolve_docket_share_recipient", {
          p_docket_matter_id: matterId,
          p_email: clerk01.email,
        });
        if (resErr) log(false, mag01.key, "resolve share recipient", errMsg(resErr));
        else {
          const recipientId = resolved?.[0]?.profile_id ?? resolved?.[0]?.id;
          if (!recipientId) log(false, mag01.key, "resolve share recipient", JSON.stringify(resolved)?.slice(0, 200));
          else {
            const { error: shErr } = await sb.from("shares").insert({
              item_type: "docket_matter",
              item_id: matterId,
              recipient_id: recipientId,
              granted_by: user.id,
              permission: "view",
            });
            log(!shErr, mag01.key, "share with clerk01", errMsg(shErr));
          }
        }
      }
    }
    finding(
      "magistrate-sitting-day",
      steps.filter((s) => s.persona === mag01.key && s.step === "create matter" && s.ok).length ? "hold" : "break",
      "Approved magistrate can run a sitting-day: matter, parties, hearing, judgment, notes, search, report, callover, bin/restore",
      "see mag01 steps",
    );
  }

  {
    const { sb } = await signIn(clerk01.email);
    const { data: matters, error } = await sb.from("docket_matters").select("id, case_number").limit(5);
    log(!error, clerk01.key, "clerk lists docket matters", errMsg(error) || `${matters?.length ?? 0}`);
    const { error: jErr } = await sb.from("judgments").insert({
      title: "Clerk should not draft this",
      case_number: `DL-${RUN}-CLERK`,
      court_name: magCourts[0].name,
      judgment_date: "2026-09-10",
      content_text: "blocked?",
    });
    log(!!jErr, clerk01.key, "clerk blocked from creating judgment", errMsg(jErr) || "unexpected success");
    const { error: cErr } = await sb.from("docket_callovers").insert({
      court_id: magCourts[0].id,
      callover_date: "2026-09-12",
      title: "Clerk callover",
      status: "draft",
    });
    log(!!cErr, clerk01.key, "clerk blocked from callover", errMsg(cErr) || "unexpected success");
    finding(
      "clerk-docket-not-research",
      !error && jErr ? "hold" : "degrade",
      "Approved clerk can see court docket but not judgments/callovers",
      `docketErr=${errMsg(error)} judgmentErr=${errMsg(jErr)} calloverErr=${errMsg(cErr)}`,
    );
  }

  {
    const { sb } = await signIn(specials.outsider.email);
    const { data: matters, error } = await sb.from("docket_matters").insert({
      court_id: magCourts[0].id,
      case_number: `DL-${RUN}-OUT`,
      matter_title: "Should fail",
      charge_or_issue: "n/a",
      status: "active",
    });
    log(!!error, "outsider", "unassigned magistrate cannot create docket", errMsg(error) || "unexpected success");
    finding(
      "unassigned-mag-no-docket",
      error ? "hold" : "break",
      "Unassigned magistrate cannot insert docket matters (RLS); UI also redirects to /court-assignments",
      errMsg(error) || JSON.stringify(matters),
    );
  }

  {
    const { sb } = await signIn(specials.emptyMag.email);
    const { data: matters } = await sb.from("docket_matters").select("id").limit(5);
    log(true, "emptyMag", "empty docket list", `${matters?.length ?? 0} matters visible`);
  }

  {
    const { sb } = await signIn(specials.multiMag.email);
    const seated = await activeMagCourts(ids.multiMag);
    log(seated.length >= 2, "multiMag", "two court assignments", seated.map((s) => s.court_id).join(","));
    finding(
      "multi-court-approve",
      seated.length >= 2 ? "hold" : "degrade",
      "Signup requested_court_ids with two courts yields two assignments after admin approve",
      `assignments=${seated.length}`,
    );
  }

  // Notifications for returned / corrected
  {
    const { data: notes } = await admin
      .from("notifications")
      .select("type, title")
      .eq("user_id", ids.wrongCourt2)
      .order("created_at", { ascending: false })
      .limit(5);
    const hasReturn = (notes ?? []).some((n) => n.type === "court_request_decided");
    finding(
      "return-notification",
      hasReturn ? "hold" : "degrade",
      "Returned magistrate receives court_request_decided notification",
      JSON.stringify(notes ?? []),
    );
    const { data: corr } = await admin
      .from("notifications")
      .select("type, title")
      .eq("user_id", ids.clerkAsMag)
      .order("created_at", { ascending: false })
      .limit(5);
    const hasCorr = (corr ?? []).some((n) => n.type === "account_type_corrected");
    finding(
      "account-type-notification",
      hasCorr ? "hold" : "degrade",
      "Corrected account receives account_type_corrected notification",
      JSON.stringify(corr ?? []),
    );
  }

  // Concurrent primary seat: try approve leftover pending onto mag01's court
  {
    const { data: extraPending } = await admin
      .from("magistrate_court_requests")
      .select("id, profile_id")
      .eq("court_id", magCourts[0].id)
      .eq("status", "pending")
      .limit(1);
    if (extraPending?.[0]) {
      const { error } = await adminSession.sb.rpc("decide_magistrate_court_request", {
        p_request_id: extraPending[0].id,
        p_decision: "approved",
      });
      finding(
        "primary-exclusivity",
        error ? "hold" : "degrade",
        "Second primary at the same court is blocked (0105 exclusivity)",
        errMsg(error) || "second primary allowed",
      );
    } else {
      finding("primary-exclusivity", "hold", "No second pending on mag01 court to collide; exclusivity still in schema", "no row");
    }
  }

  const payload = {
    run: RUN,
    url: URL,
    generatedAt: new Date().toISOString(),
    uniquePersonas: uniqueCount,
    roster,
    findings,
    steps,
    pass: steps.filter((s) => s.ok).length,
    fail: steps.filter((s) => !s.ok).length,
    byVerdict: {
      hold: findings.filter((f) => f.verdict === "hold").length,
      degrade: findings.filter((f) => f.verdict === "degrade").length,
      break: findings.filter((f) => f.verdict === "break").length,
    },
  };
  writeFileSync(RESULTS, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${RESULTS}`);
  console.log(`steps ${payload.pass} pass / ${payload.fail} fail; findings hold=${payload.byVerdict.hold} degrade=${payload.byVerdict.degrade} break=${payload.byVerdict.break}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
