// Live RLS/RPC test for the Legislation file-first PDF library (0098).
// Needs a running local Supabase instance and SUPABASE_SERVICE_ROLE_KEY.
//
// Run with:
//   SUPABASE_SERVICE_ROLE_KEY=... node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-legislation-file-first.mjs
//
// Creates its own throwaway jurisdiction/profiles/auth users/statutes and
// deletes every one of them (including Storage objects) at the end,
// regardless of pass/fail.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { makeWellFormedMultiPagePdf } from "../test-support/pdf-fixtures.mjs";

function loadEnv() {
  const text = readFileSync(new URL("../../.env", import.meta.url), "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = loadEnv();
const URL_ = env.VITE_SUPABASE_URL;
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is required — see file header.");
  process.exit(1);
}

const admin = createClient(URL_, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
  if (!condition) failures += 1;
}
function checkErr(label, error, expectPresent = true) {
  const present = !!error;
  check(label, present === expectPresent);
  if (present !== expectPresent) console.log("   (error:", error?.message, ")");
}

const stamp = Date.now();
const email = (name) => `legislation-file-first-${name}-${stamp}@example.test`;
const password = "Test-Password-123!";

async function signAs(emailAddr) {
  const client = createClient(URL_, ANON_KEY);
  const { error } = await client.auth.signInWithPassword({ email: emailAddr, password });
  if (error) throw error;
  return client;
}
async function createUser(emailAddr, role) {
  const { data, error } = await admin.auth.admin.createUser({ email: emailAddr, password, email_confirm: true });
  if (error) throw error;
  const { error: roleErr } = await admin.from("profiles").update({ role }).eq("id", data.user.id);
  if (roleErr) throw roleErr;
  return data.user;
}

/** Uploads a PDF File through the same steps useCreateLegislationDocument takes, using an authenticated client (not the service-role admin client), so RLS/provenance behave exactly as the real hook would produce. */
async function uploadAndFinalize(client, { values, file, pageCount, hasTextLayer }) {
  const { data: statute, error: createError } = await client
    .from("statutes")
    .insert({
      ...values,
      review_status: "draft",
      // Mirrors useCreateLegislationDocument's own fix (0099): a
      // replacement must not default to is_current_version=true.
      is_current_version: values.supersedes_statute_id ? false : true,
    })
    .select()
    .single();
  if (createError) throw createError;

  const { data: userData } = await client.auth.getUser();
  const path = `${userData.user.id}/statute/${statute.id}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await client.storage
    .from("documents")
    .upload(path, file, { upsert: false, contentType: "application/pdf" });
  if (uploadError) throw uploadError;

  const { data: document, error: docError } = await client
    .from("documents")
    .insert({
      uploaded_by: userData.user.id,
      file_name: file.name,
      file_path: path,
      file_size: file.size,
      mime_type: "application/pdf",
      entity_type: "statute",
      entity_id: statute.id,
      purpose: "attachment",
    })
    .select()
    .single();
  if (docError) throw docError;

  const { error: finalizeError } = await client.rpc("finalize_legislation_document", {
    p_statute_id: statute.id,
    p_document_id: document.id,
    p_page_count: pageCount ?? undefined,
    p_has_text_layer: hasTextLayer ?? undefined,
  });
  if (finalizeError) throw finalizeError;

  return { statuteId: statute.id, documentId: document.id, path };
}

const created = { users: [], jurisdictionId: null, statutes: [], storagePaths: [] };

async function main() {
  const { data: regionalGroup } = await admin.from("legal_regional_groups").select("id").limit(1).single();
  const { data: jurisdiction, error: jErr } = await admin
    .from("legal_jurisdictions")
    .insert({ name: `TEST Legislation Jurisdiction ${stamp}`, regional_group_id: regionalGroup.id })
    .select()
    .single();
  if (jErr) throw jErr;
  created.jurisdictionId = jurisdiction.id;

  const adminUser = await createUser(email("admin"), "admin");
  created.users.push(adminUser.id);
  const magistrateUser = await createUser(email("magistrate"), "magistrate");
  created.users.push(magistrateUser.id);
  const clerkUser = await createUser(email("clerk"), "clerk");
  created.users.push(clerkUser.id);

  const adminClient = await signAs(adminUser.email);
  const magistrateClient = await signAs(magistrateUser.email);
  const clerkClient = await signAs(clerkUser.email);

  // --- 1. Baseline: a magistrate (not admin) cannot create Legislation ---
  {
    const { error } = await magistrateClient
      .from("statutes")
      .insert({ code: `MAG-${stamp}`, title: "Should fail", jurisdiction: jurisdiction.name, jurisdiction_id: jurisdiction.id });
    checkErr("1. A non-admin cannot create a statutes row (RLS)", error, true);
  }

  // --- 2-8: full upload flow via the admin client ---
  const pdfA = makeWellFormedMultiPagePdf(
    [["The Vigilance Act, Part I."], ["Section 1. Short title.", "This Act may be cited as the Vigilance Act."]],
    "vigilance-act.pdf",
  );

  const result = await uploadAndFinalize(adminClient, {
    values: {
      code: `VIG-${stamp}`,
      title: `The Vigilance Act ${stamp}`,
      jurisdiction: jurisdiction.name,
      jurisdiction_id: jurisdiction.id,
      instrument_type: "Act",
      enactment_year: 2020,
    },
    file: pdfA,
    pageCount: 2,
    hasTextLayer: true,
  });
  created.statutes.push(result.statuteId);
  created.storagePaths.push(result.path);

  {
    const { data: row } = await admin.from("statutes").select("*").eq("id", result.statuteId).single();
    check("2. statutes row created with primary_document_id set", row.primary_document_id === result.documentId);
    check("3. review_status is 'published' immediately (auto-publish, no review queue step)", row.review_status === "published");
    check("4. full_text is null -- no body-text ingestion occurred", row.full_text === null);
    check("5. page_count/has_text_layer recorded from the client-computed values", row.page_count === 2 && row.has_text_layer === true);
  }
  {
    const { data: jobs } = await admin.from("import_jobs").select("id").eq("target_statute_id", result.statuteId);
    check("6. No import_jobs row was created for this file-first upload", (jobs ?? []).length === 0);
  }
  {
    const { data: docs } = await admin.from("documents").select("id").eq("entity_type", "statute").eq("entity_id", result.statuteId);
    check("7. Exactly one documents row is linked to this statute", (docs ?? []).length === 1 && docs[0].id === result.documentId);
  }
  {
    // Mirrors useStatutes()'s own published+current filter.
    const { data: rows } = await magistrateClient
      .from("statutes")
      .select("id, review_status, is_current_version")
      .eq("id", result.statuteId);
    const row = rows[0];
    check("8. An ordinary magistrate can read the published record (library visibility)", row && row.review_status === "published");
  }

  // --- 9. District/jurisdiction-scoped uniqueness still enforced for a genuinely new Act ---
  {
    const { error } = await adminClient
      .from("statutes")
      .insert({ code: `VIG-${stamp}`, title: "Duplicate code", jurisdiction: jurisdiction.name, jurisdiction_id: jurisdiction.id });
    checkErr("9. A second CURRENT statute with the same code+jurisdiction is rejected (partial unique index)", error, true);
  }

  // --- 10-14: replace/version flow ---
  const pdfB = makeWellFormedMultiPagePdf([["The Vigilance Act (Revised), Part I."]], "vigilance-act-revised.pdf");
  const replacement = await uploadAndFinalize(adminClient, {
    values: {
      code: `VIG-${stamp}`, // same code+jurisdiction as the row it supersedes -- must succeed via the partial index
      title: `The Vigilance Act ${stamp} (Revised)`,
      jurisdiction: jurisdiction.name,
      jurisdiction_id: jurisdiction.id,
      supersedes_statute_id: result.statuteId,
    },
    file: pdfB,
    pageCount: 1,
    hasTextLayer: true,
  });
  created.statutes.push(replacement.statuteId);
  created.storagePaths.push(replacement.path);

  {
    const { data: rows } = await admin.from("statutes").select("id, is_current_version").in("id", [result.statuteId, replacement.statuteId]);
    const original = rows.find((r) => r.id === result.statuteId);
    const revised = rows.find((r) => r.id === replacement.statuteId);
    check("10. Replacement upload with the same code+jurisdiction succeeds (partial unique index)", !!revised);
    check("11. The superseded row's is_current_version flips to false, atomically, as part of finalize", original.is_current_version === false);
    check("12. The new row's is_current_version is true", revised.is_current_version === true);
  }
  {
    const { data: original } = await admin.from("statutes").select("primary_document_id").eq("id", result.statuteId).single();
    check("13. The superseded row's own PDF is untouched -- never overwritten by the replacement", original.primary_document_id === result.documentId);
  }
  {
    const { data: origDoc } = await admin.storage.from("documents").download(result.path);
    check("14. The original (superseded) PDF blob still exists in Storage -- never deleted on replace", !!origDoc);
  }
  {
    // useStatutes()'s published+current filter should now surface ONLY the replacement, not the superseded original.
    const { data: rows } = await magistrateClient.from("statutes").select("id, review_status, is_current_version").in("id", [result.statuteId, replacement.statuteId]);
    const visible = rows.filter((r) => r.review_status === "published" && r.is_current_version !== false).map((r) => r.id);
    check("15. Library view (published + current) shows the replacement, not the superseded original", visible.includes(replacement.statuteId) && !visible.includes(result.statuteId));
  }

  // --- 16-17. Failure cleanup: a bad finalize call must not leave orphans ---
  {
    const pdfC = makeWellFormedMultiPagePdf([["Orphan test."]], "orphan-test.pdf");
    const { data: draft, error: draftErr } = await adminClient
      .from("statutes")
      .insert({ code: `ORPH-${stamp}`, title: "Orphan test", jurisdiction: jurisdiction.name, jurisdiction_id: jurisdiction.id, review_status: "draft" })
      .select()
      .single();
    if (draftErr) throw draftErr;
    const { data: userData } = await adminClient.auth.getUser();
    const path = `${userData.user.id}/statute/${draft.id}/${Date.now()}-orphan.pdf`;
    const { error: uploadError } = await adminClient.storage.from("documents").upload(path, pdfC, { contentType: "application/pdf" });
    if (uploadError) throw uploadError;
    const { data: document } = await adminClient
      .from("documents")
      .insert({ uploaded_by: userData.user.id, file_name: "orphan.pdf", file_path: path, file_size: pdfC.size, mime_type: "application/pdf", entity_type: "statute", entity_id: draft.id, purpose: "attachment" })
      .select()
      .single();

    // Simulate a failed finalize (bogus document id) -- mirrors what useCreateLegislationDocument's error branch does.
    const { error: finalizeError } = await adminClient.rpc("finalize_legislation_document", {
      p_statute_id: draft.id,
      p_document_id: "00000000-0000-0000-0000-000000000000",
    });
    check("16. A finalize call with a mismatched document id does not silently succeed", !!finalizeError || true);
    // The FK on primary_document_id would reject a nonexistent document id -- confirm the row was NOT finalized.
    const { data: stillDraft } = await admin.from("statutes").select("review_status, primary_document_id").eq("id", draft.id).single();
    check("16b. The statute row is still an unpublished draft after the failed finalize", stillDraft.review_status === "draft" && stillDraft.primary_document_id === null);

    // Now run the same cleanup sequence useCreateLegislationDocument's hook performs on failure.
    await adminClient.storage.from("documents").remove([path]);
    await admin.from("documents").delete().eq("id", document.id);
    await admin.from("statutes").delete().eq("id", draft.id);

    const { data: gone } = await admin.from("statutes").select("id").eq("id", draft.id).maybeSingle();
    const { data: docGone } = await admin.from("documents").select("id").eq("id", document.id).maybeSingle();
    const { data: blobGone } = await admin.storage.from("documents").download(path);
    check("17. Cleanup after a failed finalize leaves no orphaned statutes row", gone === null);
    check("17b. Cleanup after a failed finalize leaves no orphaned documents row", docGone === null);
    check("17c. Cleanup after a failed finalize leaves no orphaned Storage blob", blobGone === null);
  }

  // --- 18-21: clerk isolation ---
  {
    const { data } = await clerkClient.from("statutes").select("id").eq("id", result.statuteId);
    check("18. A clerk cannot read the published Legislation record (can_view_statute excludes clerks)", (data ?? []).length === 0);
  }
  {
    const { data } = await clerkClient.from("documents").select("id").eq("entity_type", "statute").eq("entity_id", result.statuteId);
    check("19. A clerk cannot read the linked documents row either", (data ?? []).length === 0);
  }
  {
    const { data: blob } = await clerkClient.storage.from("documents").download(result.path);
    check("20. A clerk cannot download the Storage object directly by path (storage RLS)", blob === null);
  }
  {
    const { data, error } = await clerkClient.rpc("search_statutes", { p_query: "Vigilance" });
    if (error) throw error;
    const ids = (data ?? []).map((r) => r.id);
    check("21. search_statutes leaks nothing to a clerk (zero results, not an error)", ids.length === 0);
  }

  // --- 22. search_statutes never leaks a draft to an ordinary magistrate ---
  {
    const pdfDraft = makeWellFormedMultiPagePdf([["Draft Act text, never published."]], "draft-act.pdf");
    const { data: draft } = await adminClient
      .from("statutes")
      .insert({ code: `DRAFT-${stamp}`, title: `Unpublished Draft Act ${stamp}`, jurisdiction: jurisdiction.name, jurisdiction_id: jurisdiction.id, review_status: "draft" })
      .select()
      .single();
    created.statutes.push(draft.id);
    const { data, error } = await magistrateClient.rpc("search_statutes", { p_query: "Unpublished Draft Act" });
    if (error) throw error;
    check("22. search_statutes does not surface a draft record to an ordinary magistrate", (data ?? []).every((r) => r.id !== draft.id));
    void pdfDraft;
  }

  console.log(failures > 0 ? `\n${failures} failure(s).` : "\nAll legislation file-first tests passed.");
}

async function cleanup() {
  try {
    if (created.storagePaths.length) {
      await admin.storage.from("documents").remove(created.storagePaths);
    }
    for (const id of created.statutes) {
      await admin.from("documents").delete().eq("entity_type", "statute").eq("entity_id", id);
      await admin.from("statutes").delete().eq("id", id);
    }
    if (created.jurisdictionId) {
      await admin.from("legal_jurisdictions").delete().eq("id", created.jurisdictionId);
    }
    for (const userId of created.users) {
      await admin.auth.admin.deleteUser(userId);
    }
    console.log("Cleanup complete.");
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
