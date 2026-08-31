import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";
import { resolveStoredMimeType } from "@/lib/ingest-source";

const key = (entityType: string, entityId: string) =>
  ["documents", entityType, entityId] as const;

const DOCUMENTS_BUCKET = "documents";

/**
 * Shared attachment layer for every polymorphic Document parent
 * (`entity_type`/`entity_id` — docket_matter, judgment, case_law,
 * quick_code, bench_note). One implementation instead of duplicating
 * upload/list/delete logic per feature area. Deletion order is
 * Storage-API-first, then the `public.documents` metadata row — per the
 * 0049 resolution, direct SQL deletion of a storage object orphans the
 * physical blob, so the Storage API call must happen first and the
 * metadata row is only removed once that succeeds. If Storage removal
 * fails, the metadata row is deliberately left in place (the document
 * stays visible/re-deletable) rather than silently orphaning it.
 */
export function useDocuments(entityType: string, entityId: string | undefined) {
  return useQuery({
    queryKey: key(entityType, entityId ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        // preview_derivative rows (0083) are a generated caching artifact
        // of another document, never a real attachment -- excluded here,
        // at the one shared query every consumer of this hook goes
        // through, rather than trusting each consumer to filter it out
        // (unlike cover/identification_photo, which ARE real, purpose-
        // specific attachments some views deliberately query for).
        .neq("purpose", "preview_derivative")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!entityId,
  });
}

/**
 * Core upload implementation, extracted so it can be called from contexts
 * that don't know the target `entityId` until runtime (e.g. the Legal
 * Library "draft-row-first" ingestion flow, which must create the
 * `case_law`/`statutes` row via a transactional RPC FIRST to obtain a real
 * id, then attach the original file to that real id) as well as from the
 * `useUploadDocument` hook below, which is used everywhere the entityId is
 * already known at render time. Same upload-then-insert-then-cleanup-on-
 * failure behavior in both cases -- no divergence between the two paths.
 */
export type DocumentPurpose = "attachment" | "cover" | "identification_photo" | "ruling" | "judgment";

export async function uploadDocumentToEntity(
  entityType: string,
  entityId: string,
  file: File,
  purpose: DocumentPurpose = "attachment",
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${user.id}/${entityType}/${entityId}/${Date.now()}-${safeName}`;

  const mimeType = await resolveStoredMimeType(file)
  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, file, { upsert: false, contentType: mimeType });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from("documents")
    .insert({
      uploaded_by: user.id,
      file_name: file.name,
      file_path: path,
      file_size: file.size,
      mime_type: mimeType,
      entity_type: entityType,
      entity_id: entityId,
      purpose,
    })
    .select()
    .single();
  if (error) {
    // Metadata insert failed after a successful storage upload — clean
    // up the now-unreferenced blob rather than leaving it orphaned.
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    throw error;
  }
  return data;
}

export function useUploadDocument(entityType: string, entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: File | { file: File; purpose: DocumentPurpose }) =>
      input instanceof File
        ? uploadDocumentToEntity(entityType, entityId, input)
        : uploadDocumentToEntity(entityType, entityId, input.file, input.purpose),
    onSuccess: () => {
      toast.success("Document uploaded.");
      void queryClient.invalidateQueries({
        queryKey: key(entityType, entityId),
      });
      // Ruling/Judgment purpose docs drive the Docket board's
      // has_ruling_document/has_judgment_document indicator (0074) --
      // literal key, not an import of docketMattersKeys, to avoid coupling
      // this generic module to one feature area (same tradeoff already
      // made for importJobsQueryKey elsewhere in this codebase).
      if (entityType === "docket_matter") {
        void queryClient.invalidateQueries({ queryKey: ["docket-matters"] });
      }
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}

/**
 * Download through the authenticated Storage API so RLS is re-checked on
 * every request. Callers that need a URL should create a blob: object URL
 * and revoke it when finished — signed URLs stay valid after access is
 * revoked, which this path avoids.
 */
export async function downloadDocumentBlob(filePath: string): Promise<Blob> {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .download(filePath);
  if (error || !data) throw error ?? new Error("Could not download this file.");
  return data;
}

/** Object URL for a one-shot download. Caller must revoke the URL. */
export async function getDocumentDownloadUrl(filePath: string): Promise<string> {
  const blob = await downloadDocumentBlob(filePath);
  return URL.createObjectURL(blob);
}

/** Download the stored original as a File (Review Queue reprocess). */
export async function downloadDocumentAsFile(documentId: string): Promise<File> {
  const { data: doc, error } = await supabase
    .from("documents")
    .select("file_name, file_path, mime_type")
    .eq("id", documentId)
    .single();
  if (error) throw error;
  if (!doc?.file_path) throw new Error("Original file is missing from storage.");
  const { data: blob, error: downloadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .download(doc.file_path);
  if (downloadError || !blob) throw downloadError ?? new Error("Could not download the original file.");
  return new File([blob], doc.file_name || "original.pdf", {
    type: doc.mime_type || blob.type || "application/pdf",
  });
}

/**
 * In-app view URL. A `blob:` object URL (the previous approach here) is
 * what a shared signed URL should have been replaced with, but Chromium
 * does not reliably render a PDF navigated into an `<iframe>` via a
 * `blob:` URL — the built-in PDF viewer's activation path expects a real
 * network response, and the frame's navigation to the blob silently
 * aborts (confirmed: the blob itself is valid and correctly typed —
 * `fetch()` on it from the same page succeeds — only the iframe
 * navigation fails). A short-lived signed URL (60s) keeps the original
 * security intent — RLS is re-checked at signing time and the URL is
 * worthless well before a magistrate could usefully share it — while
 * still being a normal HTTP(S) response Chromium's PDF viewer renders
 * the same way it always has. Caller does not need to revoke anything;
 * the URL simply expires.
 */
export async function getDocumentViewUrl(filePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(filePath, 60);
  if (error || !data) throw error ?? new Error("Could not load this document for preview.");
  return data.signedUrl;
}

/**
 * Looks up an already-generated, cached preview derivative for a source
 * document (0083's `source_document_id`/`purpose='preview_derivative'`).
 * RLS on `documents` covers this with no extra check needed here -- a
 * derivative always carries the exact same entity_type/entity_id as its
 * source, so "can the caller see this derivative row" is identical to
 * "can the caller see the source document's parent," the same visibility
 * boundary as everything else this file returns.
 */
export async function findDocxPreviewDerivative(
  sourceDocumentId: string,
): Promise<{ id: string; file_path: string } | null> {
  const { data, error } = await supabase
    .from("documents")
    .select("id, file_path")
    .eq("source_document_id", sourceDocumentId)
    .eq("purpose", "preview_derivative")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Generates and caches a faithful, page-based DOCX preview for `doc`
 * (docx-page-preview.ts), uploading the sanitized HTML snapshot as a new
 * `documents` row pointing back at `doc.id` (purpose='preview_derivative').
 * Stored under the CALLING user's own Storage folder regardless of who
 * owns/uploaded the source -- required by storage.objects' own-folder
 * INSERT policy, harmless because read access is governed entirely by the
 * `documents` metadata row (0083's insert policy), not by folder
 * ownership, exactly like every other document in this bucket.
 *
 * A race between two viewers generating the same derivative concurrently
 * is resolved by the partial unique index on source_document_id (0083):
 * the losing insert fails with 23505, at which point this cleans up its
 * own now-orphaned blob and returns the winner's row instead of erroring.
 */
export async function generateAndCacheDocxPreview(doc: {
  id: string;
  file_path: string;
  entity_type: string | null;
  entity_id: string | null;
}): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { renderDocxToPageSnapshot } = await import("@/lib/docx-page-preview");
  const sourceBlob = await downloadDocumentBlob(doc.file_path);
  const snapshot = await renderDocxToPageSnapshot(await sourceBlob.arrayBuffer());

  const derivativePath = `${user.id}/preview-derivatives/${doc.id}.html`;
  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(derivativePath, new Blob([snapshot], { type: "text/html" }), {
      upsert: false,
      contentType: "text/html",
    });
  if (uploadError) throw uploadError;

  const { error: insertError } = await supabase.from("documents").insert({
    uploaded_by: user.id,
    file_name: `${doc.file_path.split("/").pop() ?? "preview"}.preview.html`,
    file_path: derivativePath,
    file_size: snapshot.length,
    mime_type: "text/html",
    entity_type: doc.entity_type,
    entity_id: doc.entity_id,
    purpose: "preview_derivative",
    source_document_id: doc.id,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      // Another viewer's generation won the race -- their row is now the
      // canonical derivative. Clean up this blob and use theirs.
      await supabase.storage.from(DOCUMENTS_BUCKET).remove([derivativePath]);
      const existing = await findDocxPreviewDerivative(doc.id);
      if (existing) {
        const winningBlob = await downloadDocumentBlob(existing.file_path);
        return winningBlob.text();
      }
    }
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([derivativePath]);
    throw insertError;
  }

  return snapshot;
}

export function useDeleteDocument(entityType: string, entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (doc: { id: string; file_path: string }) => {
      // Best-effort: remove any cached preview derivative's Storage blob
      // before the source row goes away. The `documents` METADATA row for
      // the derivative cascades automatically (source_document_id ...
      // on delete cascade, 0083) once the source document row below is
      // deleted -- this step only prevents that derivative's Storage blob
      // from being orphaned, matching this project's existing "remove the
      // blob client-side before/alongside the metadata row" pattern.
      // Never blocks the actual deletion if it fails.
      try {
        const derivative = await findDocxPreviewDerivative(doc.id);
        if (derivative) {
          await supabase.storage.from(DOCUMENTS_BUCKET).remove([derivative.file_path]);
        }
      } catch (err) {
        console.error("Could not clean up cached preview derivative:", err);
      }

      const { error: storageError } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .remove([doc.file_path]);
      if (storageError) {
        // Deliberately does not interpolate storageError.message -- that's
        // raw Supabase Storage API text, not something a user should ever
        // see (Section 38: no raw internals in user-facing errors).
        console.error("Storage removal failed while deleting document:", storageError);
        throw new Error(
          "Could not remove the file from storage. The document record was left in place. Please retry.",
        );
      }
      const { error } = await supabase
        .from("documents")
        .delete()
        .eq("id", doc.id);
      if (error) {
        // The blob is already gone from Storage at this point — don't let
        // the UI imply nothing happened. This is a genuine partial
        // failure, not a full success or a full no-op.
        throw new Error(
          `The file was removed from storage, but its record couldn't be cleaned up (${getErrorMessage(error)}). Refresh the page; if it still appears, it's now a broken link and can be safely deleted again.`,
        );
      }
    },
    onSuccess: () => {
      toast.success("Document deleted.");
      void queryClient.invalidateQueries({
        queryKey: key(entityType, entityId),
      });
      if (entityType === "docket_matter") {
        void queryClient.invalidateQueries({ queryKey: ["docket-matters"] });
      }
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}
