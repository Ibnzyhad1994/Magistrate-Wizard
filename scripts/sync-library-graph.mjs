// Copy canonical library parents together with tags, documents, and
// Storage objects from one Supabase project to another.
//
// Usage (from repo root, with ~/.magistrate-wizard-supabase-token set):
//   node scripts/sync-library-graph.mjs
//
// Copies published owner-less case_law (all columns including
// full_text/summary), tags + case_law_tags, published statutes (jurisdiction
// remapped by name), and documents/storage for case_law, statute, and
// judgment rows that already exist on the destination. Skips personal
// case_law and needs_review untitled rows.

import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROD_REF = "gipijpeahkznfwitjccy";
const STG_REF = "kmfjejfsbtvbhvpoxvhb";
const PROD_URL = "https://gipijpeahkznfwitjccy.supabase.co";
const STG_URL = "https://kmfjejfsbtvbhvpoxvhb.supabase.co";
const STAGING_ADMIN = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const BUCKET = "documents";

const CASE_LAW_COLUMNS =
  "id, case_name, citation, court, jurisdiction, decided_date, summary, full_text, source_url, created_at, updated_at, owner_id, is_discoverable, neutral_citation, reported_citation, judges, parties, issues, principles, key_passages, disposition, review_status, retrieved_at, document_hash, original_filename, content_quality_status";

const STATUTE_COLUMNS =
  "id, code, title, jurisdiction, summary, full_text, source_url, effective_date, created_at, updated_at, short_title, instrument_type, act_number, chapter_number, enactment_year, commencement_note, amendment_note, is_current_version, review_status, retrieved_at, document_hash, original_filename, content_quality_status, page_count, has_text_layer, primary_document_id";

const throwIf = (error, label) => {
  if (error) throw new Error(`${label}: ${error.message}`);
};

const loadServiceRoleKey = (ref) => {
  const token = readFileSync(join(homedir(), ".magistrate-wizard-supabase-token"), "utf8").trim();
  const out = execSync(
    `npx supabase projects api-keys --project-ref ${ref} --reveal --output json`,
    {
      encoding: "utf8",
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const keys = JSON.parse(out.replace(/^\uFEFF/, "").trim());
  const service = keys.find((row) => row.name === "service_role");
  if (!service?.api_key) throw new Error(`No service_role key for ${ref}`);
  return service.api_key;
};

const client = (url, key) =>
  createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const copyStorageAndDocuments = async ({ prod, stg, docs, uploadedBy }) => {
  let copied = 0;
  let skipped = 0;
  for (const doc of docs) {
    const { data: blob, error: dlErr } = await prod.storage.from(BUCKET).download(doc.file_path);
    if (dlErr || !blob) {
      skipped += 1;
      console.log(`skip download ${doc.id}: ${dlErr?.message ?? "empty"}`);
      continue;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const { error: upErr } = await stg.storage.from(BUCKET).upload(doc.file_path, bytes, {
      contentType: doc.mime_type || "application/octet-stream",
      upsert: true,
    });
    if (upErr) {
      skipped += 1;
      console.log(`skip upload ${doc.id}: ${upErr.message}`);
      continue;
    }
    copied += 1;
  }

  const attachments = docs.filter((doc) => doc.purpose !== "preview_derivative");
  const previews = docs.filter((doc) => doc.purpose === "preview_derivative");
  if (attachments.length) {
    const { error } = await stg.from("documents").upsert(
      attachments.map((doc) => ({ ...doc, uploaded_by: uploadedBy })),
      { onConflict: "id" },
    );
    throwIf(error, "upsert documents (attachments)");
  }
  if (previews.length) {
    const { error } = await stg.from("documents").upsert(
      previews.map((doc) => ({ ...doc, uploaded_by: uploadedBy })),
      { onConflict: "id" },
    );
    throwIf(error, "upsert documents (previews)");
  }
  return { copied, skipped, rows: docs.length };
};

const main = async () => {
  const prod = client(PROD_URL, loadServiceRoleKey(PROD_REF));
  const stg = client(STG_URL, loadServiceRoleKey(STG_REF));

  const { data: srcCases, error: srcCaseErr } = await prod
    .from("case_law")
    .select(CASE_LAW_COLUMNS)
    .eq("review_status", "published")
    .is("owner_id", null);
  throwIf(srcCaseErr, "select prod published canonical case_law");

  const { data: destCases, error: destCaseErr } = await stg.from("case_law").select("id");
  throwIf(destCaseErr, "list staging case_law");
  const destCaseIds = new Set((destCases ?? []).map((row) => row.id));

  // UPDATE existing rows only. INSERT of owner_id IS NULL is blocked by
  // case_law_ownership_guard() unless auth.uid() is an admin session;
  // service_role has no auth.uid(), so new canonical shells cannot be
  // created through this client. Bodies on matching ids still copy.
  let updatedCases = 0;
  for (const row of srcCases ?? []) {
    if (!destCaseIds.has(row.id)) continue;
    const { id, owner_id: _ownerId, ...fields } = row;
    const { error } = await stg
      .from("case_law")
      .update({
        ...fields,
        created_by: STAGING_ADMIN,
      })
      .eq("id", id);
    throwIf(error, `update case_law ${id}`);
    updatedCases += 1;
  }
  console.log(`updated case_law: ${updatedCases}`);

  const { data: destJudgments, error: destJudErr } = await stg.from("judgments").select("id");
  throwIf(destJudErr, "list staging judgments");
  const destJudgmentIds = new Set((destJudgments ?? []).map((row) => row.id));

  const { data: prodJurs, error: prodJurErr } = await prod
    .from("legal_jurisdictions")
    .select("id, name");
  throwIf(prodJurErr, "select prod jurisdictions");
  const { data: stgJurs, error: stgJurErr } = await stg
    .from("legal_jurisdictions")
    .select("id, name");
  throwIf(stgJurErr, "select staging jurisdictions");
  const jurIdByName = new Map((stgJurs ?? []).map((row) => [row.name, row.id]));
  const prodJurNameById = new Map((prodJurs ?? []).map((row) => [row.id, row.name]));

  const { data: srcStatutes, error: srcStatErr } = await prod
    .from("statutes")
    .select(`${STATUTE_COLUMNS}, jurisdiction_id`)
    .eq("review_status", "published");
  throwIf(srcStatErr, "select prod published statutes");
  const statuteRows = (srcStatutes ?? []).map((row) => {
    const name = prodJurNameById.get(row.jurisdiction_id);
    const remapped = name ? jurIdByName.get(name) ?? null : null;
    return {
      ...row,
      jurisdiction_id: remapped,
      created_by: STAGING_ADMIN,
      source_id: null,
      import_job_id: null,
      supersedes_statute_id: null,
      primary_document_id: null,
    };
  });
  if (statuteRows.length) {
    const { error } = await stg.from("statutes").upsert(statuteRows, { onConflict: "id" });
    throwIf(error, "upsert staging statutes");
  }
  console.log(`upserted statutes: ${statuteRows.length}`);

  const { data: destStatutes, error: destStatErr } = await stg.from("statutes").select("id");
  throwIf(destStatErr, "list staging statutes");
  const destStatuteIds = new Set((destStatutes ?? []).map((row) => row.id));

  const { data: prodTags, error: tagsErr } = await prod.from("tags").select("id, name, color");
  throwIf(tagsErr, "select prod tags");
  if (prodTags?.length) {
    const { error } = await stg.from("tags").upsert(
      prodTags.map((tag) => ({ ...tag, created_by: STAGING_ADMIN })),
      { onConflict: "id" },
    );
    throwIf(error, "upsert staging tags");
  }
  console.log(`upserted tags: ${prodTags?.length ?? 0}`);

  const { data: prodLinks, error: linksErr } = await prod
    .from("case_law_tags")
    .select("case_law_id, tag_id");
  throwIf(linksErr, "select prod case_law_tags");
  const links = (prodLinks ?? []).filter((link) => destCaseIds.has(link.case_law_id));
  if (links.length) {
    const { error } = await stg.from("case_law_tags").upsert(links, {
      onConflict: "case_law_id,tag_id",
    });
    throwIf(error, "upsert staging case_law_tags");
  }
  console.log(`upserted case_law_tags: ${links.length}`);

  const { data: prodDocs, error: docsErr } = await prod
    .from("documents")
    .select(
      "id, file_name, file_path, file_size, mime_type, created_at, entity_type, entity_id, purpose, source_document_id",
    )
    .in("entity_type", ["case_law", "statute", "judgment"]);
  throwIf(docsErr, "select prod library documents");

  const docs = (prodDocs ?? []).filter((doc) => {
    if (doc.entity_type === "case_law") return destCaseIds.has(doc.entity_id);
    if (doc.entity_type === "statute") return destStatuteIds.has(doc.entity_id);
    if (doc.entity_type === "judgment") return destJudgmentIds.has(doc.entity_id);
    return false;
  });

  const storage = await copyStorageAndDocuments({
    prod,
    stg,
    docs,
    uploadedBy: STAGING_ADMIN,
  });
  console.log(
    `documents: ${storage.rows} rows, storage copied ${storage.copied}, skipped ${storage.skipped}`,
  );

  for (const statute of srcStatutes ?? []) {
    if (!statute.primary_document_id || !destStatuteIds.has(statute.id)) continue;
    const { error } = await stg
      .from("statutes")
      .update({ primary_document_id: statute.primary_document_id })
      .eq("id", statute.id);
    throwIf(error, `set statute primary_document_id ${statute.id}`);
  }

  const { count: ftCount } = await stg
    .from("case_law")
    .select("id", { count: "exact", head: true })
    .not("full_text", "is", null);
  const { count: smCount } = await stg
    .from("case_law")
    .select("id", { count: "exact", head: true })
    .not("summary", "is", null);
  const { count: docCount } = await stg
    .from("documents")
    .select("id", { count: "exact", head: true })
    .in("entity_type", ["case_law", "statute", "judgment"]);
  const { count: statuteCount } = await stg
    .from("statutes")
    .select("id", { count: "exact", head: true });
  console.log(
    JSON.stringify({
      staging_with_full_text: ftCount,
      staging_with_summary: smCount,
      staging_library_documents: docCount,
      staging_statutes: statuteCount,
    }),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
