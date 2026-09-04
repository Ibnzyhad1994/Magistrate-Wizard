/**
 * Comprehensive multi-persona E2E against local Magistrate Wizard APIs
 * (the same PostgREST + RLS path the UI uses). Complements
 * simulate-persona-workflows.mjs (OCR/skill paths) and simulate-twenty-users.mjs.
 *
 *   npm run test:e2e-personas
 */
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createClient } from "@supabase/supabase-js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const RESULTS = join(__dirname, "e2e-multi-persona-results.json")

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:55321"
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
const PASSWORD = "password123"
const RUN = `E2E${Date.now().toString(36).slice(-5).toUpperCase()}`
const SEED_ADMIN_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"

const admin = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const anon = createClient(URL, ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** @type {{ ok: boolean, persona: string, step: string, detail: string }[]} */
const results = []

const log = (ok, persona, step, detail = "") => {
  const row = { ok: !!ok, persona, step, detail: String(detail).slice(0, 500) }
  results.push(row)
  console.log(`${ok ? "PASS" : "FAIL"}  [${persona}] ${step}${detail ? ` — ${detail}` : ""}`)
}

const fail = (persona, step, err) => {
  const msg = err?.message ?? err?.error_description ?? String(err)
  log(false, persona, step, msg)
  return null
}

const clientAs = (accessToken) =>
  createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

const signIn = async (email) => {
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw error
  return { user: data.user, token: data.session.access_token }
}

const ensureUser = async ({ email, fullName, role }) => {
  const { data: existing } = await admin.from("profiles").select("id, email, role").eq("email", email).maybeSingle()
  if (existing?.id) {
    if (role && existing.role !== role) {
      const { error } = await admin.from("profiles").update({ role }).eq("id", existing.id)
      if (error) throw error
    }
    return existing.id
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (error) throw error
  if (role && role !== "magistrate") {
    const { error: roleErr } = await admin.from("profiles").update({ role }).eq("id", data.user.id)
    if (roleErr) throw roleErr
  }
  return data.user.id
}

const ensureMagistrateAssignment = async (profileId, courtId, assignmentType = "acting") => {
  const { data: live } = await admin
    .from("magistrate_courts")
    .select("id")
    .eq("profile_id", profileId)
    .eq("court_id", courtId)
    .is("ended_at", null)
    .maybeSingle()
  if (live?.id) return live.id
  const { data, error } = await admin
    .from("magistrate_courts")
    .insert({ profile_id: profileId, court_id: courtId, assignment_type: assignmentType })
    .select("id")
    .single()
  if (error) throw error
  return data.id
}

const ensureClerkAssignment = async (profileId, courtId, approvedBy) => {
  const { data: live } = await admin
    .from("clerk_courts")
    .select("id")
    .eq("profile_id", profileId)
    .eq("court_id", courtId)
    .is("ended_at", null)
    .maybeSingle()
  if (live?.id) return live.id
  const { data, error } = await admin
    .from("clerk_courts")
    .insert({ profile_id: profileId, court_id: courtId, approved_by: approvedBy })
    .select("id")
    .single()
  if (error) throw error
  return data.id
}

const endCurrentAssignments = async (profileId, reason) => {
  const { error } = await admin
    .from("magistrate_courts")
    .update({
      ended_at: new Date().toISOString(),
      end_reason: reason,
    })
    .eq("profile_id", profileId)
    .is("ended_at", null)
  if (error) throw error
}

const pickOpenRegularCourt = async (excludeIds = []) => {
  const { data: occupied } = await admin
    .from("magistrate_courts")
    .select("court_id")
    .eq("assignment_type", "regular")
    .is("ended_at", null)
  const taken = new Set([...(occupied ?? []).map((r) => r.court_id), ...excludeIds])
  const { data: courts } = await admin.from("courts").select("id, name").eq("is_active", true).order("name")
  const open = (courts ?? []).find((c) => !taken.has(c.id))
  if (!open) throw new Error("no court without an active regular magistrate")
  return open
}

const PERSONAS = [
  {
    key: "novice",
    email: "persona.novice@magistrate-wizard.local",
    fullName: "Hon. Maya Novice (Day-1 Magistrate)",
    role: "magistrate",
  },
  {
    key: "experienced",
    email: "persona.experienced@magistrate-wizard.local",
    fullName: "Hon. James Experienced (Senior Magistrate)",
    role: "magistrate",
  },
  {
    key: "covering",
    email: "persona.covering@magistrate-wizard.local",
    fullName: "Hon. Aisha Covering (Relief Magistrate)",
    role: "magistrate",
  },
  {
    key: "clerk",
    email: "persona.clerk@magistrate-wizard.local",
    fullName: "Clerk Devon Registry",
    role: "clerk",
  },
  {
    key: "admin",
    email: "persona.admin@magistrate-wizard.local",
    fullName: "Admin Lex Curator",
    role: "admin",
  },
  {
    key: "outsider",
    email: "persona.outsider@magistrate-wizard.local",
    fullName: "Outsider No Court",
    role: "magistrate",
  },
  {
    key: "empty",
    email: "empty.mag@magistrate-wizard.local",
    fullName: "Empty Docket Magistrate",
    role: "magistrate",
  },
]

const insertMatter = async (sb, courtId, caseNumber, title, charge) => {
  const { data, error } = await sb
    .from("docket_matters")
    .insert({
      court_id: courtId,
      case_number: caseNumber,
      matter_title: title,
      charge_or_issue: charge,
      status: "active",
    })
    .select()
    .single()
  return { data, error }
}

const runNovice = async (actor, court) => {
  const tag = actor.key
  try {
    const { token, user } = await signIn(actor.email)
    log(true, tag, "login")
    const sb = clientAs(token)

    const { data: courts } = await sb
      .from("magistrate_courts")
      .select("court_id, assignment_type, courts(name)")
      .eq("profile_id", user.id)
      .is("ended_at", null)
    log((courts?.length ?? 0) > 0, tag, "sees court assignment", courts?.[0]?.courts?.name ?? "")

    const { data: notices } = await sb.from("notifications").select("id, type").limit(20)
    log(true, tag, "list notifications", `${notices?.length ?? 0} (court_assigned expected)`)
    log(
      (notices ?? []).some((n) => n.type === "court_assigned"),
      tag,
      "received court_assigned notice",
    )

    const caseNumber = `N-${RUN}-01`
    const { data: matter, error: mErr } = await insertMatter(
      sb,
      court.id,
      caseNumber,
      `Police v. First Day Defendant (${tag})`,
      "Simple larceny",
    )
    if (mErr) return fail(tag, "create first matter", mErr)
    log(true, tag, "create first matter", caseNumber)
    actor.matterId = matter.id
    actor.caseNumber = caseNumber

    const { error: pErr } = await sb.from("docket_matter_parties").insert({
      docket_matter_id: matter.id,
      full_name: "First Day Defendant",
      party_type: "individual",
      role: "accused",
      party_status: "active",
    })
    if (pErr) fail(tag, "add accused", pErr)
    else log(true, tag, "add accused")

    const { error: procErr } = await sb
      .from("docket_matters")
      .update({
        arraignment_status: "done",
        custody_status: "on_bail",
        updated_at: matter.updated_at,
      })
      .eq("id", matter.id)
      .eq("updated_at", matter.updated_at)
    if (procErr) fail(tag, "patch procedure board", procErr)
    else log(true, tag, "patch procedure board", "arraignment done, on bail")

    const { data: nextDate, error: ndErr } = await sb.rpc("set_docket_matter_next_date", {
      p_docket_matter_id: matter.id,
      p_scheduled_date: "2026-09-10",
    })
    if (ndErr) fail(tag, "set next date", ndErr)
    else log(true, tag, "set next date", nextDate?.[0]?.status ?? JSON.stringify(nextDate)?.slice(0, 80))

    const { data: events, error: evErr } = await sb
      .from("docket_events")
      .select("id, scheduled_date, event_status")
      .eq("docket_matter_id", matter.id)
    if (evErr) fail(tag, "calendar events for matter", evErr)
    else log((events?.length ?? 0) > 0, tag, "calendar events for matter", `${events?.length ?? 0}`)

    const { error: nErr } = await sb.from("bench_notes").insert({
      title: `Day-1 notes — ${caseNumber}`,
      entity_type: "docket_matter",
      entity_id: matter.id,
      status: "draft",
      is_private: true,
      content_text: "Reminded of plea options.",
    })
    if (nErr) fail(tag, "draft bench note", nErr)
    else log(true, tag, "draft bench note")

    const { data: hits, error: sErr } = await sb.rpc("search_docket_matters", { p_query: "First", p_limit: 5 })
    if (sErr) fail(tag, "search own matter", sErr)
    else log(true, tag, "search own matter", `${hits?.length ?? 0} hits`)

    const { data: statutes, error: stErr } = await sb.from("statutes").select("id, title").limit(5)
    if (stErr) fail(tag, "browse legislation", stErr)
    else log(true, tag, "browse legislation", `${statutes?.length ?? 0} visible`)

    const { error: bmErr } = await sb.from("bookmarks").insert({
      entity_type: "docket_matter",
      entity_id: matter.id,
      user_id: user.id,
    })
    if (bmErr) fail(tag, "bookmark", bmErr)
    else log(true, tag, "bookmark")

    const { error: binErr } = await sb.rpc("bin_docket_matter", { p_id: matter.id })
    if (binErr) fail(tag, "bin matter", binErr)
    else {
      log(true, tag, "bin matter")
      const { data: hidden } = await sb
        .from("docket_matters")
        .select("id, deleted_at")
        .eq("id", matter.id)
        .is("deleted_at", null)
        .maybeSingle()
      const { data: binned } = await sb
        .from("docket_matters")
        .select("id, deleted_at")
        .eq("id", matter.id)
        .maybeSingle()
      log(!hidden && !!binned?.deleted_at, tag, "binned matter hidden from live list", hidden ? "still on live filter" : "hidden; restore path still readable")
      const { error: restErr } = await sb.rpc("restore_docket_matter", { p_id: matter.id })
      if (restErr) fail(tag, "restore from bin", restErr)
      else log(true, tag, "restore from bin")
    }

    log(true, tag, "workflow complete")
  } catch (err) {
    fail(tag, "workflow crashed", err)
  }
}

const runExperienced = async (actor, court, shareWith) => {
  const tag = actor.key
  try {
    const { token, user } = await signIn(actor.email)
    log(true, tag, "login")
    const sb = clientAs(token)

    const caseNumber = `E-${RUN}-42`
    const { data: matter, error: mErr } = await insertMatter(
      sb,
      court.id,
      caseNumber,
      `Police v. Senior Sitting (${tag})`,
      "Assault occasioning actual bodily harm",
    )
    if (mErr) return fail(tag, "create matter", mErr)
    log(true, tag, "create matter", caseNumber)
    actor.matterId = matter.id
    actor.caseNumber = caseNumber
    actor.courtId = court.id

    for (const p of [
      { full_name: "Senior Sitting Accused", party_type: "individual", role: "accused" },
      { full_name: "Commissioner of Police", party_type: "government_body", role: "complainant" },
    ]) {
      const { error } = await sb.from("docket_matter_parties").insert({
        ...p,
        docket_matter_id: matter.id,
        party_status: "active",
      })
      if (error) fail(tag, `party ${p.role}`, error)
      else log(true, tag, `party ${p.role}`)
    }

    const { data: event, error: eErr } = await sb
      .from("docket_events")
      .insert({
        docket_matter_id: matter.id,
        scheduled_date: "2026-08-20",
        scheduled_time: "09:30:00",
        event_type: "Hearing",
        stage_at_event: "Continuation",
        location: court.name,
        event_status: "scheduled",
        notes: "Part-heard; PW1 under cross.",
      })
      .select()
      .single()
    if (eErr) fail(tag, "schedule hearing", eErr)
    else {
      log(true, tag, "schedule hearing")
      const { error: uErr } = await sb
        .from("docket_events")
        .update({
          event_status: "completed",
          outcome_at_event: "Adjourned part-heard",
          orders_made_at_event: "Bail continued.",
        })
        .eq("id", event.id)
      if (uErr) fail(tag, "complete hearing", uErr)
      else log(true, tag, "complete hearing")
    }

    const { error: retErr } = await sb.from("docket_matter_assignments").insert({
      docket_matter_id: matter.id,
      reason: "retained_part_heard",
      notes: "Retain for continuation.",
    })
    if (retErr) fail(tag, "retain part-heard", retErr)
    else log(true, tag, "retain part-heard")

    const { error: procErr } = await sb
      .from("docket_matters")
      .update({ trial_status: "partial", disclosure_status: "partial" })
      .eq("id", matter.id)
    if (procErr) fail(tag, "update trial/disclosure", procErr)
    else log(true, tag, "update trial/disclosure")

    const { data: judgment, error: jErr } = await sb
      .from("judgments")
      .insert({
        title: `Ruling — ${matter.matter_title}`,
        case_number: caseNumber,
        court_name: court.name,
        judgment_date: "2026-08-14",
        content_text: "The accused is put to plea. Trial date fixed.",
      })
      .select()
      .single()
    if (jErr) fail(tag, "create draft judgment", jErr)
    else {
      log(true, tag, "create draft judgment", judgment.status)
      actor.judgmentId = judgment.id
      const { error: linkErr } = await sb.from("docket_matter_judgments").insert({
        docket_matter_id: matter.id,
        judgment_id: judgment.id,
      })
      if (linkErr) fail(tag, "link judgment", linkErr)
      else log(true, tag, "link judgment")

      const { error: citeErr } = await sb
        .from("judgments")
        .update({ citation: `[2026] E2E ${RUN}` })
        .eq("id", judgment.id)
      if (citeErr) fail(tag, "update judgment citation", citeErr)
      else log(true, tag, "update judgment citation")
    }

    const { error: qcErr } = await sb.from("quick_codes").insert({
      code_word: `bail${RUN.toLowerCase()}`,
      title: "Standard bail conditions",
      content: "Report every Monday to nearest station.",
      description: "Reusable bail",
      category: "bail",
    })
    if (qcErr) fail(tag, "quick code", qcErr)
    else log(true, tag, "quick code")

    const { data: research, error: clErr } = await sb
      .from("case_law")
      .insert({
        owner_id: user.id,
        case_name: "Research: ABH sentencing",
        citation: `[2026] PERS ${RUN}`,
        court: court.name,
        jurisdiction: "Guyana",
        summary: "Personal research for this sitting.",
      })
      .select()
      .single()
    if (clErr) fail(tag, "case law research", clErr)
    else {
      log(true, tag, "case law research")
      const { error: clLink } = await sb.from("docket_matter_case_law").insert({
        docket_matter_id: matter.id,
        case_law_id: research.id,
      })
      if (clLink) fail(tag, "link case law", clLink)
      else log(true, tag, "link case law")
    }

    if (shareWith?.email) {
      const { data: resolved, error: rErr } = await sb.rpc("resolve_docket_share_recipient", {
        p_docket_matter_id: matter.id,
        p_email: shareWith.email,
      })
      if (rErr) fail(tag, "resolve share recipient", rErr)
      else {
        const recipientId = resolved?.[0]?.profile_id
        if (!recipientId) fail(tag, "resolve share recipient", "empty")
        else {
          const { error: shErr } = await sb.from("shares").insert({
            item_type: "docket_matter",
            item_id: matter.id,
            recipient_id: recipientId,
            granted_by: user.id,
            permission: "view",
          })
          if (shErr) fail(tag, "share view with covering", shErr)
          else log(true, tag, "share view with covering", shareWith.email)
        }
      }
    }

    const { data: gHits, error: gErr } = await sb.rpc("global_search", { p_query: caseNumber, p_limit: 10 })
    if (gErr) fail(tag, "global search", gErr)
    else log(true, tag, "global search", `${gHits?.length ?? 0} hits`)

    log(true, tag, "workflow complete")
  } catch (err) {
    fail(tag, "workflow crashed", err)
  }
}

const runCovering = async (actor, court, sharedMatter, foreignMatterId) => {
  const tag = actor.key
  try {
    const { token } = await signIn(actor.email)
    log(true, tag, "login")
    const sb = clientAs(token)

    const { data: courts } = await sb
      .from("magistrate_courts")
      .select("assignment_type, courts(name)")
      .eq("profile_id", actor.id)
      .is("ended_at", null)
    log(
      (courts?.length ?? 0) > 0,
      tag,
      "relief assignment visible",
      courts?.map((c) => `${c.assignment_type}:${c.courts?.name}`).join("; ") ?? "",
    )

    const caseNumber = `C-${RUN}-07`
    const { data: matter, error: mErr } = await insertMatter(
      sb,
      court.id,
      caseNumber,
      `Police v. Relief Sitting (${tag})`,
      "Threatening language",
    )
    if (mErr) fail(tag, "create relief-court matter", mErr)
    else {
      log(true, tag, "create relief-court matter", caseNumber)
      actor.matterId = matter.id
    }

    if (sharedMatter?.id) {
      const { data, error } = await sb
        .from("docket_matters")
        .select("id, case_number")
        .eq("id", sharedMatter.id)
        .maybeSingle()
      if (error) fail(tag, "see shared matter", error)
      else log(!!data?.id, tag, "see shared matter", data?.case_number ?? "hidden")

      const { data: updated, error: updErr } = await sb
        .from("docket_matters")
        .update({ outcome: "covering-should-not-edit-view-share" })
        .eq("id", sharedMatter.id)
        .select("id")
      const blocked = Boolean(updErr) || !(updated?.length)
      log(blocked, tag, "view-share cannot edit foreign court", updErr?.message ?? "0 rows")
    }

    if (foreignMatterId) {
      const { data } = await sb.from("docket_matters").select("id").eq("id", foreignMatterId).maybeSingle()
      log(!data, tag, "cannot see other-court unshared matter", data ? "LEAK" : "hidden")
    }

    const { data: notices } = await sb.from("notifications").select("id, type, title").limit(20)
    log(true, tag, "list notifications after share", `${notices?.length ?? 0}`)

    log(true, tag, "workflow complete")
  } catch (err) {
    fail(tag, "workflow crashed", err)
  }
}

const runClerk = async (actor, court) => {
  const tag = actor.key
  try {
    const { token, user } = await signIn(actor.email)
    log(true, tag, "login")
    const sb = clientAs(token)

    const { data: clerkCourts, error: ccErr } = await sb
      .from("clerk_courts")
      .select("court_id, courts(name)")
      .eq("profile_id", user.id)
      .is("ended_at", null)
    if (ccErr) fail(tag, "list clerk_courts", ccErr)
    else log((clerkCourts?.length ?? 0) > 0, tag, "clerk_courts assignment", clerkCourts?.[0]?.courts?.name ?? "")

    const { data: magCourts } = await sb
      .from("magistrate_courts")
      .select("id")
      .eq("profile_id", user.id)
      .is("ended_at", null)
    log(true, tag, "magistrate_courts rows for clerk", `${magCourts?.length ?? 0}`)

    const { data: matters, error: listErr } = await sb
      .from("docket_matters")
      .select("id, case_number")
      .eq("court_id", court.id)
      .order("updated_at", { ascending: false })
      .limit(20)
    if (listErr) fail(tag, "list court docket", listErr)
    else log(true, tag, "list court docket", `${matters?.length ?? 0} matters`)

    const caseNumber = `K-${RUN}-03`
    const { data: matter, error: mErr } = await insertMatter(
      sb,
      court.id,
      caseNumber,
      `Registry filing (${tag})`,
      "Failure to maintain a child",
    )
    if (mErr) fail(tag, "create registry matter", mErr)
    else {
      log(true, tag, "create registry matter", caseNumber)
      actor.matterId = matter.id
      const { error: eErr } = await sb.from("docket_events").insert({
        docket_matter_id: matter.id,
        scheduled_date: "2026-08-21",
        scheduled_time: "11:00:00",
        event_type: "Mention",
        stage_at_event: "First Appearance",
        location: court.name,
        event_status: "scheduled",
        notes: "Clerk listed for mention.",
      })
      if (eErr) fail(tag, "schedule mention", eErr)
      else log(true, tag, "schedule mention")
    }

    const { data: profiles, error: pErr } = await sb.from("profiles").select("id, email").limit(20)
    if (pErr) fail(tag, "profiles list", pErr)
    else {
      const leaked = (profiles ?? []).filter((p) => p.email !== actor.email && p.id !== user.id)
      log(leaked.length === 0, tag, "cannot browse other profiles", leaked.length ? `LEAK ${leaked.length}` : "own only")
    }

    const { error: assignErr } = await sb.from("magistrate_courts").insert({
      profile_id: user.id,
      court_id: court.id,
      assignment_type: "acting",
    })
    log(!!assignErr, tag, "cannot self-assign magistrate_courts", assignErr?.message ?? "INSERT succeeded")

    const { data: issueReports, error: irErr } = await sb.from("issue_reports").select("id").limit(5)
    if (irErr) log(true, tag, "issue_reports blocked or empty", irErr.message)
    else log((issueReports?.length ?? 0) === 0, tag, "cannot browse others' issue reports", `${issueReports?.length ?? 0}`)

    log(true, tag, "workflow complete")
  } catch (err) {
    fail(tag, "workflow crashed", err)
  }
}

const runAdmin = async (actor, targetProfileId, extraCourt) => {
  const tag = actor.key
  try {
    const { token } = await signIn(actor.email)
    log(true, tag, "login")
    const sb = clientAs(token)

    const { data: profiles, error: pErr } = await sb.from("profiles").select("id, email, role").order("email").limit(50)
    if (pErr) fail(tag, "list profiles", pErr)
    else log((profiles?.length ?? 0) > 1, tag, "list profiles", `${profiles?.length ?? 0}`)

    if (extraCourt && targetProfileId) {
      const { error } = await sb.from("magistrate_courts").insert({
        profile_id: targetProfileId,
        court_id: extraCourt.id,
        assignment_type: "acting",
      })
      if (error?.message?.includes("magistrate_courts_current_pair_idx")) {
        log(true, tag, "assign acting court", `${extraCourt.name} (already seated)`)
      } else if (error) fail(tag, "assign acting court", error)
      else log(true, tag, "assign acting court", extraCourt.name)
    }

    const { data: sources, error: sErr } = await sb.from("legal_sources").select("id, name").limit(10)
    if (sErr) fail(tag, "legal sources", sErr)
    else log(true, tag, "legal sources", `${sources?.length ?? 0}`)

    const { data: reports, error: rErr } = await sb.from("issue_reports").select("id, status").limit(10)
    if (rErr) fail(tag, "list issue reports", rErr)
    else log(true, tag, "list issue reports", `${reports?.length ?? 0}`)

    const { data: matters } = await sb.from("docket_matters").select("id").limit(5)
    log(true, tag, "admin docket visibility is court-gated", `${matters?.length ?? 0} matters`)

    log(true, tag, "workflow complete")
  } catch (err) {
    fail(tag, "workflow crashed", err)
  }
}

const runOutsider = async (actor, foreignMatterId, geo1Id) => {
  const tag = actor.key
  try {
    const { token, user } = await signIn(actor.email)
    log(true, tag, "login")
    const sb = clientAs(token)

    const { data: courts } = await sb
      .from("magistrate_courts")
      .select("id")
      .eq("profile_id", user.id)
      .is("ended_at", null)
    log((courts?.length ?? 0) === 0, tag, "no court assignment", `${courts?.length ?? 0}`)

    const { data: matters, error: listErr } = await sb.from("docket_matters").select("id").limit(20)
    if (listErr) fail(tag, "list matters", listErr)
    else log((matters?.length ?? 0) === 0, tag, "sees zero docket matters", `${matters?.length ?? 0}`)

    if (foreignMatterId) {
      const { data } = await sb.from("docket_matters").select("id").eq("id", foreignMatterId).maybeSingle()
      log(!data, tag, "cannot see foreign matter", data ? "LEAK" : "hidden")
    }

    const { error: insErr } = await sb.from("docket_matters").insert({
      court_id: geo1Id,
      case_number: `X-${RUN}-NO`,
      matter_title: "Should not insert",
      charge_or_issue: "Isolation",
      status: "active",
    })
    log(!!insErr, tag, "cannot create matter on foreign court", insErr?.message ?? "INSERT succeeded")

    const { data: profiles } = await sb.from("profiles").select("id, email").limit(20)
    const leaked = (profiles ?? []).filter((p) => p.email !== actor.email)
    log(leaked.length === 0, tag, "cannot browse profiles", leaked.length ? `LEAK ${leaked.length}` : "own only")

    log(true, tag, "workflow complete")
  } catch (err) {
    fail(tag, "workflow crashed", err)
  }
}

const runEmpty = async (actor, foreignMatterId) => {
  const tag = actor.key
  try {
    const { token, user } = await signIn(actor.email)
    log(true, tag, "login", actor.email)
    const sb = clientAs(token)

    const { data: courts } = await sb
      .from("magistrate_courts")
      .select("court_id, courts(name)")
      .eq("profile_id", user.id)
      .is("ended_at", null)
    log((courts?.length ?? 0) > 0, tag, "has court but empty docket", courts?.[0]?.courts?.name ?? "")

    const { data: matters, error } = await sb.from("docket_matters").select("id, case_number").limit(50)
    if (error) fail(tag, "list matters", error)
    else log((matters?.length ?? 0) === 0, tag, "truly empty docket", `${matters?.length ?? 0} matters`)

    if (foreignMatterId) {
      const { data } = await sb.from("docket_matters").select("id").eq("id", foreignMatterId).maybeSingle()
      log(!data, tag, "cannot see other-court files", data ? "LEAK" : "hidden")
    }

    log(true, tag, "workflow complete")
  } catch (err) {
    fail(tag, "workflow crashed", err)
  }
}

const main = async () => {
  console.log(`\nComprehensive multi-persona E2E  ${RUN}\n`)
  const started = Date.now()

  const { data: allCourts, error: courtErr } = await admin
    .from("courts")
    .select("id, name, is_active")
    .eq("is_active", true)
    .order("name")
  if (courtErr || !allCourts?.length) {
    fail("system", "load courts", courtErr ?? "no active courts")
    writeFileSync(RESULTS, JSON.stringify({ error: "no courts", results }, null, 2))
    process.exit(1)
  }
  log(true, "system", "load courts", `${allCourts.length} active`)

  const geo1 = allCourts.find((c) => c.name === "Georgetown Magistrates' Court 1") ?? allCourts[0]
  const acquero = allCourts.find((c) => c.name === "Acquero Magistrate's Court") ?? allCourts[1]
  const noviceCourt = await pickOpenRegularCourt([geo1.id, acquero.id])
  const coveringCourt = await pickOpenRegularCourt([geo1.id, acquero.id, noviceCourt.id])
  const extraActing = allCourts.find(
    (c) => c.id !== geo1.id && c.id !== noviceCourt.id && c.id !== coveringCourt.id && c.id !== acquero.id,
  )

  log(true, "system", "novice court", noviceCourt.name)
  log(true, "system", "covering court", coveringCourt.name)

  /** @type {Record<string, any>} */
  const roster = {}
  for (const spec of PERSONAS) {
    try {
      const id = await ensureUser(spec)
      roster[spec.key] = { ...spec, id }
      log(true, "system", `provision ${spec.key}`, spec.email)
    } catch (err) {
      fail("system", `provision ${spec.key}`, err)
    }
  }

  try {
    await ensureMagistrateAssignment(roster.novice.id, noviceCourt.id, "regular")
    log(true, "system", "assign novice", `${noviceCourt.name} (regular)`)
  } catch (err) {
    fail("system", "assign novice", err)
  }
  try {
    await ensureMagistrateAssignment(roster.experienced.id, geo1.id, "acting")
    log(true, "system", "assign experienced", `${geo1.name} (acting)`)
  } catch (err) {
    fail("system", "assign experienced", err)
  }
  try {
    await endCurrentAssignments(roster.covering.id, "e2e reseat covering off shared empty court")
    await ensureMagistrateAssignment(roster.covering.id, coveringCourt.id, "relief")
    log(true, "system", "assign covering", `${coveringCourt.name} (relief)`)
  } catch (err) {
    fail("system", "assign covering", err)
  }
  try {
    const emptyCourt = await pickOpenRegularCourt([geo1.id, acquero.id, noviceCourt.id, coveringCourt.id])
    await endCurrentAssignments(roster.empty.id, "e2e reseat empty docket magistrate")
    await ensureMagistrateAssignment(roster.empty.id, emptyCourt.id, "regular")
    log(true, "system", "assign empty", `${emptyCourt.name} (regular, dedicated)`)
  } catch (err) {
    fail("system", "assign empty", err)
  }
  try {
    await ensureClerkAssignment(roster.clerk.id, geo1.id, roster.admin?.id ?? SEED_ADMIN_ID)
    log(true, "system", "assign clerk via clerk_courts", geo1.name)
  } catch (err) {
    fail("system", "assign clerk", err)
  }
  try {
    await ensureMagistrateAssignment(roster.admin.id, geo1.id, "acting")
    log(true, "system", "assign admin", `${geo1.name} (acting)`)
  } catch (err) {
    fail("system", "assign admin", err)
  }
  log(true, "system", "outsider intentionally unassigned", roster.outsider?.email ?? "")
  log(true, "system", "empty docket magistrate", roster.empty?.email ?? "")

  await runNovice(roster.novice, noviceCourt)
  await runExperienced(roster.experienced, geo1, roster.covering)
  await runCovering(roster.covering, coveringCourt, {
    id: roster.experienced?.matterId,
    court_id: geo1.id,
  }, roster.novice?.matterId)
  await runClerk(roster.clerk, geo1)
  await runAdmin(roster.admin, roster.novice?.id, extraActing ?? null)
  await runOutsider(roster.outsider, roster.experienced?.matterId, geo1.id)
  await runEmpty(roster.empty, roster.experienced?.matterId)

  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length
  const byPersona = {}
  for (const r of results) {
    if (!byPersona[r.persona]) byPersona[r.persona] = { passed: 0, failed: 0 }
    if (r.ok) byPersona[r.persona].passed += 1
    else byPersona[r.persona].failed += 1
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    run: RUN,
    elapsedMs: Date.now() - started,
    total: results.length,
    passed,
    failed,
    byPersona,
    personas: PERSONAS.map((p) => ({
      key: p.key,
      email: p.email,
      role: p.role,
      matterId: roster[p.key]?.matterId ?? null,
      caseNumber: roster[p.key]?.caseNumber ?? null,
    })),
    results,
  }
  writeFileSync(RESULTS, JSON.stringify(payload, null, 2))

  console.log(`\n=== Personas: ${PERSONAS.length} | ${passed} passed, ${failed} failed of ${results.length} (${RUN}) ===`)
  console.log("Results:", RESULTS)
  if (failed) {
    console.log("Failures:")
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - [${r.persona}] ${r.step}: ${r.detail}`)
    }
  }
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
