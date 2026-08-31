// Live RLS test for the Legislation view/edit separation:
// magistrates may READ published Legislation and may publish a NEW Act
// (0114, Legislation page Add). They still cannot edit, replace, or
// delete an already-published library record -- that remains admin-only.
//
// Run with:
//   SUPABASE_SERVICE_ROLE_KEY=... node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-legislation-view-edit-separation.mjs
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
const email = (name) => `legislation-view-edit-${name}-${stamp}@example.test`;
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

const created = { users: [], jurisdictionId: null, statutes: [], storagePaths: [] };

async function main() {
  const { data: regionalGroup } = await admin.from("legal_regional_groups").select("id").limit(1).single();
  const { data: jurisdiction, error: jErr } = await admin
    .from("legal_jurisdictions")
    .insert({ name: `TEST View-Edit Jurisdiction ${stamp}`, regional_group_id: regionalGroup.id })
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

  // Seed a real, published record the same way the file-first upload flow does.
  const pdf = makeWellFormedMultiPagePdf([["Summary Jurisdiction (Offences) Act, Chapter 8:02."]], "sjo-act.pdf");
  const { data: statute, error: createErr } = await adminClient
    .from("statutes")
    .insert({
      code: `SJO-${stamp}`,
      title: `Summary Jurisdiction (Offences) Act ${stamp}`,
      jurisdiction: jurisdiction.name,
      jurisdiction_id: jurisdiction.id,
      chapter_number: "8:02",
      review_status: "draft",
    })
    .select()
    .single();
  if (createErr) throw createErr;
  created.statutes.push(statute.id);

  const { data: userData } = await adminClient.auth.getUser();
  const path = `${userData.user.id}/statute/${statute.id}/${Date.now()}-sjo-act.pdf`;
  await adminClient.storage.from("documents").upload(path, pdf, { contentType: "application/pdf" });
  created.storagePaths.push(path);
  const { data: document } = await adminClient
    .from("documents")
    .insert({ uploaded_by: userData.user.id, file_name: "sjo-act.pdf", file_path: path, file_size: pdf.size, mime_type: "application/pdf", entity_type: "statute", entity_id: statute.id, purpose: "attachment" })
    .select()
    .single();
  await adminClient.rpc("finalize_legislation_document", { p_statute_id: statute.id, p_document_id: document.id, p_page_count: 1, p_has_text_layer: true });

  // --- 1: baseline -- a magistrate legitimately has VIEW access -----------
  {
    const { data } = await magistrateClient.from("statutes").select("id, title, primary_document_id").eq("id", statute.id).maybeSingle();
    check("1. An ordinary magistrate CAN read the published record (this is the new, intended read-only access)", !!data && data.primary_document_id === document.id);
  }

  // --- 2-5: a magistrate cannot mutate an already-published library record ---
  {
    const { data, error } = await magistrateClient
      .from("statutes")
      .update({ title: "Hacked title" })
      .eq("id", statute.id)
      .select();
    check("2. A magistrate's metadata UPDATE affects zero rows (RLS silently denies, not a bypass)", !error && (data ?? []).length === 0);
    const { data: unchanged } = await admin.from("statutes").select("title").eq("id", statute.id).single();
    check("2b. The record's title is genuinely unchanged after the magistrate's attempt", unchanged.title === statute.title);
  }
  {
    const { error } = await magistrateClient.rpc("finalize_legislation_document", {
      p_statute_id: statute.id,
      p_document_id: document.id,
    });
    checkErr("3. A magistrate cannot finalize someone else's already-published Act (replace path)", error, true);
  }
  {
    const magFile = makeWellFormedMultiPagePdf([["Attempted replacement by a magistrate."]], "hack.pdf");
    const magPath = `${(await magistrateClient.auth.getUser()).data.user.id}/statute/${statute.id}/${Date.now()}-hack.pdf`;
    await magistrateClient.storage.from("documents").upload(magPath, magFile, { contentType: "application/pdf" });
    const { error } = await magistrateClient
      .from("documents")
      .insert({ uploaded_by: (await magistrateClient.auth.getUser()).data.user.id, file_name: "hack.pdf", file_path: magPath, file_size: magFile.size, mime_type: "application/pdf", entity_type: "statute", entity_id: statute.id, purpose: "attachment" });
    checkErr("4. A magistrate cannot insert a documents row for entity_type='statute' (replace-file path)", error, true);
    await magistrateClient.storage.from("documents").remove([magPath]);
  }
  {
    const { data, error } = await magistrateClient.from("statutes").delete().eq("id", statute.id).select();
    check("5. A magistrate's DELETE affects zero rows", !error && (data ?? []).length === 0);
    const { data: stillThere } = await admin.from("statutes").select("id").eq("id", statute.id).maybeSingle();
    check("5b. The record still exists after the magistrate's delete attempt", !!stillThere);
  }

  // --- 5c-5f: a magistrate MAY publish a brand-new Act (Legislation page Add) ---
  {
    const magPdf = makeWellFormedMultiPagePdf([["Magistrate-uploaded Act."]], "mag-act.pdf");
    const magUserId = (await magistrateClient.auth.getUser()).data.user.id;
    const { data: magDraft, error: magCreateErr } = await magistrateClient
      .from("statutes")
      .insert({
        code: `MAG-${stamp}`,
        title: `Magistrate uploaded Act ${stamp}`,
        jurisdiction: jurisdiction.name,
        jurisdiction_id: jurisdiction.id,
        review_status: "draft",
      })
      .select()
      .single();
    check("5c. A magistrate can insert a draft Act", !magCreateErr && !!magDraft);
    if (magDraft) {
      created.statutes.push(magDraft.id);
      const magPath = `${magUserId}/statute/${magDraft.id}/${Date.now()}-mag-act.pdf`;
      await magistrateClient.storage.from("documents").upload(magPath, magPdf, { contentType: "application/pdf" });
      created.storagePaths.push(magPath);
      const { data: magDoc, error: magDocErr } = await magistrateClient
        .from("documents")
        .insert({
          uploaded_by: magUserId,
          file_name: "mag-act.pdf",
          file_path: magPath,
          file_size: magPdf.size,
          mime_type: "application/pdf",
          entity_type: "statute",
          entity_id: magDraft.id,
          purpose: "attachment",
        })
        .select()
        .single();
      check("5d. A magistrate can attach a PDF to their own draft Act", !magDocErr && !!magDoc);
      const { error: magFinalizeErr } = await magistrateClient.rpc("finalize_legislation_document", {
        p_statute_id: magDraft.id,
        p_document_id: magDoc.id,
        p_page_count: 1,
        p_has_text_layer: true,
      });
      checkErr("5e. A magistrate can finalize their own draft Act", magFinalizeErr, false);
      const { data: published } = await admin.from("statutes").select("review_status, created_by").eq("id", magDraft.id).single();
      check("5f. The magistrate-created Act is published and stamped as theirs", published.review_status === "published" && published.created_by === magUserId);
    }
  }

  // --- 6: admin CAN edit directly (matches the new edit page's plain update) ---
  {
    const { data, error } = await adminClient
      .from("statutes")
      .update({ short_title: "SJO Act" })
      .eq("id", statute.id)
      .select()
      .single();
    check("6. An admin's direct metadata update succeeds", !error && data?.short_title === "SJO Act");
    check("6b. review_status and primary_document_id are untouched by a metadata-only edit (no unpublish detour)", data.review_status === "published" && data.primary_document_id === document.id);
  }

  // --- 7-9: clerk remains fully excluded (regression check, unchanged behavior) ---
  {
    const { data } = await clerkClient.from("statutes").select("id").eq("id", statute.id);
    check("7. A clerk cannot read the record at all (unchanged from the file-first task)", (data ?? []).length === 0);
  }
  {
    const { error } = await clerkClient.from("statutes").update({ title: "Clerk hack" }).eq("id", statute.id);
    // RLS denies -> zero rows affected, not necessarily a thrown error.
    const { data: unchanged } = await admin.from("statutes").select("title").eq("id", statute.id).single();
    check("8. A clerk cannot edit the record (silently affects zero rows)", unchanged.title !== "Clerk hack", !error || true);
  }
  {
    const { error } = await clerkClient.rpc("finalize_legislation_document", { p_statute_id: statute.id, p_document_id: document.id });
    checkErr("9. A clerk cannot call finalize_legislation_document either", error, true);
  }

  // --- 10: admin CAN delete a record with a linked primary_document_id --
  // Regression test for a real bug caught by live UI testing (0101/0102):
  // deleting a file-first Legislation record threw "tuple to be deleted
  // was already modified by an operation triggered by the current
  // command" -- a circular conflict between documents_cascade_delete_-
  // statutes (BEFORE DELETE) and primary_document_id's own FK cascade.
  // Fixed by making the FK deferrable (0101) and switching the trigger
  // to AFTER DELETE, matching every other polymorphic parent table
  // (0102). This must never regress.
  {
    const { error } = await adminClient.from("statutes").delete().eq("id", statute.id);
    check("10. Admin can delete a record with a linked primary_document_id (no circular-trigger conflict)", !error, error?.message ?? "");
    const { data: gone } = await admin.from("statutes").select("id").eq("id", statute.id).maybeSingle();
    check("10b. The record is genuinely gone after delete", gone === null);
    const { data: docGone } = await admin.from("documents").select("id").eq("id", document.id).maybeSingle();
    check("10c. The linked documents row was cascade-removed too", docGone === null);
  }

  console.log(failures > 0 ? `\n${failures} failure(s).` : "\nAll legislation view/edit separation tests passed.");
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
