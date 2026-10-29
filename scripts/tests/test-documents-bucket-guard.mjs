// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * The documents bucket takes HTML only as a DOCX preview, and each person's
 * folder has a storage quota (0231), on a real database through the Storage
 * API, as real signed-in users.
 *
 *   HTML  an HTML upload is refused by the upload policy in the uploader's
 *         own folder under any other name, under a non-HTML name, at the
 *         preview path of a document that does not exist, and at the
 *         preview path of a document the uploader cannot open; a plain-text
 *         upload and a preview of a document the uploader can open still
 *         work. The stored preview is then fetched through a signed URL and
 *         its response headers are recorded, to show how Storage serves
 *         HTML (written to LIVE_REPORT_DIR when set).
 *   Quota my_documents_storage() reports the caller's usage and quota;
 *         with the recorded usage raised past the quota (psql, on the
 *         fixture's own object) a further upload is refused, and so is one
 *         that would cross it; with the real size restored it succeeds.
 *
 * Creates its own district, court, users and rows (all carrying the fixture
 * mark) and removes them afterwards, pass or fail. A fixture user the audit
 * ledger keeps is deactivated instead. Needs `psql` and the local stack.
 *
 *   npm run db:start && npm run test:documents-bucket-guard
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";
import { runSql } from "../test-support/psql.mjs";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
assertLocalSupabase(URL, "test-documents-bucket-guard");
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

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(URL, SERVICE, noSession);
const MARK = `BUCKET-${Date.now() % 1_000_000}`;
const PASSWORD = "Bucket-fixture-pass-123!";
const email = (name) => `${MARK.toLowerCase()}-${name}@example.test`;

const created = { users: [], courts: [], districts: [], judgments: [], objects: [] };

async function createUser(name) {
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
  return user;
}

async function signIn(user) {
  const client = createClient(URL, ANON, noSession);
  must(await client.auth.signInWithPassword({ email: user.email, password: PASSWORD }), "sign in");
  return client;
}

/** Uploads as `client`; returns null on success or Storage's error message. */
async function upload(client, objectPath, body, contentType) {
  const { error } = await client.storage
    .from("documents")
    .upload(objectPath, new Blob([body], { type: contentType }), { contentType, upsert: false });
  if (!error) created.objects.push(objectPath);
  return error ? error.message : null;
}

const RLS_REFUSAL = /row-level security/i;
const refusedByPolicy = (message) => message !== null && RLS_REFUSAL.test(message);

async function main() {
  // ---------- fixtures ----------
  const district = must(
    await admin
      .from("magisterial_districts")
      .insert({ name: `${MARK} District` })
      .select()
      .single(),
    "district",
  );
  created.districts.push(district.id);
  const court = must(
    await admin
      .from("courts")
      .insert({
        name: `${MARK} Court`,
        jurisdiction: "Test",
        district_id: district.id,
        is_active: true,
      })
      .select()
      .single(),
    "court",
  );
  created.courts.push(court.id);

  const owner = await createUser("owner");
  const outsider = await createUser("outsider");
  for (const user of [owner, outsider]) {
    must(
      await admin.from("magistrate_courts").insert({ profile_id: user.id, court_id: court.id }),
      "seat magistrate",
    );
  }
  const cOwner = await signIn(owner);
  const cOutsider = await signIn(outsider);

  // A private judgment of the owner's with an attachment: the preview source.
  const judgment = must(
    await cOwner
      .from("judgments")
      .insert({ title: `${MARK} reasons`, status: "draft" })
      .select("id")
      .single(),
    "judgment",
  );
  created.judgments.push(judgment.id);
  const sourcePath = `${owner.id}/judgment/${judgment.id}/${MARK}-source.txt`;
  check(
    "control: a plain-text upload into the uploader's own folder succeeds",
    await upload(cOwner, sourcePath, `${MARK} source`, "text/plain"),
    null,
  );
  const source = must(
    await cOwner
      .from("documents")
      .insert({
        uploaded_by: owner.id,
        file_name: `${MARK}-source.txt`,
        file_path: sourcePath,
        file_size: `${MARK} source`.length,
        mime_type: "text/plain",
        entity_type: "judgment",
        entity_id: judgment.id,
        purpose: "attachment",
      })
      .select("id")
      .single(),
    "source documents row",
  );

  // ---------- HTML ----------
  const html = `<!doctype html><title>${MARK}</title><script>document.title='ran'</script>`;
  const refusals = [
    ["under any other name", `${owner.id}/notes/${MARK}.html`, "text/html"],
    ["under a non-HTML name", `${owner.id}/${MARK}-looks-like.pdf`, "text/html"],
    ["with a charset parameter", `${owner.id}/${MARK}-charset.html`, "text/html; charset=utf-8"],
    [
      "at the preview path of a document that does not exist",
      `${owner.id}/preview-derivatives/${randomUUID()}.html`,
      "text/html",
    ],
    [
      "at a preview path with extra segments",
      `${owner.id}/preview-derivatives/x/${source.id}.html`,
      "text/html",
    ],
  ];
  for (const [label, objectPath, type] of refusals) {
    const message = await upload(cOwner, objectPath, html, type);
    console.log(`  ${label}: ${message}`);
    check(`HTML ${label} is refused`, message !== null, true);
    if (type === "text/html") {
      check(`HTML ${label} is refused by the upload policy`, refusedByPolicy(message), true);
    }
  }
  {
    const message = await upload(
      cOutsider,
      `${outsider.id}/preview-derivatives/${source.id}.html`,
      html,
      "text/html",
    );
    check(
      "HTML at the preview path of a document the uploader cannot open is refused by the policy",
      refusedByPolicy(message),
      true,
    );
  }

  const previewPath = `${owner.id}/preview-derivatives/${source.id}.html`;
  check(
    "control: a preview of a document the uploader can open is stored",
    await upload(cOwner, previewPath, html, "text/html"),
    null,
  );
  must(
    await cOwner.from("documents").insert({
      uploaded_by: owner.id,
      file_name: `${MARK}-source.txt.preview.html`,
      file_path: previewPath,
      file_size: html.length,
      mime_type: "text/html",
      entity_type: "judgment",
      entity_id: judgment.id,
      purpose: "preview_derivative",
      source_document_id: source.id,
    }),
    "preview documents row",
  );

  // How Storage serves the stored HTML through a signed URL.
  const signed = must(
    await cOwner.storage.from("documents").createSignedUrl(previewPath, 60),
    "sign preview",
  );
  const res = await fetch(signed.signedUrl);
  const served = {
    status: res.status,
    contentType: res.headers.get("content-type"),
    contentDisposition: res.headers.get("content-disposition"),
    xContentTypeOptions: res.headers.get("x-content-type-options"),
    contentSecurityPolicy: res.headers.get("content-security-policy"),
  };
  await res.body?.cancel();
  console.log("Signed-URL response for the stored HTML preview:", JSON.stringify(served));
  check("the stored preview is served through its signed URL", served.status, 200);
  const inline =
    /^text\/html/i.test(served.contentType ?? "") &&
    !/attachment/i.test(served.contentDisposition ?? "");
  const report = [
    "### Documents bucket: how Storage serves HTML (0231)",
    "",
    "| Header | Value |",
    "| --- | --- |",
    ...Object.entries(served).map(([k, v]) => `| ${k} | ${v ?? "(none)"} |`),
    "",
    inline
      ? "Served inline as text/html: a browser renders it on the Storage domain, so only DOCX previews may be HTML."
      : "Not rendered inline as HTML by a browser.",
    "",
  ].join("\n");
  if (process.env.LIVE_REPORT_DIR) {
    mkdirSync(process.env.LIVE_REPORT_DIR, { recursive: true });
    writeFileSync(path.join(process.env.LIVE_REPORT_DIR, "documents-bucket-html.md"), report);
  }

  // ---------- quota ----------
  const [usage] = must(await cOwner.rpc("my_documents_storage"), "my_documents_storage");
  console.log("Owner usage and quota:", JSON.stringify(usage));
  check("the quota is 5 GiB for a magistrate", usage.quota_bytes, 5 * 1024 ** 3);
  check(
    "usage counts the owner's stored files",
    usage.used_bytes,
    `${MARK} source`.length + html.length,
  );
  const [outsiderUsage] = must(
    await cOutsider.rpc("my_documents_storage"),
    "outsider my_documents_storage",
  );
  check("another person's usage is their own", outsiderUsage.used_bytes, 0);
  for (const fn of ["documents_storage_used_bytes", "documents_storage_quota_bytes"]) {
    const { error } = await cOwner.rpc(fn, { p_profile_id: outsider.id });
    check(`${fn} is not callable by a signed-in user`, error !== null, true);
  }

  const setRecordedSize = (bytes) =>
    runSql(
      `update storage.objects set metadata = jsonb_set(metadata, '{size}', to_jsonb(${bytes}::bigint))
       where bucket_id = 'documents' and name = '${sourcePath}';`,
      "test:documents-bucket-guard",
    );
  const quota = usage.quota_bytes;
  const otherBytes = html.length;

  setRecordedSize(quota - otherBytes + 1);
  {
    const message = await upload(cOwner, `${owner.id}/${MARK}-over.txt`, "x", "text/plain");
    console.log(`  over the quota: ${message}`);
    check(
      "over the quota, a further upload is refused by the policy",
      refusedByPolicy(message),
      true,
    );
  }

  setRecordedSize(quota - otherBytes - 10);
  {
    const message = await upload(
      cOwner,
      `${owner.id}/${MARK}-crosses.txt`,
      "y".repeat(100),
      "text/plain",
    );
    console.log(`  crossing the quota: ${message}`);
    check(
      "an upload that would cross the quota is refused by the policy",
      refusedByPolicy(message),
      true,
    );
  }

  setRecordedSize(`${MARK} source`.length);
  check(
    "below the quota again, the upload succeeds",
    await upload(cOwner, `${owner.id}/${MARK}-after.txt`, "z", "text/plain"),
    null,
  );
}

async function cleanup() {
  try {
    if (created.judgments.length > 0) {
      await admin.from("documents").delete().in("entity_id", created.judgments);
    }
    if (created.objects.length > 0) await admin.storage.from("documents").remove(created.objects);
    await admin.from("storage_cleanup_queue").delete().in("object_name", created.objects);
    if (created.judgments.length > 0) {
      await admin.from("judgments").delete().in("id", created.judgments);
    }
    if (created.courts.length > 0) {
      await admin.from("magistrate_courts").delete().in("court_id", created.courts);
      await admin.from("courts").delete().in("id", created.courts);
    }
    if (created.districts.length > 0)
      await admin.from("magisterial_districts").delete().in("id", created.districts);
    let kept = 0;
    for (const userId of created.users) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) {
        kept += 1;
        await admin.from("profiles").update({ is_active: false }).eq("id", userId);
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
