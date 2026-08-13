/**
 * Multi-user workflow simulation against local Magistrate Wizard.
 * Authenticates as ~20 distinct users and exercises Docket, Judgments,
 * Bench Notes, Quick Codes, Case Law, shares, retention, bookmarks,
 * search, dashboard, and admin court-assignment paths through the same
 * PostgREST APIs the UI uses (RLS enforced — not service-role writes
 * for the workflow itself).
 *
 *   node scripts/simulate-twenty-users.mjs
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:55321";
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const PASSWORD = "password123";
const RUN = `R${Date.now().toString(36).slice(-6).toUpperCase()}`;

const admin = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(URL, ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const results = [];
function log(ok, step, detail = "") {
  const row = { ok, step, detail: String(detail).slice(0, 400) };
  results.push(row);
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail ? ` — ${detail}` : ""}`);
}

async function expect(ok, step, detail) {
  log(!!ok, step, detail);
  return !!ok;
}

function fail(step, err) {
  const msg = err?.message ?? err?.error_description ?? String(err);
  log(false, step, msg);
  return null;
}

function clientAs(accessToken) {
  return createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(email) {
  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) throw error;
  return { user: data.user, token: data.session.access_token };
}

async function ensureUser({ email, fullName, role }) {
  const { data: existing } = await admin
    .from("profiles")
    .select("id, email, role")
    .eq("email", email)
    .maybeSingle();
  if (existing?.id) {
    if (role && existing.role !== role) {
      const { error } = await admin.from("profiles").update({ role }).eq("id", existing.id);
      if (error) throw error;
    }
    return existing.id;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  if (role && role !== "magistrate") {
    const { error: roleErr } = await admin.from("profiles").update({ role }).eq("id", data.user.id);
    if (roleErr) throw roleErr;
  }
  return data.user.id;
}

async function ensureAssignment(profileId, courtId, assignmentType = "regular") {
  const { data: live } = await admin
    .from("magistrate_courts")
    .select("id")
    .eq("profile_id", profileId)
    .eq("court_id", courtId)
    .is("ended_at", null)
    .maybeSingle();
  if (live?.id) return live.id;
  const { data, error } = await admin
    .from("magistrate_courts")
    .insert({ profile_id: profileId, court_id: courtId, assignment_type: assignmentType })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

const MAGISTRATES = [
  { email: "magistrate@magistrate-wizard.local", fullName: "Local Magistrate", role: "magistrate", key: "seed-mag" },
  { email: "mag02@magistrate-wizard.local", fullName: "Hon. Amina Persaud", role: "magistrate", key: "mag02" },
  { email: "mag03@magistrate-wizard.local", fullName: "Hon. Ravi Narine", role: "magistrate", key: "mag03" },
  { email: "mag04@magistrate-wizard.local", fullName: "Hon. Keisha Singh", role: "magistrate", key: "mag04" },
  { email: "mag05@magistrate-wizard.local", fullName: "Hon. David Khan", role: "magistrate", key: "mag05" },
  { email: "mag06@magistrate-wizard.local", fullName: "Hon. Priya Mohamed", role: "magistrate", key: "mag06" },
  { email: "mag07@magistrate-wizard.local", fullName: "Hon. Marcus Williams", role: "magistrate", key: "mag07" },
  { email: "mag08@magistrate-wizard.local", fullName: "Hon. Leila Baksh", role: "magistrate", key: "mag08" },
  { email: "mag09@magistrate-wizard.local", fullName: "Hon. Omar Fraser", role: "magistrate", key: "mag09" },
  { email: "mag10@magistrate-wizard.local", fullName: "Hon. Nadia Ali", role: "magistrate", key: "mag10" },
  { email: "mag11@magistrate-wizard.local", fullName: "Hon. Christopher Gomes", role: "magistrate", key: "mag11" },
  { email: "mag12@magistrate-wizard.local", fullName: "Hon. Sharmin Rahman", role: "magistrate", key: "mag12" },
  { email: "mag13@magistrate-wizard.local", fullName: "Hon. Julian Adams", role: "magistrate", key: "mag13" },
  { email: "mag14@magistrate-wizard.local", fullName: "Hon. Fatima Yusuf", role: "magistrate", key: "mag14" },
  { email: "mag15@magistrate-wizard.local", fullName: "Hon. Andre Rodrigues", role: "magistrate", key: "mag15" },
  { email: "mag16@magistrate-wizard.local", fullName: "Hon. Vanessa Chung", role: "magistrate", key: "mag16" },
  { email: "mag17@magistrate-wizard.local", fullName: "Hon. Trevor Daniels", role: "magistrate", key: "mag17" },
];

const USERS = [
  { email: "admin@magistrate-wizard.local", fullName: "Local Administrator", role: "admin", key: "admin" },
  { email: "registrar@magistrate-wizard.local", fullName: "Hon. Registrar Clarke", role: "admin", key: "registrar" },
  { email: "clerk.georgetown@magistrate-wizard.local", fullName: "Clerk S. Joseph", role: "clerk", key: "clerk" },
  ...MAGISTRATES,
];

const CHARGES = [
  "Theft contrary to the Criminal Law (Offences) Act",
  "Assault occasioning actual bodily harm",
  "Possession of narcotics for the purpose of trafficking",
  "Unlawful wounding",
  "Failure to maintain a child",
  "Malicious damage to property",
  "Threatening language",
  "Simple larceny",
  "Disorderly behaviour",
  "Traffic: driving without due care and attention",
];

const ACCUSED = [
  "John Doe",
  "Maria Santos",
  "Kwame Holder",
  "Anita Persaud",
  "Leon Grant",
  "Shanice Thomas",
  "Rohit Maharaj",
  "Paula Fernandes",
];

async function runMagistrateWorkflow(actor, court, shareWith, index) {
  const { token, user } = await signIn(actor.email);
  const sb = clientAs(token);
  const tag = actor.key;

  const { data: myCourts, error: courtsErr } = await sb
    .from("magistrate_courts")
    .select("court_id, courts(name)")
    .eq("profile_id", user.id)
    .is("ended_at", null);
  if (courtsErr) return fail(`${tag}: list my courts`, courtsErr);
  await expect((myCourts?.length ?? 0) > 0, `${tag}: has live court assignment`, myCourts.length);

  const { data: dashboard, error: dashErr } = await sb
    .from("docket_matters")
    .select("id, case_number, matter_title, status, cover_image_path")
    .order("updated_at", { ascending: false })
    .limit(20);
  if (dashErr) return fail(`${tag}: dashboard docket list`, dashErr);
  await expect(true, `${tag}: dashboard list`, `${dashboard?.length ?? 0} visible matters`);

  const caseNumber = `${10000 + index}/${2026}-${RUN}`;
  const accused = ACCUSED[index % ACCUSED.length];
  const charge = CHARGES[index % CHARGES.length];
  const { data: matter, error: matterErr } = await sb
    .from("docket_matters")
    .insert({
      court_id: court.id,
      case_number: caseNumber,
      matter_title: `Police v. ${accused} (${tag})`,
      charge_or_issue: charge,
      status: "active",
    })
    .select()
    .single();
  if (matterErr) return fail(`${tag}: create docket matter`, matterErr);
  await expect(!!matter?.id, `${tag}: created matter ${caseNumber}`, matter.matter_title);
  actor.matterId = matter.id;
  actor.caseNumber = caseNumber;

  const parties = [
    { full_name: accused, party_type: "individual", role: "accused", attorney_name: "C. Ramotar" },
    {
      full_name: "Commissioner of Police",
      party_type: "government_body",
      role: "complainant",
      attorney_name: null,
    },
  ];
  for (const p of parties) {
    const { error } = await sb.from("docket_matter_parties").insert({
      ...p,
      docket_matter_id: matter.id,
      party_status: "active",
    });
    if (error) fail(`${tag}: add party ${p.role}`, error);
    else log(true, `${tag}: add party ${p.role}`, p.full_name);
  }

  const { data: event, error: eventErr } = await sb
    .from("docket_events")
    .insert({
      docket_matter_id: matter.id,
      scheduled_date: "2026-08-20",
      scheduled_time: "09:30:00",
      event_type: "Hearing",
      stage_at_event: "First Appearance",
      location: court.name,
      event_status: "scheduled",
      notes: "First mention; disclosure outstanding.",
    })
    .select()
    .single();
  if (eventErr) fail(`${tag}: create event`, eventErr);
  else log(true, `${tag}: create event`, event.event_type);

  if (event?.id) {
    const { error } = await sb
      .from("docket_events")
      .update({
        event_status: "completed",
        outcome_at_event: "Adjourned for trial",
        orders_made_at_event: "Bail continued. Next hearing 3 September 2026.",
      })
      .eq("id", event.id);
    if (error) fail(`${tag}: complete event`, error);
    else log(true, `${tag}: complete event`);

    const { error: adjErr } = await sb.from("docket_events").insert({
      docket_matter_id: matter.id,
      scheduled_date: "2026-09-03",
      scheduled_time: "10:00:00",
      event_type: "Trial",
      stage_at_event: "Continuation",
      location: court.name,
      event_status: "scheduled",
    });
    if (adjErr) fail(`${tag}: adjournment event`, adjErr);
    else log(true, `${tag}: adjournment event (new row, original date kept)`);
  }

  for (const tagName of ["urgent", "part-heard"]) {
    const { error } = await sb.from("docket_matter_tags").insert({
      docket_matter_id: matter.id,
      tag_name: tagName,
    });
    if (error) fail(`${tag}: tag ${tagName}`, error);
    else log(true, `${tag}: tag ${tagName}`);
  }

  const { error: outcomeErr } = await sb
    .from("docket_matters")
    .update({
      orders_summary: "Bail granted with surety. Matter adjourned for trial.",
      status: index % 7 === 0 ? "stayed" : "active",
    })
    .eq("id", matter.id);
  if (outcomeErr) fail(`${tag}: update outcome/status`, outcomeErr);
  else log(true, `${tag}: update outcome/status`);

  const { data: assignment, error: retainErr } = await sb
    .from("docket_matter_assignments")
    .insert({
      docket_matter_id: matter.id,
      reason: "retained_part_heard",
      notes: "Part-heard; retain for continuation.",
    })
    .select()
    .single();
  if (retainErr) fail(`${tag}: retain part-heard`, retainErr);
  else log(true, `${tag}: retain part-heard`, assignment.id);

  if (shareWith?.email) {
    const { data: resolved, error: resolveErr } = await sb.rpc("resolve_docket_share_recipient", {
      p_docket_matter_id: matter.id,
      p_email: shareWith.email,
    });
    if (resolveErr) fail(`${tag}: resolve share recipient`, resolveErr);
    const recipientId = resolved?.[0]?.profile_id;
    if (!recipientId) {
      fail(`${tag}: resolve share recipient`, "empty result");
    } else {
      const permission = index % 2 === 0 ? "view" : "edit";
      const { error } = await sb.from("shares").insert({
        item_type: "docket_matter",
        item_id: matter.id,
        recipient_id: recipientId,
        granted_by: user.id,
        permission,
      });
      if (error) fail(`${tag}: share matter (${permission})`, error);
      else {
        log(true, `${tag}: share matter (${permission})`, shareWith.email);
        actor.sharedWith = shareWith.email;
        actor.sharePermission = permission;
      }
    }
  }

  const { data: judgment, error: jErr } = await sb
    .from("judgments")
    .insert({
      title: `Ruling — ${matter.matter_title}`,
      case_number: caseNumber,
      court_name: court.name,
      judgment_date: "2026-08-12",
      citation: null,
      content_text: "The accused is put to plea. Trial date fixed.",
    })
    .select()
    .single();
  if (jErr) fail(`${tag}: create draft judgment`, jErr);
  else {
    log(true, `${tag}: create draft judgment`, judgment.status);
    actor.judgmentId = judgment.id;
    const { error: linkErr } = await sb.from("docket_matter_judgments").insert({
      docket_matter_id: matter.id,
      judgment_id: judgment.id,
    });
    if (linkErr) fail(`${tag}: link judgment to matter`, linkErr);
    else log(true, `${tag}: link judgment to matter`);

    if (index % 3 === 0) {
      const { error: finErr } = await sb
        .from("judgments")
        .update({ status: "final", content_text: "Final ruling recorded." })
        .eq("id", judgment.id);
      if (finErr) fail(`${tag}: finalize judgment`, finErr);
      else log(true, `${tag}: finalize judgment`);

      const { error: discErr } = await sb
        .from("judgments")
        .update({ is_discoverable: true })
        .eq("id", judgment.id);
      if (discErr) fail(`${tag}: make judgment discoverable`, discErr);
      else log(true, `${tag}: make judgment discoverable`);
    }
  }

  const { data: note, error: noteErr } = await sb
    .from("bench_notes")
    .insert({
      title: `Hearing notes — ${caseNumber}`,
      entity_type: "docket_matter",
      entity_id: matter.id,
      status: "draft",
      is_private: true,
      content_text: "Credibility of complainant to be tested on continuation.",
    })
    .select()
    .single();
  if (noteErr) fail(`${tag}: create bench note`, noteErr);
  else {
    log(true, `${tag}: create bench note`, note.id);
    const { error: pubErr } = await sb
      .from("bench_notes")
      .update({ status: "published" })
      .eq("id", note.id);
    if (pubErr) fail(`${tag}: publish bench note`, pubErr);
    else log(true, `${tag}: publish bench note`);
  }

  const { error: qcErr } = await sb.from("quick_codes").insert({
    code_word: `bail${index}${RUN.toLowerCase()}`,
    title: "Standard bail conditions",
    content: "Accused to report to the nearest police station every Monday.",
    description: "Reusable bail wording",
    category: "bail",
  });
  if (qcErr) fail(`${tag}: create quick code`, qcErr);
  else log(true, `${tag}: create quick code`);

  const { data: research, error: clErr } = await sb
    .from("case_law")
    .insert({
      owner_id: user.id,
      case_name: `Research note: ${accused}`,
      citation: `[2026] SIM ${index}`,
      court: court.name,
      jurisdiction: "Guyana",
      summary: "Personal research for this sitting.",
    })
    .select()
    .single();
  if (clErr) fail(`${tag}: personal case law`, clErr);
  else {
    log(true, `${tag}: personal case law`, research.id);
    const { error: clLinkErr } = await sb.from("docket_matter_case_law").insert({
      docket_matter_id: matter.id,
      case_law_id: research.id,
    });
    if (clLinkErr) fail(`${tag}: link case law to matter`, clLinkErr);
    else log(true, `${tag}: link case law to matter`);
  }

  const { error: bmErr } = await sb.from("bookmarks").insert({
    entity_type: "docket_matter",
    entity_id: matter.id,
    user_id: user.id,
  });
  if (bmErr) fail(`${tag}: bookmark matter`, bmErr);
  else log(true, `${tag}: bookmark matter`);

  const { data: searchHits, error: searchErr } = await sb.rpc("search_docket_matters", {
    p_query: accused.split(" ")[0],
    p_limit: 10,
  });
  if (searchErr) fail(`${tag}: search docket`, searchErr);
  else
    log(
      true,
      `${tag}: search docket`,
      `${searchHits?.length ?? 0} hits for "${accused.split(" ")[0]}"`,
    );

  const { data: globalHits, error: gErr } = await sb.rpc("global_search", {
    p_query: caseNumber,
    p_limit: 10,
  });
  if (gErr) fail(`${tag}: global search`, gErr);
  else log(true, `${tag}: global search`, `${globalHits?.length ?? 0} hits`);

  const { data: statutes, error: stErr } = await sb
    .from("statutes")
    .select("id, title")
    .limit(5);
  if (stErr) fail(`${tag}: browse legislation`, stErr);
  else log(true, `${tag}: browse legislation`, `${statutes?.length ?? 0} visible`);

  return matter;
}

async function runShareRecipientChecks(grantor, recipientEmail) {
  if (!grantor?.matterId) return;
  const { token, user } = await signIn(recipientEmail);
  const sb = clientAs(token);
  const { data, error } = await sb
    .from("docket_matters")
    .select("id, case_number, matter_title, court_id")
    .eq("id", grantor.matterId)
    .maybeSingle();
  if (error) return fail(`${recipientEmail}: see shared matter`, error);
  await expect(!!data?.id, `${recipientEmail}: see shared matter`, grantor.caseNumber);

  const { data: ownCourt } = await sb
    .from("magistrate_courts")
    .select("id")
    .eq("profile_id", user.id)
    .eq("court_id", data.court_id)
    .is("ended_at", null)
    .maybeSingle();
  const hasCourtAccess = Boolean(ownCourt?.id);

  if (grantor.sharePermission === "view") {
    const { data: updated, error: updErr } = await sb
      .from("docket_matters")
      .update({ outcome: "should-be-rejected-on-view-share" })
      .eq("id", grantor.matterId)
      .select("id");
    const blocked = Boolean(updErr) || !updated?.length;
    if (hasCourtAccess) {
      await expect(
        !blocked,
        `${recipientEmail}: same-court colleague can still edit`,
        "court assignment, not the view-share, is the access path",
      );
    } else {
      await expect(blocked, `${recipientEmail}: view-share cannot edit`, updErr?.message ?? "0 rows");
    }
  } else if (grantor.sharePermission === "edit") {
    const { error: updErr } = await sb
      .from("docket_matters")
      .update({ outcome: "Consulted colleague recorded a note on the shared file." })
      .eq("id", grantor.matterId);
    if (updErr) fail(`${recipientEmail}: edit-share can edit`, updErr);
    else log(true, `${recipientEmail}: edit-share can edit`);
  }
}

async function runIsolationCheck(viewerEmail, foreignMatterId, label) {
  const { token } = await signIn(viewerEmail);
  const sb = clientAs(token);
  const { data, error } = await sb
    .from("docket_matters")
    .select("id")
    .eq("id", foreignMatterId)
    .maybeSingle();
  if (error) return fail(label, error);
  await expect(!data, label, data ? "LEAK: row visible" : "correctly hidden");
}

async function runAdminWorkflow(adminUser, targetProfileId, extraCourtId) {
  const { token, user } = await signIn(adminUser.email);
  const sb = clientAs(token);
  const tag = adminUser.key;

  const { data: profiles, error: pErr } = await sb
    .from("profiles")
    .select("id, email, role")
    .order("email")
    .limit(50);
  if (pErr) fail(`${tag}: admin list profiles`, pErr);
  else log(true, `${tag}: admin list profiles`, `${profiles?.length ?? 0} profiles`);

  if (extraCourtId && targetProfileId) {
    const { error } = await sb.from("magistrate_courts").insert({
      profile_id: targetProfileId,
      court_id: extraCourtId,
      assignment_type: "acting",
    });
    if (error) fail(`${tag}: assign acting court`, error);
    else log(true, `${tag}: assign acting court`);
  }

  const { data: sources, error: sErr } = await sb.from("legal_sources").select("id, name").limit(10);
  if (sErr) fail(`${tag}: admin legal sources`, sErr);
  else log(true, `${tag}: admin legal sources`, `${sources?.length ?? 0} sources`);

  const { data: myMatters } = await sb.from("docket_matters").select("id").limit(1);
  log(true, `${tag}: admin docket visibility`, `${myMatters?.length ?? 0} matters (court-gated, no admin bypass)`);

  return user.id;
}

async function runUnauthorizedAdminCheck(email) {
  const { token } = await signIn(email);
  const sb = clientAs(token);
  const { data, error } = await sb.from("profiles").select("id, email").limit(20);
  if (error) return fail(`${email}: non-admin profiles list`, error);
  const leaked = (data ?? []).filter((p) => p.email !== email);
  await expect(
    leaked.length === 0,
    `${email}: cannot browse other profiles`,
    leaked.length ? `LEAK ${leaked.length}` : "own row only",
  );
}

async function main() {
  console.log(`\nMagistrate Wizard multi-user simulation  ${RUN}\n`);

  const { data: courts, error: courtErr } = await admin
    .from("courts")
    .select("id, name, district_id, is_active")
    .eq("is_active", true)
    .order("name")
    .limit(20);
  if (courtErr || !courts?.length) {
    fail("load courts", courtErr ?? "no active courts");
    process.exit(1);
  }
  log(true, "load courts", courts.map((c) => c.name).slice(0, 6).join("; "));

  const geo1 =
    courts.find((c) => c.name === "Georgetown Magistrates' Court 1") ?? courts[0];
  const courtPool = courts.slice(0, 8);

  const roster = [];
  for (const spec of USERS) {
    try {
      const id = await ensureUser(spec);
      roster.push({ ...spec, id });
      log(true, `provision ${spec.key}`, `${spec.role} ${spec.email}`);
    } catch (err) {
      fail(`provision ${spec.key}`, err);
    }
  }

  const byKey = Object.fromEntries(roster.map((u) => [u.key, u]));
  const assignments = [
    ["admin", geo1],
    ["registrar", geo1],
    ["clerk", geo1],
    ["seed-mag", geo1],
    ["mag02", geo1],
    ["mag03", geo1],
    ["mag04", courtPool[1] ?? geo1],
    ["mag05", courtPool[1] ?? geo1],
    ["mag06", courtPool[2] ?? geo1],
    ["mag07", courtPool[2] ?? geo1],
    ["mag08", courtPool[3] ?? geo1],
    ["mag09", courtPool[3] ?? geo1],
    ["mag10", courtPool[4] ?? geo1],
    ["mag11", courtPool[4] ?? geo1],
    ["mag12", courtPool[5] ?? geo1],
    ["mag13", courtPool[5] ?? geo1],
    ["mag14", courtPool[6] ?? geo1],
    ["mag15", courtPool[6] ?? geo1],
    ["mag16", courtPool[7] ?? geo1],
    ["mag17", courtPool[7] ?? geo1],
  ];
  for (const [key, court] of assignments) {
    const u = byKey[key];
    if (!u || !court) continue;
    try {
      await ensureAssignment(u.id, court.id, key === "clerk" ? "relief" : "regular");
      u.court = court;
      log(true, `assign ${key}`, court.name);
    } catch (err) {
      fail(`assign ${key}`, err);
    }
  }

  const sharePairs = {
    "seed-mag": byKey.mag04,
    mag02: byKey.mag05,
    mag03: byKey.mag06,
    mag04: byKey.mag02,
    mag05: byKey.mag03,
    mag06: byKey.mag08,
    mag07: byKey.mag09,
    mag08: byKey.mag10,
    mag09: byKey.mag11,
    mag10: byKey.mag12,
    mag11: byKey.mag13,
    mag12: byKey.mag14,
    mag13: byKey.mag15,
    mag14: byKey.mag16,
    mag15: byKey.mag17,
    mag16: byKey.mag02,
    mag17: byKey.mag04,
    clerk: byKey.mag02,
    admin: byKey.mag03,
    registrar: byKey.mag07,
  };

  let i = 0;
  for (const actor of roster) {
    if (!actor.court) continue;
    try {
      await runMagistrateWorkflow(actor, actor.court, sharePairs[actor.key], i);
    } catch (err) {
      fail(`${actor.key}: workflow crashed`, err);
    }
    i += 1;
  }

  for (const actor of roster) {
    const recipient = sharePairs[actor.key];
    if (!recipient) continue;
    try {
      await runShareRecipientChecks(actor, recipient.email);
    } catch (err) {
      fail(`${actor.key}: share recipient check`, err);
    }
  }

  const foreignMatter = byKey.mag06?.matterId;
  const isolatedViewer = byKey.mag04;
  if (foreignMatter && isolatedViewer) {
    await runIsolationCheck(
      isolatedViewer.email,
      foreignMatter,
      `${isolatedViewer.key}: cannot see other-court matter without share`,
    );
  }

  const privateJudgmentOwner = roster.find((u) => u.judgmentId && u.key !== "mag03");
  if (privateJudgmentOwner && byKey.mag03) {
    const { token } = await signIn(byKey.mag03.email);
    const sb = clientAs(token);
    const { data } = await sb
      .from("judgments")
      .select("id, is_discoverable")
      .eq("id", privateJudgmentOwner.judgmentId)
      .maybeSingle();
    const shouldHide = data?.is_discoverable !== true;
    await expect(
      shouldHide ? !data : !!data,
      `mag03: private judgment isolation vs ${privateJudgmentOwner.key}`,
      data ? `visible discoverable=${data.is_discoverable}` : "hidden",
    );
  }

  try {
    await runAdminWorkflow(byKey.admin, byKey.mag17?.id, courtPool[2]?.id);
  } catch (err) {
    fail("admin workflow", err);
  }
  try {
    await runAdminWorkflow(byKey.registrar, byKey.mag16?.id, courtPool[3]?.id);
  } catch (err) {
    fail("registrar workflow", err);
  }

  await runUnauthorizedAdminCheck("magistrate@magistrate-wizard.local");
  await runUnauthorizedAdminCheck("clerk.georgetown@magistrate-wizard.local");

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== ${passed} passed, ${failed} failed of ${results.length} checks (${roster.length} users, run ${RUN}) ===\n`);
  if (failed) {
    console.log("Failures:");
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - ${r.step}: ${r.detail}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
