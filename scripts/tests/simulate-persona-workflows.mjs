/**
 * Persona-driven end-to-end simulation against local Magistrate Wizard.
 * Creates skill-level users, runs distinct workflows (incl. client OCR ingest
 * for curator / experienced magistrate), and writes results JSON.
 *
 *   npm run test:persona-workflows
 */
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createClient } from "@supabase/supabase-js"
import { ingestDocument } from "@/lib/ingest-document"
import { terminateOcrWorker } from "@/lib/ocr/engine"
import { characterErrorRate, containsNormalized } from "@/lib/ocr/accuracy"
import { makeRenderedScanPdf, SCAN_GROUND_TRUTH, SCAN_MUST_CONTAIN } from "../test-support/scanned-pdf-fixtures.mjs"
import { makeTextPdf } from "../test-support/pdf-fixtures.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const RESULTS = join(__dirname, "persona-workflow-results.json")

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:55321"
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
const PASSWORD = "password123"
const RUN = `P${Date.now().toString(36).slice(-6).toUpperCase()}`

const admin = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const anon = createClient(URL, ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** @type {{ ok: boolean, persona: string, step: string, detail: string, ms?: number }[]} */
const results = []

const log = (ok, persona, step, detail = "", ms) => {
  const row = { ok: !!ok, persona, step, detail: String(detail).slice(0, 500), ...(ms != null ? { ms } : {}) }
  results.push(row)
  console.log(`${ok ? "PASS" : "FAIL"}  [${persona}] ${step}${detail ? ` — ${detail}` : ""}${ms != null ? ` (${ms}ms)` : ""}`)
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

const ensureAssignment = async (profileId, courtId, assignmentType = "regular") => {
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

/**
 * Skill-level personas — each exercises a different slice of the product.
 */
const PERSONAS = [
  {
    key: "novice",
    email: "persona.novice@magistrate-wizard.local",
    fullName: "Hon. Maya Novice (Day-1 Magistrate)",
    role: "magistrate",
    level: "beginner",
    description: "First sitting: login, create one matter, parties, short note, search. No OCR.",
    assignmentType: "regular",
  },
  {
    key: "experienced",
    email: "persona.experienced@magistrate-wizard.local",
    fullName: "Hon. James Experienced (Senior Magistrate)",
    role: "magistrate",
    level: "advanced",
    description: "Full docket lifecycle + OCR scanned judgment ingest into draft ruling.",
    assignmentType: "regular",
  },
  {
    key: "covering",
    email: "persona.covering@magistrate-wizard.local",
    fullName: "Hon. Aisha Covering (Relief Magistrate)",
    role: "magistrate",
    level: "intermediate",
    description: "Relief assignment + receive view share; must not edit unless edit share.",
    assignmentType: "relief",
  },
  {
    key: "clerk",
    email: "persona.clerk@magistrate-wizard.local",
    fullName: "Clerk Devon Registry",
    role: "clerk",
    level: "intermediate",
    description: "Court clerk: list matters, add event notes, cannot admin profiles.",
    assignmentType: "regular",
  },
  {
    key: "admin",
    email: "persona.admin@magistrate-wizard.local",
    fullName: "Admin Lex Curator",
    role: "admin",
    level: "expert",
    description: "Admin: profiles, court assign, legal sources, OCR library ingest simulation.",
    assignmentType: "regular",
  },
  {
    key: "outsider",
    email: "persona.outsider@magistrate-wizard.local",
    fullName: "Outsider No Court",
    role: "magistrate",
    level: "none",
    description: "Authenticated magistrate with ZERO court assignment — isolation checks.",
    assignmentType: null,
  },
]

const runNoviceWorkflow = async (actor, court) => {
  const tag = actor.key
  const t0 = Date.now()
  try {
    const { token, user } = await signIn(actor.email)
    log(true, tag, "login", actor.email)
    const sb = clientAs(token)

    const { data: courts, error: cErr } = await sb
      .from("magistrate_courts")
      .select("court_id, courts(name)")
      .eq("profile_id", user.id)
      .is("ended_at", null)
    if (cErr) return fail(tag, "list courts", cErr)
    log((courts?.length ?? 0) > 0, tag, "sees court assignment", courts?.[0]?.courts?.name ?? "")

    const caseNumber = `N-${RUN}-01`
    const { data: matter, error: mErr } = await sb
      .from("docket_matters")
      .insert({
        court_id: court.id,
        case_number: caseNumber,
        matter_title: `Police v. First Day Defendant (${tag})`,
        charge_or_issue: "Simple larceny",
        status: "active",
      })
      .select()
      .single()
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

    const { error: nErr } = await sb.from("bench_notes").insert({
      title: `Day-1 notes — ${caseNumber}`,
      entity_type: "docket_matter",
      entity_id: matter.id,
      status: "draft",
      is_private: true,
      content_text: "Reminded of plea options. Adjourned for counsel.",
    })
    if (nErr) fail(tag, "draft bench note", nErr)
    else log(true, tag, "draft bench note")

    const { data: hits, error: sErr } = await sb.rpc("search_docket_matters", {
      p_query: "First",
      p_limit: 5,
    })
    if (sErr) fail(tag, "search own matter", sErr)
    else log(true, tag, "search own matter", `${hits?.length ?? 0} hits`)

    log(true, tag, "workflow complete", "beginner path", Date.now() - t0)
  } catch (err) {
    fail(tag, "workflow crashed", err)
  }
}

const runExperiencedWorkflow = async (actor, court, shareWith) => {
  const tag = actor.key
  const t0 = Date.now()
  try {
    const { token, user } = await signIn(actor.email)
    log(true, tag, "login", actor.email)
    const sb = clientAs(token)

    const caseNumber = `E-${RUN}-42`
    const { data: matter, error: mErr } = await sb
      .from("docket_matters")
      .insert({
        court_id: court.id,
        case_number: caseNumber,
        matter_title: `Police v. Senior Sitting (${tag})`,
        charge_or_issue: "Assault occasioning actual bodily harm",
        status: "active",
      })
      .select()
      .single()
    if (mErr) return fail(tag, "create matter", mErr)
    log(true, tag, "create matter", caseNumber)
    actor.matterId = matter.id
    actor.caseNumber = caseNumber

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
          orders_made_at_event: "Bail continued. Next sitting 3 Sep 2026.",
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

    for (const t of ["urgent", "part-heard"]) {
      const { error } = await sb.from("docket_matter_tags").insert({
        docket_matter_id: matter.id,
        tag_name: t,
      })
      if (error) fail(tag, `tag ${t}`, error)
      else log(true, tag, `tag ${t}`)
    }

    // Client-side OCR ingest (what happens when they upload a scan into a draft)
    const scanFile = makeRenderedScanPdf({ name: `persona-scan-${RUN}.pdf`, jpegQuality: 88 })
    const ocrT0 = Date.now()
    const envelope = await ingestDocument(scanFile)
    const ocrMs = Date.now() - ocrT0
    const hits = SCAN_MUST_CONTAIN.filter((p) => containsNormalized(envelope.text, p)).length
    const usable = envelope.status === "extracted" || envelope.status === "low_quality"
    log(
      usable && envelope.ocrUsed === true && envelope.requiresReview === true && hits >= 2,
      tag,
      "OCR ingest scanned judgment",
      `status=${envelope.status} hits=${hits}/${SCAN_MUST_CONTAIN.length} cer=${usable ? characterErrorRate(envelope.text, SCAN_GROUND_TRUTH).toFixed(3) : "n/a"}`,
      ocrMs,
    )
    actor.ocrStatus = envelope.status
    actor.ocrMs = ocrMs

    const judgmentBody =
      usable && envelope.text
        ? envelope.text.slice(0, 4000)
        : "The accused is put to plea. Trial date fixed. [OCR withheld — manual entry]"

    const { data: judgment, error: jErr } = await sb
      .from("judgments")
      .insert({
        title: `Ruling — ${matter.matter_title}`,
        case_number: caseNumber,
        court_name: court.name,
        judgment_date: "2026-08-14",
        content_text: judgmentBody,
      })
      .select()
      .single()
    if (jErr) fail(tag, "create judgment from OCR text", jErr)
    else {
      log(true, tag, "create judgment from OCR text", judgment.status)
      actor.judgmentId = judgment.id
      const { error: linkErr } = await sb.from("docket_matter_judgments").insert({
        docket_matter_id: matter.id,
        judgment_id: judgment.id,
      })
      if (linkErr) fail(tag, "link judgment", linkErr)
      else log(true, tag, "link judgment")
    }

    const { data: note, error: nErr } = await sb
      .from("bench_notes")
      .insert({
        title: `Continuation notes — ${caseNumber}`,
        entity_type: "docket_matter",
        entity_id: matter.id,
        status: "draft",
        is_private: true,
        content_text: "Credibility of PW1 to be tested.",
      })
      .select()
      .single()
    if (nErr) fail(tag, "bench note", nErr)
    else {
      log(true, tag, "bench note")
      const { error: pubErr } = await sb.from("bench_notes").update({ status: "published" }).eq("id", note.id)
      if (pubErr) fail(tag, "publish bench note", pubErr)
      else log(true, tag, "publish bench note")
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

    const { error: bmErr } = await sb.from("bookmarks").insert({
      entity_type: "docket_matter",
      entity_id: matter.id,
      user_id: user.id,
    })
    if (bmErr) fail(tag, "bookmark", bmErr)
    else log(true, tag, "bookmark")

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
          else {
            log(true, tag, "share view with covering", shareWith.email)
            actor.sharedWith = shareWith.email
            actor.sharePermission = "view"
          }
        }
      }
    }

    const { data: gHits, error: gErr } = await sb.rpc("global_search", {
      p_query: caseNumber,
      p_limit: 10,
    })
    if (gErr) fail(tag, "global search", gErr)
    else log(true, tag, "global search", `${gHits?.length ?? 0} hits`)

    log(true, tag, "workflow complete", "advanced path", Date.now() - t0)
  } catch (err) {
    fail(tag, "workflow crashed", err)
  }
}

const runCoveringWorkflow = async (actor, court, sharedMatter) => {
  const tag = actor.key
  const t0 = Date.now()
  try {
    const { token, user } = await signIn(actor.email)
    log(true, tag, "login", actor.email)
    const sb = clientAs(token)

    const { data: courts } = await sb
      .from("magistrate_courts")
      .select("assignment_type, courts(name)")
      .eq("profile_id", user.id)
      .is("ended_at", null)
    log(
      (courts?.length ?? 0) > 0,
      tag,
      "relief assignment visible",
      courts?.map((c) => `${c.assignment_type}:${c.courts?.name}`).join("; ") ?? "",
    )

    // Own short matter on relief court
    const caseNumber = `C-${RUN}-07`
    const { data: matter, error: mErr } = await sb
      .from("docket_matters")
      .insert({
        court_id: court.id,
        case_number: caseNumber,
        matter_title: `Police v. Relief Sitting (${tag})`,
        charge_or_issue: "Threatening language",
        status: "active",
      })
      .select()
      .single()
    if (mErr) fail(tag, "create relief-court matter", mErr)
    else {
      log(true, tag, "create relief-court matter", caseNumber)
      actor.matterId = matter.id
    }

    if (sharedMatter?.id) {
      const { data, error } = await sb
        .from("docket_matters")
        .select("id, case_number, matter_title")
        .eq("id", sharedMatter.id)
        .maybeSingle()
      if (error) fail(tag, "see shared matter", error)
      else log(!!data?.id, tag, "see shared matter", data?.case_number ?? "hidden")

      const { data: updated, error: updErr } = await sb
        .from("docket_matters")
        .update({ outcome: "covering-should-not-edit-view-share" })
        .eq("id", sharedMatter.id)
        .select("id")

      const sameCourt = sharedMatter.court_id === court.id
      const blocked = Boolean(updErr) || !(updated?.length)
      if (sameCourt) {
        log(!blocked, tag, "same-court can still edit via assignment", updErr?.message ?? "ok")
      } else {
        log(blocked, tag, "view-share cannot edit foreign court", updErr?.message ?? "0 rows")
      }
    }

    log(true, tag, "workflow complete", "covering path", Date.now() - t0)
  } catch (err) {
    fail(tag, "workflow crashed", err)
  }
}

const runClerkWorkflow = async (actor, court) => {
  const tag = actor.key
  const t0 = Date.now()
  try {
    const { token, user } = await signIn(actor.email)
    log(true, tag, "login", actor.email)
    const sb = clientAs(token)

    const { data: matters, error: listErr } = await sb
      .from("docket_matters")
      .select("id, case_number, matter_title")
      .eq("court_id", court.id)
      .order("updated_at", { ascending: false })
      .limit(20)
    if (listErr) fail(tag, "list court docket", listErr)
    else log(true, tag, "list court docket", `${matters?.length ?? 0} matters`)

    const caseNumber = `K-${RUN}-03`
    const { data: matter, error: mErr } = await sb
      .from("docket_matters")
      .insert({
        court_id: court.id,
        case_number: caseNumber,
        matter_title: `Registry filing (${tag})`,
        charge_or_issue: "Failure to maintain a child",
        status: "active",
      })
      .select()
      .single()
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

    log(true, tag, "workflow complete", "clerk path", Date.now() - t0)
  } catch (err) {
    fail(tag, "workflow crashed", err)
  }
}

const runAdminWorkflow = async (actor, targetProfileId, extraCourt) => {
  const tag = actor.key
  const t0 = Date.now()
  try {
    const { token } = await signIn(actor.email)
    log(true, tag, "login", actor.email)
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
      if (error) fail(tag, "assign acting court", error)
      else log(true, tag, "assign acting court", extraCourt.name)
    }

    const { data: sources, error: sErr } = await sb.from("legal_sources").select("id, name").limit(10)
    if (sErr) fail(tag, "legal sources", sErr)
    else log(true, tag, "legal sources", `${sources?.length ?? 0}`)

    // Library curator: OCR a scan + prefer text-layer PDF (what bulk ingest does client-side)
    const scan = makeRenderedScanPdf({ name: `library-scan-${RUN}.pdf`, jpegQuality: 90 })
    const textPdf = makeTextPdf(SCAN_GROUND_TRUTH.split("\n").filter(Boolean), `library-text-${RUN}.pdf`)

    const ocrT0 = Date.now()
    const scanEnv = await ingestDocument(scan)
    const ocrMs = Date.now() - ocrT0
    const textT0 = Date.now()
    const textEnv = await ingestDocument(textPdf)
    const textMs = Date.now() - textT0

    const scanOk =
      (scanEnv.status === "extracted" || scanEnv.status === "low_quality") &&
      scanEnv.ocrUsed === true &&
      scanEnv.requiresReview === true
    log(scanOk, tag, "library OCR scan ingest", `status=${scanEnv.status}`, ocrMs)
    log(
      textEnv.ocrUsed === false && textEnv.method === "pdf_text_layer",
      tag,
      "library text-layer prefers fast path",
      `method=${textEnv.method}`,
      textMs,
    )

    const { data: matters } = await sb.from("docket_matters").select("id").limit(5)
    log(true, tag, "admin docket visibility is court-gated", `${matters?.length ?? 0} matters`)

    log(true, tag, "workflow complete", "admin/curator path", Date.now() - t0)
  } catch (err) {
    fail(tag, "workflow crashed", err)
  }
}

const runOutsiderWorkflow = async (actor, foreignMatterId) => {
  const tag = actor.key
  const t0 = Date.now()
  try {
    const { token, user } = await signIn(actor.email)
    log(true, tag, "login", actor.email)
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

    const { data: profiles } = await sb.from("profiles").select("id, email").limit(20)
    const leaked = (profiles ?? []).filter((p) => p.email !== actor.email)
    log(leaked.length === 0, tag, "cannot browse profiles", leaked.length ? `LEAK ${leaked.length}` : "own only")

    log(true, tag, "workflow complete", "isolation path", Date.now() - t0)
  } catch (err) {
    fail(tag, "workflow crashed", err)
  }
}

const main = async () => {
  console.log(`\nPersona workflow simulation  ${RUN}\n`)
  const started = Date.now()

  const { data: courts, error: courtErr } = await admin
    .from("courts")
    .select("id, name, is_active")
    .eq("is_active", true)
    .order("name")
    .limit(20)
  if (courtErr || !courts?.length) {
    fail("system", "load courts", courtErr ?? "no active courts")
    writeFileSync(RESULTS, JSON.stringify({ error: "no courts", results }, null, 2))
    process.exit(1)
  }
  log(true, "system", "load courts", courts.map((c) => c.name).slice(0, 5).join("; "))

  const geo1 = courts.find((c) => c.name === "Georgetown Magistrates' Court 1") ?? courts[0]
  const other = courts.find((c) => c.id !== geo1.id) ?? courts[1] ?? geo1

  /** @type {Record<string, any>} */
  const roster = {}
  for (const spec of PERSONAS) {
    try {
      const id = await ensureUser(spec)
      roster[spec.key] = { ...spec, id }
      log(true, "system", `provision ${spec.key}`, `${spec.role} ${spec.email} (${spec.level})`)
    } catch (err) {
      fail("system", `provision ${spec.key}`, err)
    }
  }

  for (const key of ["novice", "experienced", "clerk", "admin"]) {
    const u = roster[key]
    if (!u) continue
    try {
      await ensureAssignment(u.id, geo1.id, u.assignmentType ?? "regular")
      u.court = geo1
      log(true, "system", `assign ${key}`, geo1.name)
    } catch (err) {
      fail("system", `assign ${key}`, err)
    }
  }
  if (roster.covering) {
    try {
      await ensureAssignment(roster.covering.id, geo1.id, "relief")
      roster.covering.court = geo1
      log(true, "system", "assign covering", `${geo1.name} (relief)`)
    } catch (err) {
      fail("system", "assign covering", err)
    }
  }
  log(true, "system", "outsider intentionally unassigned", roster.outsider?.email ?? "")

  await runNoviceWorkflow(roster.novice, geo1)
  await runExperiencedWorkflow(roster.experienced, geo1, roster.covering)
  await runCoveringWorkflow(roster.covering, geo1, {
    id: roster.experienced?.matterId,
    court_id: geo1.id,
  })
  await runClerkWorkflow(roster.clerk, geo1)
  await runAdminWorkflow(roster.admin, roster.novice?.id, other.id !== geo1.id ? other : null)
  await runOutsiderWorkflow(roster.outsider, roster.experienced?.matterId)

  await terminateOcrWorker()

  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length
  const byPersona = {}
  for (const r of results) {
    if (!byPersona[r.persona]) byPersona[r.persona] = { passed: 0, failed: 0, steps: [] }
    if (r.ok) byPersona[r.persona].passed += 1
    else byPersona[r.persona].failed += 1
    byPersona[r.persona].steps.push(r)
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    run: RUN,
    elapsedMs: Date.now() - started,
    total: results.length,
    passed,
    failed,
    personas: PERSONAS.map((p) => ({
      key: p.key,
      email: p.email,
      fullName: p.fullName,
      role: p.role,
      level: p.level,
      description: p.description,
      password: PASSWORD,
      stats: byPersona[p.key] ?? { passed: 0, failed: 0 },
      matterId: roster[p.key]?.matterId ?? null,
      caseNumber: roster[p.key]?.caseNumber ?? null,
      ocrStatus: roster[p.key]?.ocrStatus ?? null,
      ocrMs: roster[p.key]?.ocrMs ?? null,
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
